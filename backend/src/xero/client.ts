import { request } from "undici";
import { getValidAuth, refreshTokens, XeroReconnectRequiredError } from "./oauth.js";
import { loadAuth } from "./authStore.js";

const API_BASE = "https://api.xero.com/api.xro/2.0";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Module-level sliding-window rate limiter shared by all Xero calls. Xero
 * allows 60 req/min per tenant; we cap at 50 to leave headroom. This only
 * ever delays during bulk runs (e.g. the backfill script) — the live sync
 * makes ~5 calls and never trips it.
 */
const RATE_LIMIT = 50;
const RATE_WINDOW_MS = 60_000;
const recentCalls: number[] = [];
async function rateLimitGate(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (recentCalls.length && recentCalls[0] <= now - RATE_WINDOW_MS) recentCalls.shift();
    if (recentCalls.length < RATE_LIMIT) {
      recentCalls.push(Date.now());
      return;
    }
    await sleep(recentCalls[0] + RATE_WINDOW_MS - now + 50);
  }
}

const MAX_429_RETRIES = 5;

/**
 * GETs a Xero endpoint. Handles:
 *  - rate limiting (shared sliding window, see above)
 *  - 401: one-shot token refresh + retry; if that fails, XeroReconnectRequiredError
 *  - 429: honours the Retry-After header, retries up to MAX_429_RETRIES times
 */
export async function xeroGet<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  let auth = await getValidAuth();
  const qs = new URLSearchParams(query).toString();
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ""}`;

  const send = async () => {
    await rateLimitGate();
    return request(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${auth.access_token}`,
        "xero-tenant-id": auth.tenant_id,
        accept: "application/json",
      },
    });
  };

  let res = await send();
  let triedRefresh = false;
  let retries429 = 0;
  for (;;) {
    if (res.statusCode === 401 && !triedRefresh) {
      // Access token rejected; force a refresh and retry once.
      await res.body.dump();
      const current = await loadAuth();
      if (!current) throw new XeroReconnectRequiredError();
      auth = await refreshTokens(current);
      triedRefresh = true;
      res = await send();
      continue;
    }
    if (res.statusCode === 429 && retries429 < MAX_429_RETRIES) {
      const retryAfter = Number(res.headers["retry-after"]);
      await res.body.dump();
      const waitMs = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60) * 1000 + 500;
      process.stderr.write(`[xeroGet] 429 on ${path}; waiting ${Math.round(waitMs / 1000)}s before retry\n`);
      await sleep(waitMs);
      retries429++;
      res = await send();
      continue;
    }
    break;
  }

  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Xero ${path} failed (${res.statusCode}): ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}
