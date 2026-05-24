"use client";

/**
 * One collapsible card per prescribed movement in the session. Owns
 * the header chip, the collapsed/expanded toggle, the auto-collapse-
 * to-recap latch, and the embedded `<MovementFocusView>` body.
 *
 * The auto-collapse latch (`autoCollapsedRef`) ensures that once a
 * user re-expands the card after it auto-collapsed, the card stays
 * open for the rest of the session — preventing the re-collapse loop
 * called out in the reference doc.
 *
 * The "Same as planned" button moved here from the session-level
 * banner so prefilling is per-movement: tap to populate every set in
 * this group with its TM-derived target.
 */

import { useEffect, useRef, useState } from "react";
import type { Prescription } from "@hta/db";
import {
  deriveCardState,
  isMovementComplete,
  type MovementGroup,
} from "@/lib/sessions/movement-grouping";
import { MovementFocusView, type FocusLoggedSet } from "./MovementFocusView";
import { SwapMovementModal } from "./SwapMovementModal";
import type { fillSessionFromPlan } from "@/lib/sessions/actions";

export type MovementCardProps = {
  sessionId: string;
  group: MovementGroup;
  tmKg: number | undefined;
  loggedItemIndices: ReadonlySet<number>;
  loggedSetIdByItemIndex: Readonly<Record<number, string>>;
  loggedSets: FocusLoggedSet[];
  priorBest: { heaviestWeight: number | null; bestE1rm: number | null } | undefined;
  addStrengthSet: (fd: FormData) => Promise<{ error?: string; ok?: true }>;
  fillFromPlan?: typeof fillSessionFromPlan | null;
  /** Parent-controlled: only the first card in a fresh session shows the session-level fill button. */
  showFillFromPlan: boolean;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
  /** Persistence key prefix — combined with movementId for localStorage. */
  persistKeyPrefix: string;
};

const RECAP_DELAY_MS = 4500;

