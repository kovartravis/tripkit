import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import type { Pool } from "pg";
import { createSupabasePool, supabasePoolConfigFromEnv } from "../../src/db/postgres/pool.js";
import { SupabaseTripkitRepository } from "../../src/db/postgres/supabaseTripkitRepository.js";
import { SupabaseInviteService } from "../../src/db/postgres/invites.js";
import { NotFoundError } from "../../src/db/repository.js";
import { createTripkitMcpServer } from "../../src/mcp/server.js";
import { exportMarkdown } from "../../src/export/markdown.js";
import { exportIcs } from "../../src/export/ics.js";

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

  async function createOwnerTrip(name: string): Promise<string> {
    const trip = await ownerRepo.createTrip({
      name,
      startDate: "2026-04-10",
      endDate: "2026-04-20",
      homeTimezone: "America/Los_Angeles",
    });
    createdTripIds.push(trip.id);
    return trip.id;
  }

  describe("people", () => {
    it("lets a Member add and list people, denies a non-member read and write", async () => {
      const tripId = await createOwnerTrip("People trip");

      const person = await ownerRepo.addPerson({ tripId, name: "Alice" });
      expect(person.tripId).toBe(tripId);
      expect(await ownerRepo.listPeople(tripId)).toEqual([person]);

      const updated = await ownerRepo.updatePerson({ id: person.id, role: "companion" });
      expect(updated.role).toBe("companion");

      expect(await strangerRepo.listPeople(tripId)).toEqual([]);
      await expect(strangerRepo.addPerson({ tripId, name: "Mallory" })).rejects.toThrow(NotFoundError);
    });
  });

  describe("flights", () => {
    it("lets a Member add and list flights, denies a non-member read and write", async () => {
      const tripId = await createOwnerTrip("Flights trip");

      const flight = await ownerRepo.addFlight({
        tripId,
        airline: "ANA",
        flightNumber: "NH7",
        departureAirport: "sfo",
        arrivalAirport: "hnd",
        departureTime: "2026-04-10T13:15:00-07:00",
        arrivalTime: "2026-04-11T16:50:00+09:00",
      });
      expect(flight.departureAirport).toBe("SFO");
      expect(await ownerRepo.listFlights(tripId)).toEqual([flight]);

      const updated = await ownerRepo.updateFlight({ id: flight.id, seat: "22A" });
      expect(updated.seat).toBe("22A");

      expect(await strangerRepo.listFlights(tripId)).toEqual([]);
      await expect(
        strangerRepo.addFlight({
          tripId,
          airline: "ANA",
          flightNumber: "NH7",
          departureAirport: "SFO",
          arrivalAirport: "HND",
          departureTime: "2026-04-10T13:15:00-07:00",
          arrivalTime: "2026-04-11T16:50:00+09:00",
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("stays", () => {
    it("lets a Member add and list stays, denies a non-member read and write", async () => {
      const tripId = await createOwnerTrip("Stays trip");

      const stay = await ownerRepo.addStay({
        tripId,
        name: "Park Hyatt Tokyo",
        checkIn: "2026-04-11T15:00:00+09:00",
        checkOut: "2026-04-13T11:00:00+09:00",
      });
      expect(await ownerRepo.listStays(tripId)).toEqual([stay]);

      const updated = await ownerRepo.updateStay({ id: stay.id, confirmation: "XYZ" });
      expect(updated.confirmation).toBe("XYZ");

      expect(await strangerRepo.listStays(tripId)).toEqual([]);
      await expect(
        strangerRepo.addStay({
          tripId,
          name: "Hijacked stay",
          checkIn: "2026-04-11T15:00:00+09:00",
          checkOut: "2026-04-13T11:00:00+09:00",
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("days and day plans", () => {
    it("lets a Member upsert a day, set its plan, and read it back; denies a non-member", async () => {
      const tripId = await createOwnerTrip("Days trip");

      const day = await ownerRepo.upsertDay({ tripId, date: "2026-04-12", title: "Tokyo" });
      expect(day.blocks).toEqual([]);

      const planned = await ownerRepo.setDayPlan(day.id, [
        { startTime: "09:00", endTime: "10:30", type: "activity", title: "Senso-ji" },
      ]);
      expect(planned.blocks).toHaveLength(1);
      expect(planned.blocks[0]!.title).toBe("Senso-ji");

      expect(await ownerRepo.getDay(day.id)).toEqual(planned);
      expect(await ownerRepo.getDayByDate(tripId, "2026-04-12")).toEqual(planned);
      expect(await ownerRepo.listDays(tripId)).toEqual([planned]);

      // Idempotent on trip + date.
      const reupserted = await ownerRepo.upsertDay({ tripId, date: "2026-04-12", title: "Tokyo (updated)" });
      expect(reupserted.id).toBe(day.id);
      expect(reupserted.title).toBe("Tokyo (updated)");

      expect(await strangerRepo.listDays(tripId)).toEqual([]);
      expect(await strangerRepo.getDay(day.id)).toBeUndefined();
      await expect(strangerRepo.upsertDay({ tripId, date: "2026-04-13" })).rejects.toThrow(NotFoundError);
      await expect(
        strangerRepo.setDayPlan(day.id, [{ startTime: "08:00", endTime: "09:00", type: "other", title: "Hijack" }]),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("packing items", () => {
    it("lets a Member generate and update a packing list, denies a non-member", async () => {
      const tripId = await createOwnerTrip("Packing trip");

      const generated = await ownerRepo.replacePackingItems(tripId, [
        { category: "documents", label: "passport / ID", quantity: 1 },
      ]);
      expect(generated).toHaveLength(1);

      const merged = await ownerRepo.upsertPackingItems(
        tripId,
        [{ id: generated[0]!.id, label: generated[0]!.label, packed: true }, { category: "clothing", label: "socks", quantity: 3 }],
        [],
      );
      expect(merged.find((i) => i.label === "passport / ID")?.packed).toBe(true);
      expect(merged.find((i) => i.label === "socks")?.quantity).toBe(3);

      expect(await strangerRepo.listPackingItems(tripId)).toEqual([]);
      await expect(strangerRepo.replacePackingItems(tripId, [])).rejects.toThrow(NotFoundError);
    });
  });

  describe("query", () => {
    it("returns a combined bundle for a Member and nothing for a non-member", async () => {
      const tripId = await createOwnerTrip("Query trip");
      await ownerRepo.addPerson({ tripId, name: "Alice" });
      await ownerRepo.addFlight({
        tripId,
        airline: "ANA",
        flightNumber: "NH7",
        departureAirport: "SFO",
        arrivalAirport: "HND",
        departureTime: "2026-04-10T13:15:00-07:00",
        arrivalTime: "2026-04-11T16:50:00+09:00",
      });

      const result = await ownerRepo.query(tripId, { entityTypes: ["trip", "person", "flight"] });
      expect(result.trip?.id).toBe(tripId);
      expect(result.people).toHaveLength(1);
      expect(result.flights).toHaveLength(1);

      const strangerResult = await strangerRepo.query(tripId, { entityTypes: ["trip", "person", "flight"] });
      expect(strangerResult.trip).toBeUndefined();
      expect(strangerResult.people).toEqual([]);
      expect(strangerResult.flights).toEqual([]);
    });
  });

  describe("exports and MCP wiring", () => {
    it("renders markdown/ICS exports against Supabase-backed data", async () => {
      const tripId = await createOwnerTrip("Export trip");
      await ownerRepo.addFlight({
        tripId,
        airline: "ANA",
        flightNumber: "NH7",
        departureAirport: "SFO",
        arrivalAirport: "HND",
        departureTime: "2026-04-10T13:15:00-07:00",
        arrivalTime: "2026-04-11T16:50:00+09:00",
      });

      const markdown = await exportMarkdown(ownerRepo, tripId);
      expect(markdown).toContain("Export trip");
      expect(markdown).toContain("ANA NH7");

      const ics = await exportIcs(ownerRepo, tripId);
      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("SUMMARY:ANA NH7: SFO → HND");
    });

    it("registers an MCP server against a SupabaseTripkitRepository and SupabaseInviteService", () => {
      const invites = new SupabaseInviteService(pool, { sub: ownerId, role: "authenticated" }, {
        projectUrl: "https://example.supabase.co",
        serviceRoleKey: "unused-in-this-test",
      });
      const server = createTripkitMcpServer(ownerRepo, invites);
      expect(server).toBeDefined();
    });
  });
});
