import type { NextFunction, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { verifyOwnerPassword, type OAuthState } from "./state.js";

export const SESSION_COOKIE = "tripkit_owner_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_FIELDS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "state",
  "resource",
];

function sign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function makeSessionToken(secret: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `owner.${expiresAt}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifySessionToken(secret: string, token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [subject, expiresAtRaw, signature] = parts as [string, string, string];
  const expected = sign(secret, `${subject}.${expiresAtRaw}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return subject === "owner" && Number(expiresAtRaw) > Date.now();
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function setOwnerSessionCookie(res: Response, secret: string): void {
  const token = makeSessionToken(secret);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/`,
  );
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function renderLoginPage(opts: {
  action: string;
  heading: string;
  description: string;
  hiddenFields?: Record<string, string>;
  error?: string;
}): string {
  const hidden = Object.entries(opts.hiddenFields ?? {})
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("\n  ");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tripkit &mdash; Sign in</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0b0b0c; color: #eee; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; box-sizing: border-box; }
  form { background: #17171a; padding: 2rem; border-radius: 12px; width: 100%; max-width: 320px; box-shadow: 0 10px 40px rgba(0,0,0,0.4); }
  h1 { font-size: 1.1rem; margin: 0 0 1rem; }
  input[type=password] { width: 100%; box-sizing: border-box; padding: 0.6rem 0.7rem; border-radius: 8px; border: 1px solid #333; background: #0b0b0c; color: #eee; margin-bottom: 0.75rem; font-size: 1rem; }
  button { width: 100%; padding: 0.6rem; border-radius: 8px; border: none; background: #4f7cff; color: white; font-size: 1rem; cursor: pointer; }
  .error { color: #ff6b6b; font-size: 0.85rem; margin: -0.4rem 0 0.75rem; }
  p { color: #999; font-size: 0.8rem; }
</style>
</head>
<body>
<form method="POST" action="${escapeHtml(opts.action)}">
  <h1>${escapeHtml(opts.heading)}</h1>
  ${opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : ""}
  ${hidden}
  <input type="password" name="passphrase" placeholder="Owner passphrase" autofocus required>
  <button type="submit">Continue</button>
  <p>${escapeHtml(opts.description)}</p>
</form>
</body>
</html>`;
}

/**
 * Gates /authorize behind a passphrase-only login screen. Mount this before mcpAuthRouter
 * (on the same "/authorize" path, with express.urlencoded() already applied) so it runs
 * first: without a valid session cookie it renders the login form; on a correct passphrase
 * it sets the session cookie and calls next(), falling through into the SDK's real
 * authorization handler, which then issues the code and redirects back to the client.
 */
export function createOwnerLoginGate(state: OAuthState) {
  return function ownerLoginGate(req: Request, res: Response, next: NextFunction): void {
    const cookies = parseCookies(req.headers.cookie);
    if (verifySessionToken(state.cookieSecret, cookies[SESSION_COOKIE])) {
      next();
      return;
    }

    const isPost = req.method === "POST";
    const source = (isPost ? req.body : req.query) as Record<string, unknown>;
    const hiddenFields: Record<string, string> = {};
    for (const field of OAUTH_FIELDS) {
      const value = source[field];
      if (typeof value === "string") hiddenFields[field] = value;
    }

    const pageOpts = {
      action: "/authorize",
      heading: "Approve access to your Tripkit data",
      description: "This grants the requesting app access to your trips, flights, and stays until you revoke it.",
      hiddenFields,
    };

    if (isPost && typeof req.body?.passphrase === "string") {
      if (verifyOwnerPassword(state, req.body.passphrase)) {
        setOwnerSessionCookie(res, state.cookieSecret);
        next();
        return;
      }
      res.status(401).send(renderLoginPage({ ...pageOpts, error: "Incorrect passphrase." }));
      return;
    }

    res.status(200).send(renderLoginPage(pageOpts));
  };
}
