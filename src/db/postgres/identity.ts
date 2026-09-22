/**
 * The claims of an already-verified Supabase-issued JWT (see
 * `src/mcp/oauth/supabaseTokenVerifier.ts`), forwarded into Postgres verbatim as
 * `request.jwt.claims` so RLS's `auth.uid()`/`auth.role()` resolve exactly as they would for
 * any other authenticated Supabase client. This repository never re-verifies a token itself —
 * by the time one reaches here, the resource-server boundary has already done that.
 */
export interface VerifiedSupabaseClaims {
  sub: string;
  role: string;
  [claim: string]: unknown;
}
