import { supabase } from "../db/supabase.js";
import { encrypt, decrypt } from "./crypto.js";

export type XeroAuth = {
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  tenant_id: string;
  tenant_name: string | null;
  scope: string | null;
  last_refreshed_at: Date | null;
  needs_reauth: boolean;
};

type AuthRow = {
  access_token: string | null;
  refresh_token_encrypted: string | null;
  expires_at: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  scope: string | null;
  last_refreshed_at: string | null;
  needs_reauth: boolean | null;
};

export async function loadAuth(): Promise<XeroAuth | null> {
  const { data, error } = await supabase
    .from("xero_auth")
    .select(
      "access_token, refresh_token_encrypted, expires_at, tenant_id, tenant_name, scope, last_refreshed_at, needs_reauth",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`xero_auth load failed: ${error.message}`);
  if (!data) return null;

  const row = data as AuthRow;
  if (!row.access_token || !row.refresh_token_encrypted || !row.tenant_id || !row.expires_at) {
    return null;
  }

  return {
    access_token: row.access_token,
    refresh_token: decrypt(row.refresh_token_encrypted),
    expires_at: new Date(row.expires_at),
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name,
    scope: row.scope,
    last_refreshed_at: row.last_refreshed_at ? new Date(row.last_refreshed_at) : null,
    needs_reauth: row.needs_reauth ?? false,
  };
}

export type SaveAuthInput = {
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  tenant_id: string;
  tenant_name?: string | null;
  scope?: string | null;
};

/**
 * Single-row upsert (id=1). The unique constraint via primary key handles
 * insert vs update without us needing to know which case we're in — works on
 * first connect and on every refresh.
 */
export async function saveAuth(input: SaveAuthInput): Promise<void> {
  const row = {
    id: 1,
    access_token: input.access_token,
    refresh_token_encrypted: encrypt(input.refresh_token),
    expires_at: input.expires_at.toISOString(),
    tenant_id: input.tenant_id,
    tenant_name: input.tenant_name ?? null,
    scope: input.scope ?? null,
    last_refreshed_at: new Date().toISOString(),
    // A successful (re)connect or refresh means the grant is alive again.
    needs_reauth: false,
  };
  const { error } = await supabase
    .from("xero_auth")
    .upsert(row, { onConflict: "id", ignoreDuplicates: false });
  if (error) throw new Error(`xero_auth save failed: ${error.message}`);
}

/**
 * Flags the connection as dead — set when a refresh_token exchange is rejected
 * by Xero (the grant has been revoked or expired beyond refresh). The row is
 * kept (not deleted) so the dashboard can distinguish "expired, reconnect" from
 * "never connected", and so future syncs skip the Xero step instead of failing.
 */
export async function markNeedsReauth(): Promise<void> {
  const { error } = await supabase.from("xero_auth").update({ needs_reauth: true }).eq("id", 1);
  if (error) throw new Error(`xero_auth markNeedsReauth failed: ${error.message}`);
}

export async function clearAuth(): Promise<void> {
  const { error } = await supabase.from("xero_auth").delete().eq("id", 1);
  if (error) throw new Error(`xero_auth clear failed: ${error.message}`);
}
