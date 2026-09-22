import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseInviteService } from "../../db/postgres/invites.js";
import { inviteCreateInputSchema } from "../../domain/types.js";
import { safeHandler } from "../toolResult.js";

export function registerInviteTools(server: McpServer, invites: SupabaseInviteService): void {
  server.registerTool(
    "tripkit_invite_create",
    {
      title: "Invite a Companion",
      description:
        "Invite someone by email to join a trip you own. If they already have an account, they're " +
        "granted access on their next sign-in; otherwise Supabase emails them to set a password first.",
      inputSchema: inviteCreateInputSchema,
    },
    safeHandler(({ tripId, email }) => invites.createInvite(tripId, email)),
  );
}
