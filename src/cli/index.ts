#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTripkitMcpServer, TRIPKIT_SERVER_VERSION } from "../mcp/server.js";
import { openDatabase } from "../db/client.js";
import { SqliteTripkitRepository } from "../db/sqliteRepository.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { initProjectDataDir, resolveDataDir, resolveDbPath } from "../utils/paths.js";

const USAGE = `tripkit ${TRIPKIT_SERVER_VERSION}

Usage:
  tripkit mcp       Start the Tripkit MCP server on stdio
  tripkit init      Initialize a local .tripkit/ data directory in this folder
  tripkit status    Show where Tripkit's data lives and a quick summary
  tripkit --help    Show this help

Data resolution: a ./.tripkit directory in the current folder (created by
"tripkit init") is used if present; otherwise Tripkit falls back to a
per-user data directory shared across projects.`;

async function runMcp(): Promise<void> {
  const dbPath = resolveDbPath();
  const db = openDatabase(dbPath);
  const repo = new SqliteTripkitRepository(db);
  const server = createTripkitMcpServer(repo);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await server.close();
    repo.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function runInit(): void {
  const cwd = process.cwd();
  const alreadyInitialized = existsSync(join(cwd, ".tripkit"));
  const dir = initProjectDataDir(cwd);
  const dbPath = resolveDbPath(cwd);
  openDatabase(dbPath).close();
  console.log(alreadyInitialized ? `Already initialized: ${dir}` : `Initialized Tripkit data directory: ${dir}`);
}

async function runStatus(): Promise<void> {
  const dataDir = resolveDataDir();
  const dbPath = resolveDbPath();
  const dbExists = existsSync(dbPath);
  console.log(`Tripkit ${TRIPKIT_SERVER_VERSION}`);
  console.log(`Data directory: ${dataDir}`);
  console.log(`Database file:  ${dbPath} ${dbExists ? "" : "(not created yet)"}`);

  if (!dbExists) {
    console.log(`Run "tripkit init" or "tripkit mcp" to create it.`);
    return;
  }

  const db = openDatabase(dbPath);
  const repo = new SqliteTripkitRepository(db);
  const trips = await repo.listTrips();
  console.log(`Trips: ${trips.length}`);
  for (const trip of trips) {
    console.log(`  - ${trip.name} (${trip.startDate} → ${trip.endDate}) [${trip.id}]`);
  }
  repo.close();
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);

  switch (command) {
    case "mcp":
      await runMcp();
      return;
    case "init":
      runInit();
      return;
    case "status":
      await runStatus();
      return;
    case "--help":
    case "-h":
    case undefined:
      console.log(USAGE);
      return;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
