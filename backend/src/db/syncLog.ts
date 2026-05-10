import { supabase } from "./supabase.js";

export type SyncSource = "linnworks_po" | "linnworks_financial" | "xero" | "manual" | "cron";

type LogPayload = {
  source: SyncSource;
  trigger: "manual" | "cron";
  ok: boolean;
  detail: Record<string, unknown> | null;
  error: string | null;
  duration_ms: number;
};

export async function recordSync(payload: LogPayload): Promise<void> {
  const { error } = await supabase.from("sync_log").insert(payload);
  if (error) {
    console.error("Failed to write sync_log:", error.message);
  }
}
