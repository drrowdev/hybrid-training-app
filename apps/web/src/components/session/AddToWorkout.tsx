"use client";

/**
 * Unified "+ Add to workout" entry point at the bottom of the in-progress
 * session detail page.
 *
 * Collapses three historical surfaces into one button:
 *   - "+ Add strength set" (the old AddStrengthSetForm card)
 *   - "+ Add cardio block" (the old AddCardioBlockForm card)
 *   - "+ Add off-plan movement" (the old AddOffPlanMovement pill)
 *
 * Behaviour:
 *   1. The default state is a single small pill button.
 *   2. Click reveals a 2-option chooser: Strength | Cardio.
 *   3. Strength → MovementPicker (no patternFilter) → on pick, call
 *      `addSessionMovementAction` so the picked movement renders as a
 *      new movement card with its own set-logging UI.
 *   4. Cardio → MovementPicker (patternFilter="cardio") + a single
 *      Duration field (required, >= 1 minute) → submit calls
 *      `addCardioBlock` with the picked movement's display_name +
 *      equipment as the modality string (matches the historical
 *      AddCardioBlockForm contract).
 *
 * Rationale: pure-cardio sessions had a different "+Add" affordance
 * (off-plan movement) from hybrid sessions (cardio block + strength
 * set), and neither was discoverable. One button keeps the page tail
 * predictable and lets the picker's `patternFilter` do the type-of-add
 * selection — the user already knows whether they did extra running or
 * an extra bench set.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MovementPicker,
  type MovementSearchResult,
} from "@/components/movement-picker";
import { addSessionMovementAction } from "@/lib/sessions/session-movement-actions";
import type { addCardioBlock as addCardioBlockAction } from "@/lib/sessions/actions";

type CardioAction = typeof addCardioBlockAction;
type Mode = "closed" | "menu" | "strength" | "cardio";

export type AddToWorkoutProps = {
  sessionId: string;
  cardioAction: CardioAction;
  /**
   * When set, opening the picker skips the Strength|Cardio chooser and
   * jumps straight to this modality's MovementPicker. Use it when the
   * session's modality is already known (a Quick Strength session opens
   * to strength; a pure-cardio session opens to cardio) so the user
   * doesn't re-pick a type they already chose. A small inline switch
   * still lets them reach the other modality. When omitted, the full
   * two-option chooser renders (the right call for hybrid sessions
   * where either add is equally likely).
   */
  primaryModality?: "strength" | "cardio";
  /**
   * Render the closed-state trigger as the prominent empty-state card
   * ("Pick movements to start logging") instead of the small pill. Used
   * on a fresh Quick Strength session so the logical thing to tap — the
   * big card — actually starts the add flow.
   */
  prominent?: boolean;
};

