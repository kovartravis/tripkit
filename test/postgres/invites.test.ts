import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import type { Pool } from "pg";
import { createSupabasePool, supabasePoolConfigFromEnv } from "../../src/db/postgres/pool.js";
import { SupabaseTripkitRepository } from "../../src/db/postgres/supabaseTripkitRepository.js";
import { SupabaseInviteService, ForbiddenError } from "../../src/db/postgres/invites.js";

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

// Never hits Supabase's real invite endpoint (which would send an actual email and burn the
// project's email quota) — the DB-level behavior under test (Owner check, pending-invite
// insert, RLS, redemption) doesn't depend on what the Admin API actually did.
const fakeAdminFetch = (async () => ({ ok: true, status: 200, text: async () => "" })) as unknown as typeof fetch;
const ADMIN_CONFIG = { projectUrl: "https://example.supabase.co", serviceRoleKey: "unused-in-tests" };

/**
 * Real Postgres, real RLS, real (throwaway) Supabase Auth accounts — same approach as
 * `supabaseTripkitRepository.test.ts`. Skips itself when live-project credentials aren't
 * configured.
 */
describe.skipIf(!hasCreds)("SupabaseInviteService (live Postgres)", () => {
  let pool: Pool;
  let ownerId: string;
  let companionId: string;
  let companionEmail: string;
  let strangerId: string;
  const createdTripIds: string[] = [];

  async function createTestAccount(): Promise<{ id: string; email: string }> {
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
    return { id: body.id, email };
  }

  async function deleteTestAccount(id: string): Promise<void> {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
  }

  beforeAll(async () => {
    pool = createSupabasePool(poolConfig!);
    const [owner, companion, stranger] = await Promise.all([
      createTestAccount(),
      createTestAccount(),
      createTestAccount(),
    ]);
    ownerId = owner.id;
    companionId = companion.id;
    companionEmail = companion.email;
    strangerId = stranger.id;
  });

  afterAll(async () => {
    if (createdTripIds.length > 0) {
      const client = await pool.connect();
      try {
        await client.query("DELETE FROM trips WHERE id = ANY($1)", [createdTripIds]);
      } finally {
        client.release();
      }
    }
    await Promise.all([ownerId, companionId, strangerId].map(deleteTestAccount));
    await pool.end();
  });

  function invitesAs(accountId: string): SupabaseInviteService {
    return new SupabaseInviteService(pool, { sub: accountId, role: "authenticated" }, ADMIN_CONFIG, fakeAdminFetch);
  }

  function repoAs(accountId: string): SupabaseTripkitRepository {
    return new SupabaseTripkitRepository(pool, { sub: accountId, role: "authenticated" });
  }

  async function createOwnerTrip(name: string): Promise<string> {
    const trip = await repoAs(ownerId).createTrip({
      name,
      startDate: "2026-04-10",
      endDate: "2026-04-20",
      homeTimezone: "America/Los_Angeles",
    });
    createdTripIds.push(trip.id);
    return trip.id;
  }

  it("lets the Owner invite a Companion by email, recording a pending invite", async () => {
    const tripId = await createOwnerTrip("Invite trip");

    const invite = await invitesAs(ownerId).createInvite(tripId, companionEmail);

    expect(invite.tripId).toBe(tripId);
    expect(invite.email).toBe(companionEmail);
    expect(invite.status).toBe("pending");
    expect(invite.invitedByAccountId).toBe(ownerId);
  });

  it("rejects invite creation from anyone but the trip's Owner", async () => {
    const tripId = await createOwnerTrip("Owner-only invites");

    await expect(invitesAs(strangerId).createInvite(tripId, companionEmail)).rejects.toThrow(ForbiddenError);
  });

  it("automatically grants trip_members access on redemption, and is idempotent", async () => {
    const tripId = await createOwnerTrip("Redemption trip");
    await invitesAs(ownerId).createInvite(tripId, companionEmail);

    // Before redemption, the invited Account has no access at all.
    expect(await repoAs(companionId).getTrip(tripId)).toBeUndefined();

    await invitesAs(companionId).redeemPendingInvites();

    const trip = await repoAs(companionId).getTrip(tripId);
    expect(trip?.id).toBe(tripId);

    const { rows } = await pool.query<{ status: string; accepted_account_id: string }>(
      `SELECT status, accepted_account_id FROM invites WHERE trip_id = $1 AND email = $2`,
      [tripId, companionEmail],
    );
    expect(rows[0]?.status).toBe("accepted");
    expect(rows[0]?.accepted_account_id).toBe(companionId);

    // A second call (e.g. a later request in the same session) is a no-op, not an error.
    await expect(invitesAs(companionId).redeemPendingInvites()).resolves.toBeUndefined();
  });

  it("keeps invites invisible to a non-Owner (RLS), including the Companion the invite is for", async () => {
    const tripId = await createOwnerTrip("Private invites");
    await invitesAs(ownerId).createInvite(tripId, companionEmail);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: strangerId, role: "authenticated" }),
      ]);
      await client.query("SET LOCAL ROLE authenticated");
      const { rows } = await client.query("SELECT * FROM invites WHERE trip_id = $1", [tripId]);
      expect(rows).toEqual([]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  });
});
