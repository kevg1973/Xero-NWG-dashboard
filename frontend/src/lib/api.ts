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
  upserted?: number;
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
