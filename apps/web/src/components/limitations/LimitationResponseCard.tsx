"use client";

/**
 * LimitationResponseCard — ADR 0014 mid-block limitation-response offer.
 *
 * Collapsed by default into a compact banner; "Review & adjust" opens a centered
 * modal where the proposed changes are grouped BY OFFENDING MOVEMENT (one row
 * per movement, not one per session-occurrence). Each swap row carries a
 * dropdown of the engine's ranked, limitation-safe + equipment-available
 * alternatives, so the user can pick which movement to swap in. Each row is
 * all-or-nothing via a checkbox; the apply action re-derives the plan
 * server-side and only honours a chosen target that is one of the offered
 * alternatives, so the client can only ever apply a SUBSET of what the engine
 * independently decided is safe. Main-lift warnings are display-only.
 *
 * Shared between the active-block view on `/app/plan` and `/app/recovery/injuries`.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LimitationResponseOffer } from "@/lib/limitations/offer";
import type {
  LimitationDrop,
  LimitationOffenceReason,
  LimitationSwap,
  LimitationSwapTarget,
} from "@/lib/limitations/response";
import type { ApplyLimitationResult } from "@/lib/limitations/actions";
import { limitationItemKey } from "@/lib/limitations/item-key";

type AppliedResult = Extract<ApplyLimitationResult, { ok: true }>;

function reasonLabel(reason: LimitationOffenceReason): string {
  switch (reason) {
    case "movement_flagged":
      return "you flagged it";
    case "blocked_region":
      return "loads a flagged area";
    case "blocked_muscle":
      return "loads a flagged muscle";
  }
}

type ChangeGroup = {
  id: string;
  kind: "swap" | "drop";
  fromMovementId: string;
  fromName: string;
  reason: LimitationOffenceReason;
  /** Ranked alternatives (swaps only); first is the engine default. */
  alternatives: LimitationSwapTarget[];
  /** Underlying per-item keys this row controls (toggled together). */
  keys: string[];
  sessionIds: Set<string>;
  weeks: number[];
};

function weekRange(weeks: readonly number[]): string {
  if (weeks.length === 0) return "";
  const min = Math.min(...weeks) + 1;
  const max = Math.max(...weeks) + 1;
  return min === max ? `Week ${min}` : `Weeks ${min}–${max}`;
}

function buildGroups(
  swaps: readonly LimitationSwap[],
  drops: readonly LimitationDrop[],
): ChangeGroup[] {
  const order: string[] = [];
  const byId = new Map<string, ChangeGroup>();
  const ensure = (
    id: string,
    seed: Omit<ChangeGroup, "keys" | "sessionIds" | "weeks">,
  ): ChangeGroup => {
    let g = byId.get(id);
    if (!g) {
      g = { ...seed, keys: [], sessionIds: new Set(), weeks: [] };
      byId.set(id, g);
      order.push(id);
    }
    return g;
  };
  // Group by OFFENDING movement so all occurrences collapse to one row + one choice.
  for (const s of swaps) {
    const id = `swap:${s.fromMovementId}`;
    const g = ensure(id, {
      id,
      kind: "swap",
      fromMovementId: s.fromMovementId,
      fromName: s.fromName,
      reason: s.reason,
      alternatives: s.alternatives,
    });
    g.keys.push(limitationItemKey(s.sessionId, s.itemIndex));
    g.sessionIds.add(s.sessionId);
    g.weeks.push(s.weekIndex);
  }
  for (const d of drops) {
    const id = `drop:${d.fromMovementId}`;
    const g = ensure(id, {
      id,
      kind: "drop",
      fromMovementId: d.fromMovementId,
      fromName: d.fromName,
      reason: d.reason,
      alternatives: [],
    });
    g.keys.push(limitationItemKey(d.sessionId, d.itemIndex));
    g.sessionIds.add(d.sessionId);
    g.weeks.push(d.weekIndex);
  }
  // Swaps first (actionable), then drops.
  return order
    .map((id) => byId.get(id)!)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "swap" ? -1 : 1));
}

