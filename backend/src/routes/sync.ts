import { Router } from "express";
import { syncPurchaseOrders, type SyncMode } from "../linnworks/sync.js";
import { recordSync } from "../db/syncLog.js";
import { requireAuth } from "../middleware/auth.js";

export const syncRouter = Router();

syncRouter.post("/sync", requireAuth, async (req, res) => {
  const mode: SyncMode = req.body?.mode === "full" ? "full" : "incremental";
  const startedAt = Date.now();

  try {
    const summary = await syncPurchaseOrders(mode);
    await recordSync({
      source: "linnworks_po",
      trigger: "manual",
      ok: true,
      detail: { mode, ...summary },
      error: null,
      duration_ms: Date.now() - startedAt,
    });
    res.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordSync({
      source: "linnworks_po",
      trigger: "manual",
      ok: false,
      detail: { mode },
      error: message,
      duration_ms: Date.now() - startedAt,
    });
    res.status(500).json({ ok: false, error: message });
  }
});
