import pg, { type Pool, type PoolClient } from "pg";
import { assertNoOverlaps } from "../../domain/validation.js";
import type {
  Day,
  DayBlock,
  DayBlockInput,
  DayUpsertInput,
  Flight,
  FlightAddInput,
  FlightUpdateInput,
  PackingItem,
  Person,
  PersonAddInput,
  PersonUpdateInput,
  Stay,
  StayAddInput,
  StayUpdateInput,
  Trip,
  TripCreateInput,
  TripUpdateInput,
} from "../../domain/types.js";
import { NotFoundError, type QueryFilters, type QueryResult, type TripkitRepository } from "../repository.js";
import { newId, nowIso } from "../../utils/id.js";
import { n } from "../../utils/normalize.js";
import type { VerifiedSupabaseClaims } from "./identity.js";
import { withAuthenticatedTransaction } from "./withAuth.js";

// pg's default type parsers turn `date`/`timestamptz` columns into JS Date objects, which
// would then need re-stringifying to match the ISO/YYYY-MM-DD string shape every other
// TripkitRepository implementation returns. Parse them as plain strings instead: OID 1082 is
// `date`, which Postgres already sends as `YYYY-MM-DD` text; OID 1184 is `timestamptz`, sent
// as e.g. `2026-04-10 14:30:00+00`, normalized to ISO via Date (which parses that fine).
pg.types.setTypeParser(1082, (value) => value);
pg.types.setTypeParser(1184, (value) => new Date(value).toISOString());

interface TripRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  home_timezone: string;
  notes: string | null;
  owner_account_id: string;
  created_at: string;
  updated_at: string;
}

