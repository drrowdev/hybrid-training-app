"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectSwimDashboard, disconnectSwimDashboard } from "@/lib/swim/import-actions";
import type { SwimConnection } from "@/lib/swim/import-storage";

export function SwimImportConnection({ enabled, connection }: { enabled: boolean; connection: SwimConnection | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [issued, setIssued] = useState<{ id: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [disconnectedId, setDisconnectedId] = useState<string | null>(null);
  const activeId = issued?.id ?? (connection?.id === disconnectedId ? undefined : connection?.id);

  function connect() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await connectSwimDashboard();
        if (!result.ok) { setError(result.error); router.refresh(); return; }
        setIssued({ id: result.id, key: result.key });
        setDisconnectedId(null);
        setCopied(false);
        router.refresh();
      } catch {
        setError("Connection status unconfirmed. Reload.");
      }
    });
  }

  function disconnect() {
    if (!activeId) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await disconnectSwimDashboard(activeId);
        if (!result.ok) { setError(result.error); return; }
        setIssued(null);
        setDisconnectedId(activeId);
        setCopied(false);
        router.refresh();
      } catch {
        setError("Connection status unconfirmed. Reload.");
      }
    });
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.key);
      setCopied(true);
      setError(null);
    } catch {
      setError("Select and copy the key below.");
    }
  }

  return (
    <section className="space-y-4" style={{ padding: 20, borderRadius: 16, border: "1px solid var(--cp-border)", background: "var(--cp-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Local dashboard</h2>
        <span className="text-sm" style={{ color: "var(--cp-text-muted)" }}>{activeId ? "Key active" : "No active key"}</span>
      </div>
      {issued && (
        <div className="space-y-2">
          <label htmlFor="swim-import-key" className="text-sm">Import key</label>
          <input id="swim-import-key" value={issued.key} readOnly autoComplete="off" spellCheck={false}
            className="w-full rounded-lg border p-3 font-mono text-sm"
            style={{ background: "var(--cp-bg-elevated)", borderColor: "var(--cp-border)", color: "var(--cp-text)" }}
            onFocus={(event) => event.target.select()} />
          <button type="button" className="cp-btn" onClick={copy}>{copied ? "Copied" : "Copy key"}</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm" style={{ color: "var(--cp-danger)" }}>{error}</p>}
      {activeId
        ? <button type="button" className="cp-btn" disabled={pending} onClick={disconnect}>Disconnect dashboard</button>
        : enabled
          ? <>
            <p className="text-sm" style={{ color: "var(--cp-text-muted)" }}>Import swim dates, distance, timing, strokes and workout references.</p>
            <button type="button" className="cp-btn primary" disabled={pending} onClick={connect}>Create import key</button>
          </>
          : <p className="text-sm" style={{ color: "var(--cp-text-muted)" }}>New connections unavailable.</p>}
    </section>
  );
}
