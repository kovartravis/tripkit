import type { Pool, PoolClient } from "pg";
import type { VerifiedSupabaseClaims } from "./identity.js";

/**
 * Runs `fn` inside a transaction scoped to `claims`' Account: forwards the already-verified
 * JWT claims into `request.jwt.claims` and switches to the `authenticated` Postgres role for
 * that transaction only (`SET LOCAL`, so it never leaks onto a pooled connection handed back
 * for someone else's request afterward), so `auth.uid()`-based RLS is genuinely enforced by
 * Postgres per call. Shared by every Supabase-backed data-access class (`SupabaseTripkitRepository`,
 * `SupabaseInviteService`) rather than each reimplementing it — see ticket #8's direct-Postgres
 * JWT-forwarding design.
 */
export async function withAuthenticatedTransaction<T>(
  pool: Pool,
  claims: VerifiedSupabaseClaims,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
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