export function MovementCard({
  sessionId,
  group,
  tmKg,
  loggedItemIndices,
  loggedSetIdByItemIndex,
  loggedSets,
  priorBest,
  addStrengthSet,
  fillFromPlan,
  showFillFromPlan,
  hapticsEnabled,
  timerSoundEnabled,
  persistKeyPrefix,
}: MovementCardProps) {
  const cardState = deriveCardState(group, loggedItemIndices);
  const complete = isMovementComplete(group, loggedItemIndices);

  const storageKey = `${persistKeyPrefix}:${group.movementId}`;

  // Compute the initial collapsed value. Server render uses card state
  // defaults; client mount syncs with localStorage so the user's
  // explicit toggles win across page reloads.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (cardState === "completed") return true;
    if (cardState === "not_started") return true;
    return false;
  });
  const userOverrodeRef = useRef(false);
  const autoCollapsedRef = useRef(false);
  const [swapOpen, setSwapOpen] = useState(false);
  // Hydrate from localStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      /* eslint-disable react-hooks/set-state-in-effect -- hydrate from storage on mount */
      if (raw === "open") {
        userOverrodeRef.current = true;
        setCollapsed(false);
      } else if (raw === "closed") {
        userOverrodeRef.current = true;
        setCollapsed(true);
      }
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  // Auto-collapse to recap once every set is logged. Latches via
  // autoCollapsedRef so re-expanding doesn't snap the card shut again.
  useEffect(() => {
    if (!complete) return;
    if (autoCollapsedRef.current) return;
    if (userOverrodeRef.current) return;
    const id = window.setTimeout(() => {
      autoCollapsedRef.current = true;
      setCollapsed(true);
    }, RECAP_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [complete]);

  const toggleCollapsed = () => {
    userOverrodeRef.current = true;
    setCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(storageKey, next ? "closed" : "open");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const total = group.itemIndices.length;
  const done = group.itemIndices.filter((i) => loggedItemIndices.has(i)).length;

  const chipColor =
    cardState === "completed"
      ? "var(--cp-success)"
      : cardState === "in_progress"
        ? "var(--cp-accent)"
        : "var(--cp-text-muted)";
  const chipLabel =
    cardState === "completed" ? "✓" : cardState === "in_progress" ? `${done}/${total}` : "·";

  // Summary line for the recap row.
  const summaryLine = (() => {
    if (loggedSets.length === 0) return null;
    const repList = loggedSets
      .filter((s) => s.reps != null && s.reps > 0)
      .map((s) => s.reps)
      .join("/");
    const topWeight = loggedSets.reduce(
      (max, s) => (s.weightKg != null && s.weightKg > max ? s.weightKg : max),
      0,
    );
    return `${loggedSets.length} sets · ${repList} reps${topWeight > 0 ? ` · top set ${topWeight} kg` : ""}`;
  })();

  return (
    <section
      data-testid={`movement-card-${group.movementId}`}
      data-state={cardState}
      data-collapsed={collapsed ? "true" : "false"}
      className="cp-card"
      style={{
        padding: 0,
        display: "grid",
        borderColor:
          cardState === "completed"
            ? "color-mix(in oklab, var(--cp-success) 40%, var(--cp-border))"
            : cardState === "in_progress"
              ? "color-mix(in oklab, var(--cp-accent) 40%, var(--cp-border))"
              : "var(--cp-border)",
      }}
    >
      <button
        type="button"
        onClick={toggleCollapsed}
        data-testid={`movement-card-header-${group.movementId}`}
        aria-expanded={!collapsed}
        style={{
          all: "unset",
          cursor: "pointer",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 15, flex: "1 1 auto" }}>
          {group.movementName}
        </span>
        {tmKg != null && (
          <span
            className="mono"
            style={{
              fontSize: 11,
              padding: "2px 6px",
              borderRadius: 6,
              background: "var(--cp-surface-soft)",
              color: "var(--cp-text-muted)",
              border: "1px solid var(--cp-border)",
            }}
          >
            TM {tmKg} kg
          </span>
        )}
        <span
          data-testid={`movement-card-chip-${group.movementId}`}
          className="mono"
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 999,
            background: `color-mix(in oklab, ${chipColor} 14%, transparent)`,
            color: chipColor,
            fontWeight: 700,
          }}
        >
          {chipLabel}
        </span>
        <span
          aria-hidden="true"
          style={{ fontSize: 14, color: "var(--cp-text-muted)" }}
        >
          {collapsed ? "▸" : "▾"}
        </span>
      </button>

      {collapsed && cardState === "completed" && summaryLine && (
        <div
          data-testid={`movement-card-recap-${group.movementId}`}
          style={{
            padding: "0 14px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            fontSize: 12,
            color: "var(--cp-text-muted)",
          }}
        >
          <span style={{ color: "var(--cp-success)", fontWeight: 700 }}>✓</span>
          <span style={{ flex: "1 1 auto" }}>{summaryLine}</span>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="cp-btn"
            style={{ padding: "4px 10px", fontSize: 11 }}
            data-testid={`movement-card-edit-${group.movementId}`}
          >
            Edit sets
          </button>
        </div>
      )}

      {!collapsed && (
        <div style={{ padding: "0 14px 14px", display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {fillFromPlan && showFillFromPlan && cardState !== "completed" && (
              <FillFromPlanButton
                fillFromPlan={fillFromPlan}
                sessionId={sessionId}
              />
            )}
            <button
              type="button"
              onClick={() => setSwapOpen(true)}
              data-testid={`movement-card-swap-${group.movementId}`}
              className="cp-btn"
              style={{ padding: "6px 10px", fontSize: 11 }}
            >
              Swap movement
            </button>
          </div>
          <MovementFocusView
            sessionId={sessionId}
            group={group}
            tmKg={tmKg}
            loggedItemIndices={loggedItemIndices}
            loggedSetIdByItemIndex={loggedSetIdByItemIndex}
            loggedSets={loggedSets}
            priorBest={priorBest}
            addStrengthSet={addStrengthSet}
            hapticsEnabled={hapticsEnabled}
            timerSoundEnabled={timerSoundEnabled}
          />
        </div>
      )}

      <SwapMovementModal
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        sessionId={sessionId}
        original={{ id: group.movementId, displayName: group.movementName }}
        onSwapped={() => {
          setSwapOpen(false);
        }}
      />
    </section>
  );
}

function FillFromPlanButton({
  fillFromPlan,
  sessionId,
}: {
  fillFromPlan: typeof fillSessionFromPlan;
  sessionId: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setPending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("sessionId", sessionId);
      const result = await fillFromPlan(fd);
      if (result?.error) setError(result.error);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="cp-btn primary"
        disabled={pending}
        data-testid="movement-card-fill-from-plan"
        style={{ padding: "6px 10px", fontSize: 11 }}
      >
        {pending ? "Filling…" : "Same as planned"}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 11, color: "var(--cp-danger)" }}>
          {error}
        </span>
      )}
    </>
  );
}

// Re-export so callers don't need to know the underlying shape file.
export type { Prescription };
