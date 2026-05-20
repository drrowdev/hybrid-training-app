"use client";

import { useRef, useState, useTransition } from "react";

type Status = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 600;

type Candidate = { id: string; display_name: string; pattern?: string };

export function TmAutoForm({
  mode,
  candidates,
  candidateGroups,
  initial,
  defaultPercent,
  action,
}: {
  /**
   * "new" — show a variant picker + inputs; saves auto when a movement is selected and a positive 1RM is entered.
   * "edit" — fixed movement; saves auto when 1RM or TM% changes.
   */
  mode: "new" | "edit";
  /** Flat candidate list (when mode="new" and no groups). */
  candidates?: Candidate[];
  /** Optional grouped candidates for the optgroup-style picker. */
  candidateGroups?: { label: string; items: Candidate[] }[];
  /** Initial state — required for edit mode, optional for new. */
  initial?: {
    movementId?: string;
    movementName?: string;
    oneRmKg?: number;
    tmPercent?: number | null;
  };
  defaultPercent: number;
  /** Bound server action upsertTrainingMax. Returns either void or {ok, error?} */
  action: (fd: FormData) => Promise<unknown>;
}) {
  const [movementId, setMovementId] = useState<string>(initial?.movementId ?? "");
  const [oneRmKg, setOneRmKg] = useState<string>(
    initial?.oneRmKg != null ? String(initial.oneRmKg) : "",
  );
  const [tmPercent, setTmPercent] = useState<string>(
    initial?.tmPercent != null ? String(initial.tmPercent) : "",
  );

  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSerialised = useRef<string | null>(null);

  const scheduleSave = (mid: string, rm: string, pct: string) => {
    if (!mid) return;
    const rmNum = Number(rm);
    if (!Number.isFinite(rmNum) || rmNum <= 0) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const serialised = `${mid}|${rmNum}|${pct.trim()}`;
      if (lastSerialised.current === serialised) return;
      lastSerialised.current = serialised;
      const fd = new FormData();
      fd.set("movementId", mid);
      fd.set("oneRmKg", rm);
      if (pct.trim() !== "") fd.set("tmPercent", pct);
      setStatus("saving");
      setErrorMsg(null);
      startTransition(async () => {
        try {
          const result = (await action(fd)) as
            | undefined
            | void
            | { ok: true }
            | { ok: false; error: string };
          if (result && typeof result === "object" && "ok" in result && result.ok === false) {
            setStatus("error");
            setErrorMsg(result.error);
            return;
          }
          setStatus("saved");
          window.setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1800);
        } catch (e) {
          setStatus("error");
          setErrorMsg(e instanceof Error ? e.message : "Failed to save");
        }
      });
    }, DEBOUNCE_MS);
  };

  const onMovement = (v: string) => {
    setMovementId(v);
    scheduleSave(v, oneRmKg, tmPercent);
  };
  const onOneRm = (v: string) => {
    setOneRmKg(v);
    scheduleSave(movementId, v, tmPercent);
  };
  const onTmPct = (v: string) => {
    setTmPercent(v);
    scheduleSave(movementId, oneRmKg, v);
  };

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) 110px 110px auto",
          gap: 8,
          alignItems: "end",
          ...(mode === "new"
            ? { border: "1px dashed var(--cp-border-strong)", borderRadius: 12, padding: 12 }
            : {}),
        }}
      >
      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <Label>{mode === "new" ? "Pick your variant" : "Movement"}</Label>
        {mode === "new" ? (
          <select
            value={movementId}
            onChange={(e) => onMovement(e.target.value)}
            aria-label="Pick a variant"
            style={{ padding: "8px 10px", fontSize: 14 }}
          >
            <option value="">— variant —</option>
            {candidateGroups
              ? candidateGroups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.display_name}
                      </option>
                    ))}
                  </optgroup>
                ))
              : (candidates ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
          </select>
        ) : (
          <div style={{ fontSize: 14, fontWeight: 600, padding: "8px 0" }}>
            {initial?.movementName}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gap: 2 }}>
        <Label>1RM (kg)</Label>
        <input
          type="number"
          step="0.5"
          min="1"
          max="1000"
          value={oneRmKg}
          onChange={(e) => onOneRm(e.target.value)}
          inputMode="decimal"
          aria-label="One rep max"
          className="mono"
          style={{ width: "100%", padding: "8px 10px", fontSize: 14, textAlign: "right" }}
        />
      </div>
      <div style={{ display: "grid", gap: 2 }}>
        <Label>TM% (optional)</Label>
        <input
          type="number"
          step="0.5"
          min="50"
          max="100"
          value={tmPercent}
          onChange={(e) => onTmPct(e.target.value)}
          placeholder={`${defaultPercent}`}
          inputMode="decimal"
          aria-label="TM% override"
          className="mono"
          style={{ width: "100%", padding: "8px 10px", fontSize: 14, textAlign: "right" }}
        />
      </div>
        <StatusBadge status={status} errorMsg={errorMsg} />
      </div>
      {status === "error" && errorMsg && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: "var(--cp-danger)",
            padding: "6px 10px",
            borderRadius: 8,
            background: "color-mix(in oklab, var(--cp-danger) 8%, transparent)",
            border: "1px solid var(--cp-danger)",
          }}
        >
          Couldn&apos;t save: {errorMsg}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, errorMsg }: { status: Status; errorMsg: string | null }) {
  if (status === "idle") {
    return (
      <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>auto-saves</span>
    );
  }
  if (status === "saving") {
    return (
      <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>saving…</span>
    );
  }
  if (status === "saved") {
    return (
      <span style={{ fontSize: 11, color: "var(--cp-success)", fontWeight: 600 }}>✓ saved</span>
    );
  }
  return (
    <span
      title={errorMsg ?? undefined}
      style={{ fontSize: 11, color: "var(--cp-danger)", fontWeight: 600 }}
    >
      ✗ failed
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        color: "var(--cp-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </span>
  );
}
