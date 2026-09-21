import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripkitRepository } from "../../db/repository.js";
import { flightAddInputSchema, flightUpdateInputSchema, idSchema } from "../../domain/types.js";
import { safeHandler } from "../toolResult.js";
import { z } from "zod";

export function registerFlightTools(server: McpServer, repo: TripkitRepository): void {
  server.registerTool(
    "tripkit_flight_add",
    {
      title: "Add flight",
      description:
        "Add a flight to a trip: airline, flight number, departure/arrival airports and times, confirmation, seat, travelers.",
      inputSchema: flightAddInputSchema,
    },
    safeHandler((args) => repo.addFlight(args)),
  );

  server.registerTool(
    "tripkit_flight_update",
    {
      title: "Update flight",
      description: "Update fields on an existing flight.",
      inputSchema: flightUpdateInputSchema,
    },
    safeHandler((args) => repo.updateFlight(args)),
  );

  server.registerTool(
    "tripkit_flight_list",
    {
      title: "List flights",
      description: "List flights on a trip, ordered by departure time.",
      inputSchema: z.object({ tripId: idSchema.describe("Trip id") }),
    },
    safeHandler(({ tripId }) => repo.listFlights(tripId)),
  );
}
