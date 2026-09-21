import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripkitRepository } from "../../db/repository.js";
import { queryInputSchema } from "../../domain/types.js";
import { safeHandler } from "../toolResult.js";

export function registerQueryTools(server: McpServer, repo: TripkitRepository): void {
  server.registerTool(
    "tripkit_query",
    {
      title: "Query trip ledger",
      description:
        "Structured query over a trip's ledger: pick entity types (trip|person|flight|stay|day|packingItem) and " +
        "optionally filter by date range and/or person.",
      inputSchema: queryInputSchema,
    },
    safeHandler(({ tripId, entityTypes, startDate, endDate, personId }) =>
      repo.query(tripId, { entityTypes, startDate, endDate, personId }),
    ),
  );
}
