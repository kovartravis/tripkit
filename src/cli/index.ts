#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTripkitMcpServer, TRIPKIT_SERVER_VERSION } from "../mcp/server.js";
import { runHttpServer, listLanAddresses, type AuthMode } from "../mcp/httpServer.js";
import { openDatabase } from "../db/client.js";
import { SqliteTripkitRepository } from "../db/sqliteRepository.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { initProjectDataDir, resolveDataDir, resolveDbPath } from "../utils/paths.js";

const DEFAULT_HTTP_PORT = 4700;

const USAGE = `tripkit ${TRIPKIT_SERVER_VERSION}

Usage:
  tripkit mcp       Start the Tripkit MCP server on stdio
  tripkit init      Initialize a local .tripkit/ data directory in this folder
  tripkit status    Show where Tripkit's data lives and a quick summary
  tripkit --help    Show this help

MCP server flags:
  tripkit mcp --http              Serve MCP over HTTP instead of stdio, so a
                                   phone or other device on your network can
                                   connect (default: 0.0.0.0:${DEFAULT_HTTP_PORT}).
                                   Also serves a day-by-day itinerary
                                   dashboard at /ui, always behind an owner
                                   passphrase regardless of the flags below
                                   (which only affect /mcp, the agent-facing
                                   endpoint).
  tripkit mcp --http --port N     Use a specific port
  tripkit mcp --http --host H     Bind a specific address (default 0.0.0.0)
  tripkit mcp --http --token T    Require "Authorization: Bearer T" on /mcp
                                   (a token is auto-generated and printed if
                                   omitted)
  tripkit mcp --http --no-auth    Disable auth on /mcp entirely (/ui stays
                                   passphrase-protected; only do this on a
                                   network you trust)
  tripkit mcp --http --oauth \
    --public-url URL              Serve a full MCP OAuth 2.1 flow on /mcp
                                   (dynamic client registration + authorization
                                   code + refresh tokens) instead of a static
                                   bearer token, for clients that expect OAuth
                                   (e.g. Muse). URL is the exact public HTTPS
                                   origin clients will reach this server at
                                   (e.g. your tunnel's URL) — it's used as the
                                   OAuth issuer identity.
  tripkit mcp --http --oauth-password P
                                   Set/reset the owner passphrase that gates
                                   /ui and (with --oauth) /authorize (one is
                                   auto-generated and printed on first run if
                                   omitted).

Data resolution: a ./.tripkit directory in the current folder (created by
"tripkit init") is used if present; otherwise Tripkit falls back to a
per-user data directory shared across projects.`;

function parseMcpArgs(args: string[]): {
  http: boolean;
  port: number;
  host: string;
  token: string | undefined;
  noAuth: boolean;
  oauth: boolean;
  publicUrl: string | undefined;
  oauthPassword: string | undefined;
} {
  let http = false;
  let port = DEFAULT_HTTP_PORT;
  let host = "0.0.0.0";
  let token: string | undefined = process.env.TRIPKIT_HTTP_TOKEN;
  let noAuth = false;
  let oauth = false;
  let publicUrl: string | undefined;
  let oauthPassword: string | undefined = process.env.TRIPKIT_OAUTH_PASSWORD;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--http":
        http = true;
        break;
      case "--port":
        port = Number(args[++i]);
        break;
      case "--host":
        host = args[++i] ?? host;
        break;
      case "--token":
        token = args[++i];
        break;
      case "--no-auth":
        noAuth = true;
        break;
      case "--oauth":
        oauth = true;
        break;
      case "--public-url":
        publicUrl = args[++i];
        break;
      case "--oauth-password":
        oauthPassword = args[++i];
        break;
      default:
        console.error(`Unknown flag: ${arg}\n`);
        console.log(USAGE);
        process.exit(1);
    }
  }

  if ([noAuth, oauth, token !== undefined].filter(Boolean).length > 1) {
    console.error("--token, --no-auth, and --oauth are mutually exclusive\n");
    console.log(USAGE);
    process.exit(1);
  }
  if (oauth && !publicUrl) {
    console.error("--oauth requires --public-url <https-url>\n");
    console.log(USAGE);
    process.exit(1);
  }

  return { http, port, host, token, noAuth, oauth, publicUrl, oauthPassword };
}

