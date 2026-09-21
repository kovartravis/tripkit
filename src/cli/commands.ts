import { existsSync } from "node:fs";
import { join } from "node:path";
import { TRIPKIT_SERVER_VERSION } from "../version.js";
import { initProjectDataDir, resolveDataDir, resolveDbPath } from "../utils/paths.js";

export const USAGE = `tripkit ${TRIPKIT_SERVER_VERSION}

Usage:
  tripkit mcp       Start the Tripkit MCP server on stdio
  tripkit init      Initialize a local .tripkit/ data directory in this folder
  tripkit status    Show where Tripkit's data lives and a quick summary
  tripkit --help    Show this help

Data resolution: TRIPKIT_DATA_DIR (if set), else a ./.tripkit directory in
the current folder (created by "tripkit init"), else a per-user data
directory shared across projects.`;

async function loadStore(dbPath: string) {
  const { openDatabase } = await import("../db/client.js");
  const { SqliteTripkitRepository } = await import("../db/sqliteRepository.js");
  const db = openDatabase(dbPath);
  return new SqliteTripkitRepository(db);
}

export async function runMcp(): Promise<void> {
  const [{ StdioServerTransport }, { createTripkitMcpServer }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("../mcp/server.js"),
  ]);
  const repo = await loadStore(resolveDbPath());
  const server = createTripkitMcpServer(repo);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const closeRepo = (): void => {
    try {
      repo.close();
    } catch {
      // already closed
    }
  };
  const shutdown = async (): Promise<void> => {
    try {
      await server.close();
    } catch {
      // already closing
    }
    closeRepo();
    process.exit(0);
  };
  server.server.onclose = closeRepo;
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

export async function runInit(cwd: string = process.cwd()): Promise<string> {
  const alreadyInitialized = existsSync(join(cwd, ".tripkit"));
  const dir = initProjectDataDir(cwd);
  const repo = await loadStore(resolveDbPath(cwd));
  repo.close();
  return alreadyInitialized ? `Already initialized: ${dir}` : `Initialized Tripkit data directory: ${dir}`;
}

export async function runStatus(cwd: string = process.cwd()): Promise<string> {
  const dataDir = resolveDataDir(cwd);
  const dbPath = resolveDbPath(cwd);
  const dbExists = existsSync(dbPath);
  const lines = [
    `Tripkit ${TRIPKIT_SERVER_VERSION}`,
    `Data directory: ${dataDir}`,
    `Database file:  ${dbPath}${dbExists ? "" : " (not created yet)"}`,
  ];

  if (!dbExists) {
    lines.push(`Run "tripkit init" or "tripkit mcp" to create it.`);
    return lines.join("\n");
  }

  const repo = await loadStore(dbPath);
  try {
    const trips = repo.listTrips();
    lines.push(`Trips: ${trips.length}`);
    for (const trip of trips) {
      lines.push(`  - ${trip.name} (${trip.startDate} → ${trip.endDate}) [${trip.id}]`);
    }
    return lines.join("\n");
  } finally {
    repo.close();
  }
}
