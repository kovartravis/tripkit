import { jwtVerify, type JWTVerifyGetKey } from "jose";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

export interface SupabaseTokenVerifierOptions {
  /** The `iss` claim every accepted token must carry, e.g. `https://<ref>.supabase.co/auth/v1`. */
  issuer: string;
  /** Resolves the signing key for a token, e.g. `createRemoteJWKSet(new URL(jwks_uri))`. */
  getKey: JWTVerifyGetKey;
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
      let payload;
      try {
        ({ payload } = await jwtVerify(token, getKey, { issuer }));
      } catch (error) {
        throw new InvalidTokenError(error instanceof Error ? error.message : "Invalid or expired token");
      }

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
