import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import type { Pool } from "pg";
import { createSupabasePool, supabasePoolConfigFromEnv } from "../../src/db/postgres/pool.js";
import { SupabaseTripkitRepository } from "../../src/db/postgres/supabaseTripkitRepository.js";
import { NotFoundError } from "../../src/db/repository.js";

// vitest doesn't load .env files itself; pull in .env.local (gitignored) if present, without
// overriding anything already set in the real environment (e.g. by CI).
function loadEnvLocal(): void {
  const path = new URL("../../.env.local", import.meta.url);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = line.slice(idx + 1).trim();
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const poolConfig = supabasePoolConfigFromEnv();
const hasCreds = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && poolConfig);

/**
 * Real Postgres, real RLS, real (throwaway) Supabase Auth accounts — no mocking, per ticket
 * #19's acceptance criteria. Skips itself when the live-project credentials described in
 * README/CLAUDE.md aren't configured, rather than failing `npm test` for anyone without them.
 */
describe.skipIf(!hasCreds)("SupabaseTripkitRepository (live Postgres)", () => {
  let pool: Pool;
  let ownerId: string;
  let strangerId: string;
  let ownerRepo: SupabaseTripkitRepository;
  let strangerRepo: SupabaseTripkitRepository;
  const createdTripIds: string[] = [];

  async function createTestAccount(): Promise<string> {
    const email = `tripkit-test-${randomUUID()}@tripkit-test.local`;
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password: randomUUID(), email_confirm: true }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create test account: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  async function deleteTestAccount(id: string): Promise<void> {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
  }

  beforeAll(async () => {
    pool = createSupabasePool(poolConfig!);
    [ownerId, strangerId] = await Promise.all([createTestAccount(), createTestAccount()]);
    ownerRepo = new SupabaseTripkitRepository(pool, { sub: ownerId, role: "authenticated" });
    strangerRepo = new SupabaseTripkitRepository(pool, { sub: strangerId, role: "authenticated" });
  });

  afterAll(async () => {
    // Hard-delete as the pool's base (postgres) role, bypassing RLS: trips.owner_account_id
    // has no ON DELETE CASCADE from accounts, so a dangling trip would block account deletion.
    if (createdTripIds.length > 0) {
      const client = await pool.connect();
      try {
        await client.query("DELETE FROM trips WHERE id = ANY($1)", [createdTripIds]);
      } finally {
        client.release();
      }
    }
    await Promise.all([deleteTestAccount(ownerId), deleteTestAccount(strangerId)]);
    await pool.end();
  });

  it("lets an Owner create a trip and see it via getTrip/listTrips", async () => {
    const trip = await ownerRepo.createTrip({
      name: "Japan 2026",
      startDate: "2026-04-10",
      endDate: "2026-04-20",
      homeTimezone: "America/Los_Angeles",
    });
    createdTripIds.push(trip.id);

    expect(trip.name).toBe("Japan 2026");
    expect(trip.startDate).toBe("2026-04-10");

    const fetched = await ownerRepo.getTrip(trip.id);
    expect(fetched).toEqual(trip);

    const listed = await ownerRepo.listTrips();
    expect(listed.map((t) => t.id)).toContain(trip.id);
  });

  it("hides another Account's trip entirely from listTrips/getTrip", async () => {
    const trip = await ownerRepo.createTrip({
      name: "Private trip",
      startDate: "2026-05-01",
      endDate: "2026-05-05",
      homeTimezone: "America/Los_Angeles",
    });
    createdTripIds.push(trip.id);

    const strangerList = await strangerRepo.listTrips();
    expect(strangerList).toEqual([]);

    const strangerGet = await strangerRepo.getTrip(trip.id);
    expect(strangerGet).toBeUndefined();
  });

  it("throws NotFoundError when a non-member tries to update a trip", async () => {
    const trip = await ownerRepo.createTrip({
      name: "Another trip",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      homeTimezone: "America/Los_Angeles",
    });
    createdTripIds.push(trip.id);

    await expect(strangerRepo.updateTrip({ id: trip.id, name: "Hijacked" })).rejects.toThrow(NotFoundError);

    const stillOriginal = await ownerRepo.getTrip(trip.id);
    expect(stillOriginal?.name).toBe("Another trip");
  });

  it("lets the Owner update their own trip", async () => {
    const trip = await ownerRepo.createTrip({
      name: "Draft name",
      startDate: "2026-07-01",
      endDate: "2026-07-05",
      homeTimezone: "America/Los_Angeles",
    });
    createdTripIds.push(trip.id);

    const updated = await ownerRepo.updateTrip({ id: trip.id, name: "Final name" });
    expect(updated.name).toBe("Final name");
    expect(updated.updatedAt).not.toBe(trip.updatedAt);
  });

  it("never lets the Owner delete their own trip_members row (ADR 0005)", async () => {
    const trip = await ownerRepo.createTrip({
      name: "Owner can't self-remove",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      homeTimezone: "America/Los_Angeles",
    });
    createdTripIds.push(trip.id);

    // No repository method exposes membership deletion yet (that's ticket #21's invite/member
    // surface) — exercise the RLS policy directly, scoped as the Owner, the same way the
    // repository itself would.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ownerId, role: "authenticated" }),
      ]);
      await client.query("SET LOCAL ROLE authenticated");
      const result = await client.query("DELETE FROM trip_members WHERE trip_id = $1 AND account_id = $2", [
        trip.id,
        ownerId,
      ]);
      expect(result.rowCount).toBe(0);
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const stillVisible = await ownerRepo.getTrip(trip.id);
    expect(stillVisible?.id).toBe(trip.id);
  });
});
