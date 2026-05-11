import { Router } from "express";
import { env } from "../env.js";
import { buildAuthUrl, consumeState, exchangeCodeForTokens } from "../xero/oauth.js";
import { loadAuth } from "../xero/authStore.js";
import { supabase } from "../db/supabase.js";
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

  const bounceTo = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    res.redirect(`${env.XERO_FRONTEND_URL}/?${qs}`);
  };

  if (errorParam) {
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
 * Authenticated — frontend polls this to decide whether to show the
 * "Connect Xero" button. Returns no token material.
 */
xeroRouter.get("/status", requireAuth, async (_req, res) => {
  try {
    const auth = await loadAuth();
    if (!auth) {
      return res.json({ connected: false, needs_reconnection: false, tenant_name: null });
    }

    /**
     * The brief calls for surfacing "Reconnect Xero" state if the refresh
     * token has expired (>60 days). We don't actively probe Xero on every
     * /status call; instead, look at the most recent xero sync_log entry —
     * if the last sync failed with a reconnect-required error, surface it.
     * Implicit assumption: the daily cron runs often enough that a 60-day
     * refresh-token expiry will surface within ~24h.
     */
    const { data: lastLog } = await supabase
      .from("sync_log")
      .select("ok, error")
      .eq("source", "xero")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastError = (lastLog as { ok: boolean; error: string | null } | null)?.error ?? "";
    const needs_reconnection = lastLog != null && lastLog.ok === false && /reconnect/i.test(lastError);

    return res.json({
      connected: true,
      needs_reconnection,
      tenant_name: auth.tenant_name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
});
