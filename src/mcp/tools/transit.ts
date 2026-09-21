import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { transitSketchInputSchema } from "../../domain/types.js";
import { sketchTransit } from "../../domain/transit.js";
import { safeHandler } from "../toolResult.js";

export function registerTransitTools(server: McpServer): void {
  server.registerTool(
    "tripkit_transit_sketch",
    {
      title: "Sketch transit",
      description:
        "Sketch a transit leg between two places on a day: mode hint, rough duration estimate. " +
        "Placeholder estimates only — no live routing/booking API in v1. Feed the result into tripkit_day_plan_set as a 'transit' block if useful.",
      inputSchema: transitSketchInputSchema,
    },
    safeHandler((args) => sketchTransit(args)),
  );
}
