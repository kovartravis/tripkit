export interface SupabaseAdminConfig {
  /** Project base URL, e.g. https://<ref>.supabase.co */
  projectUrl: string;
  /** service_role key — required for any admin endpoint, never the anon/publishable key. */
  serviceRoleKey: string;
}

export class SupabaseAdminApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseAdminApiError";
  }
}

export type InviteUserByEmailResult =
  | { outcome: "invited" }
  | { outcome: "already_exists" };

/**
 * Thin wrapper over Supabase Auth's (GoTrue) admin `/invite` endpoint — the same REST call
 * `supabase.auth.admin.inviteUserByEmail` makes under the hood. Called directly via `fetch`
 * rather than pulling in `@supabase/supabase-js`, matching how the rest of Tripkit's external
 * integrations are built (see `lookupPlace` in ./nominatim.ts) and how the live-Postgres test
 * suite already talks to Supabase's admin API (`test/postgres/supabaseTripkitRepository.test.ts`).
 *
 * If the email already has an Account, Supabase's admin API rejects with HTTP 422
 * (`email_exists`) — that's an expected, not exceptional, outcome for invite issuance (ticket
 * #21: the invite still gets recorded, just without creating a duplicate Account), so it's
 * returned rather than thrown. Any other non-2xx response is a genuine failure.
 */
export async function inviteUserByEmail(
  config: SupabaseAdminConfig,
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InviteUserByEmailResult> {
  const url = new URL("/auth/v1/invite", config.projectUrl);
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  if (res.ok) {
    return { outcome: "invited" };
  }
  if (res.status === 422) {
    return { outcome: "already_exists" };
  }
  throw new SupabaseAdminApiError(res.status, await res.text());
}
