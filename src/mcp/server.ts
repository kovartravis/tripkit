import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TripkitRepository } from "../db/repository.js";
import type { SupabaseInviteService } from "../db/postgres/invites.js";
import { registerTripTools } from "./tools/trip.js";
import { registerPersonTools } from "./tools/person.js";
import { registerFlightTools } from "./tools/flight.js";
import { registerStayTools } from "./tools/stay.js";
import { registerDayTools } from "./tools/day.js";
import { registerPackingTools } from "./tools/packing.js";
import { registerTransitTools } from "./tools/transit.js";
import { registerPlaceTools } from "./tools/place.js";
import { registerQueryTools } from "./tools/query.js";
import { registerExportTools } from "./tools/export.js";
import { registerInviteTools } from "./tools/invite.js";

export const TRIPKIT_SERVER_NAME = "tripkit";
export const TRIPKIT_SERVER_VERSION = "0.1.0";

export function createTripkitMcpServer(repo: TripkitRepository, invites: SupabaseInviteService): McpServer {
  const server = new McpServer({
    name: TRIPKIT_SERVER_NAME,
    version: TRIPKIT_SERVER_VERSION,
  });

  registerTripTools(server, repo);
  registerPersonTools(server, repo);
  registerFlightTools(server, repo);
  registerStayTools(server, repo);
  registerDayTools(server, repo);
  registerPackingTools(server, repo);
  registerTransitTools(server);
  registerPlaceTools(server);
  registerQueryTools(server, repo);
  registerExportTools(server, repo);
  registerInviteTools(server, invites);

  return server;
}
