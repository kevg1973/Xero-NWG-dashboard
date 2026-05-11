import { recordSync, type SyncSource } from "../db/syncLog.js";
import { syncPurchaseOrders, type SyncMode, type SyncSummary } from "./sync.js";
import { syncFinancialSnapshots, type FinancialSyncSummary } from "./financial.js";

/**
 * Orchestrates the full sync. Each step (PO + financial) runs in its own
 * try/catch and writes its own sync_log entry — a failure in one does not
 * stop the other, so we always make progress on at least one dataset per run.
 */

type Trigger = "manual" | "cron";

type StepResult<T> = { summary: T | null; error: string | null; durationMs: number };

async function runStep<T>(
  source: SyncSource,
  trigger: Trigger,
  fn: () => Promise<T>,
  detailExtra: Record<string, unknown> = {},
): Promise<StepResult<T>> {
  const startedAt = Date.now();
  try {
    const summary = await fn();
    const durationMs = Date.now() - startedAt;
    await recordSync({
      source,
      trigger,
      ok: true,
      detail: { ...detailExtra, ...(summary as object) },
      error: null,
      duration_ms: durationMs,
    });
    return { summary, error: null, durationMs };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startedAt;
    await recordSync({
      source,
      trigger,
      ok: false,
      detail: detailExtra,
      error,
      duration_ms: durationMs,
    });
    return { summary: null, error, durationMs };
  }
}

export type FullSyncResult = {
  ok: boolean;
  po: StepResult<SyncSummary>;
  financial: StepResult<FinancialSyncSummary>;
};

export async function runSyncs({
  trigger,
  mode = "incremental",
}: {
  trigger: Trigger;
  mode?: SyncMode;
}): Promise<FullSyncResult> {
  const po = await runStep("linnworks_po", trigger, () => syncPurchaseOrders(mode), { mode });
  const financial = await runStep("linnworks_financial", trigger, () => syncFinancialSnapshots());
  return { ok: po.error === null && financial.error === null, po, financial };
}
