import express, { type NextFunction, type Request, type Response } from "express";
import { networkInterfaces } from "node:os";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import type { Pool } from "pg";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { mcpAuthMetadataRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { TripkitRepository } from "../db/repository.js";
import { NotFoundError } from "../db/repository.js";
import { createSupabasePool, supabasePoolConfigFromEnv } from "../db/postgres/pool.js";
import { SupabaseTripkitRepository } from "../db/postgres/supabaseTripkitRepository.js";
import { SupabaseInviteService } from "../db/postgres/invites.js";
import type { VerifiedSupabaseClaims } from "../db/postgres/identity.js";
import type { SupabaseAdminConfig } from "../integrations/supabaseAdmin.js";
import { createTripkitMcpServer } from "./server.js";
import { fetchSupabaseOAuthMetadata } from "./oauth/supabaseMetadata.js";
import { createSupabaseTokenVerifier, createSupabaseSessionVerifier } from "./oauth/supabaseTokenVerifier.js";
import { renderDashboardPage } from "./ui/dashboard.js";
import { renderOAuthConsentPage } from "./ui/oauthConsent.js";
import { buildDayItineraries } from "./ui/itinerary.js";
import { loadTripExportBundle } from "../export/markdown.js";

const MCP_PATH = "/mcp";

export interface HttpServerOptions {
  host: string;
  port: number;
  /** Every request Tripkit serves is authenticated against this one Supabase project (ADR 0004: no other auth mode exists). */
  supabase: {
    projectUrl: URL;
    publicUrl: URL;
    /** Public anon key, embedded in the /ui dashboard so a Member can sign in there via Supabase's own hosted login. */
    anonKey: string;
    /** service_role key — used only for the privileged Admin API call behind tripkit_invite_create. */
    serviceRoleKey: string;
  };
  /** Override for fetching Supabase's OAuth discovery document; defaults to `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface HttpServerHandle {
  close: () => Promise<void>;
}

/**
 * Every dashboard route funnels its errors through here so a config problem (e.g. the Postgres
 * pool env vars missing) becomes a clean JSON 500 like the rest of this API, not Express's
 * default HTML error page — `runHttpServer` is called directly by tests too, so this can't rely
 * solely on the CLI's own startup validation catching that case first.
 */
function sendDashboardError(res: Response, error: unknown): void {
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: "not found" });
    return;
  }
  console.error("Dashboard request failed:", error);
  res.status(500).json({ error: "internal server error" });
}

