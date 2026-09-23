#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRemoteJWKSet } from "jose";
import { createTripkitMcpServer, TRIPKIT_SERVER_VERSION } from "../mcp/server.js";
import { runHttpServer, listLanAddresses } from "../mcp/httpServer.js";
import { fetchSupabaseOAuthMetadata } from "../mcp/oauth/supabaseMetadata.js";
import { createSupabaseSessionVerifier } from "../mcp/oauth/supabaseTokenVerifier.js";
import { createSupabasePool, supabasePoolConfigFromEnv } from "../db/postgres/pool.js";
import { SupabaseTripkitRepository } from "../db/postgres/supabaseTripkitRepository.js";
import { SupabaseInviteService } from "../db/postgres/invites.js";

const DEFAULT_HTTP_PORT = 4700;

const USAGE = `tripkit ${TRIPKIT_SERVER_VERSION}

Every path requires a Supabase Account (ADR 0004) — there is no local-only
or account-free mode.

Usage:
  tripkit mcp       Start the Tripkit MCP server on stdio
  tripkit --help    Show this help

Stdio mode (env vars only, no flags — matches how MCP clients like Claude
Desktop configure a subprocess's environment):
  TRIPKIT_SUPABASE_URL           Your Supabase project's base URL
                                  (e.g. https://<ref>.supabase.co)
  TRIPKIT_SUPABASE_ACCESS_TOKEN  Your own Supabase session access token
                                  (obtained via Supabase's own sign-in —
                                  see README), scoping the whole stdio
                                  session to your Account
  SUPABASE_SERVICE_ROLE_KEY      The project's service_role key (needed
                                  for tripkit_invite_create's Admin API
                                  call)
  SUPABASE_DB_HOST / _USER / _PASSWORD [/ _PORT / _NAME]
                                  Direct Postgres connection (RLS is
                                  enforced per request, not via PostgREST)

MCP server flags:
  tripkit mcp --http              Serve MCP over HTTP instead of stdio, so a
                                   phone, other device, or remote MCP client
                                   (dynamic client registration + PKCE
                                   against Supabase's own OAuth 2.1 server)
                                   can connect (default: 0.0.0.0:${DEFAULT_HTTP_PORT}).
                                   Also serves a day-by-day itinerary
                                   dashboard at /ui — a Member signs in there
                                   via Supabase's own hosted login.
  tripkit mcp --http --port N     Use a specific port
  tripkit mcp --http --host H     Bind a specific address (default 0.0.0.0)
  tripkit mcp --http --supabase-url URL \\
    --supabase-anon-key KEY \\
    --public-url URL              --supabase-url is the project's base URL
                                   (e.g. https://<ref>.supabase.co);
                                   --supabase-anon-key is that project's
                                   public anon key (safe to expose — it's
                                   embedded in the /ui dashboard);
                                   --public-url is the exact public HTTPS
                                   origin clients will reach this server at
                                   (e.g. your tunnel's URL) — used as the
                                   resource server identity clients discover
                                   Supabase's OAuth server through. Also
                                   requires SUPABASE_SERVICE_ROLE_KEY and
                                   SUPABASE_DB_HOST/USER/PASSWORD (see
                                   stdio mode above) to be set as env vars.`;

