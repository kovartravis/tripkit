import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripkitRepository } from "../../db/repository.js";
import { idSchema } from "../../domain/types.js";
import { exportMarkdown } from "../../export/markdown.js";
import { exportIcs } from "../../export/ics.js";
import { safeHandler } from "../toolResult.js";
import { z } from "zod";

const exportInputSchema = z.object({
  tripId: idSchema,
  dayId: idSchema.optional(),
});

export function registerExportTools(server: McpServer, repo: TripkitRepository): void {
  server.registerTool(
    "tripkit_export_markdown",
    {
      title: "Export markdown",
      description: "Export a trip (or a single day within it, via dayId) as markdown.",
      inputSchema: exportInputSchema,
    },
    safeHandler(async ({ tripId, dayId }) => ({ markdown: await exportMarkdown(repo, tripId, dayId) })),
  );

  server.registerTool(
    "tripkit_export_ics",
    {
      title: "Export ICS calendar",
      description:
        "Export flights, stays, and day-plan blocks as an ICS calendar. Scope to a single day's blocks via dayId.",
      inputSchema: exportInputSchema,
    },
    safeHandler(async ({ tripId, dayId }) => ({ ics: await exportIcs(repo, tripId, dayId) })),
  );
}
