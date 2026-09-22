import { jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { VerifiedSupabaseClaims } from "../../db/postgres/identity.js";

export interface SupabaseTokenVerifierOptions {
  /** The `iss` claim every accepted token must carry, e.g. `https://<ref>.supabase.co/auth/v1`. */
  issuer: string;
  /** Resolves the signing key for a token, e.g. `createRemoteJWKSet(new URL(jwks_uri))`. */
  getKey: JWTVerifyGetKey;
}

/**
 * Signature/issuer/expiry verification shared by both the MCP-facing verifier (which then also
 * requires `client_id`) and the dashboard session verifier (which doesn't — a plain
 * Supabase-hosted-login session was never issued to an OAuth client).
 */
async function verifySupabaseJwt(token: string, options: SupabaseTokenVerifierOptions): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, options.getKey, { issuer: options.issuer });
    return payload;
  } catch (error) {
    throw new InvalidTokenError(error instanceof Error ? error.message : "Invalid or expired token");
  }
}

/**
 * Verifies bearer tokens issued by Supabase's OAuth 2.1 authorization server: Tripkit is
 * only the resource server here, so this never talks to Supabase's token endpoint itself —
 * it just checks a presented token's signature (against `getKey`), issuer, and expiry.
 */
export function createSupabaseTokenVerifier(options: SupabaseTokenVerifierOptions): OAuthTokenVerifier {
  const { issuer, getKey } = options;

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const payload = await verifySupabaseJwt(token, { issuer, getKey });

      if (typeof payload.exp !== "number") {
        throw new InvalidTokenError("Token has no expiration time");
      }

      // Supabase issues the *same* "authenticated" audience to every session in the
      // project regardless of how a user signed in, so a plain logged-in-to-some-other-app
      // session token is otherwise indistinguishable from one issued through this project's
      // OAuth flow. `client_id` is only ever set on tokens minted for a registered OAuth
      // client (see Supabase's "Token Security & RLS" guide), so requiring it here is what
      // actually confines accepted tokens to ones issued via OAuth, not bare user sessions.
      if (typeof payload.client_id !== "string" || payload.client_id.length === 0) {
        throw new InvalidTokenError("Token was not issued to an OAuth client (missing client_id)");
      }

      const scope = typeof payload.scope === "string" ? payload.scope : "";

      return {
        token,
        clientId: payload.client_id,
        scopes: scope.length > 0 ? scope.split(" ") : [],
        expiresAt: payload.exp,
        extra: { sub: payload.sub },
      };
    },
  };
}

/**
 * Verifies the dashboard's bearer tokens: Supabase-hosted-login session tokens, unlike the
 * MCP-facing verifier above these never carry `client_id` (they weren't issued to an OAuth
 * client, since the dashboard signs in directly against Supabase Auth), so that check is
 * deliberately absent here. Resolves straight to `VerifiedSupabaseClaims` — what
 * `SupabaseTripkitRepository` needs to scope a request's RLS-enforced transaction.
 */
export function createSupabaseSessionVerifier(
  options: SupabaseTokenVerifierOptions,
): (token: string) => Promise<VerifiedSupabaseClaims> {
  return async function verifySupabaseSession(token: string): Promise<VerifiedSupabaseClaims> {
    const payload = await verifySupabaseJwt(token, options);

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new InvalidTokenError("Token has no subject");
    }

    return {
      sub: payload.sub,
      role: typeof payload.role === "string" ? payload.role : "authenticated",
    };
  };
}