/** Distinct main-lift movement names that load the flagged area (deduped). */
function distinctWarnNames(offer: LimitationResponseOffer): string[] {
  const seen = new Map<string, string>();
  for (const w of offer.warns) {
    if (!seen.has(w.fromMovementId)) seen.set(w.fromMovementId, w.fromName);
  }
  return [...seen.values()];
}

export function LimitationResponseCard({
  offer,
  applyAction,
}: {
  offer: LimitationResponseOffer;
  applyAction: (
    selectedKeys: string[],
    choices: Record<string, string>,
  ) => Promise<ApplyLimitationResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AppliedResult | null>(null);

  const groups = useMemo(
    () => buildGroups(offer.swaps, offer.drops),
    [offer.swaps, offer.drops],
  );
  const allKeys = useMemo(() => groups.flatMap((g) => g.keys), [groups]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(allKeys));
  // fromMovementId -> chosen toMovementId (defaults to each group's top pick).
  const [choices, setChoices] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const g of groups) {
      if (g.kind === "swap" && g.alternatives[0]) {
        init[g.fromMovementId] = g.alternatives[0].movementId;
      }
    }
    return init;
  });

  const warnNames = useMemo(() => distinctWarnNames(offer), [offer]);

  const sessionCount = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groups) for (const s of g.sessionIds) ids.add(s);
    return ids.size;
  }, [groups]);

  const isGroupChecked = (g: ChangeGroup) => g.keys.every((k) => checked.has(k));
  const toggleGroup = (g: ChangeGroup) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (g.keys.every((k) => next.has(k))) {
        for (const k of g.keys) next.delete(k);
      } else {
        for (const k of g.keys) next.add(k);
      }
      return next;
    });
  const setAll = (on: boolean) => setChecked(on ? new Set(allKeys) : new Set());

  const selectedGroupCount = groups.filter(isGroupChecked).length;

  const apply = () => {
    setError(null);
    const keys = [...checked];
    const chosen = { ...choices };
    startTransition(async () => {
      const res = await applyAction(keys, chosen);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res);
      setOpen(false);
      router.refresh();
    });
  };

  const movementWord = groups.length === 1 ? "movement" : "movements";
  const sessionWord = sessionCount === 1 ? "session" : "sessions";

  return (
    <section
      className="cp-card"
      role="alert"
      data-testid="limitation-response-card"
      style={{
        padding: "14px 18px",
        display: "grid",
        gap: 10,
        borderColor: "var(--cp-accent)",
        background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-accent)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        Limitation — adjust remaining sessions
      </div>

      {done ? (
        <div
          style={{ fontSize: 13, color: "var(--cp-text)" }}
          data-testid="limitation-response-done"
        >
          ✓ Applied {done.swapped} swap{done.swapped === 1 ? "" : "s"} and{" "}
          {done.dropped} removal{done.dropped === 1 ? "" : "s"} across{" "}
          {done.sessions} session{done.sessions === 1 ? "" : "s"}. Anything you
          left unchecked was kept.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: "var(--cp-text)", lineHeight: 1.5 }}>
            A limitation you flagged affects {groups.length} {movementWord} in{" "}
            {sessionCount} upcoming {sessionWord}. The engine can adjust them to
            work around it.
          </div>
          {warnNames.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--cp-warning)" }}>
              ⚠ {warnNames.length} main lift{warnNames.length === 1 ? "" : "s"}{" "}
              also load this area and {warnNames.length === 1 ? "is" : "are"} left
              unchanged — best decided with a clinician.
            </div>
          )}
          <button
            type="button"
            className="cp-btn"
            data-testid="limitation-response-review"
            onClick={() => setOpen(true)}
            style={{ fontSize: 13, padding: "7px 14px", justifySelf: "start" }}
          >
            Review &amp; adjust →
          </button>
        </>
      )}

      {open && !done && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Review limitation adjustments"
          data-testid="limitation-response-modal"
          onClick={() => !pending && setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "grid",
            placeItems: "center",
            zIndex: 70,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="cp-card"
            style={{
              maxWidth: 500,
              width: "100%",
              maxHeight: "85vh",
              overflowY: "auto",
              padding: 20,
              display: "grid",
              gap: 14,
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.01em" }}>
                Adjust remaining sessions
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
                Uncheck anything you want to keep. For each swap you can pick the
                replacement.
              </p>
            </div>

            {groups.length > 1 && (
              <div style={{ display: "flex", gap: 14, fontSize: 12 }}>
                <button
                  type="button"
                  onClick={() => setAll(true)}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--cp-text-muted)" }}
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setAll(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--cp-text-muted)" }}
                >
                  Clear all
                </button>
              </div>
            )}

            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {groups.map((g) => {
                const sessions = g.sessionIds.size;
                const scope = `${sessions} session${sessions === 1 ? "" : "s"}`;
                const checkedHere = isGroupChecked(g);
                return (
                  <li
                    key={g.id}
                    data-testid="limitation-response-group"
                    style={{
                      border: "1px solid var(--cp-border)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <label style={{ display: "flex", gap: 10, alignItems: "start", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={checkedHere}
                        onChange={() => toggleGroup(g)}
                        style={{ marginTop: 3, accentColor: "var(--cp-accent)", flexShrink: 0 }}
                      />
                      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, color: "var(--cp-text)", lineHeight: 1.4 }}>
                          {g.kind === "swap" ? (
                            <>Swap <strong>{g.fromName}</strong></>
                          ) : (
                            <>
                              Remove <strong>{g.fromName}</strong>
                              <span style={{ color: "var(--cp-text-muted)" }}> (no safe alternative)</span>
                            </>
                          )}
                        </span>
                        <span style={{ fontSize: 11.5, color: "var(--cp-text-muted)" }}>
                          {weekRange(g.weeks)} · {scope} · {reasonLabel(g.reason)}
                        </span>
                      </span>
                    </label>

                    {g.kind === "swap" && g.alternatives.length > 0 && (
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginLeft: 30,
                          fontSize: 12.5,
                          color: "var(--cp-text-muted)",
                          opacity: checkedHere ? 1 : 0.5,
                        }}
                      >
                        Replace with
                        <select
                          data-testid="limitation-response-target"
                          value={choices[g.fromMovementId] ?? g.alternatives[0]?.movementId}
                          disabled={!checkedHere}
                          onChange={(e) =>
                            setChoices((prev) => ({
                              ...prev,
                              [g.fromMovementId]: e.target.value,
                            }))
                          }
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 12.5,
                            padding: "4px 6px",
                            borderRadius: 6,
                            border: "1px solid var(--cp-border)",
                            background: "var(--cp-surface)",
                            color: "var(--cp-text)",
                          }}
                        >
                          {g.alternatives.map((alt) => (
                            <option key={alt.movementId} value={alt.movementId}>
                              {alt.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>

            {warnNames.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--cp-warning)", lineHeight: 1.5 }}>
                ⚠ {warnNames.length} main lift{warnNames.length === 1 ? "" : "s"}{" "}
                ({warnNames.slice(0, 3).join(", ")}
                {warnNames.length > 3 ? ", …" : ""}) also load this area. These
                are left unchanged — adjusting load or range of motion on a main
                lift is best decided with a clinician.
              </div>
            )}

            {error && (
              <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="cp-btn ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cp-btn primary"
                data-testid="limitation-response-apply"
                onClick={apply}
                disabled={pending || selectedGroupCount === 0}
              >
                {pending
                  ? "Applying…"
                  : `Apply ${selectedGroupCount} change${selectedGroupCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