export function AddToWorkout({
  sessionId,
  cardioAction,
  primaryModality,
  prominent = false,
}: AddToWorkoutProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("closed");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [cardioMovement, setCardioMovement] =
    useState<MovementSearchResult | null>(null);
  const [cardioDurationMin, setCardioDurationMin] = useState<string>("");

  // Opening the flow honours `primaryModality` so a known-modality
  // session skips the redundant chooser. Falls back to the chooser.
  const openMode: Mode = primaryModality ?? "menu";

  const reset = () => {
    setMode("closed");
    setError(null);
    setCardioMovement(null);
    setCardioDurationMin("");
  };

  const handleStrengthPick = (m: MovementSearchResult | null) => {
    if (!m || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await addSessionMovementAction(sessionId, m.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      router.refresh();
    });
  };

  const handleCardioSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardioMovement) {
      setError("Pick a cardio modality first.");
      return;
    }
    const minutes = Number(cardioDurationMin);
    if (!Number.isFinite(minutes) || minutes < 1) {
      setError("Enter a duration in minutes (at least 1).");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("movementId", cardioMovement.id);
    fd.set("durationSec", String(Math.round(minutes * 60)));
    const modality =
      (
        (cardioMovement.equipment ?? "") +
        " " +
        (cardioMovement.display_name ?? "")
      )
        .trim()
        .slice(0, 40) || "other";
    fd.set("modality", modality);
    startTransition(async () => {
      const result = await cardioAction(fd);
      if (result?.error) {
        setError(result.error);
        return;
      }
      reset();
      router.refresh();
    });
  };

  if (mode === "closed") {
    if (prominent) {
      return (
        <div data-testid="add-to-workout">
          <button
            type="button"
            data-testid="add-to-workout-open"
            onClick={() => setMode(openMode)}
            className="cp-card"
            style={{
              width: "100%",
              padding: "18px 16px",
              display: "grid",
              gap: 6,
              justifyItems: "center",
              textAlign: "center",
              borderStyle: "dashed",
              cursor: "pointer",
              font: "inherit",
              color: "var(--cp-text)",
            }}
          >
            <span style={{ fontSize: 24, lineHeight: 1 }} aria-hidden="true">
              🏋️
            </span>
            <span
              style={{ fontSize: 14, fontWeight: 600, color: "var(--cp-text)" }}
            >
              Pick movements to start logging
            </span>
            <span style={{ fontSize: 12, color: "var(--cp-accent)" }}>
              Tap to add your first movement
            </span>
          </button>
        </div>
      );
    }
    return (
      <div
        data-testid="add-to-workout"
        style={{ display: "grid", justifyItems: "center", padding: "8px 0" }}
      >
        <button
          type="button"
          data-testid="add-to-workout-open"
          onClick={() => setMode(openMode)}
          style={pillButtonStyle}
        >
          + Add to workout
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="add-to-workout"
      data-mode={mode}
      className="cp-card"
      style={{
        padding: 12,
        display: "grid",
        gap: 10,
        maxWidth: 560,
        marginInline: "auto",
        width: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 600,
          }}
        >
          Add to workout
        </div>
        <button
          type="button"
          onClick={reset}
          data-testid="add-to-workout-cancel"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--cp-text-muted)",
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
          }}
        >
          × cancel
        </button>
      </div>

      {mode === "menu" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          <button
            type="button"
            data-testid="add-to-workout-pick-strength"
            onClick={() => setMode("strength")}
            style={chooserButtonStyle}
          >
            <span style={chooserTitleStyle}>Strength</span>
            <span style={chooserSubStyle}>set, exercise, accessory</span>
          </button>
          <button
            type="button"
            data-testid="add-to-workout-pick-cardio"
            onClick={() => setMode("cardio")}
            style={chooserButtonStyle}
          >
            <span style={chooserTitleStyle}>Cardio</span>
            <span style={chooserSubStyle}>run, bike, row, …</span>
          </button>
        </div>
      )}

      {mode === "strength" && (
        <div style={{ display: "grid", gap: 8 }}>
          <MovementPicker
            name="__add_strength_movement"
            placeholder="Search the catalog…"
            onChange={handleStrengthPick}
          />
          {pending && (
            <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
              Adding…
            </div>
          )}
          {primaryModality && (
            <button
              type="button"
              data-testid="add-to-workout-switch-cardio"
              onClick={() => {
                setError(null);
                setMode("cardio");
              }}
              style={switchLinkStyle}
            >
              + Add cardio instead
            </button>
          )}
        </div>
      )}

      {mode === "cardio" && (
        <form onSubmit={handleCardioSubmit} style={{ display: "grid", gap: 8 }}>
          <MovementPicker
            name="__add_cardio_movement"
            patternFilter="cardio"
            placeholder="Search cardio modalities…"
            onChange={setCardioMovement}
          />
          <label style={{ display: "grid", gap: 4 }}>
            <span
              style={{
                fontSize: 11,
                color: "var(--cp-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontWeight: 600,
              }}
            >
              Duration (min)
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              required
              value={cardioDurationMin}
              onChange={(e) => setCardioDurationMin(e.target.value)}
              data-testid="add-to-workout-cardio-duration"
              style={{
                width: "100%",
                minHeight: 40,
                padding: "0 12px",
                borderRadius: 10,
                border: "1px solid var(--cp-border)",
                background: "var(--cp-surface)",
                color: "var(--cp-text)",
                fontSize: 15,
              }}
            />
          </label>
          <button
            type="submit"
            disabled={pending || !cardioMovement}
            data-testid="add-to-workout-cardio-submit"
            className="cp-btn primary"
            style={{ minHeight: 40 }}
          >
            {pending ? "Adding…" : "Add cardio block"}
          </button>
          {primaryModality && (
            <button
              type="button"
              data-testid="add-to-workout-switch-strength"
              onClick={() => {
                setError(null);
                setMode("strength");
              }}
              style={switchLinkStyle}
            >
              + Add strength instead
            </button>
          )}
        </form>
      )}

      {error && (
        <div
          role="alert"
          data-testid="add-to-workout-error"
          style={{ fontSize: 12, color: "var(--cp-danger)" }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

const pillButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px dashed var(--cp-border)",
  borderRadius: 999,
  padding: "6px 16px",
  fontSize: 13,
  color: "var(--cp-text-muted)",
  cursor: "pointer",
};

const chooserButtonStyle: React.CSSProperties = {
  display: "grid",
  gap: 2,
  padding: "12px 14px",
  background: "var(--cp-surface)",
  border: "1px solid var(--cp-border)",
  borderRadius: 10,
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
};

const chooserTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "var(--cp-text)",
};

const chooserSubStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
};

const switchLinkStyle: React.CSSProperties = {
  justifySelf: "start",
  background: "transparent",
  border: "none",
  color: "var(--cp-link)",
  fontSize: 12,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  padding: "2px 0",
};
