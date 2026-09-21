import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripkitRepository } from "../../db/repository.js";
import { tripCreateInputSchema, tripUpdateInputSchema, idSchema } from "../../domain/types.js";
import { NotFoundError } from "../../db/repository.js";
import { safeHandler } from "../toolResult.js";
import { z } from "zod";

export function registerTripTools(server: McpServer, repo: TripkitRepository): void {
  server.registerTool(
    "tripkit_trip_create",
    {
      title: "Create trip",
      description: "Create a new trip in the local ledger (name, start/end dates, home timezone, notes).",
      inputSchema: tripCreateInputSchema,
    },
    safeHandler((args) => repo.createTrip(args)),
  );

  server.registerTool(
    "tripkit_trip_update",
    {
      title: "Update trip",
      description: "Update fields on an existing trip.",
      inputSchema: tripUpdateInputSchema,
    },
    safeHandler((args) => repo.updateTrip(args)),
  );

  server.registerTool(
    "tripkit_trip_get",
    {
      title: "Get trip",
      description: "Fetch a single trip by id.",
      inputSchema: z.object({ id: idSchema }),
    },
    safeHandler(({ id }) => {
      const trip = repo.getTrip(id);
      if (!trip) throw new NotFoundError("trip", id);
      return trip;
    }),
  );

  server.registerTool(
    "tripkit_trip_list",
    {
      title: "List trips",
      description: "List all trips in the local ledger.",
      inputSchema: z.object({}),
    },
    safeHandler(() => repo.listTrips()),
  );
}
