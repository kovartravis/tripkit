import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { createSupabaseTokenVerifier } from "../src/mcp/oauth/supabaseTokenVerifier.js";

const ISSUER = "https://project-ref.supabase.co/auth/v1";
const ALG = "RS256";

describe("createSupabaseTokenVerifier", () => {
  let signingKey: Awaited<ReturnType<typeof generateKeyPair>>;
  let wrongKey: Awaited<ReturnType<typeof generateKeyPair>>;
  let publicJwk: JWK;

  beforeAll(async () => {
    signingKey = await generateKeyPair(ALG, { extractable: true });
    wrongKey = await generateKeyPair(ALG, { extractable: true });
    publicJwk = { ...(await exportJWK(signingKey.publicKey)), alg: ALG, kid: "test-key" };
  });

  function verifier() {
    const jwks = createLocalJWKSet({ keys: [publicJwk] });
    return createSupabaseTokenVerifier({ issuer: ISSUER, getKey: jwks });
  }

  async function signToken(overrides: {
    key?: CryptoKey;
    issuer?: string;
    expiresIn?: string;
    kid?: string;
    clientId?: string | null;
    scope?: string | null;
  } = {}): Promise<string> {
    const scope = overrides.scope === null ? undefined : (overrides.scope ?? "tripkit");
    const clientId = overrides.clientId === null ? undefined : (overrides.clientId ?? "test-client");
    return new SignJWT({ client_id: clientId, scope })
      .setProtectedHeader({ alg: ALG, kid: overrides.kid ?? "test-key" })
      .setIssuedAt()
      .setIssuer(overrides.issuer ?? ISSUER)
      .setSubject("user-123")
      .setExpirationTime(overrides.expiresIn ?? "1h")
      .sign(overrides.key ?? signingKey.privateKey);
  }

  it("accepts a valid token signed by the expected key and issuer", async () => {
    const token = await signToken();
    const info = await verifier().verifyAccessToken(token);

    expect(info.token).toBe(token);
    expect(info.clientId).toBe("test-client");
    expect(info.scopes).toEqual(["tripkit"]);
    expect(typeof info.expiresAt).toBe("number");
  });

  it("rejects an expired token", async () => {
    const token = await signToken({ expiresIn: "-1h" });
    await expect(verifier().verifyAccessToken(token)).rejects.toThrow();
  });

  it("rejects a malformed token", async () => {
    await expect(verifier().verifyAccessToken("not-a-jwt")).rejects.toThrow();
  });

  it("rejects a token signed by the wrong key", async () => {
    const token = await signToken({ key: wrongKey.privateKey });
    await expect(verifier().verifyAccessToken(token)).rejects.toThrow();
  });

  it("rejects a token with an unexpected issuer", async () => {
    const token = await signToken({ issuer: "https://not-the-right-project.supabase.co/auth/v1" });
    await expect(verifier().verifyAccessToken(token)).rejects.toThrow();
  });

  it("defaults scopes to an empty array when the scope claim is absent", async () => {
    const token = await signToken({ scope: null });
    const info = await verifier().verifyAccessToken(token);
    expect(info.scopes).toEqual([]);
  });

  it("rejects a token with no client_id, e.g. a bare Supabase user-session token", async () => {
    const token = await signToken({ clientId: null });
    await expect(verifier().verifyAccessToken(token)).rejects.toThrow(/client_id/);
  });
});
