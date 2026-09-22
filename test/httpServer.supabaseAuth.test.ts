import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { openDatabase } from "../src/db/client.js";
import { SqliteTripkitRepository } from "../src/db/sqliteRepository.js";
import { runHttpServer, type HttpServerHandle } from "../src/mcp/httpServer.js";

const ALG = "RS256";
const KID = "test-key";

/** A minimal stand-in for Supabase's own OAuth server: just discovery + JWKS. */
function startFakeSupabase(publicJwk: object): Promise<{ server: Server; baseUrl: URL }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      if (req.url === "/.well-known/oauth-authorization-server/auth/v1") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            issuer: `${baseUrl}/auth/v1`,
            authorization_endpoint: `${baseUrl}/auth/v1/oauth/authorize`,
            token_endpoint: `${baseUrl}/auth/v1/oauth/token`,
            jwks_uri: `${baseUrl}/auth/v1/.well-known/jwks.json`,
            registration_endpoint: `${baseUrl}/auth/v1/oauth/clients/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
          }),
        );
        return;
      }
      if (req.url === "/auth/v1/.well-known/jwks.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, baseUrl: new URL(`http://127.0.0.1:${port}`) });
    });
  });
}

describe("runHttpServer with Supabase auth", () => {
  let fakeSupabase: { server: Server; baseUrl: URL };
  let signingKey: Awaited<ReturnType<typeof generateKeyPair>>;
  let handle: HttpServerHandle;
  let tripkitBaseUrl: string;
  let dataDir: string;

  const TRIPKIT_PORT = 48173;
  const PUBLIC_URL = "https://tripkit.example.com";

  beforeAll(async () => {
    signingKey = await generateKeyPair(ALG, { extractable: true });
    const publicJwk = { ...(await exportJWK(signingKey.publicKey)), alg: ALG, kid: KID };
    fakeSupabase = await startFakeSupabase(publicJwk);

    dataDir = mkdtempSync(join(tmpdir(), "tripkit-supabase-auth-"));
    const repo = new SqliteTripkitRepository(openDatabase(":memory:"));

    handle = await runHttpServer(repo, {
      host: "127.0.0.1",
      port: TRIPKIT_PORT,
      dataDir,
      auth: { kind: "supabase", projectUrl: fakeSupabase.baseUrl, publicUrl: new URL(PUBLIC_URL), anonKey: "test-anon-key" },
    });
    tripkitBaseUrl = `http://127.0.0.1:${TRIPKIT_PORT}`;
  });

  afterAll(async () => {
    await handle.close();
    fakeSupabase.server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function signToken(
    overrides: { expiresIn?: string; issuer?: string; key?: CryptoKey; clientId?: string | null } = {},
  ): Promise<string> {
    const clientId = overrides.clientId === null ? undefined : (overrides.clientId ?? "test-client");
    return new SignJWT({ client_id: clientId, scope: "tripkit" })
      .setProtectedHeader({ alg: ALG, kid: KID })
      .setIssuedAt()
      .setIssuer(overrides.issuer ?? `${fakeSupabase.baseUrl}auth/v1`)
      .setSubject("user-123")
      .setExpirationTime(overrides.expiresIn ?? "1h")
      .sign(overrides.key ?? signingKey.privateKey);
  }

  it("advertises Protected Resource Metadata pointing at Supabase's OAuth server", async () => {
    const res = await fetch(`${tripkitBaseUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resource: string; authorization_servers: string[] };
    expect(body.resource).toBe(`${PUBLIC_URL}/mcp`);
    expect(body.authorization_servers).toEqual([`${fakeSupabase.baseUrl}auth/v1`]);
  });

  it("rejects a request with no Authorization header", async () => {
    const res = await fetch(`${tripkitBaseUrl}/mcp`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed bearer token", async () => {
    const res = await fetch(`${tripkitBaseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer not-a-jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const token = await signToken({ expiresIn: "-1h" });
    const res = await fetch(`${tripkitBaseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a bare Supabase user-session token (no client_id, never went through OAuth)", async () => {
    const token = await signToken({ clientId: null });
    const res = await fetch(`${tripkitBaseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it("accepts a valid Supabase-issued token and reaches the MCP handler", async () => {
    const token = await signToken();
    const res = await fetch(`${tripkitBaseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
  });
});
