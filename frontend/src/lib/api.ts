import { backendUrl, supabase } from "./supabase";

async function authHeader(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${token}` };
}

export type SyncResponse = {
  ok: boolean;
  fetched?: number;
  inserts?: number;
  updates?: number;
  unchanged?: number;
  durationMs?: number;
  error?: string;
};

export async function triggerSync(mode: "incremental" | "full" = "incremental"): Promise<SyncResponse> {
  const headers = { ...(await authHeader()), "content-type": "application/json" };
  const res = await fetch(`${backendUrl}/api/sync`, {
    method: "POST",
    headers,
    body: JSON.stringify({ mode }),
  });
  return (await res.json()) as SyncResponse;
}

export type XeroStatus = {
  connected: boolean;
  needs_reconnection: boolean;
  tenant_name: string | null;
};

export async function getXeroStatus(): Promise<XeroStatus> {
  const headers = await authHeader();
  const res = await fetch(`${backendUrl}/api/xero/status`, { headers });
  if (!res.ok) throw new Error(`xero/status ${res.status}`);
  return (await res.json()) as XeroStatus;
}

export function xeroConnectUrl(): string {
  return `${backendUrl}/api/xero/connect`;
}
