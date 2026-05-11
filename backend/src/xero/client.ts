import { request } from "undici";
import { getValidAuth, refreshTokens, XeroReconnectRequiredError } from "./oauth.js";
import { loadAuth } from "./authStore.js";

const API_BASE = "https://api.xero.com/api.xro/2.0";

/**
 * GETs a Xero report endpoint. Auto-refreshes the token if expired; on a 401
 * (e.g. token revoked server-side), tries a one-shot refresh + retry, then
 * surfaces XeroReconnectRequiredError so the caller can route the user back
 * through OAuth.
 */
export async function xeroGet<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  let auth = await getValidAuth();

  const send = async () => {
    const qs = new URLSearchParams(query).toString();
    const url = `${API_BASE}${path}${qs ? `?${qs}` : ""}`;
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
  if (res.statusCode === 401) {
    // Access token rejected; force a refresh and retry once.
    const current = await loadAuth();
    if (!current) throw new XeroReconnectRequiredError();
    auth = await refreshTokens(current);
    res = await send();
  }

  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Xero ${path} failed (${res.statusCode}): ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}
