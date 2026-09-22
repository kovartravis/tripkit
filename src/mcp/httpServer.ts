import express, { type NextFunction, type Request, type Response } from "express";
import { networkInterfaces } from "node:os";
import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import type { Pool } from "pg";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
  mcpAuthRouter,
  mcpAuthMetadataRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { TripkitRepository } from "../db/repository.js";
import { NotFoundError } from "../db/repository.js";
import { createSupabasePool, supabasePoolConfigFromEnv } from "../db/postgres/pool.js";
import { SupabaseTripkitRepository } from "../db/postgres/supabaseTripkitRepository.js";
import type { VerifiedSupabaseClaims } from "../db/postgres/identity.js";
import { createTripkitMcpServer } from "./server.js";
import { TripkitOAuthProvider } from "./oauth/provider.js";
import {
  createOwnerLoginGate,
  parseCookies,
  renderLoginPage,
  setOwnerSessionCookie,
  SESSION_COOKIE,
  verifySessionToken,
} from "./oauth/loginGate.js";
import { loadOAuthState, verifyOwnerPassword, type OAuthState } from "./oauth/state.js";
import { fetchSupabaseOAuthMetadata } from "./oauth/supabaseMetadata.js";
import { createSupabaseTokenVerifier, createSupabaseSessionVerifier } from "./oauth/supabaseTokenVerifier.js";
import { renderDashboardPage } from "./ui/dashboard.js";
import { buildDayItineraries } from "./ui/itinerary.js";
import { loadTripExportBundle } from "../export/markdown.js";

const MCP_PATH = "/mcp";

export type AuthMode =
  | { kind: "bearer"; token: string }
  | { kind: "oauth"; publicUrl: URL }
  | { kind: "supabase"; projectUrl: URL; publicUrl: URL; anonKey: string }
  | { kind: "none" };

export interface HttpServerOptions {
  host: string;
  port: number;
  dataDir: string;
  auth: AuthMode;
  /** Owner passphrase gating /ui, /api, and (in OAuth mode) /authorize. Auto-generated on first run if omitted. */
  ownerPassword?: string;
  /** Override for fetching Supabase's OAuth discovery document (`auth.kind === "supabase"`); defaults to `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface HttpServerHandle {
  close: () => Promise<void>;
  /** Set only when OAuth mode auto-generated a fresh owner passphrase this run. */
  generatedOwnerPassword?: string;
}

/**
 * Every dashboard route funnels its errors through here so a config problem (e.g. Supabase
 * mode's Postgres pool env vars missing) becomes a clean JSON 500 like the rest of this API,
 * not Express's default HTML error page — `runHttpServer` is called directly by tests too, so
 * this can't rely solely on the CLI's own startup validation catching that case first.
 */
function sendDashboardError(res: Response, error: unknown): void {
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: "not found" });
    return;
  }
  console.error("Dashboard request failed:", error);
  res.status(500).json({ error: "internal server error" });
}

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearerAuthMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!tokenMatches(provided, token)) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized" }, id: null });
      return;
    }
    next();
  };
}

