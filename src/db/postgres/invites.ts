import type { Pool, PoolClient } from "pg";
import type { Invite } from "../../domain/types.js";
import { NotFoundError } from "../repository.js";
import { newId, nowIso } from "../../utils/id.js";
import { inviteUserByEmail, type SupabaseAdminConfig } from "../../integrations/supabaseAdmin.js";
import type { VerifiedSupabaseClaims } from "./identity.js";
import { withAuthenticatedTransaction } from "./withAuth.js";

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

interface InviteRow {
  id: string;
  trip_id: string;
  email: string;
  invited_by_account_id: string;
  status: Invite["status"];
  accepted_account_id: string | null;
  created_at: string;
  updated_at: string;
}

function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    tripId: row.trip_id,
    email: row.email,
    invitedByAccountId: row.invited_by_account_id,
    status: row.status,
    acceptedAccountId: row.accepted_account_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Invite issuance and redemption (ticket #21). Deliberately sits alongside
 * `SupabaseTripkitRepository` rather than inside `TripkitRepository`'s interface: inviting
 * isn't part of the storage port every repository implementation must satisfy — it's
 * Supabase-specific, privileged plumbing (the Admin API + a `SECURITY DEFINER` RPC) that
 * `SqliteTripkitRepository` never had and never will.
 */
export class SupabaseInviteService {
  constructor(
    private readonly pool: Pool,
    private readonly claims: VerifiedSupabaseClaims,
    private readonly adminConfig: SupabaseAdminConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private withAuth<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return withAuthenticatedTransaction(this.pool, this.claims, fn);
  }

  /**
   * Only the Trip's Owner may invite a Companion — checked explicitly here rather than left
   * solely to RLS (the `invites` table's own "owner has full access" policy would also catch
   * a non-Owner INSERT, but by then `inviteUserByEmail` — a privileged external call — would
   * already have run).
   */
  async createInvite(tripId: string, email: string): Promise<Invite> {
    return this.withAuth(async (client) => {
      const { rows } = await client.query<{ role: string }>(
        `SELECT role FROM trip_members WHERE trip_id = $1 AND account_id = $2`,
        [tripId, this.claims.sub],
      );
      if (rows[0]?.role !== "owner") {
        throw new ForbiddenError("Only the trip's Owner can invite a Companion");
      }

      // Skips creating a duplicate Account when the email already has one (outcome
      // "already_exists") — either way, the pending invite below is what actually grants
      // access, via redeem_pending_invites() the next time that Account authenticates.
      await inviteUserByEmail(this.adminConfig, email, this.fetchImpl);

      const id = newId("invite");
      const ts = nowIso();
      await client.query(
        `INSERT INTO invites (id, trip_id, email, invited_by_account_id, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
        [id, tripId, email, this.claims.sub, ts, ts],
      );
      return this.getInviteInTxOrThrow(client, id);
    });
  }

  /**
   * Grants the caller `trip_members` access for every pending Invite matching their verified
   * email, no explicit accept step. Idempotent — safe to call on every authenticated request,
   * as the spec calls for ("once per new access-token session ... not on every tool call"):
   * a second call with nothing pending is a no-op.
   *
   * Invoked from every /mcp request and every dashboard /api/* request (`httpServer.ts`'s
   * `redeemInvitesBestEffort`), best-effort: a failure here is logged and swallowed rather than
   * failing the request it was piggybacking on.
   */
  async redeemPendingInvites(): Promise<void> {
    return this.withAuth(async (client) => {
      await client.query("SELECT public.redeem_pending_invites()");
    });
  }

  private async getInviteInTx(client: PoolClient, id: string): Promise<Invite | undefined> {
    const { rows } = await client.query<InviteRow>(`SELECT * FROM invites WHERE id = $1`, [id]);
    return rows[0] ? toInvite(rows[0]) : undefined;
  }

  private async getInviteInTxOrThrow(client: PoolClient, id: string): Promise<Invite> {
    const invite = await this.getInviteInTx(client, id);
    if (!invite) throw new NotFoundError("invite", id);
    return invite;
  }
}
