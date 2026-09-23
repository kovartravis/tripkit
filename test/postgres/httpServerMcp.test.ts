import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { Pool } from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createSupabasePool, supabasePoolConfigFromEnv } from "../../src/db/postgres/pool.js";
import { runHttpServer, type HttpServerHandle } from "../../src/mcp/httpServer.js";

const ALG = "RS256";
const KID = "test-key";

// vitest doesn't load .env files itself; pull in .env.local (gitignored) if present, without
// overriding anything already set in the real environment (e.g. by CI).
function loadEnvLocal(): void {
  const path = new URL("../../.env.local", import.meta.url);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = line.slice(idx + 1).trim();
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const poolConfig = supabasePoolConfigFromEnv();
const hasCreds = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && poolConfig);

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

/**
 * Real Postgres, real RLS, real (throwaway) Supabase Auth accounts, and a real running
 * `runHttpServer` — proving ticket #23's "tripkit mcp --http only ever runs against Supabase"
 * end-to-end: an actual `tripkit_trip_create`/`tripkit_trip_list` round trip over /mcp is
 * RLS-scoped per caller, not served off a single shared repository. The OAuth/JWKS layer is
 * faked (as in httpServer.supabaseAuth.test.ts) so this doesn't need a full Dynamic Client
 * Registration + PKCE flow against the real Supabase project — what's under test here is what
 * happens *after* a bearer token is accepted, which only depends on the token's claims, not on
 * who signed it. Skips itself when live-project credentials aren't configured.
 */
describe.skipIf(!hasCreds)("POST /mcp (Supabase auth, live Postgres)", () => {
  let fakeSupabase: { server: Server; baseUrl: URL };
  let signingKey: Awaited<ReturnType<typeof generateKeyPair>>;
  let pool: Pool;
  let handle: HttpServerHandle;
  let tripkitBaseUrl: string;
  let ownerId: string;
  let strangerId: string;
  const createdTripIds: string[] = [];

  const TRIPKIT_PORT = 48175;

  async function createTestAccount(): Promise<string> {
    const email = `tripkit-test-${randomUUID()}@tripkit-test.local`;
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password: randomUUID(), email_confirm: true }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create test account: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  async function deleteTestAccount(id: string): Promise<void> {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
  }

  function signToken(sub: string): Promise<string> {
    return new SignJWT({ client_id: "test-client", scope: "tripkit" })
      .setProtectedHeader({ alg: ALG, kid: KID })
      .setIssuedAt()
      .setIssuer(`${fakeSupabase.baseUrl}auth/v1`)
      .setSubject(sub)
      .setExpirationTime("1h")
      .sign(signingKey.privateKey);
  }

  async function connectClient(sub: string): Promise<Client> {
    const token = await signToken(sub);
    const transport = new StreamableHTTPClientTransport(new URL(`${tripkitBaseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
    return client;
  }

  beforeAll(async () => {
    signingKey = await generateKeyPair(ALG, { extractable: true });
    const publicJwk = { ...(await exportJWK(signingKey.publicKey)), alg: ALG, kid: KID };
    fakeSupabase = await startFakeSupabase(publicJwk);

    pool = createSupabasePool(poolConfig!);
    [ownerId, strangerId] = await Promise.all([createTestAccount(), createTestAccount()]);

    handle = await runHttpServer({
      host: "127.0.0.1",
      port: TRIPKIT_PORT,
      supabase: {
        projectUrl: fakeSupabase.baseUrl,
        publicUrl: new URL("https://tripkit-mcp-test.example.com"),
        anonKey: "unused-by-this-test",
        serviceRoleKey: SERVICE_ROLE_KEY!,
      },
    });
    tripkitBaseUrl = `http://127.0.0.1:${TRIPKIT_PORT}`;
  });

  afterAll(async () => {
    await handle.close();
    fakeSupabase.server.close();
    if (createdTripIds.length > 0) {
      const client = await pool.connect();
      try {
        await client.query("DELETE FROM trips WHERE id = ANY($1)", [createdTripIds]);
      } finally {
        client.release();
      }
    }
    await Promise.all([deleteTestAccount(ownerId), deleteTestAccount(strangerId)]);
    await pool.end();
  });

  it("creates a trip via tripkit_trip_create and lists it back via tripkit_trip_list, for the caller only", async () => {
    const ownerClient = await connectClient(ownerId);
    try {
      const created = await ownerClient.callTool({
        name: "tripkit_trip_create",
        arguments: {
          name: "MCP live test trip",
          startDate: "2026-05-01",
          endDate: "2026-05-05",
          homeTimezone: "America/Los_Angeles",
        },
      });
      expect(created.isError).toBeFalsy();
      const content = created.content as Array<{ type: string; text: string }>;
      const trip = JSON.parse(content[0]!.text) as { id: string; name: string };
      expect(trip.name).toBe("MCP live test trip");
      createdTripIds.push(trip.id);

      const listed = await ownerClient.callTool({ name: "tripkit_trip_list", arguments: {} });
      const ownerTrips = JSON.parse((listed.content as Array<{ text: string }>)[0]!.text) as Array<{ id: string }>;
      expect(ownerTrips.map((t) => t.id)).toContain(trip.id);

      const strangerClient = await connectClient(strangerId);
      try {
        const strangerListed = await strangerClient.callTool({ name: "tripkit_trip_list", arguments: {} });
        const strangerTrips = JSON.parse((strangerListed.content as Array<{ text: string }>)[0]!.text) as Array<{
          id: string;
        }>;
        expect(strangerTrips.map((t) => t.id)).not.toContain(trip.id);
      } finally {
        await strangerClient.close();
      }
    } finally {
      await ownerClient.close();
    }
  });
});
