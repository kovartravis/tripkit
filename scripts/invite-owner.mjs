#!/usr/bin/env node
// One-time bootstrap: sends the Supabase invite email that lets the very first Owner set a
// password and get a real Account, before any Trip (and so any `tripkit_invite_create` caller)
// exists yet. Same underlying Supabase Admin API call `tripkit_invite_create` makes
// (src/integrations/supabaseAdmin.ts's inviteUserByEmail) — just without a Trip/Owner context,
// which that tool requires and a first Owner doesn't have.
//
// Usage:
//   npm run build                          # dist/integrations/supabaseAdmin.js must exist
//   node scripts/invite-owner.mjs <email>   # defaults to OWNER_EMAIL / kovartravis@gmail.com
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env, or gitignored .env.local).
// Set TRIPKIT_PUBLIC_URL (e.g. https://147-224-167-3.sslip.io) so the invite link sends the
// invitee to the actual dashboard instead of the project's default Site URL (localhost:3000) —
// that URL must also be in the project's Auth "Redirect URLs" allow list.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(repoRoot, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = line.slice(idx + 1).trim();
  }
}
loadEnvLocal();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name} (see .env.example)`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const email = process.argv[2] ?? process.env.OWNER_EMAIL ?? "kovartravis@gmail.com";
  const projectUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const redirectTo = process.env.TRIPKIT_PUBLIC_URL
    ? new URL("/ui", process.env.TRIPKIT_PUBLIC_URL).href
    : undefined;

  const { inviteUserByEmail } = await import(
    path.join(repoRoot, "dist/integrations/supabaseAdmin.js")
  );

  console.log(`Sending Supabase invite email to ${email}...`);
  const result = await inviteUserByEmail({ projectUrl, serviceRoleKey, redirectTo }, email);
  if (result.outcome === "invited") {
    console.log(`Invite sent. ${email} should check their inbox to set a password.`);
  } else {
    console.log(`${email} already has a Supabase Account — no invite email needed.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
