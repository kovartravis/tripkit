import pg, { type Pool, type PoolClient } from "pg";
import type { Trip, TripCreateInput, TripUpdateInput } from "../../domain/types.js";
import { NotFoundError } from "../repository.js";
import { newId, nowIso } from "../../utils/id.js";
import type { VerifiedSupabaseClaims } from "./identity.js";

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

/**
 * Postgres-backed Trip repository, scoped per Account by real RLS rather than an in-app
 * permission check. Every call opens its own transaction, forwards the caller's already-
 * verified JWT claims (see `src/mcp/oauth/supabaseTokenVerifier.ts`) into
 * `request.jwt.claims`, and switches to the `authenticated` Postgres role for that
 * transaction only (`SET LOCAL`, so it can never leak onto a pooled connection handed back
 * for someone else's request afterward) — the direct-Postgres JWT-forwarding design recorded
 * on ticket #8, chosen specifically to avoid relying on supabase-js's own (currently broken
 * for OAuth-Server tokens — see supabase/supabase#41668) bearer-forwarding path.
 *
 * Implements Trip create/get/list/update only; the remaining trip-data entities are ticket
 * #20's, at which point this is expected to grow into a full `TripkitRepository`.
 */
export class SupabaseTripkitRepository {
  constructor(
    private readonly pool: Pool,
    private readonly claims: VerifiedSupabaseClaims,
  ) {}

  // No close(): unlike SqliteTripkitRepository, this doesn't own its Pool — the same pool is
  // meant to be shared across many per-request instances (one per authenticated identity), so
  // ending it here would kill every other instance's connections too. Whoever constructs the
  // pool is responsible for ending it.

  private async withAuth<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(this.claims)]);
      await client.query("SET LOCAL ROLE authenticated");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

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
}
