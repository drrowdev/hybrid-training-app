"use client";

/**
 * LimitationResponseCard — ADR 0014 mid-block limitation-response offer,
 * per-item review (Option 2).
 *
 * Shared between the active-block view on `/app/plan` and the
 * `/app/recovery/injuries` page. The engine derives a remediation plan
 * (swap / drop / warn); this card lets the user review every proposed swap
 * and drop and uncheck any they want to keep, then applies only the checked
 * subset. Main-lift warnings are display-only — never auto-changed.
 *
 * The apply action re-derives the plan server-side and intersects it with the
 * checked keys, so the client only ever requests a SUBSET of what the engine
 * independently decided is safe.
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
      return "you flagged this movement";
    case "blocked_region":
      return "loads a flagged area";
    case "blocked_muscle":
      return "loads a flagged muscle";
  }
}

type SessionGroup = {
  sessionId: string;
  title: string;
  weekIndex: number;
  dayIndex: number;
  swaps: LimitationSwap[];
  drops: LimitationDrop[];
};

function groupBySession(
  swaps: readonly LimitationSwap[],
  drops: readonly LimitationDrop[],
): SessionGroup[] {
  const order: string[] = [];
  const byId = new Map<string, SessionGroup>();
  const ensure = (
    sessionId: string,
    title: string,
    weekIndex: number,
    dayIndex: number,
  ): SessionGroup => {
    let g = byId.get(sessionId);
    if (!g) {
      g = { sessionId, title, weekIndex, dayIndex, swaps: [], drops: [] };
      byId.set(sessionId, g);
      order.push(sessionId);
    }
    return g;
  };
  for (const s of swaps) {
    ensure(s.sessionId, s.sessionTitle, s.weekIndex, s.dayIndex).swaps.push(s);
  }
  for (const d of drops) {
    ensure(d.sessionId, d.sessionTitle, d.weekIndex, d.dayIndex).drops.push(d);
  }
  return order
    .map((id) => byId.get(id)!)
    .sort((a, b) =>
      a.weekIndex !== b.weekIndex
        ? a.weekIndex - b.weekIndex
        : a.dayIndex - b.dayIndex,
    );
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
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AppliedResult | null>(null);

  const groups = useMemo(
    () => groupBySession(offer.swaps, offer.drops),
    [offer.swaps, offer.drops],
  );

  const allKeys = useMemo(
    () => [
      ...offer.swaps.map((s) => limitationItemKey(s.sessionId, s.itemIndex)),
      ...offer.drops.map((d) => limitationItemKey(d.sessionId, d.itemIndex)),
    ],
    [offer.swaps, offer.drops],
  );

  // Default: every proposed change checked (the old one-click "apply all").
  const [checked, setChecked] = useState<Set<string>>(() => new Set(allKeys));

  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setAll = (on: boolean) =>
    setChecked(on ? new Set(allKeys) : new Set());

  const selectedCount = checked.size;
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
      router.refresh();
    });
  };

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
          {done.sessions} session{done.sessions === 1 ? "" : "s"}. Any changes
          you left unchecked were kept as-is.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: "var(--cp-text)", lineHeight: 1.5 }}>
            A limitation you flagged still affects movements scheduled later in
            this block. Review each proposed change below — uncheck anything you
            want to keep — then apply the rest.
          </div>

          {allKeys.length > 1 && (
            <div style={{ display: "flex", gap: 14, fontSize: 12 }}>
              <button
                type="button"
                onClick={() => setAll(true)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  color: "var(--cp-text-muted)",
                }}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setAll(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  color: "var(--cp-text-muted)",
                }}
              >
                Clear all
              </button>
            </div>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {groups.map((g) => (
              <div
                key={g.sessionId}
                data-testid="limitation-response-session"
                style={{
                  border: "1px solid var(--cp-border)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "grid", gap: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--cp-text)",
                    }}
                  >
                    {g.title}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                    Week {g.weekIndex + 1} · Day {g.dayIndex + 1}
                  </div>
                </div>

                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  {g.swaps.map((s) => {
                    const key = limitationItemKey(s.sessionId, s.itemIndex);
                    return (
                      <li key={key}>
                        <label
                          data-testid="limitation-response-item"
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "start",
                            cursor: "pointer",
                            fontSize: 12.5,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked.has(key)}
                            onChange={() => toggle(key)}
                            style={{ marginTop: 2, accentColor: "var(--cp-accent)" }}
                          />
                          <span style={{ color: "var(--cp-text)", lineHeight: 1.4 }}>
                            Swap <strong>{s.fromName}</strong> →{" "}
                            <strong>{s.toName}</strong>
                            <span style={{ color: "var(--cp-text-muted)" }}>
                              {" "}
                              — {reasonLabel(s.reason)}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                  {g.drops.map((d) => {
                    const key = limitationItemKey(d.sessionId, d.itemIndex);
                    return (
                      <li key={key}>
                        <label
                          data-testid="limitation-response-item"
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "start",
                            cursor: "pointer",
                            fontSize: 12.5,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked.has(key)}
                            onChange={() => toggle(key)}
                            style={{ marginTop: 2, accentColor: "var(--cp-accent)" }}
                          />
                          <span style={{ color: "var(--cp-text)", lineHeight: 1.4 }}>
                            Remove <strong>{d.fromName}</strong>
                            <span style={{ color: "var(--cp-text-muted)" }}>
                              {" "}
                              — no safe alternative; {reasonLabel(d.reason)}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {offer.warns.length > 0 && (
            <div
              style={{
                fontSize: 12,
                color: "var(--cp-warning)",
                lineHeight: 1.5,
              }}
            >
              ⚠ {offer.warns.length} main-lift movement
              {offer.warns.length === 1 ? "" : "s"} also load this area (
              {offer.warns.slice(0, 3).map((w) => w.fromName).join(", ")}
              {offer.warns.length > 3 ? "…" : ""}). These aren&apos;t changed
              automatically — adjusting load, range of motion, or grip on a
              primary lift is best decided with a clinician.
            </div>
          )}

          <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
            This is load management, not medical care. If symptoms persist or
            worsen, see a qualified clinician.
          </div>

          {error && (
            <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
              {error}
            </div>
          )}

          {allKeys.length > 0 && (
            <button
              type="button"
              className="cp-btn"
              data-testid="limitation-response-apply"
              onClick={apply}
              disabled={pending || selectedCount === 0}
              style={{ fontSize: 13, padding: "7px 14px", justifySelf: "start" }}
            >
              {pending
                ? "Applying…"
                : `Apply ${selectedCount} change${selectedCount === 1 ? "" : "s"}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
