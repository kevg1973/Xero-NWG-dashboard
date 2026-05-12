import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { triggerSync, getXeroStatus, xeroConnectUrl, xeroDisconnect, type XeroStatus } from "../lib/api";
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
  const [xero, setXero] = useState<XeroStatus | null>(null);
  const [xeroBanner, setXeroBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

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
    getXeroStatus().then(setXero).catch(() => setXero(null));

    // Surface the result of an OAuth round-trip if present in the URL.
    const params = new URLSearchParams(window.location.search);
    const xeroParam = params.get("xero");
    if (xeroParam === "connected") {
      const tenant = params.get("tenant");
      setXeroBanner({
        kind: "ok",
        text: tenant ? `Connected to Xero: ${tenant}` : "Xero connected",
      });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (xeroParam === "error") {
      setXeroBanner({
        kind: "error",
        text: `Xero connection failed: ${params.get("reason") ?? "unknown"}`,
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
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

  async function onDisconnectXero() {
    if (!window.confirm("Disconnect Xero? You'll need to reconnect to keep syncing data.")) return;
    try {
      await xeroDisconnect();
      setXero({ connected: false, needs_reconnection: false, tenant_name: null });
      setXeroBanner(null);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Failed to disconnect Xero");
    }
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
            <XeroIndicator status={xero} onDisconnect={onDisconnectXero} />
            <button
              onClick={onSync}
              disabled={syncing}
              className="bg-ink-900 text-white text-sm font-medium rounded px-3 py-1.5 hover:bg-ink-700 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              {syncing && (
                <span
                  aria-hidden
                  className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin"
                />
              )}
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
        {xero?.needs_reconnection && (
          <div className="text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded px-3 py-2 flex items-center justify-between">
            <span>Xero connection expired — reconnect to keep syncing P&amp;L and balance-sheet data.</span>
            <a
              href={xeroConnectUrl()}
              className="font-medium text-amber-900 border border-amber-400 rounded px-2.5 py-1 hover:bg-amber-100 whitespace-nowrap ml-3"
            >
              Reconnect Xero
            </a>
          </div>
        )}
        {xeroBanner && (
          <div
            className={
              xeroBanner.kind === "ok"
                ? "text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2"
                : "text-sm text-bad bg-red-50 border border-red-200 rounded px-3 py-2"
            }
          >
            {xeroBanner.text}
          </div>
        )}
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

function XeroIndicator({ status, onDisconnect }: { status: XeroStatus | null; onDisconnect: () => void }) {
  if (status == null) return null;

  // Dead grant: reconnect takes priority over the plain "connect" affordance.
  if (status.needs_reconnection) {
    return (
      <a
        href={xeroConnectUrl()}
        className="text-sm font-medium text-amber-800 border border-amber-300 bg-amber-50 rounded px-3 py-1.5 hover:bg-amber-100"
      >
        Reconnect Xero
      </a>
    );
  }
  if (!status.connected) {
    return (
      <a
        href={xeroConnectUrl()}
        className="text-sm font-medium text-ink-900 border border-ink-300 rounded px-3 py-1.5 hover:bg-ink-100"
      >
        Connect Xero
      </a>
    );
  }
  return (
    <span className="text-xs text-ink-500 px-2 py-1.5 flex items-center gap-2">
      <span>Xero · {status.tenant_name ?? "connected"}</span>
      <button onClick={onDisconnect} className="underline hover:text-ink-700">
        Disconnect
      </button>
    </span>
  );
}