interface PersonRow {
  id: string;
  trip_id: string;
  name: string;
  email: string | null;
  role: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface FlightRow {
  id: string;
  trip_id: string;
  airline: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  departure_time: string;
  arrival_time: string;
  confirmation: string | null;
  seat: string | null;
  traveler_ids: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface StayRow {
  id: string;
  trip_id: string;
  name: string;
  check_in: string;
  check_out: string;
  address: string | null;
  confirmation: string | null;
  guest_ids: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface DayRow {
  id: string;
  trip_id: string;
  date: string;
  title: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface DayBlockRow {
  id: string;
  day_id: string;
  block_order: number;
  start_time: string;
  end_time: string;
  type: string;
  title: string;
  place: string | null;
  notes: string | null;
}

interface PackingItemRow {
  id: string;
  trip_id: string;
  category: string;
  label: string;
  quantity: number;
  packed: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toTrip(row: TripRow): Trip {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    homeTimezone: row.home_timezone,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    tripId: row.trip_id,
    name: row.name,
    email: row.email ?? undefined,
    role: row.role ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFlight(row: FlightRow): Flight {
  return {
    id: row.id,
    tripId: row.trip_id,
    airline: row.airline,
    flightNumber: row.flight_number,
    departureAirport: row.departure_airport,
    arrivalAirport: row.arrival_airport,
    departureTime: row.departure_time,
    arrivalTime: row.arrival_time,
    confirmation: row.confirmation ?? undefined,
    seat: row.seat ?? undefined,
    travelerIds: row.traveler_ids,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStay(row: StayRow): Stay {
  return {
    id: row.id,
    tripId: row.trip_id,
    name: row.name,
    checkIn: row.check_in,
    checkOut: row.check_out,
    address: row.address ?? undefined,
    confirmation: row.confirmation ?? undefined,
    guestIds: row.guest_ids,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDayBlock(row: DayBlockRow): DayBlock {
  return {
    id: row.id,
    dayId: row.day_id,
    order: row.block_order,
    startTime: row.start_time,
    endTime: row.end_time,
    type: row.type as DayBlock["type"],
    title: row.title,
    place: row.place ?? undefined,
    notes: row.notes ?? undefined,
  };
}

function toPackingItem(row: PackingItemRow): PackingItem {
  return {
    id: row.id,
    tripId: row.trip_id,
    category: row.category,
    label: row.label,
    quantity: row.quantity,
    packed: row.packed,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Postgres-backed repository, scoped per Account by real RLS rather than an in-app
 * permission check. Every call opens its own transaction, forwards the caller's already-
 * verified JWT claims (see `src/mcp/oauth/supabaseTokenVerifier.ts`) into
 * `request.jwt.claims`, and switches to the `authenticated` Postgres role for that
 * transaction only (`SET LOCAL`, so it can never leak onto a pooled connection handed back
 * for someone else's request afterward) — the direct-Postgres JWT-forwarding design recorded
 * on ticket #8, chosen specifically to avoid relying on supabase-js's own (currently broken
 * for OAuth-Server tokens — see supabase/supabase#41668) bearer-forwarding path.
 *
 * Implements the full `TripkitRepository` surface (ticket #20 completes what ticket #19
 * started with Trip create/get/list/update). Every method is `async`/`Promise`-returning
 * because RLS enforcement requires a genuine network round trip per call — `TripkitRepository`
 * itself is declared with `Promise`-returning methods for exactly this reason.
 */
export class SupabaseTripkitRepository implements TripkitRepository {
  constructor(
    private readonly pool: Pool,
    private readonly claims: VerifiedSupabaseClaims,
  ) {}

  // A no-op, unlike SqliteTripkitRepository.close(): this instance doesn't own its Pool — the
  // same pool is meant to be shared across many per-request instances (one per authenticated
  // identity), so ending it here would kill every other instance's connections too. Whoever
  // constructs the pool is responsible for ending it. Exists only to satisfy TripkitRepository.
  close(): void {}

  private withAuth<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return withAuthenticatedTransaction(this.pool, this.claims, fn);
  }

  // ---------------------------------------------------------------- trips

  async createTrip(input: TripCreateInput): Promise<Trip> {
    return this.withAuth(async (client) => {
      const id = newId("trip");
      const ts = nowIso();
      await client.query(
        `INSERT INTO trips (id, name, start_date, end_date, home_timezone, notes, owner_account_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, input.name, input.startDate, input.endDate, input.homeTimezone, input.notes ?? null, this.claims.sub, ts, ts],
      );
      // ADR 0005: the Owner gets a trip_members row too, in the same transaction as creation.
      await client.query(`INSERT INTO trip_members (trip_id, account_id, role) VALUES ($1, $2, 'owner')`, [
        id,
        this.claims.sub,
      ]);
      return this.getTripInTxOrThrow(client, id);
    });
  }

  async updateTrip(input: TripUpdateInput): Promise<Trip> {
    return this.withAuth(async (client) => {
      const existing = await this.getTripInTxOrThrow(client, input.id);
      const merged: Trip = {
        ...existing,
        name: input.name ?? existing.name,
        startDate: input.startDate ?? existing.startDate,
        endDate: input.endDate ?? existing.endDate,
        homeTimezone: input.homeTimezone ?? existing.homeTimezone,
        notes: input.notes ?? existing.notes,
        updatedAt: nowIso(),
      };
      await client.query(
        `UPDATE trips SET name = $1, start_date = $2, end_date = $3, home_timezone = $4, notes = $5, updated_at = $6
         WHERE id = $7`,
        [merged.name, merged.startDate, merged.endDate, merged.homeTimezone, merged.notes ?? null, merged.updatedAt, merged.id],
      );
      return this.getTripInTxOrThrow(client, merged.id);
    });
  }

  async getTrip(id: string): Promise<Trip | undefined> {
    return this.withAuth((client) => this.getTripInTx(client, id));
  }

  async listTrips(): Promise<Trip[]> {
    return this.withAuth(async (client) => {
      const { rows } = await client.query<TripRow>(`SELECT * FROM trips ORDER BY start_date ASC`);
      return rows.map(toTrip);
    });
  }

  private async getTripInTx(client: PoolClient, id: string): Promise<Trip | undefined> {
    const { rows } = await client.query<TripRow>(`SELECT * FROM trips WHERE id = $1`, [id]);
    return rows[0] ? toTrip(rows[0]) : undefined;
  }

  private async getTripInTxOrThrow(client: PoolClient, id: string): Promise<Trip> {
    const trip = await this.getTripInTx(client, id);
    if (!trip) throw new NotFoundError("trip", id);
    return trip;
  }

  // --------------------------------------------------------------- people

  async addPerson(input: PersonAddInput): Promise<Person> {
    return this.withAuth(async (client) => {
      await this.getTripInTxOrThrow(client, input.tripId);
      const id = newId("person");
      const ts = nowIso();
      await client.query(
        `INSERT INTO people (id, trip_id, name, email, role, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, input.tripId, input.name, n(input.email), n(input.role), n(input.notes), ts, ts],
      );
      return this.getPersonInTxOrThrow(client, id);
    });
  }

  async updatePerson(input: PersonUpdateInput): Promise<Person> {
    return this.withAuth(async (client) => {
      const existing = await this.getPersonInTxOrThrow(client, input.id);
      const merged: Person = {
        ...existing,
        name: input.name ?? existing.name,
        email: input.email ?? existing.email,
        role: input.role ?? existing.role,
        notes: input.notes ?? existing.notes,
        updatedAt: nowIso(),
      };
      await client.query(
        `UPDATE people SET name = $1, email = $2, role = $3, notes = $4, updated_at = $5 WHERE id = $6`,
        [merged.name, n(merged.email), n(merged.role), n(merged.notes), merged.updatedAt, merged.id],
      );
      return this.getPersonInTxOrThrow(client, merged.id);
    });
  }

  async listPeople(tripId: string): Promise<Person[]> {
    return this.withAuth((client) => this.listPeopleInTx(client, tripId));
  }

  private async listPeopleInTx(client: PoolClient, tripId: string): Promise<Person[]> {
    const { rows } = await client.query<PersonRow>(
      `SELECT * FROM people WHERE trip_id = $1 ORDER BY created_at ASC`,
      [tripId],
    );
    return rows.map(toPerson);
  }

  private async getPersonInTx(client: PoolClient, id: string): Promise<Person | undefined> {
    const { rows } = await client.query<PersonRow>(`SELECT * FROM people WHERE id = $1`, [id]);
    return rows[0] ? toPerson(rows[0]) : undefined;
  }

  private async getPersonInTxOrThrow(client: PoolClient, id: string): Promise<Person> {
    const person = await this.getPersonInTx(client, id);
    if (!person) throw new NotFoundError("person", id);
    return person;
  }

  // -------------------------------------------------------------- flights

  async addFlight(input: FlightAddInput): Promise<Flight> {
    return this.withAuth(async (client) => {
      await this.getTripInTxOrThrow(client, input.tripId);
      const id = newId("flight");
      const ts = nowIso();
      await client.query(
        `INSERT INTO flights (id, trip_id, airline, flight_number, departure_airport, arrival_airport,
           departure_time, arrival_time, confirmation, seat, traveler_ids, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          id,
          input.tripId,
          input.airline,
          input.flightNumber,
          input.departureAirport.toUpperCase(),
          input.arrivalAirport.toUpperCase(),
          input.departureTime,
          input.arrivalTime,
          n(input.confirmation),
          n(input.seat),
          JSON.stringify(input.travelerIds ?? []),
          n(input.notes),
          ts,
          ts,
        ],
      );
      return this.getFlightInTxOrThrow(client, id);
    });
  }

  async updateFlight(input: FlightUpdateInput): Promise<Flight> {
    return this.withAuth(async (client) => {
      const existing = await this.getFlightInTxOrThrow(client, input.id);
      const merged: Flight = {
        ...existing,
        airline: input.airline ?? existing.airline,
        flightNumber: input.flightNumber ?? existing.flightNumber,
        departureAirport: (input.departureAirport ?? existing.departureAirport).toUpperCase(),
        arrivalAirport: (input.arrivalAirport ?? existing.arrivalAirport).toUpperCase(),
        departureTime: input.departureTime ?? existing.departureTime,
        arrivalTime: input.arrivalTime ?? existing.arrivalTime,
        confirmation: input.confirmation ?? existing.confirmation,
        seat: input.seat ?? existing.seat,
        travelerIds: input.travelerIds ?? existing.travelerIds,
        notes: input.notes ?? existing.notes,
        updatedAt: nowIso(),
      };
      await client.query(
        `UPDATE flights SET airline = $1, flight_number = $2, departure_airport = $3, arrival_airport = $4,
           departure_time = $5, arrival_time = $6, confirmation = $7, seat = $8, traveler_ids = $9, notes = $10,
           updated_at = $11
         WHERE id = $12`,
        [
          merged.airline,
          merged.flightNumber,
          merged.departureAirport,
          merged.arrivalAirport,
          merged.departureTime,
          merged.arrivalTime,
          n(merged.confirmation),
          n(merged.seat),
          JSON.stringify(merged.travelerIds),
          n(merged.notes),
          merged.updatedAt,
          merged.id,
        ],
      );
      return this.getFlightInTxOrThrow(client, merged.id);
    });
  }

  async listFlights(tripId: string): Promise<Flight[]> {
    return this.withAuth((client) => this.listFlightsInTx(client, tripId));
  }

  private async listFlightsInTx(client: PoolClient, tripId: string): Promise<Flight[]> {
    const { rows } = await client.query<FlightRow>(
      `SELECT * FROM flights WHERE trip_id = $1 ORDER BY departure_time ASC`,
      [tripId],
    );
    return rows.map(toFlight);
  }

  private async getFlightInTx(client: PoolClient, id: string): Promise<Flight | undefined> {
    const { rows } = await client.query<FlightRow>(`SELECT * FROM flights WHERE id = $1`, [id]);
    return rows[0] ? toFlight(rows[0]) : undefined;
  }

  private async getFlightInTxOrThrow(client: PoolClient, id: string): Promise<Flight> {
    const flight = await this.getFlightInTx(client, id);
    if (!flight) throw new NotFoundError("flight", id);
    return flight;
  }

  // ---------------------------------------------------------------- stays

  async addStay(input: StayAddInput): Promise<Stay> {
    return this.withAuth(async (client) => {
      await this.getTripInTxOrThrow(client, input.tripId);
      const id = newId("stay");
      const ts = nowIso();
      await client.query(
        `INSERT INTO stays (id, trip_id, name, check_in, check_out, address, confirmation, guest_ids, notes,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          input.tripId,
          input.name,
          input.checkIn,
          input.checkOut,
          n(input.address),
          n(input.confirmation),
          JSON.stringify(input.guestIds ?? []),
          n(input.notes),
          ts,
          ts,
        ],
      );
      return this.getStayInTxOrThrow(client, id);
    });
  }

  async updateStay(input: StayUpdateInput): Promise<Stay> {
    return this.withAuth(async (client) => {
      const existing = await this.getStayInTxOrThrow(client, input.id);
      const merged: Stay = {
        ...existing,
        name: input.name ?? existing.name,
        checkIn: input.checkIn ?? existing.checkIn,
        checkOut: input.checkOut ?? existing.checkOut,
        address: input.address ?? existing.address,
        confirmation: input.confirmation ?? existing.confirmation,
        guestIds: input.guestIds ?? existing.guestIds,
        notes: input.notes ?? existing.notes,
        updatedAt: nowIso(),
      };
      await client.query(
        `UPDATE stays SET name = $1, check_in = $2, check_out = $3, address = $4, confirmation = $5, guest_ids = $6,
           notes = $7, updated_at = $8
         WHERE id = $9`,
        [
          merged.name,
          merged.checkIn,
          merged.checkOut,
          n(merged.address),
          n(merged.confirmation),
          JSON.stringify(merged.guestIds),
          n(merged.notes),
          merged.updatedAt,
          merged.id,
        ],
      );
      return this.getStayInTxOrThrow(client, merged.id);
    });
  }

  async listStays(tripId: string): Promise<Stay[]> {
    return this.withAuth((client) => this.listStaysInTx(client, tripId));
  }

  private async listStaysInTx(client: PoolClient, tripId: string): Promise<Stay[]> {
    const { rows } = await client.query<StayRow>(`SELECT * FROM stays WHERE trip_id = $1 ORDER BY check_in ASC`, [
      tripId,
    ]);
    return rows.map(toStay);
  }

  private async getStayInTx(client: PoolClient, id: string): Promise<Stay | undefined> {
    const { rows } = await client.query<StayRow>(`SELECT * FROM stays WHERE id = $1`, [id]);
    return rows[0] ? toStay(rows[0]) : undefined;
  }

  private async getStayInTxOrThrow(client: PoolClient, id: string): Promise<Stay> {
    const stay = await this.getStayInTx(client, id);
    if (!stay) throw new NotFoundError("stay", id);
    return stay;
  }

  // ----------------------------------------------------------------- days

  async upsertDay(input: DayUpsertInput): Promise<Day> {
    return this.withAuth(async (client) => {
      await this.getTripInTxOrThrow(client, input.tripId);
      const { rows } = await client.query<DayRow>(`SELECT * FROM days WHERE trip_id = $1 AND date = $2`, [
        input.tripId,
        input.date,
      ]);
      const existingRow = rows[0];
      const ts = nowIso();

      if (existingRow) {
        const title = input.title ?? existingRow.title ?? undefined;
        const notes = input.notes ?? existingRow.notes ?? undefined;
        await client.query(`UPDATE days SET title = $1, notes = $2, updated_at = $3 WHERE id = $4`, [
          n(title),
          n(notes),
          ts,
          existingRow.id,
        ]);
        return this.getDayInTxOrThrow(client, existingRow.id);
      }

      const id = newId("day");
      await client.query(
        `INSERT INTO days (id, trip_id, date, title, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, input.tripId, input.date, n(input.title), n(input.notes), ts, ts],
      );
      return this.getDayInTxOrThrow(client, id);
    });
  }

  async getDay(id: string): Promise<Day | undefined> {
    return this.withAuth((client) => this.getDayInTx(client, id));
  }

  async getDayByDate(tripId: string, date: string): Promise<Day | undefined> {
    return this.withAuth(async (client) => {
      const { rows } = await client.query<DayRow>(`SELECT * FROM days WHERE trip_id = $1 AND date = $2`, [
        tripId,
        date,
      ]);
      return rows[0] ? this.hydrateDayInTx(client, rows[0]) : undefined;
    });
  }

  async listDays(tripId: string, range?: { startDate?: string; endDate?: string }): Promise<Day[]> {
    return this.withAuth((client) => this.listDaysInTx(client, tripId, range));
  }

  private async listDaysInTx(
    client: PoolClient,
    tripId: string,
    range?: { startDate?: string; endDate?: string },
  ): Promise<Day[]> {
    const { rows } = await client.query<DayRow>(`SELECT * FROM days WHERE trip_id = $1 ORDER BY date ASC`, [
      tripId,
    ]);
    const filtered = rows.filter((row) => {
      if (range?.startDate && row.date < range.startDate) return false;
      if (range?.endDate && row.date > range.endDate) return false;
      return true;
    });
    if (filtered.length === 0) return [];

    const { rows: blockRows } = await client.query<DayBlockRow>(
      `SELECT * FROM day_blocks WHERE day_id = ANY($1) ORDER BY block_order ASC`,
      [filtered.map((row) => row.id)],
    );
    const blocksByDay = new Map<string, DayBlockRow[]>();
    for (const row of blockRows) {
      const list = blocksByDay.get(row.day_id) ?? [];
      list.push(row);
      blocksByDay.set(row.day_id, list);
    }
    return filtered.map((row) => this.toDay(row, (blocksByDay.get(row.id) ?? []).map(toDayBlock)));
  }

  private async getDayInTx(client: PoolClient, id: string): Promise<Day | undefined> {
    const { rows } = await client.query<DayRow>(`SELECT * FROM days WHERE id = $1`, [id]);
    return rows[0] ? this.hydrateDayInTx(client, rows[0]) : undefined;
  }

  private async getDayInTxOrThrow(client: PoolClient, id: string): Promise<Day> {
    const day = await this.getDayInTx(client, id);
    if (!day) throw new NotFoundError("day", id);
    return day;
  }

  private async hydrateDayInTx(client: PoolClient, row: DayRow): Promise<Day> {
    const blocks = await this.listDayBlocksInTx(client, row.id);
    return this.toDay(row, blocks);
  }

  private toDay(row: DayRow, blocks: DayBlock[]): Day {
    return {
      id: row.id,
      tripId: row.trip_id,
      date: row.date,
      title: row.title ?? undefined,
      notes: row.notes ?? undefined,
      blocks,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async listDayBlocksInTx(client: PoolClient, dayId: string): Promise<DayBlock[]> {
    const { rows } = await client.query<DayBlockRow>(
      `SELECT * FROM day_blocks WHERE day_id = $1 ORDER BY block_order ASC`,
      [dayId],
    );
    return rows.map(toDayBlock);
  }

  async setDayPlan(dayId: string, blocks: DayBlockInput[]): Promise<Day> {
    return this.withAuth(async (client) => {
      const { rows } = await client.query<DayRow>(`SELECT * FROM days WHERE id = $1`, [dayId]);
      if (!rows[0]) throw new NotFoundError("day", dayId);
      assertNoOverlaps(blocks);

      await client.query(`DELETE FROM day_blocks WHERE day_id = $1`, [dayId]);
      if (blocks.length > 0) {
        const values: string[] = [];
        const params: unknown[] = [];
        blocks.forEach((block, index) => {
          const base = params.length;
          values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`);
          params.push(newId("block"), dayId, index, block.startTime, block.endTime, block.type, block.title, n(block.place), n(block.notes));
        });
        // One batched multi-row INSERT instead of one round trip per block: each call already
        // pays a real network round trip (see the class doc comment), so a 10-block day plan
        // would otherwise cost 10 serialized round trips.
        await client.query(
          `INSERT INTO day_blocks (id, day_id, block_order, start_time, end_time, type, title, place, notes)
           VALUES ${values.join(", ")}`,
          params,
        );
      }
      await client.query(`UPDATE days SET updated_at = $1 WHERE id = $2`, [nowIso(), dayId]);

      return this.getDayInTxOrThrow(client, dayId);
    });
  }

  // ------------------------------------------------------------- packing

  async listPackingItems(tripId: string): Promise<PackingItem[]> {
    return this.withAuth((client) => this.listPackingItemsInTx(client, tripId));
  }

  private async listPackingItemsInTx(client: PoolClient, tripId: string): Promise<PackingItem[]> {
    const { rows } = await client.query<PackingItemRow>(
      `SELECT * FROM packing_items WHERE trip_id = $1 ORDER BY category ASC, label ASC`,
      [tripId],
    );
    return rows.map(toPackingItem);
  }

  async replacePackingItems(
    tripId: string,
    items: Array<{ category: string; label: string; quantity: number }>,
  ): Promise<PackingItem[]> {
    return this.withAuth(async (client) => {
      await this.getTripInTxOrThrow(client, tripId);
      const ts = nowIso();
      await client.query(`DELETE FROM packing_items WHERE trip_id = $1`, [tripId]);
      if (items.length > 0) {
        const values: string[] = [];
        const params: unknown[] = [];
        items.forEach((item) => {
          const base = params.length;
          values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, false, NULL, $${base + 6}, $${base + 7})`);
          params.push(newId("pack"), tripId, item.category, item.label, item.quantity, ts, ts);
        });
        await client.query(
          `INSERT INTO packing_items (id, trip_id, category, label, quantity, packed, notes, created_at, updated_at)
           VALUES ${values.join(", ")}`,
          params,
        );
      }
      return this.listPackingItemsInTx(client, tripId);
    });
  }

  async upsertPackingItems(
    tripId: string,
    upserts: Array<{
      id?: string;
      category?: string;
      label: string;
      quantity?: number;
      packed?: boolean;
      notes?: string;
    }>,
    removeIds: string[],
  ): Promise<PackingItem[]> {
    return this.withAuth(async (client) => {
      await this.getTripInTxOrThrow(client, tripId);
      const ts = nowIso();

      if (removeIds.length > 0) {
        await client.query(`DELETE FROM packing_items WHERE id = ANY($1) AND trip_id = $2`, [removeIds, tripId]);
      }

      // Items with an id need an individual SELECT (for NotFoundError + per-field merge) before
      // their UPDATE, so those stay one round trip apiece; plain inserts don't need that and
      // are batched below into a single multi-row INSERT.
      const toInsert = upserts.filter((item) => !item.id);
      for (const item of upserts) {
        if (!item.id) continue;
        const { rows } = await client.query<PackingItemRow>(
          `SELECT * FROM packing_items WHERE id = $1 AND trip_id = $2`,
          [item.id, tripId],
        );
        const existingRow = rows[0];
        if (!existingRow) throw new NotFoundError("packingItem", item.id);
        const existing = toPackingItem(existingRow);
        const merged: PackingItem = {
          ...existing,
          category: item.category ?? existing.category,
          label: item.label,
          quantity: item.quantity ?? existing.quantity,
          packed: item.packed ?? existing.packed,
          notes: item.notes ?? existing.notes,
          updatedAt: ts,
        };
        await client.query(
          `UPDATE packing_items SET category = $1, label = $2, quantity = $3, packed = $4, notes = $5, updated_at = $6
           WHERE id = $7`,
          [merged.category, merged.label, merged.quantity, merged.packed, n(merged.notes), ts, merged.id],
        );
      }

      if (toInsert.length > 0) {
        const values: string[] = [];
        const params: unknown[] = [];
        toInsert.forEach((item) => {
          const base = params.length;
          values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`);
          params.push(
            newId("pack"),
            tripId,
            item.category ?? "misc",
            item.label,
            item.quantity ?? 1,
            item.packed ?? false,
            n(item.notes),
            ts,
            ts,
          );
        });
        await client.query(
          `INSERT INTO packing_items (id, trip_id, category, label, quantity, packed, notes, created_at, updated_at)
           VALUES ${values.join(", ")}`,
          params,
        );
      }

      return this.listPackingItemsInTx(client, tripId);
    });
  }

  // ----------------------------------------------------------------- query

  async query(tripId: string, filters: QueryFilters): Promise<QueryResult> {
    return this.withAuth(async (client) => {
      const result: QueryResult = {};
      const types = new Set(filters.entityTypes);

      if (types.has("trip")) {
        result.trip = await this.getTripInTx(client, tripId);
      }
      if (types.has("person")) {
        const people = await this.listPeopleInTx(client, tripId);
        result.people = filters.personId ? people.filter((p) => p.id === filters.personId) : people;
      }
      if (types.has("flight")) {
        let flights = await this.listFlightsInTx(client, tripId);
        if (filters.startDate) flights = flights.filter((f) => f.departureTime.slice(0, 10) >= filters.startDate!);
        if (filters.endDate) flights = flights.filter((f) => f.departureTime.slice(0, 10) <= filters.endDate!);
        if (filters.personId) flights = flights.filter((f) => f.travelerIds.includes(filters.personId!));
        result.flights = flights;
      }
      if (types.has("stay")) {
        let stays = await this.listStaysInTx(client, tripId);
        if (filters.startDate) stays = stays.filter((s) => s.checkOut.slice(0, 10) >= filters.startDate!);
        if (filters.endDate) stays = stays.filter((s) => s.checkIn.slice(0, 10) <= filters.endDate!);
        if (filters.personId) stays = stays.filter((s) => s.guestIds.includes(filters.personId!));
        result.stays = stays;
      }
      if (types.has("day")) {
        result.days = await this.listDaysInTx(client, tripId, { startDate: filters.startDate, endDate: filters.endDate });
      }
      if (types.has("packingItem")) {
        result.packingItems = await this.listPackingItemsInTx(client, tripId);
      }

      return result;
    });
  }
}
