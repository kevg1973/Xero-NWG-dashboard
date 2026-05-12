import crypto from "node:crypto";
import { request } from "undici";
import { env } from "../env.js";
import { loadAuth, saveAuth, markNeedsReauth, type XeroAuth } from "./authStore.js";

const REVOCATION_URL = "https://identity.xero.com/connect/revocation";

const AUTH_BASE = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";

// Xero is OIDC-based; `offline_access` requires `openid` in the same request.
// `profile`/`email` round out the OIDC set so the consent screen shows who
// the user is connecting as.
//
// This app was registered after Xero's 2026-03-02 granular-scopes cutoff,
// so the legacy broad scopes (accounting.reports.read,
// accounting.transactions.read) are unavailable. We only need P&L and
// balance sheet reports — the two granular report scopes below cover it.
const SCOPES = [
  "openid",
  "profile",
  "email",
  "accounting.reports.profitandloss.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.banksummary.read",
  // GET /Accounts — needed to read each bank account's BankAccountType so we
  // can split BankSummary balances into cash vs credit-card liability.
  "accounting.settings.read",
  "offline_access",
];

/**
 * OAuth state nonces. Held in process memory with a TTL — if Railway restarts
 * mid-flow the user just retries. Single-user app; this is acceptable.
 */
const stateStore = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

function pruneState() {
  const now = Date.now();
  for (const [k, expiresAt] of stateStore.entries()) {
    if (expiresAt < now) stateStore.delete(k);
  }
}

export function buildAuthUrl(): { url: string; state: string } {
  pruneState();
  const state = crypto.randomBytes(16).toString("hex");
  stateStore.set(state, Date.now() + STATE_TTL_MS);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.XERO_CLIENT_ID,
    redirect_uri: env.XERO_REDIRECT_URI,
    scope: SCOPES.join(" "),
    state,
    // Force Xero to show the consent screen every time. There's no Xero-side
    // revocation in this app (Disconnect just clears the local xero_auth row),
    // so without this a "reconnect" after a scope change could silently reuse
    // the old grant and hand back a token missing the new scopes.
    prompt: "consent",
  });
  return { url: `${AUTH_BASE}?${params.toString()}`, state };
}

export function consumeState(state: string): boolean {
  pruneState();
  const ok = stateStore.has(state);
  if (ok) stateStore.delete(state);
  return ok;
}

function basicAuthHeader(): string {
  return `Basic ${Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64")}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
};

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const { statusCode, body: resBody } = await request(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: basicAuthHeader(),
    },
    body: body.toString(),
  });
  const text = await resBody.text();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Xero token endpoint ${statusCode}: ${text}`);
  }
  return JSON.parse(text) as TokenResponse;
}

type Connection = {
  id: string;
  tenantId: string;
  tenantType: string;
  tenantName: string;
};

async function fetchConnections(accessToken: string): Promise<Connection[]> {
  const { statusCode, body: resBody } = await request(CONNECTIONS_URL, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  const text = await resBody.text();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Xero connections ${statusCode}: ${text}`);
  }
  return JSON.parse(text) as Connection[];
}

export async function exchangeCodeForTokens(code: string): Promise<XeroAuth> {
  const tokens = await postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.XERO_REDIRECT_URI,
    }),
  );

  // Xero can silently drop scopes it won't grant — log what was actually
  // granted vs what we asked for, so a missing scope is obvious in the logs.
  process.stderr.write(
    `[xero/token] requested_scope="${SCOPES.join(" ")}" granted_scope="${tokens.scope}"\n`,
  );

  const connections = await fetchConnections(tokens.access_token);
  if (!connections.length) {
    throw new Error("Xero returned no connections for this user");
  }
  // Single-tenant app: pick the first connection.
  const connection = connections[0];

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await saveAuth({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    tenant_id: connection.tenantId,
    tenant_name: connection.tenantName,
    scope: tokens.scope,
  });

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    tenant_id: connection.tenantId,
    tenant_name: connection.tenantName,
    scope: tokens.scope,
    last_refreshed_at: new Date(),
    needs_reauth: false,
  };
}

/**
 * Best-effort server-side revocation of a refresh token (and all access tokens
 * derived from it). Called on Disconnect. Failures are swallowed — the
 * authoritative state for the dashboard is the local xero_auth row, which the
 * caller deletes regardless.
 */
export async function revokeToken(refreshToken: string): Promise<void> {
  try {
    const { statusCode } = await request(REVOCATION_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: basicAuthHeader(),
      },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    if (statusCode < 200 || statusCode >= 300) {
      process.stderr.write(`[xero/revoke] non-2xx from Xero revocation: ${statusCode}\n`);
    }
  } catch (err) {
    process.stderr.write(`[xero/revoke] failed (ignored): ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export class XeroReconnectRequiredError extends Error {
  constructor(message = "Xero refresh token is invalid or expired — reconnection required") {
    super(message);
    this.name = "XeroReconnectRequiredError";
  }
}

/**
 * Refresh tokens rotate on every use. Persist the new refresh_token BEFORE
 * returning — if we crash after refreshing but before saving, the next call
 * would try to reuse a token Xero has already rotated and we'd be locked out.
 */
export async function refreshTokens(auth: XeroAuth): Promise<XeroAuth> {
  let tokens: TokenResponse;
  try {
    tokens = await postToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: auth.refresh_token,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Xero returns 400 with invalid_grant when the refresh token is dead
    // (grant revoked, or not used within 60 days). The connection can't
    // recover without a fresh consent — flag it so the dashboard surfaces
    // "Reconnect" and future syncs skip the Xero step instead of failing.
    if (msg.includes("invalid_grant") || msg.includes(" 400")) {
      await markNeedsReauth();
      throw new XeroReconnectRequiredError();
    }
    throw err;
  }

  process.stderr.write(`[xero/token] (refresh) granted_scope="${tokens.scope}"\n`);

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await saveAuth({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    tenant_id: auth.tenant_id,
    tenant_name: auth.tenant_name,
    scope: tokens.scope,
  });

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    tenant_id: auth.tenant_id,
    tenant_name: auth.tenant_name,
    scope: tokens.scope,
    last_refreshed_at: new Date(),
    needs_reauth: false,
  };
}

/**
 * Returns a valid auth object, refreshing if the access token has expired
 * (or is within 60s of expiring). Throws XeroReconnectRequiredError if
 * we have no auth row at all, or the connection is flagged needs_reauth,
 * or the refresh token turns out to be dead.
 */
export async function getValidAuth(): Promise<XeroAuth> {
  const auth = await loadAuth();
  if (!auth) throw new XeroReconnectRequiredError("Xero not connected");
  if (auth.needs_reauth) throw new XeroReconnectRequiredError("Xero connection expired — reconnect required");

  const now = Date.now();
  const skewMs = 60_000;
  if (auth.expires_at.getTime() - skewMs > now) {
    return auth;
  }
  return refreshTokens(auth);
}
