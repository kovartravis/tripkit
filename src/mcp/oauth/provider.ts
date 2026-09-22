import { randomBytes, randomUUID } from "node:crypto";
import type { Response } from "express";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidGrantError, InvalidRequestError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { loadOAuthState, writeOAuthState, type OAuthState } from "./state.js";

const ACCESS_TOKEN_TTL_SECONDS = 3600;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60_000;

interface PendingCode {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  expiresAt: number;
}

interface AccessTokenRecord {
  clientId: string;
  scopes: string[];
  resource?: URL;
  expiresAt: number;
}

class PersistedClientsStore implements OAuthRegisteredClientsStore {
  constructor(
    private readonly state: OAuthState,
    private readonly persist: () => void,
  ) {}

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.state.clients[clientId];
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.state.clients[full.client_id] = full;
    this.persist();
    return full;
  }
}

/**
 * A single-owner OAuth 2.1 authorization + resource server for Tripkit. Any client can
 * dynamically register (standard for MCP), but reaching an access token requires passing
 * the owner login gate in front of /authorize (see oauth/loginGate.ts) — that's the actual
 * security boundary, not client registration.
 */
export class TripkitOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: PersistedClientsStore;
  readonly state: OAuthState;
  readonly generatedPassword: string | undefined;

  private readonly dataDir: string;
  private readonly codes = new Map<string, PendingCode>();
  private readonly accessTokens = new Map<string, AccessTokenRecord>();

  constructor(dataDir: string, explicitPassword?: string) {
    this.dataDir = dataDir;
    const { state, generatedPassword } = loadOAuthState(dataDir, explicitPassword);
    this.state = state;
    this.generatedPassword = generatedPassword;
    this.clientsStore = new PersistedClientsStore(this.state, () => this.persist());
  }

  private persist(): void {
    writeOAuthState(this.dataDir, this.state);
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }
    const code = randomBytes(24).toString("base64url");
    this.codes.set(code, { client, params, expiresAt: Date.now() + AUTHORIZATION_CODE_TTL_MS });

    const target = new URL(params.redirectUri);
    target.searchParams.set("code", code);
    if (params.state !== undefined) {
      target.searchParams.set("state", params.state);
    }
    res.redirect(target.toString());
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const entry = this.codes.get(authorizationCode);
    if (!entry || entry.expiresAt < Date.now() || entry.client.client_id !== client.client_id) {
      throw new InvalidGrantError("Invalid or expired authorization code");
    }
    return entry.params.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<OAuthTokens> {
    const entry = this.codes.get(authorizationCode);
    if (!entry || entry.expiresAt < Date.now() || entry.client.client_id !== client.client_id) {
      this.codes.delete(authorizationCode);
      throw new InvalidGrantError("Invalid or expired authorization code");
    }
    this.codes.delete(authorizationCode);
    return this.issueTokens(client.client_id, entry.params.scopes ?? [], entry.params.resource);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = this.state.refreshTokens[refreshToken];
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    const effectiveResource = resource ?? (record.resource ? new URL(record.resource) : undefined);
    return this.issueTokens(client.client_id, scopes ?? record.scopes, effectiveResource, refreshToken);
  }

  private issueTokens(
    clientId: string,
    scopes: string[],
    resource: URL | undefined,
    existingRefreshToken?: string,
  ): OAuthTokens {
    const accessToken = randomBytes(32).toString("base64url");
    this.accessTokens.set(accessToken, {
      clientId,
      scopes,
      resource,
      expiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
    });

    const refreshToken = existingRefreshToken ?? randomBytes(32).toString("base64url");
    this.state.refreshTokens[refreshToken] = { clientId, scopes, resource: resource?.toString() };
    this.persist();

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(" "),
      refresh_token: refreshToken,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = this.accessTokens.get(token);
    if (!record || record.expiresAt < Date.now()) {
      throw new InvalidTokenError("Invalid or expired token");
    }
    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: Math.floor(record.expiresAt / 1000),
      resource: record.resource,
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    this.accessTokens.delete(request.token);
    if (this.state.refreshTokens[request.token]) {
      delete this.state.refreshTokens[request.token];
      this.persist();
    }
  }
}
