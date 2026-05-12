import { recordSync, type SyncSource } from "../db/syncLog.js";
import { syncPurchaseOrders, type SyncMode, type SyncSummary } from "./sync.js";
import { syncFinancialSnapshots, type FinancialSyncSummary } from "./financial.js";
import { syncXeroSnapshots, type XeroSyncSummary } from "../xero/sync.js";
import { loadAuth } from "../xero/authStore.js";

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
  xero: StepResult<XeroSyncSummary>;
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

  // Skip the Xero step entirely (don't fail noisily) when there's no
  // connection or it's flagged needs_reauth — Linnworks steps still run.
  let xero: StepResult<XeroSyncSummary>;
  const xeroAuth = await loadAuth();
  if (!xeroAuth || xeroAuth.needs_reauth) {
    const reason = !xeroAuth ? "not_connected" : "needs_reauth";
    await recordSync({
      source: "xero",
      trigger,
      ok: true,
      detail: { skipped: reason },
      error: null,
      duration_ms: 0,
    });
    xero = { summary: null, error: null, durationMs: 0 };
  } else {
    xero = await runStep("xero", trigger, () => syncXeroSnapshots());
  }

  return {
    ok: po.error === null && financial.error === null && xero.error === null,
    po,
    financial,
    xero,
  };
}
