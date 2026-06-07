/**
 * Focus-muscle chip multi-select.
 *
 * Reusable presentational component used by:
 *  - the block wizard Step 2 (`Step2Focus.tsx`)
 *  - the Plan-page "Edit focus" modal (`FocusMusclesEditor.tsx`)
 *
 * Behaviour:
 *  - Multi-select with FOCUS_MUSCLE_MAX (=2) cap. When the user taps a
 *    third chip the oldest selection is dropped — the reducer / parent
 *    owns that policy, this component just emits toggle events.
 *  - "Shoulders" appears as a parent chip that expands inline to show
 *    the three delt variants (medial / rear / front). The underlying
 *    enum exposes them separately but users think "shoulders" —
 *    expanding inline (not a nested modal) keeps the picker
 *    self-explanatory.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import {
  FOCUS_MUSCLE_LABEL,
  SHOULDER_FOCUS_VARIANTS,
  type FocusMuscle,
} from "@/lib/planner/focus-muscles";

const SHOULDER_VARIANT_SET: ReadonlySet<string> = new Set(SHOULDER_FOCUS_VARIANTS);

/**
 * Single-row chip layout, with "Shoulders" rendered as one parent chip
 * that toggles a sub-row. Order is intentional: arms first (most-
 * specialised aesthetic muscles), then shoulders, then everything else.
 */
const ROW_LAYOUT: ReadonlyArray<{ kind: "chip"; muscle: FocusMuscle } | { kind: "shoulders" }> = [
  { kind: "chip", muscle: "biceps" },
  { kind: "chip", muscle: "triceps" },
  { kind: "shoulders" },
  { kind: "chip", muscle: "calves" },
  { kind: "chip", muscle: "glutes" },
  { kind: "chip", muscle: "upper_chest" },
  { kind: "chip", muscle: "traps" },
  { kind: "chip", muscle: "forearms" },
  { kind: "chip", muscle: "quads" },
  { kind: "chip", muscle: "hamstrings" },
];

export function FocusMuscleChips({
  selected,
  onToggle,
}: {
  selected: readonly string[];
  onToggle: (muscle: string) => void;
}): React.ReactElement {
  const anyShoulderSelected = selected.some((m) => SHOULDER_VARIANT_SET.has(m));
  // Surface the chosen delt variant(s) on the collapsed parent chip so the
  // selection stays visible without opening the dropdown.
  const selectedShoulderLabel =
    SHOULDER_FOCUS_VARIANTS.filter((m) => selected.includes(m))
      .map((m) => FOCUS_MUSCLE_LABEL[m])
      .join(", ") || null;
  const [shouldersOpen, setShouldersOpen] = useState<boolean>(false);
  const shouldersRef = useRef<HTMLSpanElement>(null);

  // Close the shoulders dropdown on an outside click or Escape so it
  // behaves like a normal menu rather than a sticky sub-row.
  useEffect(() => {
    if (!shouldersOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!shouldersRef.current?.contains(e.target as Node)) {
        setShouldersOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShouldersOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [shouldersOpen]);

  return (
    <div data-testid="focus-muscle-chips" style={containerStyle}>
      <div style={chipsRowStyle}>
        {ROW_LAYOUT.map((entry) => {
          if (entry.kind === "shoulders") {
            return (
              <span
                key="shoulders"
                ref={shouldersRef}
                style={{ position: "relative", display: "inline-flex" }}
              >
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={shouldersOpen}
                  aria-pressed={anyShoulderSelected}
                  onClick={() => setShouldersOpen((v) => !v)}
                  style={chipStyle(anyShoulderSelected)}
                  data-testid="focus-chip-shoulders"
                >
                  {selectedShoulderLabel ?? "Shoulders"}{" "}
                  <span
                    aria-hidden="true"
                    style={{
                      opacity: 0.7,
                      marginLeft: 2,
                      display: "inline-block",
                      transition: "transform .15s",
                      transform: shouldersOpen ? "rotate(180deg)" : "none",
                    }}
                  >
                    ⌄
                  </span>
                </button>
                {shouldersOpen && (
                  <div
                    role="menu"
                    style={dropdownStyle}
                    data-testid="focus-shoulders-subrow"
                  >
                    {SHOULDER_FOCUS_VARIANTS.map((m) => {
                      const isSelected = selected.includes(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={isSelected}
                          onClick={() => onToggle(m)}
                          style={chipStyle(isSelected, true)}
                          data-testid={`focus-chip-${m}`}
                          data-selected={isSelected ? "true" : "false"}
                        >
                          {FOCUS_MUSCLE_LABEL[m]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </span>
            );
          }
          const isSelected = selected.includes(entry.muscle);
          return (
            <button
              key={entry.muscle}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggle(entry.muscle)}
              style={chipStyle(isSelected)}
              data-testid={`focus-chip-${entry.muscle}`}
              data-selected={isSelected ? "true" : "false"}
            >
              {FOCUS_MUSCLE_LABEL[entry.muscle]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const chipsRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

/**
 * Anchored dropdown beneath the Shoulders chip — the delt variants open
 * directly under where the user clicked rather than as a full-width row
 * below the wrapped chip grid.
 */
const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  left: 0,
  zIndex: 30,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 8,
  borderRadius: 12,
  background: "var(--cp-surface)",
  border: "1px solid var(--cp-border)",
  boxShadow: "var(--cp-shadow, 0 8px 24px rgba(0,0,0,0.18))",
  minWidth: "max-content",
};

function chipStyle(selected: boolean, sub: boolean = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    fontSize: sub ? 12 : 13,
    fontWeight: 600,
    padding: sub ? "6px 12px" : "8px 14px",
    borderRadius: 999,
    background: selected ? "var(--cp-accent)" : "var(--cp-surface)",
    color: selected ? "var(--cp-accent-fg)" : "var(--cp-text)",
    border: `1px solid ${selected ? "var(--cp-accent)" : "var(--cp-border)"}`,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background .15s, color .15s, border-color .15s",
  };
}
