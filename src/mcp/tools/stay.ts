import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripkitRepository } from "../../db/repository.js";
import { stayAddInputSchema, stayUpdateInputSchema, idSchema } from "../../domain/types.js";
import { safeHandler } from "../toolResult.js";
import { z } from "zod";

export function registerStayTools(server: McpServer, repo: TripkitRepository): void {
  server.registerTool(
    "tripkit_stay_add",
    {
      title: "Add stay",
      description: "Add lodging to a trip: name, check-in/out, address, confirmation, guests.",
      inputSchema: stayAddInputSchema,
    },
    safeHandler((args) => repo.addStay(args)),
  );

  server.registerTool(
    "tripkit_stay_update",
    {
      title: "Update stay",
      description: "Update fields on an existing stay.",
      inputSchema: stayUpdateInputSchema,
    },
    safeHandler((args) => repo.updateStay(args)),
  );

  server.registerTool(
    "tripkit_stay_list",
    {
      title: "List stays",
      description: "List lodging on a trip, ordered by check-in.",
      inputSchema: z.object({ tripId: idSchema }),
    },
    safeHandler(({ tripId }) => repo.listStays(tripId)),
  );
}
