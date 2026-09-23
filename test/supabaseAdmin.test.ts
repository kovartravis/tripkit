import { describe, it, expect, vi } from "vitest";
import {
  inviteUserByEmail,
  sendPasswordRecoveryEmail,
  SupabaseAdminApiError,
} from "../src/integrations/supabaseAdmin.js";

const CONFIG = { projectUrl: "https://example.supabase.co", serviceRoleKey: "service-role-key" };

function fakeFetch(status: number, body = "") {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  });
}

describe("inviteUserByEmail", () => {
  it("returns 'invited' on success and calls the admin invite endpoint with the service-role key", async () => {
    const fetchImpl = fakeFetch(200, JSON.stringify({ id: "user-1" }));

    const result = await inviteUserByEmail(CONFIG, "companion@example.com", fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ outcome: "invited" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect((url as URL).toString()).toBe("https://example.supabase.co/auth/v1/invite");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("service-role-key");
    expect(init.headers.Authorization).toBe("Bearer service-role-key");
    expect(JSON.parse(init.body)).toEqual({ email: "companion@example.com" });
  });

  it("appends redirect_to as a query param when config.redirectTo is set", async () => {
    const fetchImpl = fakeFetch(200, JSON.stringify({ id: "user-1" }));

    await inviteUserByEmail(
      { ...CONFIG, redirectTo: "https://147-224-167-3.sslip.io/ui" },
      "companion@example.com",
      fetchImpl as unknown as typeof fetch,
    );

    const [url] = fetchImpl.mock.calls[0]!;
    expect((url as URL).toString()).toBe(
      "https://example.supabase.co/auth/v1/invite?redirect_to=https%3A%2F%2F147-224-167-3.sslip.io%2Fui",
    );
  });

  it("omits redirect_to when config.redirectTo is unset", async () => {
    const fetchImpl = fakeFetch(200, JSON.stringify({ id: "user-1" }));

    await inviteUserByEmail(CONFIG, "companion@example.com", fetchImpl as unknown as typeof fetch);

    const [url] = fetchImpl.mock.calls[0]!;
    expect((url as URL).toString()).toBe("https://example.supabase.co/auth/v1/invite");
  });

  it("returns 'already_exists' on a 422 (the email already has an Account)", async () => {
    const fetchImpl = fakeFetch(422, JSON.stringify({ error_code: "email_exists" }));

    const result = await inviteUserByEmail(CONFIG, "existing@example.com", fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ outcome: "already_exists" });
  });

  it("throws on an unrelated error", async () => {
    const fetchImpl = fakeFetch(500, "internal error");

    await expect(
      inviteUserByEmail(CONFIG, "companion@example.com", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(SupabaseAdminApiError);
  });
});

describe("sendPasswordRecoveryEmail", () => {
  it("posts to /auth/v1/recover with the email and an optional redirect_to", async () => {
    const fetchImpl = fakeFetch(200, "{}");

    await sendPasswordRecoveryEmail(
      { ...CONFIG, redirectTo: "https://tripkit.duckdns.org/ui" },
      "owner@example.com",
      fetchImpl as unknown as typeof fetch,
    );

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect((url as URL).toString()).toBe(
      "https://example.supabase.co/auth/v1/recover?redirect_to=https%3A%2F%2Ftripkit.duckdns.org%2Fui",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("service-role-key");
    expect(JSON.parse(init.body)).toEqual({ email: "owner@example.com" });
  });

  it("omits redirect_to when config.redirectTo is unset", async () => {
    const fetchImpl = fakeFetch(200, "{}");

    await sendPasswordRecoveryEmail(CONFIG, "owner@example.com", fetchImpl as unknown as typeof fetch);

    const [url] = fetchImpl.mock.calls[0]!;
    expect((url as URL).toString()).toBe("https://example.supabase.co/auth/v1/recover");
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = fakeFetch(500, "internal error");

    await expect(
      sendPasswordRecoveryEmail(CONFIG, "owner@example.com", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(SupabaseAdminApiError);
  });
});
