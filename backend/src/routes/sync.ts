import { Router } from "express";
import { runSyncs } from "../linnworks/runSyncs.js";
import type { SyncMode } from "../linnworks/sync.js";
import { requireAuth } from "../middleware/auth.js";

export const syncRouter = Router();

syncRouter.post("/sync", requireAuth, async (req, res) => {
  const mode: SyncMode = req.body?.mode === "full" ? "full" : "incremental";
  const result = await runSyncs({ trigger: "manual", mode });

  /**
   * Spread the PO summary at the top level for backwards compat with the
   * existing frontend (which reads fetched/inserts/updates/unchanged). Add the
   * financial summary as a nested field. `error` reports the first failure.
   */
  const body: Record<string, unknown> = {
    ok: result.ok,
    ...(result.po.summary ?? {}),
    financial: result.financial.summary,
    xero: result.xero.summary,
  };
  const error = result.po.error ?? result.financial.error ?? result.xero.error;
  if (error) body.error = error;

  res.status(result.ok ? 200 : 500).json(body);
});
