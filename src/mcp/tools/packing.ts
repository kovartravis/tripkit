import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripkitRepository } from "../../db/repository.js";
import { packingListGenerateInputSchema, packingListUpdateInputSchema } from "../../domain/types.js";
import { NotFoundError } from "../../db/repository.js";
import { generatePackingItems } from "../../domain/packing.js";
import { safeHandler } from "../toolResult.js";

function nightsBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const diffDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(1, diffDays);
}

export function registerPackingTools(server: McpServer, repo: TripkitRepository): void {
  server.registerTool(
    "tripkit_packing_list_generate",
    {
      title: "Generate packing list",
      description:
        "Generate a packing list for a trip from deterministic rules over trip length, traveler count, and climate/activity hints. " +
        "By default merges into any existing list (adds missing items, leaves checkoffs alone); set replaceExisting to start over.",
      inputSchema: packingListGenerateInputSchema,
    },
    safeHandler(({ tripId, climateHints, activityHints, replaceExisting }) => {
      const trip = repo.getTrip(tripId);
      if (!trip) throw new NotFoundError("trip", tripId);
      const travelerCount = Math.max(1, repo.listPeople(tripId).length);
      const generated = generatePackingItems({
        nights: nightsBetween(trip.startDate, trip.endDate),
        travelerCount,
        climateHints: climateHints ?? ["mild"],
        activityHints: activityHints ?? [],
      });

      if (replaceExisting) {
        return repo.replacePackingItems(tripId, generated);
      }

      const existing = repo.listPackingItems(tripId);
      const existingKeys = new Set(existing.map((item) => `${item.category}::${item.label}`));
      const missing = generated.filter((item) => !existingKeys.has(`${item.category}::${item.label}`));
      if (missing.length > 0) {
        repo.upsertPackingItems(tripId, missing, []);
      }
      return repo.listPackingItems(tripId);
    }),
  );

  server.registerTool(
    "tripkit_packing_list_update",
    {
      title: "Update packing list",
      description: "Check off, edit, add, or remove packing list items on a trip.",
      inputSchema: packingListUpdateInputSchema,
    },
    safeHandler(({ tripId, upserts, removeIds }) =>
      repo.upsertPackingItems(tripId, upserts ?? [], removeIds ?? []),
    ),
  );
}
