"use client";

/**
 * LimitationResponseCard — ADR 0014 mid-block limitation-response offer.
 *
 * Collapsed by default into a compact banner; "Review & adjust" opens a modal
 * where the proposed changes are grouped BY MOVEMENT (one row per movement, not
 * one per session-occurrence) so a single flagged accessory repeated across the
 * block reads as one line instead of dozens. Each row is all-or-nothing; the
 * apply action still receives the underlying per-item keys, and re-derives the
 * plan server-side, so the client only ever applies a SUBSET of what the engine
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
  /** Stable group id (also the React key). */
  id: string;
  kind: "swap" | "drop";
  fromName: string;
  toName?: string;
  reason: LimitationOffenceReason;
  /** Underlying per-item keys this row controls (all toggled together). */
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
  for (const s of swaps) {
    const id = `swap:${s.fromMovementId}->${s.toMovementId}`;
    const g = ensure(id, {
      id,
      kind: "swap",
      fromName: s.fromName,
      toName: s.toName,
      reason: s.reason,
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
      fromName: d.fromName,
      reason: d.reason,
    });
    g.keys.push(limitationItemKey(d.sessionId, d.itemIndex));
    g.sessionIds.add(d.sessionId);
    g.weeks.push(d.weekIndex);
  }
  // Swaps first (the actionable, reassuring ones), then drops.
  return order
    .map((id) => byId.get(id)!)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "swap" ? -1 : 1));
}

export function LimitationResponseCard({
  offer,
  applyAction,
}: {
  offer: LimitationResponseOffer;
  applyAction: (selectedKeys: string[]) => Promise<ApplyLimitationResult>;
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
    startTransition(async () => {
      const res = await applyAction(keys);
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
          {offer.warns.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--cp-warning)" }}>
              ⚠ {offer.warns.length} main-lift movement
              {offer.warns.length === 1 ? "" : "s"} also load this area and
              aren&apos;t changed automatically — best decided with a clinician.
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
              maxWidth: 480,
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
                Uncheck anything you want to keep, then apply the rest.
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
                const count = g.keys.length;
                const sessions = g.sessionIds.size;
                const scope =
                  sessions === count
                    ? `${sessions} session${sessions === 1 ? "" : "s"}`
                    : `${count}× across ${sessions} session${sessions === 1 ? "" : "s"}`;
                return (
                  <li
                    key={g.id}
                    data-testid="limitation-response-group"
                    style={{
                      border: "1px solid var(--cp-border)",
                      borderRadius: 10,
                      padding: "10px 12px",
                    }}
                  >
                    <label style={{ display: "flex", gap: 10, alignItems: "start", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={isGroupChecked(g)}
                        onChange={() => toggleGroup(g)}
                        style={{ marginTop: 3, accentColor: "var(--cp-accent)", flexShrink: 0 }}
                      />
                      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, color: "var(--cp-text)", lineHeight: 1.4 }}>
                          {g.kind === "swap" ? (
                            <>
                              Swap <strong>{g.fromName}</strong> →{" "}
                              <strong>{g.toName}</strong>
                            </>
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
                  </li>
                );
              })}
            </ul>

            {offer.warns.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--cp-warning)", lineHeight: 1.5 }}>
                ⚠ {offer.warns.length} main-lift movement
                {offer.warns.length === 1 ? "" : "s"} also load this area (
                {offer.warns.slice(0, 3).map((w) => w.fromName).join(", ")}
                {offer.warns.length > 3 ? "…" : ""}) — left unchanged; adjusting
                load/ROM on a primary lift is best decided with a clinician.
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