async function handleMcpRequest(repo: TripkitRepository, req: Request, res: Response): Promise<void> {
  const mcpServer = createTripkitMcpServer(repo);
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
    res.on("close", () => {
      void transport.close();
      void mcpServer.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
}

/**
 * The dashboard (`/ui`, `/api/trips`, `/api/trips/:id/itinerary`) authenticates independently
 * of whichever auth mode `/mcp` uses — one of these two implementations is built once per
 * `runHttpServer` call and used for all three routes, so each is authenticated (and, in
 * Supabase mode, RLS-scoped) exactly the same way.
 */
interface DashboardAuth {
  requireSession: (req: Request, res: Response, next: NextFunction) => void;
  getRepo: (req: Request, res: Response) => TripkitRepository;
  renderUi: (req: Request, res: Response) => void;
  /** Tears down anything this dashboard opened for itself (e.g. Supabase mode's own Pool). */
  close?: () => Promise<void>;
}

/** The pre-Supabase dashboard: gated by the same owner-passphrase session cookie as `/authorize`. */
function createPassphraseDashboard(state: OAuthState, repo: TripkitRepository): DashboardAuth {
  return {
    requireSession(req, res, next) {
      const cookies = parseCookies(req.headers.cookie);
      if (verifySessionToken(state.cookieSecret, cookies[SESSION_COOKIE])) {
        next();
        return;
      }
      res.status(401).json({ error: "unauthorized" });
    },
    getRepo: () => repo,
    renderUi(req, res) {
      const cookies = parseCookies(req.headers.cookie);
      if (verifySessionToken(state.cookieSecret, cookies[SESSION_COOKIE])) {
        res.status(200).send(renderDashboardPage());
        return;
      }

      const pageOpts = {
        action: "/ui",
        heading: "Sign in to Tripkit",
        description: "View your day-by-day itinerary.",
      };
      if (req.method === "POST" && typeof req.body?.passphrase === "string") {
        if (verifyOwnerPassword(state, req.body.passphrase)) {
          setOwnerSessionCookie(res, state.cookieSecret);
          res.status(200).send(renderDashboardPage());
          return;
        }
        res.status(401).send(renderLoginPage({ ...pageOpts, error: "Incorrect passphrase." }));
        return;
      }
      res.status(200).send(renderLoginPage(pageOpts));
    },
  };
}

/**
 * The Supabase-authenticated dashboard: a Member signs in via Supabase's own hosted login
 * (client-side, inside `renderDashboardPage`'s own script — see `src/mcp/ui/dashboard.ts`) and
 * the browser presents that session's access token as a bearer token on every `/api/*` call.
 * Each request gets its own `SupabaseTripkitRepository`, scoped to the caller's verified
 * claims, so the trip list Account-scoping is real RLS enforcement — the same mechanism the
 * MCP tools rely on — not a separate authorization check in the dashboard's own code.
 */
function createSupabaseDashboard(
  auth: { projectUrl: URL; anonKey: string },
  sessionVerifier: (token: string) => Promise<VerifiedSupabaseClaims>,
): DashboardAuth {
  let pool: Pool | undefined;
  function getPool(): Pool {
    if (!pool) {
      const config = supabasePoolConfigFromEnv();
      if (!config) {
        throw new Error(
          "Dashboard auth in Supabase mode requires SUPABASE_DB_HOST, SUPABASE_DB_USER, and SUPABASE_DB_PASSWORD to be set.",
        );
      }
      pool = createSupabasePool(config);
    }
    return pool;
  }

  return {
    requireSession(req, res, next) {
      const header = req.headers.authorization;
      const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
      if (!token) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      sessionVerifier(token)
        .then((claims) => {
          res.locals.tripkitClaims = claims;
          next();
        })
        .catch(() => {
          res.status(401).json({ error: "unauthorized" });
        });
    },
    getRepo: (_req, res) => new SupabaseTripkitRepository(getPool(), res.locals.tripkitClaims as VerifiedSupabaseClaims),
    renderUi(_req, res) {
      res.status(200).send(renderDashboardPage({ supabase: { url: auth.projectUrl.href, anonKey: auth.anonKey } }));
    },
    close: async () => {
      if (pool) await pool.end();
    },
  };
}

/** LAN-reachable addresses (non-internal IPv4) for printing a phone-friendly URL. */
export function listLanAddresses(): string[] {
  const addresses: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const entry of iface ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

export async function runHttpServer(repo: TripkitRepository, options: HttpServerOptions): Promise<HttpServerHandle> {
  const { host, port, auth } = options;
  const app = express();
  app.disable("x-powered-by");
  // We sit behind a local reverse proxy (a tunnel, or none at all) that connects over
  // loopback; trusting only loopback lets express-rate-limit read X-Forwarded-For safely
  // without trusting arbitrary upstream hops.
  app.set("trust proxy", "loopback");

  let generatedOwnerPassword: string | undefined;
  let dashboard: DashboardAuth;

  if (auth.kind === "oauth") {
    const provider = new TripkitOAuthProvider(options.dataDir, options.ownerPassword);
    generatedOwnerPassword = provider.generatedPassword;
    dashboard = createPassphraseDashboard(provider.state, repo);

    const resourceUrl = new URL(MCP_PATH, auth.publicUrl);
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);

    // Gate the human-facing /authorize step behind an owner passphrase before the SDK's
    // own OAuth router (mounted below) handles the protocol mechanics.
    app.use("/authorize", express.urlencoded({ extended: false }), createOwnerLoginGate(provider.state));

    app.use(
      mcpAuthRouter({
        provider,
        issuerUrl: auth.publicUrl,
        resourceServerUrl: resourceUrl,
        scopesSupported: ["tripkit"],
        resourceName: "Tripkit",
      }),
    );

    app.post(MCP_PATH, requireBearerAuth({ verifier: provider, resourceMetadataUrl }), (req, res) => {
      void handleMcpRequest(repo, req, res);
    });
  } else if (auth.kind === "supabase") {
    // Tripkit is only the resource server here: Supabase's own OAuth 2.1 server issues and
    // signs the tokens, so all we do is advertise where clients should authenticate (this
    // Protected Resource Metadata) and verify what they bring back (the bearer middleware
    // below) — no /authorize or /token routes of our own. No owner passphrase in this mode at
    // all: the dashboard authenticates Members via Supabase's own hosted login instead (see
    // createSupabaseDashboard below).
    const oauthMetadata = await fetchSupabaseOAuthMetadata(auth.projectUrl, options.fetchImpl);
    const getKey: JWTVerifyGetKey = createRemoteJWKSet(new URL(oauthMetadata.jwks_uri));
    const verifier = createSupabaseTokenVerifier({ issuer: oauthMetadata.issuer, getKey });
    const sessionVerifier = createSupabaseSessionVerifier({ issuer: oauthMetadata.issuer, getKey });
    dashboard = createSupabaseDashboard(auth, sessionVerifier);

    const resourceUrl = new URL(MCP_PATH, auth.publicUrl);
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);

    app.use(
      mcpAuthMetadataRouter({
        oauthMetadata,
        resourceServerUrl: resourceUrl,
        // Supabase's OAuth server only grants its own fixed OIDC scopes (openid, email,
        // profile, ...), not app-defined ones — advertise what it actually supports rather
        // than a made-up scope no client could ever obtain.
        scopesSupported: oauthMetadata.scopes_supported,
        resourceName: "Tripkit",
      }),
    );

    app.post(MCP_PATH, requireBearerAuth({ verifier, resourceMetadataUrl }), (req, res) => {
      void handleMcpRequest(repo, req, res);
    });
  } else {
    const loaded = loadOAuthState(options.dataDir, options.ownerPassword);
    generatedOwnerPassword = loaded.generatedPassword;
    dashboard = createPassphraseDashboard(loaded.state, repo);

    if (auth.kind === "bearer") {
      app.post(MCP_PATH, bearerAuthMiddleware(auth.token), (req, res) => {
        void handleMcpRequest(repo, req, res);
      });
    } else {
      app.post(MCP_PATH, (req, res) => {
        void handleMcpRequest(repo, req, res);
      });
    }
  }

  app.get(MCP_PATH, (_req, res) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  });
  app.delete(MCP_PATH, (_req, res) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  });

  // --- Human-facing dashboard, authenticated independently of whichever auth mode /mcp is
  // using (see `dashboard`, built per auth.kind above). ---
  app.get("/api/trips", dashboard.requireSession, async (req, res) => {
    try {
      res.json(await dashboard.getRepo(req, res).listTrips());
    } catch (error) {
      sendDashboardError(res, error);
    }
  });

  app.get("/api/trips/:id/itinerary", dashboard.requireSession, async (req, res) => {
    try {
      const tripId = req.params.id;
      if (typeof tripId !== "string") {
        res.status(400).json({ error: "invalid trip id" });
        return;
      }
      const bundle = await loadTripExportBundle(dashboard.getRepo(req, res), tripId);
      res.json({
        trip: bundle.trip,
        people: bundle.people,
        packingItems: bundle.packingItems,
        days: buildDayItineraries(bundle),
      });
    } catch (error) {
      sendDashboardError(res, error);
    }
  });

  app.all("/ui", express.urlencoded({ extended: false }), (req, res) => dashboard.renderUi(req, res));

  app.get("/", (_req, res) => res.redirect("/ui"));

  const server = app.listen(port, host);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });

  return {
    generatedOwnerPassword,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await dashboard.close?.();
    },
  };
}
