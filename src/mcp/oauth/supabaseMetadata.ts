import { z } from "zod";
import { OAuthMetadataSchema, type OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

const SupabaseOAuthMetadataSchema = OAuthMetadataSchema.extend({
  jwks_uri: z.string(),
});

export type SupabaseOAuthMetadata = OAuthMetadata & { jwks_uri: string };

/** Supabase Auth's OAuth 2.1 issuer identity for a project, e.g. `https://<ref>.supabase.co/auth/v1`. */
export function supabaseIssuer(projectUrl: URL): string {
  return new URL("/auth/v1", projectUrl).href;
}

/**
 * Where Supabase publishes its Authorization Server Metadata (RFC 8414) for this project —
 * the same URL MCP clients discover on their own once we point them at the issuer above.
 */
export function supabaseDiscoveryUrl(projectUrl: URL): URL {
  return new URL("/.well-known/oauth-authorization-server/auth/v1", projectUrl);
}

/**
 * Fetches and validates Supabase's live OAuth discovery document, rather than hardcoding its
 * endpoint paths here: those are Supabase implementation details (e.g. the registration
 * endpoint lives at a non-obvious `/oauth/clients/register`) that this stays correct against
 * even if they change.
 */
export async function fetchSupabaseOAuthMetadata(
  projectUrl: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<SupabaseOAuthMetadata> {
  const discoveryUrl = supabaseDiscoveryUrl(projectUrl);
  const res = await fetchImpl(discoveryUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch Supabase OAuth metadata: ${res.status} ${res.statusText}`);
  }

  const metadata = SupabaseOAuthMetadataSchema.parse(await res.json());

  const expectedIssuer = supabaseIssuer(projectUrl);
  if (metadata.issuer !== expectedIssuer) {
    throw new Error(`Unexpected issuer in Supabase OAuth metadata: got "${metadata.issuer}", expected "${expectedIssuer}"`);
  }

  return metadata;
}