function parseMcpArgs(args: string[]): {
  http: boolean;
  port: number;
  host: string;
  publicUrl: string | undefined;
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
} {
  let http = false;
  let port = DEFAULT_HTTP_PORT;
  let host = "0.0.0.0";
  let publicUrl: string | undefined;
  let supabaseUrl: string | undefined = process.env.TRIPKIT_SUPABASE_URL;
  let supabaseAnonKey: string | undefined = process.env.TRIPKIT_SUPABASE_ANON_KEY;

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
      case "--public-url":
        publicUrl = args[++i];
        break;
      case "--supabase-url":
        supabaseUrl = args[++i];
        break;
      case "--supabase-anon-key":
        supabaseAnonKey = args[++i];
        break;
      default:
        console.error(`Unknown flag: ${arg}\n`);
        console.log(USAGE);
        process.exit(1);
    }
  }

  if (http) {
    if (!publicUrl) {
      console.error("--http requires --public-url <https-url>\n");
      console.log(USAGE);
      process.exit(1);
    }
    if (!supabaseUrl) {
      console.error("--http requires --supabase-url <url> (or TRIPKIT_SUPABASE_URL)\n");
      console.log(USAGE);
      process.exit(1);
    }
    if (!supabaseAnonKey) {
      console.error("--http requires --supabase-anon-key <key> (or TRIPKIT_SUPABASE_ANON_KEY)\n");
      console.log(USAGE);
      process.exit(1);
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("--http requires SUPABASE_SERVICE_ROLE_KEY to be set\n");
      console.log(USAGE);
      process.exit(1);
    }
    // The dashboard and /mcp both connect to Postgres directly — fail before binding a port
    // rather than letting the first request hit a missing-config error.
    if (!supabasePoolConfigFromEnv()) {
      console.error(
        "--http also requires SUPABASE_DB_HOST, SUPABASE_DB_USER, and SUPABASE_DB_PASSWORD to be set\n",
      );
      console.log(USAGE);
      process.exit(1);
    }
  }

  return { http, port, host, publicUrl, supabaseUrl, supabaseAnonKey };
}

async function runMcpStdio(): Promise<void> {
  const projectUrlRaw = process.env.TRIPKIT_SUPABASE_URL;
  const accessToken = process.env.TRIPKIT_SUPABASE_ACCESS_TOKEN;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const poolConfig = supabasePoolConfigFromEnv();

  if (!projectUrlRaw || !accessToken || !serviceRoleKey || !poolConfig) {
    console.error(
      "tripkit mcp (stdio) requires TRIPKIT_SUPABASE_URL, TRIPKIT_SUPABASE_ACCESS_TOKEN, " +
        "SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_DB_HOST/USER/PASSWORD to be set. Run \"tripkit --help\".",
    );
    process.exit(1);
  }

  let projectUrl: URL;
  try {
    projectUrl = new URL(projectUrlRaw);
  } catch {
    console.error(`Invalid TRIPKIT_SUPABASE_URL: ${projectUrlRaw}`);
    process.exit(1);
  }

  const oauthMetadata = await fetchSupabaseOAuthMetadata(projectUrl);
  const sessionVerifier = createSupabaseSessionVerifier({
    issuer: oauthMetadata.issuer,
    getKey: createRemoteJWKSet(new URL(oauthMetadata.jwks_uri)),
  });

  let claims;
  try {
    claims = await sessionVerifier(accessToken);
  } catch (error) {
    console.error(`TRIPKIT_SUPABASE_ACCESS_TOKEN is invalid or expired: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  const pool = createSupabasePool(poolConfig);
  const repo = new SupabaseTripkitRepository(pool, claims);
  const invites = new SupabaseInviteService(pool, claims, { projectUrl: projectUrl.href, serviceRoleKey });
  try {
    await invites.redeemPendingInvites();
  } catch (error) {
    console.error("Failed to redeem pending invites:", error instanceof Error ? error.message : error);
  }

  const server = createTripkitMcpServer(repo, invites);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await server.close();
    await pool.end();
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

  let publicUrl: URL;
  let projectUrl: URL;
  try {
    publicUrl = new URL(opts.publicUrl!);
  } catch {
    console.error(`Invalid --public-url: ${opts.publicUrl}`);
    process.exit(1);
  }
  try {
    projectUrl = new URL(opts.supabaseUrl!);
  } catch {
    console.error(`Invalid --supabase-url: ${opts.supabaseUrl}`);
    process.exit(1);
  }

  const { close } = await runHttpServer({
    host: opts.host,
    port: opts.port,
    supabase: {
      projectUrl,
      publicUrl,
      anonKey: opts.supabaseAnonKey!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    },
  });

  console.log(`Tripkit MCP server listening on http://${opts.host}:${opts.port}/mcp`);
  console.log(`Supabase auth enabled (project: ${projectUrl}). MCP endpoint: ${new URL("/mcp", publicUrl)}`);
  console.log(`\nDashboard: http://${opts.host}:${opts.port}/ui (day-by-day itinerary view)`);
  console.log("Sign in there with your Supabase Account (Supabase's own hosted login).");

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

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "mcp":
      await runMcp(rest);
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
