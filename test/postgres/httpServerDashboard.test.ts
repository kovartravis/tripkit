import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import type { Pool } from "pg";
import { createSupabasePool, supabasePoolConfigFromEnv } from "../../src/db/postgres/pool.js";
import { SupabaseTripkitRepository } from "../../src/db/postgres/supabaseTripkitRepository.js";
import { runHttpServer, type HttpServerHandle } from "../../src/mcp/httpServer.js";

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
 * Real Postgres, real RLS, real (throwaway) Supabase Auth accounts, and — unlike
 * `supabaseTripkitRepository.test.ts` — a real running `runHttpServer` in front of them: this
 * is ticket #22's "same RLS-isolation test pattern as the repository, exercised through the
 * endpoint the dashboard calls" requirement, not a separate ad hoc check. Skips itself when
 * live-project credentials aren't configured.
 */
describe.skipIf(!hasCreds)("GET /api/trips (Supabase dashboard auth, live Postgres)", () => {
  let pool: Pool;
  let handle: HttpServerHandle;
  let tripkitBaseUrl: string;
  let ownerId: string;
  let companionId: string;
  let ownerToken: string;
  let companionToken: string;
  let ownerTripId: string;
  const createdTripIds: string[] = [];

  const TRIPKIT_PORT = 48174;

  async function createTestAccount(): Promise<{ id: string; email: string; password: string }> {
    const email = `tripkit-test-${randomUUID()}@tripkit-test.local`;
    const password = randomUUID();
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create test account: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { id: string };
    return { id: body.id, email, password };
  }

  async function deleteTestAccount(id: string): Promise<void> {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
  }

  // The dashboard's real login path: Supabase's hosted password grant, not a hand-signed
  // token — this is what actually proves the endpoint accepts what the browser will present.
  async function signIn(email: string, password: string): Promise<string> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: SERVICE_ROLE_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(`Failed to sign in test account: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { access_token: string };
    return body.access_token;
  }

  beforeAll(async () => {
    pool = createSupabasePool(poolConfig!);

    const owner = await createTestAccount();
    const companion = await createTestAccount();
    ownerId = owner.id;
    companionId = companion.id;

    [ownerToken, companionToken] = await Promise.all([
      signIn(owner.email, owner.password),
      signIn(companion.email, companion.password),
    ]);

    const ownerRepo = new SupabaseTripkitRepository(pool, { sub: ownerId, role: "authenticated" });
    const trip = await ownerRepo.createTrip({
      name: "Dashboard test trip",
      startDate: "2026-04-10",
      endDate: "2026-04-20",
      homeTimezone: "America/Los_Angeles",
    });
    ownerTripId = trip.id;
    createdTripIds.push(trip.id);

    handle = await runHttpServer({
      host: "127.0.0.1",
      port: TRIPKIT_PORT,
      supabase: {
        projectUrl: new URL(SUPABASE_URL!),
        publicUrl: new URL("https://tripkit-dashboard-test.example.com"),
        anonKey: "unused-by-this-test",
        serviceRoleKey: SERVICE_ROLE_KEY!,
      },
    });
    tripkitBaseUrl = `http://127.0.0.1:${TRIPKIT_PORT}`;
  });

  afterAll(async () => {
    await handle.close();
    if (createdTripIds.length > 0) {
      const client = await pool.connect();
      try {
        await client.query("DELETE FROM trips WHERE id = ANY($1)", [createdTripIds]);
      } finally {
        client.release();
      }
    }
    await Promise.all([deleteTestAccount(ownerId), deleteTestAccount(companionId)]);
    await pool.end();
  });

  it("rejects a request with no Authorization header", async () => {
    const res = await fetch(`${tripkitBaseUrl}/api/trips`);
    expect(res.status).toBe(401);
  });

  it("returns the Owner's trip when the Owner is signed in", async () => {
    const res = await fetch(`${tripkitBaseUrl}/api/trips`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status).toBe(200);
    const trips = (await res.json()) as Array<{ id: string; name: string }>;
    expect(trips.map((t) => t.id)).toContain(ownerTripId);
  });

  // The Account-scoping assertion the ticket asks for: a Member who isn't part of this trip
  // gets an empty list back, RLS-enforced through the real endpoint, not the repository
  // directly.
  it("hides the trip entirely from a signed-in Account who isn't a Member", async () => {
    const res = await fetch(`${tripkitBaseUrl}/api/trips`, {
      headers: { Authorization: `Bearer ${companionToken}` },
    });
    expect(res.status).toBe(200);
    const trips = (await res.json()) as Array<{ id: string; name: string }>;
    expect(trips.map((t) => t.id)).not.toContain(ownerTripId);
  });

  it("returns the itinerary bundle for a trip the caller is a Member of", async () => {
    const res = await fetch(`${tripkitBaseUrl}/api/trips/${ownerTripId}/itinerary`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as { trip: { id: string } };
    expect(bundle.trip.id).toBe(ownerTripId);
  });

  it("404s the itinerary for a trip the caller is not a Member of", async () => {
    const res = await fetch(`${tripkitBaseUrl}/api/trips/${ownerTripId}/itinerary`, {
      headers: { Authorization: `Bearer ${companionToken}` },
    });
    expect(res.status).toBe(404);
  });
});
