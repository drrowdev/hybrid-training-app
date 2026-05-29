"use client";

/**
 * "+ Add off-plan movement" button + picker, extracted from
 * `MovementCardList` so the active-session page can render it either
 * inside the strength card list (the default for hybrid + strength
 * sessions) or AFTER the cardio block (Fix 3 of the active-session UX
 * overhaul — for pure-cardio sessions the in-list placement put the
 * +Add link before the workout itself, which read like the primary
 * CTA on an otherwise empty page).
 *
 * Pure-presentational shell over `addSessionMovementAction` — owns the
 * optimistic add → server confirm dance and surfaces a `onAdded`
 * callback so callers that want their own pending state can keep the
 * UI in sync without re-fetching.
 */

import { useState } from "react";
import { MovementPicker, type MovementSearchResult } from "@/components/movement-picker";
import { addSessionMovementAction } from "@/lib/sessions/session-movement-actions";

export type AddOffPlanMovementProps = {
  sessionId: string;
  /**
   * Called after a successful add so the parent can drop the picked
   * movement into its local pending list / refresh, etc. Optional —
   * the action also calls `revalidatePath` on the session page, so a
   * router refresh will eventually surface the new card anyway.
   */
  onAdded?: (movement: MovementSearchResult) => void;
};

export function AddOffPlanMovement({
  sessionId,
  onAdded,
}: AddOffPlanMovementProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePick = async (m: MovementSearchResult | null) => {
    if (!m || busy) return;
    setError(null);
    setBusy(true);
    setShowPicker(false);
    try {
      const result = await addSessionMovementAction(sessionId, m.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onAdded?.(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add movement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="add-off-plan-movement"
      style={{
        display: "grid",
        justifyItems: "center",
        gap: 6,
        padding: "8px 0",
      }}
    >
      {!showPicker ? (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setShowPicker(true);
          }}
          data-testid="movement-card-add"
          disabled={busy}
          style={{
            // Small text-link-style button so it doesn't compete with the
            // prescribed work above. Reporting an off-plan movement is
            // rare; the button shouldn't read as a primary action.
            background: "transparent",
            border: "1px dashed var(--cp-border)",
            borderRadius: 999,
            padding: "4px 14px",
            fontSize: 12,
            color: "var(--cp-text-muted)",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Adding…" : "+ Add off-plan movement"}
        </button>
      ) : (
        <div
          className="cp-card"
          style={{ padding: 12, display: "grid", gap: 8, width: "100%", maxWidth: 520 }}
        >
          <MovementPicker
            name="__add_movement"
            onChange={handlePick}
            placeholder="Search the catalog…"
          />
          <button
            type="button"
            onClick={() => setShowPicker(false)}
            className="cp-btn"
            style={{ padding: "6px 10px", fontSize: 11 }}
          >
            × cancel
          </button>
        </div>
      )}
      {error && (
        <div
          role="alert"
          data-testid="movement-card-add-error"
          style={{ fontSize: 12, color: "var(--cp-danger)" }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
