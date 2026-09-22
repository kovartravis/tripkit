import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { placeLookupInputSchema } from "../../domain/types.js";
import { lookupPlace } from "../../integrations/nominatim.js";
import { safeHandler } from "../toolResult.js";

export function registerPlaceTools(server: McpServer): void {
  server.registerTool(
    "tripkit_place_lookup",
    {
      title: "Look up a place",
      description:
        "Resolve a free-text place name (e.g. 'Senso-ji Temple, Asakusa' or 'Shinjuku Station') into a real " +
        "address, coordinates, and a Google Maps link, via OpenStreetMap — no API key needed. Use this before " +
        "writing a location into a day block's `place` or a stay's `address`, instead of guessing an address " +
        "from memory. Returns up to `limit` candidates (default 3) so you can pick the right match when the " +
        "name is ambiguous.",
      inputSchema: placeLookupInputSchema,
    },
    safeHandler((args) => lookupPlace(args)),
  );
}
