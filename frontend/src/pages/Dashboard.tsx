import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { triggerSync } from "../lib/api";
import type { PurchaseOrder } from "../lib/types";
import { POsTable } from "../components/POsTable";

function formatLastSynced(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Dashboard() {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  async function refresh() {
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("*")
      .order("po_date", { ascending: false, nullsFirst: false });
    if (error) {
      setSyncError(error.message);
    } else {
      setPos((data ?? []) as PurchaseOrder[]);
      const latest = (data ?? [])
        .map((p) => p.last_synced_at)
        .filter((v): v is string => !!v)
        .sort()
        .pop();
      setLastSyncedAt(latest ?? null);
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onSync() {
    setSyncing(true);
    setSyncError(null);
    const result = await triggerSync("incremental");
    setSyncing(false);
    if (!result.ok) {
      setSyncError(result.error ?? "Sync failed");
    } else {
      await refresh();
    }
  }

  async function onSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-300 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Northwest Guitars</h1>
            <p className="text-xs text-ink-500 mt-0.5">
              Last synced {formatLastSynced(lastSyncedAt)} · Linnworks
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onSync}
              disabled={syncing}
              className="bg-ink-900 text-white text-sm font-medium rounded px-3 py-1.5 hover:bg-ink-700 disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <button
              onClick={onSignOut}
              className="text-sm text-ink-500 hover:text-ink-700 px-2 py-1.5"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {syncError && (
          <div className="text-sm text-bad bg-red-50 border border-red-200 rounded px-3 py-2">
            {syncError}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-ink-500">Loading purchase orders…</div>
        ) : (
          <POsTable rows={pos} onChange={refresh} />
        )}
      </main>
    </div>
  );
}
