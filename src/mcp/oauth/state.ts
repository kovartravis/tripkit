import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { ensureDataDir } from "../../utils/paths.js";

const STATE_FILE_NAME = "oauth-state.json";
const SCRYPT_KEY_LENGTH = 64;

export interface StoredRefreshToken {
  clientId: string;
  scopes: string[];
  resource?: string;
}

export interface OAuthState {
  cookieSecret: string;
  ownerPasswordSalt: string;
  ownerPasswordHash: string;
  clients: Record<string, OAuthClientInformationFull>;
  refreshTokens: Record<string, StoredRefreshToken>;
}

function statePath(dataDir: string): string {
  return join(dataDir, STATE_FILE_NAME);
}

function setOwnerPassword(state: OAuthState, password: string): void {
  const salt = randomBytes(16).toString("hex");
  state.ownerPasswordSalt = salt;
  state.ownerPasswordHash = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex");
}

export function verifyOwnerPassword(state: OAuthState, candidate: string): boolean {
  if (!state.ownerPasswordHash) return false;
  const candidateHash = scryptSync(candidate, state.ownerPasswordSalt, SCRYPT_KEY_LENGTH);
  const stored = Buffer.from(state.ownerPasswordHash, "hex");
  if (candidateHash.length !== stored.length) return false;
  return timingSafeEqual(candidateHash, stored);
}

export function writeOAuthState(dataDir: string, state: OAuthState): void {
  writeFileSync(statePath(dataDir), JSON.stringify(state, null, 2), { mode: 0o600 });
}

/**
 * Loads persisted OAuth state (registered clients, refresh tokens, the cookie-signing
 * secret, and the owner login passphrase), creating it on first run. If `explicitPassword`
 * is given, it always (re)sets the owner passphrase, which is how a forgotten passphrase
 * is reset. Otherwise, a passphrase is auto-generated on first run and returned so the
 * caller can print it once; it is never recoverable afterward, only its hash is stored.
 */
export function loadOAuthState(dataDir: string, explicitPassword?: string): { state: OAuthState; generatedPassword?: string } {
  ensureDataDir(dataDir);
  const path = statePath(dataDir);

  const state: OAuthState = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as OAuthState)
    : {
        cookieSecret: randomBytes(32).toString("hex"),
        ownerPasswordSalt: "",
        ownerPasswordHash: "",
        clients: {},
        refreshTokens: {},
      };

  let generatedPassword: string | undefined;
  if (explicitPassword) {
    setOwnerPassword(state, explicitPassword);
  } else if (!state.ownerPasswordHash) {
    generatedPassword = randomBytes(9).toString("base64url");
    setOwnerPassword(state, generatedPassword);
  }

  writeOAuthState(dataDir, state);
  return { state, generatedPassword };
}
