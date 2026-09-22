import { describe, it, expect, vi } from "vitest";
import { fetchSupabaseOAuthMetadata, supabaseDiscoveryUrl, supabaseIssuer } from "../src/mcp/oauth/supabaseMetadata.js";

const PROJECT_URL = new URL("https://project-ref.supabase.co");

function discoveryDoc(overrides: Record<string, unknown> = {}) {
  return {
    issuer: "https://project-ref.supabase.co/auth/v1",
    authorization_endpoint: "https://project-ref.supabase.co/auth/v1/oauth/authorize",
    token_endpoint: "https://project-ref.supabase.co/auth/v1/oauth/token",
    jwks_uri: "https://project-ref.supabase.co/auth/v1/.well-known/jwks.json",
    registration_endpoint: "https://project-ref.supabase.co/auth/v1/oauth/clients/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    ...overrides,
  };
}

function fakeFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, statusText: ok ? "OK" : "Error", json: async () => body });
}

describe("supabaseIssuer / supabaseDiscoveryUrl", () => {
  it("derives the auth/v1 issuer and well-known discovery URL from the project URL", () => {
    expect(supabaseIssuer(PROJECT_URL)).toBe("https://project-ref.supabase.co/auth/v1");
    expect(supabaseDiscoveryUrl(PROJECT_URL).href).toBe(
      "https://project-ref.supabase.co/.well-known/oauth-authorization-server/auth/v1",
    );
  });
});

describe("fetchSupabaseOAuthMetadata", () => {
  it("fetches and returns the discovery document", async () => {
    const fetchImpl = fakeFetch(discoveryDoc());
    const metadata = await fetchSupabaseOAuthMetadata(PROJECT_URL, fetchImpl as unknown as typeof fetch);

    expect(metadata.issuer).toBe("https://project-ref.supabase.co/auth/v1");
    expect(metadata.jwks_uri).toBe("https://project-ref.supabase.co/auth/v1/.well-known/jwks.json");
    expect(metadata.registration_endpoint).toBe("https://project-ref.supabase.co/auth/v1/oauth/clients/register");
    expect(fetchImpl.mock.calls[0]![0]).toEqual(supabaseDiscoveryUrl(PROJECT_URL));
  });

  it("throws when the discovery request fails", async () => {
    const fetchImpl = fakeFetch({}, false, 503);
    await expect(fetchSupabaseOAuthMetadata(PROJECT_URL, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /503/,
    );
  });

  it("throws when the response doesn't match the expected issuer for this project URL", async () => {
    const fetchImpl = fakeFetch(discoveryDoc({ issuer: "https://someone-else.supabase.co/auth/v1" }));
    await expect(fetchSupabaseOAuthMetadata(PROJECT_URL, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /issuer/i,
    );
  });

  it("throws when jwks_uri is missing from the discovery document", async () => {
    const doc = discoveryDoc();
    delete (doc as Record<string, unknown>)["jwks_uri"];
    const fetchImpl = fakeFetch(doc);
    await expect(fetchSupabaseOAuthMetadata(PROJECT_URL, fetchImpl as unknown as typeof fetch)).rejects.toThrow();
  });
});
