import type { DatabaseSync } from "node:sqlite";
import { assertNoOverlaps } from "../domain/validation.js";
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
} from "../domain/types.js";
import { newId, nowIso } from "../utils/id.js";
import { NotFoundError, type QueryFilters, type QueryResult, type TripkitRepository } from "./repository.js";

/** SQLite row shapes (snake_case, as stored) */
interface TripRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  home_timezone: string;
  notes: string | null;
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
  traveler_ids: string;
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
  guest_ids: string;
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
  packed: number;
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
    travelerIds: JSON.parse(row.traveler_ids) as string[],
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
    guestIds: JSON.parse(row.guest_ids) as string[],
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
    packed: row.packed === 1,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** node:sqlite bind params reject `undefined`; normalize to `null`. */
function n(value: string | undefined | null): string | null {
  return value ?? null;
}

export class SqliteTripkitRepository implements TripkitRepository {
  constructor(private readonly db: DatabaseSync) {}

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------- trips

  createTrip(input: TripCreateInput): Trip {
    const id = newId("trip");
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO trips (id, name, start_date, end_date, home_timezone, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, input.startDate, input.endDate, input.homeTimezone, n(input.notes), ts, ts);
    return this.getTripOrThrow(id);
  }

  updateTrip(input: TripUpdateInput): Trip {
    const existing = this.getTripOrThrow(input.id);
    const merged: Trip = {
      ...existing,
      name: input.name ?? existing.name,
      startDate: input.startDate ?? existing.startDate,
      endDate: input.endDate ?? existing.endDate,
      homeTimezone: input.homeTimezone ?? existing.homeTimezone,
      notes: input.notes ?? existing.notes,
      updatedAt: nowIso(),
    };
    this.db
      .prepare(
        `UPDATE trips SET name = ?, start_date = ?, end_date = ?, home_timezone = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        merged.name,
        merged.startDate,
        merged.endDate,
        merged.homeTimezone,
        n(merged.notes),
        merged.updatedAt,
        merged.id,
      );
    return merged;
  }

  getTrip(id: string): Trip | undefined {
    const row = this.db.prepare(`SELECT * FROM trips WHERE id = ?`).get(id) as TripRow | undefined;
    return row ? toTrip(row) : undefined;
  }

  private getTripOrThrow(id: string): Trip {
    const trip = this.getTrip(id);
    if (!trip) throw new NotFoundError("trip", id);
    return trip;
  }

  listTrips(): Trip[] {
    const rows = this.db.prepare(`SELECT * FROM trips ORDER BY start_date ASC`).all() as unknown as TripRow[];
    return rows.map(toTrip);
  }

  // --------------------------------------------------------------- people

  addPerson(input: PersonAddInput): Person {
    this.getTripOrThrow(input.tripId);
    const id = newId("person");
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO people (id, trip_id, name, email, role, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.tripId, input.name, n(input.email), n(input.role), n(input.notes), ts, ts);
    return this.getPersonOrThrow(id);
  }

  updatePerson(input: PersonUpdateInput): Person {
    const existing = this.getPersonOrThrow(input.id);
    const merged: Person = {
      ...existing,
      name: input.name ?? existing.name,
      email: input.email ?? existing.email,
      role: input.role ?? existing.role,
      notes: input.notes ?? existing.notes,
      updatedAt: nowIso(),
    };
    this.db
      .prepare(`UPDATE people SET name = ?, email = ?, role = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(merged.name, n(merged.email), n(merged.role), n(merged.notes), merged.updatedAt, merged.id);
    return merged;
  }

  private getPersonOrThrow(id: string): Person {
    const row = this.db.prepare(`SELECT * FROM people WHERE id = ?`).get(id) as PersonRow | undefined;
    if (!row) throw new NotFoundError("person", id);
    return toPerson(row);
  }

  listPeople(tripId: string): Person[] {
    const rows = this.db
      .prepare(`SELECT * FROM people WHERE trip_id = ? ORDER BY created_at ASC`)
      .all(tripId) as unknown as PersonRow[];
    return rows.map(toPerson);
  }

  // -------------------------------------------------------------- flights

  addFlight(input: FlightAddInput): Flight {
    this.getTripOrThrow(input.tripId);
    const id = newId("flight");
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO flights (id, trip_id, airline, flight_number, departure_airport, arrival_airport,
           departure_time, arrival_time, confirmation, seat, traveler_ids, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
      );
    return this.getFlightOrThrow(id);
  }

  updateFlight(input: FlightUpdateInput): Flight {
    const existing = this.getFlightOrThrow(input.id);
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
    this.db
      .prepare(
        `UPDATE flights SET airline = ?, flight_number = ?, departure_airport = ?, arrival_airport = ?,
           departure_time = ?, arrival_time = ?, confirmation = ?, seat = ?, traveler_ids = ?, notes = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
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
      );
    return merged;
  }

  private getFlightOrThrow(id: string): Flight {
    const row = this.db.prepare(`SELECT * FROM flights WHERE id = ?`).get(id) as FlightRow | undefined;
    if (!row) throw new NotFoundError("flight", id);
    return toFlight(row);
  }

  listFlights(tripId: string): Flight[] {
    const rows = this.db
      .prepare(`SELECT * FROM flights WHERE trip_id = ? ORDER BY departure_time ASC`)
      .all(tripId) as unknown as FlightRow[];
    return rows.map(toFlight);
  }

  // ---------------------------------------------------------------- stays

  addStay(input: StayAddInput): Stay {
    this.getTripOrThrow(input.tripId);
    const id = newId("stay");
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO stays (id, trip_id, name, check_in, check_out, address, confirmation, guest_ids, notes,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
      );
    return this.getStayOrThrow(id);
  }

  updateStay(input: StayUpdateInput): Stay {
    const existing = this.getStayOrThrow(input.id);
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
    this.db
      .prepare(
        `UPDATE stays SET name = ?, check_in = ?, check_out = ?, address = ?, confirmation = ?, guest_ids = ?,
           notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        merged.name,
        merged.checkIn,
        merged.checkOut,
        n(merged.address),
        n(merged.confirmation),
        JSON.stringify(merged.guestIds),
        n(merged.notes),
        merged.updatedAt,
        merged.id,
      );
    return merged;
  }

  private getStayOrThrow(id: string): Stay {
    const row = this.db.prepare(`SELECT * FROM stays WHERE id = ?`).get(id) as StayRow | undefined;
    if (!row) throw new NotFoundError("stay", id);
    return toStay(row);
  }

  listStays(tripId: string): Stay[] {
    const rows = this.db
      .prepare(`SELECT * FROM stays WHERE trip_id = ? ORDER BY check_in ASC`)
      .all(tripId) as unknown as StayRow[];
    return rows.map(toStay);
  }

  // ----------------------------------------------------------------- days

  upsertDay(input: DayUpsertInput): Day {
    this.getTripOrThrow(input.tripId);
    const existingRow = this.db
      .prepare(`SELECT * FROM days WHERE trip_id = ? AND date = ?`)
      .get(input.tripId, input.date) as DayRow | undefined;
    const ts = nowIso();

    if (existingRow) {
      const title = input.title ?? existingRow.title ?? undefined;
      const notes = input.notes ?? existingRow.notes ?? undefined;
      this.db
        .prepare(`UPDATE days SET title = ?, notes = ?, updated_at = ? WHERE id = ?`)
        .run(n(title), n(notes), ts, existingRow.id);
      return this.getDayOrThrow(existingRow.id);
    }

    const id = newId("day");
    this.db
      .prepare(
        `INSERT INTO days (id, trip_id, date, title, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.tripId, input.date, n(input.title), n(input.notes), ts, ts);
    return this.getDayOrThrow(id);
  }

  getDay(id: string): Day | undefined {
    const row = this.db.prepare(`SELECT * FROM days WHERE id = ?`).get(id) as DayRow | undefined;
    if (!row) return undefined;
    return this.hydrateDay(row);
  }

  private getDayOrThrow(id: string): Day {
    const day = this.getDay(id);
    if (!day) throw new NotFoundError("day", id);
    return day;
  }

  getDayByDate(tripId: string, date: string): Day | undefined {
    const row = this.db
      .prepare(`SELECT * FROM days WHERE trip_id = ? AND date = ?`)
      .get(tripId, date) as DayRow | undefined;
    return row ? this.hydrateDay(row) : undefined;
  }

  listDays(tripId: string, range?: { startDate?: string; endDate?: string }): Day[] {
    const rows = this.db
      .prepare(`SELECT * FROM days WHERE trip_id = ? ORDER BY date ASC`)
      .all(tripId) as unknown as DayRow[];
    const filtered = rows.filter((row) => {
      if (range?.startDate && row.date < range.startDate) return false;
      if (range?.endDate && row.date > range.endDate) return false;
      return true;
    });
    return filtered.map((row) => this.hydrateDay(row));
  }

  private hydrateDay(row: DayRow): Day {
    const blockRows = this.db
      .prepare(`SELECT * FROM day_blocks WHERE day_id = ? ORDER BY block_order ASC`)
      .all(row.id) as unknown as DayBlockRow[];
    return {
      id: row.id,
      tripId: row.trip_id,
      date: row.date,
      title: row.title ?? undefined,
      notes: row.notes ?? undefined,
      blocks: blockRows.map(toDayBlock),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  setDayPlan(dayId: string, blocks: DayBlockInput[]): Day {
    this.getDayOrThrow(dayId);
    assertNoOverlaps(blocks);

    const del = this.db.prepare(`DELETE FROM day_blocks WHERE day_id = ?`);
    const insert = this.db.prepare(
      `INSERT INTO day_blocks (id, day_id, block_order, start_time, end_time, type, title, place, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const touch = this.db.prepare(`UPDATE days SET updated_at = ? WHERE id = ?`);

    del.run(dayId);
    blocks.forEach((block, index) => {
      insert.run(
        newId("block"),
        dayId,
        index,
        block.startTime,
        block.endTime,
        block.type,
        block.title,
        n(block.place),
        n(block.notes),
      );
    });
    touch.run(nowIso(), dayId);

    return this.getDayOrThrow(dayId);
  }

  // ------------------------------------------------------------- packing

  listPackingItems(tripId: string): PackingItem[] {
    const rows = this.db
      .prepare(`SELECT * FROM packing_items WHERE trip_id = ? ORDER BY category ASC, label ASC`)
      .all(tripId) as unknown as PackingItemRow[];
    return rows.map(toPackingItem);
  }

  replacePackingItems(
    tripId: string,
    items: Array<{ category: string; label: string; quantity: number }>,
  ): PackingItem[] {
    this.getTripOrThrow(tripId);
    const ts = nowIso();
    this.db.prepare(`DELETE FROM packing_items WHERE trip_id = ?`).run(tripId);
    const insert = this.db.prepare(
      `INSERT INTO packing_items (id, trip_id, category, label, quantity, packed, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    );
    for (const item of items) {
      insert.run(newId("pack"), tripId, item.category, item.label, item.quantity, ts, ts);
    }
    return this.listPackingItems(tripId);
  }

  upsertPackingItems(
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
  ): PackingItem[] {
    this.getTripOrThrow(tripId);
    const ts = nowIso();

    for (const id of removeIds) {
      this.db.prepare(`DELETE FROM packing_items WHERE id = ? AND trip_id = ?`).run(id, tripId);
    }

    for (const item of upserts) {
      if (item.id) {
        const existingRow = this.db
          .prepare(`SELECT * FROM packing_items WHERE id = ? AND trip_id = ?`)
          .get(item.id, tripId) as PackingItemRow | undefined;
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
        this.db
          .prepare(
            `UPDATE packing_items SET category = ?, label = ?, quantity = ?, packed = ?, notes = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(merged.category, merged.label, merged.quantity, merged.packed ? 1 : 0, n(merged.notes), ts, merged.id);
      } else {
        this.db
          .prepare(
            `INSERT INTO packing_items (id, trip_id, category, label, quantity, packed, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            newId("pack"),
            tripId,
            item.category ?? "misc",
            item.label,
            item.quantity ?? 1,
            item.packed ? 1 : 0,
            n(item.notes),
            ts,
            ts,
          );
      }
    }

    return this.listPackingItems(tripId);
  }

  // ----------------------------------------------------------------- query

  query(tripId: string, filters: QueryFilters): QueryResult {
    const result: QueryResult = {};
    const types = new Set(filters.entityTypes);

    if (types.has("trip")) {
      result.trip = this.getTrip(tripId);
    }
    if (types.has("person")) {
      const people = this.listPeople(tripId);
      result.people = filters.personId ? people.filter((p) => p.id === filters.personId) : people;
    }
    if (types.has("flight")) {
      let flights = this.listFlights(tripId);
      if (filters.startDate) flights = flights.filter((f) => f.departureTime.slice(0, 10) >= filters.startDate!);
      if (filters.endDate) flights = flights.filter((f) => f.departureTime.slice(0, 10) <= filters.endDate!);
      if (filters.personId) flights = flights.filter((f) => f.travelerIds.includes(filters.personId!));
      result.flights = flights;
    }
    if (types.has("stay")) {
      let stays = this.listStays(tripId);
      if (filters.startDate) stays = stays.filter((s) => s.checkOut.slice(0, 10) >= filters.startDate!);
      if (filters.endDate) stays = stays.filter((s) => s.checkIn.slice(0, 10) <= filters.endDate!);
      if (filters.personId) stays = stays.filter((s) => s.guestIds.includes(filters.personId!));
      result.stays = stays;
    }
    if (types.has("day")) {
      result.days = this.listDays(tripId, { startDate: filters.startDate, endDate: filters.endDate });
    }
    if (types.has("packingItem")) {
      result.packingItems = this.listPackingItems(tripId);
    }

    return result;
  }
}
