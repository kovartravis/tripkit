import express, { type NextFunction, type Request, type Response } from "express";
import { networkInterfaces } from "node:os";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { TripkitRepository } from "../db/repository.js";
import { NotFoundError } from "../db/repository.js";
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
import { renderDashboardPage } from "./ui/dashboard.js";
import { buildDayItineraries } from "./ui/itinerary.js";
import { loadTripExportBundle } from "../export/markdown.js";

const MCP_PATH = "/mcp";

export type AuthMode = { kind: "bearer"; token: string } | { kind: "oauth"; publicUrl: URL } | { kind: "none" };

export interface HttpServerOptions {
  host: string;
  port: number;
  dataDir: string;
  auth: AuthMode;
  /** Owner passphrase gating /ui, /api, and (in OAuth mode) /authorize. Auto-generated on first run if omitted. */
  ownerPassword?: string;
}

export interface HttpServerHandle {
  close: () => Promise<void>;
  /** Set only when OAuth mode auto-generated a fresh owner passphrase this run. */
  generatedOwnerPassword?: string;
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
  let ownerState: OAuthState;

  if (auth.kind === "oauth") {
    const provider = new TripkitOAuthProvider(options.dataDir, options.ownerPassword);
    ownerState = provider.state;
    generatedOwnerPassword = provider.generatedPassword;

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
  } else {
    const loaded = loadOAuthState(options.dataDir, options.ownerPassword);
    ownerState = loaded.state;
    generatedOwnerPassword = loaded.generatedPassword;

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

  // --- Human-facing dashboard, gated by the same owner passphrase/session cookie as
  // /authorize above, but independent of whichever auth mode /mcp is using. ---
  const requireOwnerSession = (req: Request, res: Response, next: NextFunction): void => {
    const cookies = parseCookies(req.headers.cookie);
    if (verifySessionToken(ownerState.cookieSecret, cookies[SESSION_COOKIE])) {
      next();
      return;
    }
    res.status(401).json({ error: "unauthorized" });
  };

  app.get("/api/trips", requireOwnerSession, (_req, res) => {
    res.json(repo.listTrips());
  });

  app.get("/api/trips/:id/itinerary", requireOwnerSession, (req, res) => {
    try {
      const tripId = req.params.id;
      if (typeof tripId !== "string") {
        res.status(400).json({ error: "invalid trip id" });
        return;
      }
      const bundle = loadTripExportBundle(repo, tripId);
      res.json({
        trip: bundle.trip,
        people: bundle.people,
        packingItems: bundle.packingItems,
        days: buildDayItineraries(bundle),
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: "not found" });
        return;
      }
      throw error;
    }
  });

  app.all("/ui", express.urlencoded({ extended: false }), (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    if (verifySessionToken(ownerState.cookieSecret, cookies[SESSION_COOKIE])) {
      res.status(200).send(renderDashboardPage());
      return;
    }

    const pageOpts = {
      action: "/ui",
      heading: "Sign in to Tripkit",
      description: "View your day-by-day itinerary.",
    };
    if (req.method === "POST" && typeof req.body?.passphrase === "string") {
      if (verifyOwnerPassword(ownerState, req.body.passphrase)) {
        setOwnerSessionCookie(res, ownerState.cookieSecret);
        res.status(200).send(renderDashboardPage());
        return;
      }
      res.status(401).send(renderLoginPage({ ...pageOpts, error: "Incorrect passphrase." }));
      return;
    }
    res.status(200).send(renderLoginPage(pageOpts));
  });

  app.get("/", (_req, res) => res.redirect("/ui"));

  const server = app.listen(port, host);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });

  return {
    generatedOwnerPassword,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