async function handleMcpRequest(
  repo: TripkitRepository,
  invites: SupabaseInviteService,
  req: Request,
  res: Response,
): Promise<void> {
  const mcpServer = createTripkitMcpServer(repo, invites);
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

export async function runHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const { host, port, supabase } = options;
  const app = express();
  app.disable("x-powered-by");
  // We sit behind a local reverse proxy (a tunnel, or none at all) that connects over
  // loopback; trusting only loopback lets express-rate-limit read X-Forwarded-For safely
  // without trusting arbitrary upstream hops.
  app.set("trust proxy", "loopback");
  // None of Tripkit's pages are meant to be embedded in an iframe -- most importantly
  // /oauth/consent, whose whole job is a click on "Approve" that grants an OAuth client access
  // to the signer-in's account, exactly what a clickjacking overlay would try to hijack.
  app.use((_req, res, next) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    next();
  });

  const adminConfig: SupabaseAdminConfig = {
    projectUrl: supabase.projectUrl.href,
    serviceRoleKey: supabase.serviceRoleKey,
    redirectTo: new URL("/ui", supabase.publicUrl).href,
  };

  // Lazy and shared by every route below (both /mcp and the dashboard): a config problem only
  // surfaces on first real use, as a clean per-request 500/401 rather than a startup crash, and
  // there's exactly one Pool for the whole server's lifetime, closed once at shutdown.
  let pool: Pool | undefined;
  function getPool(): Pool {
    if (!pool) {
      const config = supabasePoolConfigFromEnv();
      if (!config) {
        throw new Error(
          "Tripkit requires SUPABASE_DB_HOST, SUPABASE_DB_USER, and SUPABASE_DB_PASSWORD to be set.",
        );
      }
      pool = createSupabasePool(config);
    }
    return pool;
  }

  /** Grants access from any Invite pending for this Account before it's used for anything else — idempotent, so failing this never blocks the request it was piggybacking on. */
  async function redeemInvitesBestEffort(invites: SupabaseInviteService): Promise<void> {
    try {
      await invites.redeemPendingInvites();
    } catch (error) {
      console.error("Failed to redeem pending invites:", error);
    }
  }

  function scopedServices(claims: VerifiedSupabaseClaims): { repo: SupabaseTripkitRepository; invites: SupabaseInviteService } {
    const dbPool = getPool();
    return {
      repo: new SupabaseTripkitRepository(dbPool, claims),
      invites: new SupabaseInviteService(dbPool, claims, adminConfig),
    };
  }

  const oauthMetadata = await fetchSupabaseOAuthMetadata(supabase.projectUrl, options.fetchImpl);
  const getKey: JWTVerifyGetKey = createRemoteJWKSet(new URL(oauthMetadata.jwks_uri));
  // Tripkit is only the resource server here: Supabase's own OAuth 2.1 server issues and signs
  // the tokens, so all we do is advertise where clients should authenticate (this Protected
  // Resource Metadata) and verify what they bring back — no /authorize or /token routes of our
  // own.
  const mcpVerifier = createSupabaseTokenVerifier({ issuer: oauthMetadata.issuer, getKey });
  const dashboardSessionVerifier = createSupabaseSessionVerifier({ issuer: oauthMetadata.issuer, getKey });

  const resourceUrl = new URL(MCP_PATH, supabase.publicUrl);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);

  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: resourceUrl,
      // Supabase's OAuth server only grants its own fixed OIDC scopes (openid, email,
      // profile, ...), not app-defined ones — advertise what it actually supports rather than a
      // made-up scope no client could ever obtain.
      scopesSupported: oauthMetadata.scopes_supported,
      resourceName: "Tripkit",
    }),
  );

  app.post(MCP_PATH, requireBearerAuth({ verifier: mcpVerifier, resourceMetadataUrl }), async (req, res) => {
    const sub = req.auth?.extra?.sub;
    if (typeof sub !== "string" || sub.length === 0) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized" }, id: null });
      return;
    }
    const { repo, invites } = scopedServices({ sub, role: "authenticated" });
    await redeemInvitesBestEffort(invites);
    await handleMcpRequest(repo, invites, req, res);
  });

  app.get(MCP_PATH, (_req, res) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  });
  app.delete(MCP_PATH, (_req, res) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  });

  // --- Human-facing dashboard: a Member signs in via Supabase's own hosted login (client-side,
  // inside renderDashboardPage's own script — see src/mcp/ui/dashboard.ts) and the browser
  // presents that session's access token as a bearer token on every /api/* call below. ---
  const requireDashboardSession = (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    dashboardSessionVerifier(token)
      .then((claims) => {
        res.locals.tripkitClaims = claims;
        next();
      })
      .catch(() => {
        res.status(401).json({ error: "unauthorized" });
      });
  };

  app.get("/api/trips", requireDashboardSession, async (_req, res) => {
    try {
      const { repo, invites } = scopedServices(res.locals.tripkitClaims as VerifiedSupabaseClaims);
      await redeemInvitesBestEffort(invites);
      res.json(await repo.listTrips());
    } catch (error) {
      sendDashboardError(res, error);
    }
  });

  app.get("/api/trips/:id/itinerary", requireDashboardSession, async (req, res) => {
    try {
      const tripId = req.params.id;
      if (typeof tripId !== "string") {
        res.status(400).json({ error: "invalid trip id" });
        return;
      }
      const { repo } = scopedServices(res.locals.tripkitClaims as VerifiedSupabaseClaims);
      const bundle = await loadTripExportBundle(repo, tripId);
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

  app.get("/ui", (_req, res) => {
    res.status(200).send(renderDashboardPage({ url: supabase.projectUrl.href, anonKey: supabase.anonKey }));
  });

  // Supabase's OAuth 2.1 Server sends users here (its configured Authorization Path) mid-flow,
  // with an authorization_id query param -- this is Tripkit's consent screen, not Supabase's
  // (see src/mcp/ui/oauthConsent.ts). Must match the Authorization Path set in the Supabase
  // dashboard under Authentication > OAuth Server.
  app.get("/oauth/consent", (_req, res) => {
    res.status(200).send(renderOAuthConsentPage({ url: supabase.projectUrl.href, anonKey: supabase.anonKey }));
  });

  app.get("/", (_req, res) => res.redirect("/ui"));

  const server = app.listen(port, host);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      if (pool) await pool.end();
    },
  };
}
