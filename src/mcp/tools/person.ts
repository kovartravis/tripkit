import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripkitRepository } from "../../db/repository.js";
import { personAddInputSchema, personUpdateInputSchema, idSchema } from "../../domain/types.js";
import { safeHandler } from "../toolResult.js";
import { z } from "zod";

export function registerPersonTools(server: McpServer, repo: TripkitRepository): void {
  server.registerTool(
    "tripkit_person_add",
    {
      title: "Add person",
      description: "Add a traveler to a trip.",
      inputSchema: personAddInputSchema,
    },
    safeHandler((args) => repo.addPerson(args)),
  );

  server.registerTool(
    "tripkit_person_update",
    {
      title: "Update person",
      description: "Update fields on an existing traveler.",
      inputSchema: personUpdateInputSchema,
    },
    safeHandler((args) => repo.updatePerson(args)),
  );

  server.registerTool(
    "tripkit_person_list",
    {
      title: "List people",
      description: "List travelers on a trip.",
      inputSchema: z.object({ tripId: idSchema.describe("Trip id") }),
    },
    safeHandler(({ tripId }) => repo.listPeople(tripId)),
  );
}
