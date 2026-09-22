import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { createSupabaseTokenVerifier, createSupabaseSessionVerifier } from "../src/mcp/oauth/supabaseTokenVerifier.js";

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

describe("createSupabaseSessionVerifier", () => {
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
    return createSupabaseSessionVerifier({ issuer: ISSUER, getKey: jwks });
  }

  async function signSessionToken(overrides: {
    key?: CryptoKey;
    issuer?: string;
    expiresIn?: string;
    kid?: string;
    role?: string | null;
    subject?: string | null;
  } = {}): Promise<string> {
    const role = overrides.role === null ? undefined : (overrides.role ?? "authenticated");
    let jwt = new SignJWT({ role })
      .setProtectedHeader({ alg: ALG, kid: overrides.kid ?? "test-key" })
      .setIssuedAt()
      .setIssuer(overrides.issuer ?? ISSUER)
      .setExpirationTime(overrides.expiresIn ?? "1h");
    if (overrides.subject !== null) jwt = jwt.setSubject(overrides.subject ?? "user-123");
    return jwt.sign(overrides.key ?? signingKey.privateKey);
  }

  // The whole point of this verifier: a plain Supabase hosted-login session token (no
  // client_id claim, since it was never issued to an OAuth client) is exactly what the
  // dashboard presents, unlike createSupabaseTokenVerifier's MCP-facing rejection of it.
  it("accepts a valid session token that carries no client_id", async () => {
    const token = await signSessionToken();
    const claims = await verifier()(token);
    expect(claims.sub).toBe("user-123");
    expect(claims.role).toBe("authenticated");
  });

  it("defaults role to authenticated when the claim is absent", async () => {
    const token = await signSessionToken({ role: null });
    const claims = await verifier()(token);
    expect(claims.role).toBe("authenticated");
  });

  it("rejects an expired token", async () => {
    const token = await signSessionToken({ expiresIn: "-1h" });
    await expect(verifier()(token)).rejects.toThrow();
  });

  it("rejects a malformed token", async () => {
    await expect(verifier()("not-a-jwt")).rejects.toThrow();
  });

  it("rejects a token signed by the wrong key", async () => {
    const token = await signSessionToken({ key: wrongKey.privateKey });
    await expect(verifier()(token)).rejects.toThrow();
  });

  it("rejects a token with an unexpected issuer", async () => {
    const token = await signSessionToken({ issuer: "https://not-the-right-project.supabase.co/auth/v1" });
    await expect(verifier()(token)).rejects.toThrow();
  });

  it("rejects a token with no subject", async () => {
    const token = await signSessionToken({ subject: null });
    await expect(verifier()(token)).rejects.toThrow(/subject/);
  });
});