async function runMcpStdio(): Promise<void> {
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

async function runMcpHttp(opts: ReturnType<typeof parseMcpArgs>): Promise<void> {
  if (Number.isNaN(opts.port)) {
    console.error("Invalid --port value");
    process.exit(1);
  }

  const dataDir = resolveDataDir();
  const dbPath = resolveDbPath();
  const db = openDatabase(dbPath);
  const repo = new SqliteTripkitRepository(db);

  let auth: AuthMode;
  if (opts.oauth) {
    let publicUrl: URL;
    try {
      publicUrl = new URL(opts.publicUrl!);
    } catch {
      console.error(`Invalid --public-url: ${opts.publicUrl}`);
      process.exit(1);
    }
    auth = { kind: "oauth", publicUrl };
  } else if (opts.noAuth) {
    auth = { kind: "none" };
  } else {
    auth = { kind: "bearer", token: opts.token ?? randomBytes(24).toString("base64url") };
  }

  const { close, generatedOwnerPassword } = await runHttpServer(repo, {
    host: opts.host,
    port: opts.port,
    dataDir,
    auth,
    ownerPassword: opts.oauthPassword,
  });

  console.log(`Tripkit MCP server listening on http://${opts.host}:${opts.port}/mcp`);
  if (auth.kind === "bearer") {
    console.log(`Authorization required: Bearer ${auth.token}`);
  } else if (auth.kind === "none") {
    console.log("Warning: running with --no-auth — anyone on your network can read and write this trip data.");
  } else {
    console.log(`OAuth enabled. MCP endpoint: ${new URL("/mcp", auth.publicUrl)}`);
  }

  console.log(`\nDashboard: http://${opts.host}:${opts.port}/ui (day-by-day itinerary view)`);
  if (generatedOwnerPassword) {
    console.log(`Owner passphrase (for /ui, and /authorize if using --oauth):`);
    console.log(`  ${generatedOwnerPassword}`);
    console.log(`(Saved as a hash under ${dataDir}; re-run with --oauth-password to change it.)`);
  } else {
    console.log("Using the previously set owner passphrase (pass --oauth-password to change it).");
  }

  const lanAddresses = listLanAddresses();
  if (lanAddresses.length > 0) {
    console.log("\nReachable from your phone (same Wi-Fi) at:");
    for (const addr of lanAddresses) {
      console.log(`  http://${addr}:${opts.port}/ui`);
    }
  } else {
    console.log("\nNo LAN network interface found — your phone may not be able to reach this host.");
  }

  const shutdown = async () => {
    await close();
    repo.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function runMcp(args: string[]): Promise<void> {
  const opts = parseMcpArgs(args);
  if (opts.http) {
    await runMcpHttp(opts);
  } else {
    await runMcpStdio();
  }
}

function runInit(): void {
  const cwd = process.cwd();
  const alreadyInitialized = existsSync(join(cwd, ".tripkit"));
  const dir = initProjectDataDir(cwd);
  const dbPath = resolveDbPath(cwd);
  openDatabase(dbPath).close();
  console.log(alreadyInitialized ? `Already initialized: ${dir}` : `Initialized Tripkit data directory: ${dir}`);
}

function runStatus(): void {
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
  const trips = repo.listTrips();
  console.log(`Trips: ${trips.length}`);
  for (const trip of trips) {
    console.log(`  - ${trip.name} (${trip.startDate} → ${trip.endDate}) [${trip.id}]`);
  }
  repo.close();
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "mcp":
      await runMcp(rest);
      return;
    case "init":
      runInit();
      return;
    case "status":
      runStatus();
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
