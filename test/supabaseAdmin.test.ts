import { describe, it, expect, vi } from "vitest";
import { inviteUserByEmail, SupabaseAdminApiError } from "../src/integrations/supabaseAdmin.js";

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
