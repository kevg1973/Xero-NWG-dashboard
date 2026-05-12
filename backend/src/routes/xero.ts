import { Router } from "express";
import { env } from "../env.js";
import { buildAuthUrl, consumeState, exchangeCodeForTokens, revokeToken } from "../xero/oauth.js";
import { loadAuth, clearAuth } from "../xero/authStore.js";
import { requireAuth } from "../middleware/auth.js";

export const xeroRouter = Router();

/**
 * Public — starts the OAuth flow. Browser navigation (window.location), no
 * JSON. CSRF protection comes from the state nonce + Xero's redirect_uri
 * enforcement.
 */
xeroRouter.get("/connect", (_req, res) => {
  const { url } = buildAuthUrl();
  // stderr (unbuffered) + direct write so Railway can't filter or buffer it.
  process.stderr.write(`[xero/connect] redirecting to: ${url}\n`);
  console.error("[xero/connect] redirecting to:", url);
  res.redirect(url);
});

/**
 * Public — Xero redirects the user here after consent. We validate state,
 * exchange the auth code for tokens, then bounce the user back to the
 * frontend with a query-string flag.
 */
xeroRouter.get("/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const errorParam = typeof req.query.error === "string" ? req.query.error : null;
  const errorDescription =
    typeof req.query.error_description === "string" ? req.query.error_description : null;

  const bounceTo = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    res.redirect(`${env.XERO_FRONTEND_URL}/?${qs}`);
  };

  if (errorParam) {
    // Log Xero's rejection reason. error_description usually names the
    // offending scope or parameter, which is the diagnostic we want.
    process.stderr.write(
      `[xero/callback] rejected: error=${errorParam} error_description=${errorDescription ?? ""}\n`,
    );
    console.error("[xero/callback] rejected:", { error: errorParam, error_description: errorDescription });
    return bounceTo({ xero: "error", reason: errorParam });
  }
  if (!code || !state) {
    return bounceTo({ xero: "error", reason: "missing_code_or_state" });
  }
  if (!consumeState(state)) {
    return bounceTo({ xero: "error", reason: "invalid_state" });
  }

  try {
    const auth = await exchangeCodeForTokens(code);
    return bounceTo({ xero: "connected", tenant: auth.tenant_name ?? "" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[xero/callback] token exchange failed:", message);
    return bounceTo({ xero: "error", reason: message.slice(0, 120) });
  }
});

/**
 * Authenticated — frontend polls this to decide which Xero control to show.
 * Returns no token material.
 *  - no row                  → { connected: false, needs_reconnection: false }  ("Connect Xero")
 *  - row with needs_reauth    → { connected: false, needs_reconnection: true  }  ("Reconnect Xero")
 *  - healthy row              → { connected: true,  needs_reconnection: false }  ("Xero · <tenant>")
 *
 * needs_reauth is set when a refresh_token exchange is rejected by Xero (see
 * refreshTokens) — a real, observed dead grant, not an inference from sync_log.
 */
xeroRouter.get("/status", requireAuth, async (_req, res) => {
  try {
    const auth = await loadAuth();
    if (!auth) {
      return res.json({ connected: false, needs_reconnection: false, tenant_name: null });
    }
    if (auth.needs_reauth) {
      return res.json({ connected: false, needs_reconnection: true, tenant_name: auth.tenant_name });
    }
    return res.json({ connected: true, needs_reconnection: false, tenant_name: auth.tenant_name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
});

/**
 * Authenticated — disconnects Xero. Best-effort server-side token revocation,
 * then deletes the local xero_auth row (the authoritative state). Idempotent:
 * returns 200 even if there was nothing to disconnect.
 */
xeroRouter.post("/disconnect", requireAuth, async (_req, res) => {
  try {
    const auth = await loadAuth();
    if (auth?.refresh_token) {
      await revokeToken(auth.refresh_token);
    }
    await clearAuth();
    return res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: message });
  }
});
