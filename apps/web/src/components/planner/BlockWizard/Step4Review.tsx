/**
 * Step 4 — Review. Renders the "Why this match?" paragraph + the per-week
 * progression list. Both blocks ship the mockup's exact copy verbatim.
 *
 * Per-archetype week labels + details come from a static map mirroring
 * the mockup's `baseStrengthWaves` / `baseHypertrophyWaves` / etc. Keeping
 * them here (as opposed to in the lib/) lets the engine's planned-session
 * generator stay decoupled from wizard copy.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { WizardState, WizardAction } from "@/lib/planner/wizard/wizard-state";
import type { ResolvedArchetype } from "@/lib/planner/wizard/wizard-mapping";
import type { EquipmentPreset } from "@/lib/settings/equipment-schema";
import type { AccessoryVolumeLevel } from "@/lib/planner/accessory-volume";
import {
  accessoryVolumeApplicability,
  accessoryVolumeRedundancy,
  recommendedAccessoryVolume,
  type AccessoryVolumeRecommendation,
  type AccessoryVolumeRedundancy,
} from "@/lib/planner/accessory-volume-recommendation";
import { resolveSecondaryFocus } from "@/lib/planner/secondary-focus";
import type {
  EstimateAccessoryVolumeInput,
  EstimateAccessoryVolumeResult,
} from "@/lib/planner/estimate-actions";

type Wave = { label: string; detail: string };

// ── Bodyweight-only wave copy ─────────────────────────────────────────────
// BW users don't use a barbell or training maxes — progression rides on
// RIR, eccentric tempo, and family rotation (see bw-family-rotation.ts).
// These wave templates mirror the loaded-strength shape (ramp → build →
// push → recover) but swap barbell-flavoured copy for BW-native cues.

const BW_STRENGTH_WAVES: Wave[] = [
  {
    label: "Ramp in — find your tempo and clean reps",
    detail:
      "Foundation week. Find your sweet spot at the prescribed RIR, get clean reps with controlled eccentrics.",
  },
  {
    label: "Build — add reps or holds each session",
    detail:
      "Same movements, more reps or longer holds — same RIR, more accumulated TUT.",
  },
  {
    label: "Push — your hardest week",
    detail:
      "Top sets approach RIR 1 with the longest holds and slowest tempos of the block. This is where progression unlocks.",
  },
  {
    label: "Recover — pull back, sleep more",
    detail:
      "Half the sets at higher RIR. Fatigue clears so the harder work locks in.",
  },
];

const BW_HYPERTROPHY_WAVES: Wave[] = [
  {
    label: "Ramp in — find your tempo and clean reps",
    detail:
      "Moderate-RIR sets with longer eccentrics and accessory variants. Leave 1–2 reps in the tank — this is your foundation.",
  },
  {
    label: "Build — add a working set per movement",
    detail:
      "One more working set per movement at the same tempo and RIR. More total work this week without changing the lifts.",
  },
  {
    label: "Push — most sets of the block",
    detail: "Highest weekly set count of the block — the top of your recoverable volume.",
  },
  {
    label: "Recover — half the volume, full sleep",
    detail:
      "Half the sets at the same RIR. Lets the volume sink in and muscles catch up before the next block.",
  },
];

const BW_HYBRID_WAVES: Wave[] = [
  {
    label: "Ramp in — both engines at low load",
    detail:
      "Moderate-RIR sets with clean tempos. Cardio is steady Z2 — easy aerobic dose that won't tax the lifts.",
  },
  {
    label: "Build — add reps + minutes",
    detail:
      "Same movements, more reps or longer holds. Cardio sessions also run longer.",
  },
  {
    label: "Push — your hardest week",
    detail:
      "Reps and holds bumped, but RIR stays 2 to keep cardio fresh. One harder VO2 cardio session gets added.",
  },
  {
    label: "Recover — lighter on both",
    detail:
      "Half the sets, half the cardio minutes. Same tempo and pace — reset before next block.",
  },
];

function strengthWaves(strengthHypDays: number, isBw: boolean, accessoryTilt = false): Wave[] {
  const base: Wave[] = isBw
    ? BW_STRENGTH_WAVES.map((w) => ({ ...w }))
    : [
        {
          label: "Ramp in — get your bar speed back",
          detail:
            "Sets of 5 at moderate weight. Foundation week — rehearse the lifts and find your groove before adding load.",
        },
        {
          label: "Build — heavier top sets each session",
          detail:
            "Sets of 3 at heavier weight. Same lifts, fewer reps, more weight on the bar each time you train.",
        },
        {
          label: "Push — your hardest week",
          detail:
            "Top single up to ~95% of your training max — the heaviest work of the block. This is where the gains from the earlier weeks show up.",
        },
        {
          label: "Recover — lighter loads, sleep more",
          detail:
            "Half the sets at the same weights. Fatigue clears so the heavy work locks in.",
        },
      ];
  if (accessoryTilt) {
    // Muscle secondary: hypertrophy is added as accessory volume ON each
    // strength day (ADR 0020), not as a separate day. Describe it that way.
    const tiltBlurb = isBw
      ? "accessory variants and longer-eccentric back-off sets added after the main work on every strength day"
      : "extra accessory sets at moderate weights added after the main work on every strength day";
    return base.map((w, i) => {
      if (i < 3)
        return { ...w, detail: w.detail + ` Plus ${tiltBlurb} — same dose every week.` };
      return {
        ...w,
        detail: w.detail + ` The accessory volume also drops back during recovery.`,
      };
    });
  }
  if (strengthHypDays === 0) return base;
  const hypBlurb = isBw
    ? `moderate-RIR set${strengthHypDays === 1 ? "" : "s"} with longer eccentrics and accessory variants`
    : `hypertrophy day${strengthHypDays === 1 ? "" : "s"} at moderate weights with extra accessory work`;
  return base.map((w, i) => {
    if (i < 3)
      return {
        ...w,
        detail:
          w.detail +
          ` Plus ${strengthHypDays} ${hypBlurb} — same dose every week.`,
      };
    return {
      ...w,
      detail:
        w.detail +
        ` Hypertrophy day${strengthHypDays === 1 ? "" : "s"} also drop${strengthHypDays === 1 ? "s" : ""} to half the sets.`,
    };
  });
}

function hypertrophyWaves(hypStrengthDays: number, isBw: boolean): Wave[] {
  const base: Wave[] = isBw
    ? BW_HYPERTROPHY_WAVES.map((w) => ({ ...w }))
    : [
        {
          label: "Ramp in — find your working weights",
          detail:
            "4 working sets per lift at 6–10 reps. Moderate weights, leave 1–2 reps in the tank — this is your foundation.",
        },
        {
          label: "Build — add a working set per lift",
          detail:
            "5 working sets per lift at the same reps and weights. More total work this week without changing the lifts.",
        },
        {
          label: "Push — most sets of the block",
          detail: "Highest weekly set count of the block — the top of your recoverable volume.",
        },
        {
          label: "Recover — half the volume, full sleep",
          detail:
            "Half the sets, same weights. Lets the volume sink in and muscles catch up before the next block.",
        },
      ];
  if (hypStrengthDays === 0) return base;
  const strengthBlurb = isBw
    ? `low-RIR strength day${hypStrengthDays === 1 ? "" : "s"} with the hardest progressions so you don't lose absolute strength`
    : `strength day${hypStrengthDays === 1 ? "" : "s"} keeping a heavy top set (≥85% TM) so you don't lose absolute strength`;
  return base.map((w, i) => {
    if (i < 3)
      return {
        ...w,
        detail: w.detail + ` Plus ${hypStrengthDays} ${strengthBlurb}.`,
      };
    return {
      ...w,
      detail:
        w.detail +
        ` Strength day${hypStrengthDays === 1 ? "" : "s"} also drop${hypStrengthDays === 1 ? "s" : ""} to half the sets.`,
    };
  });
}

function enduranceWaves(
  strength: number,
  secondary: WizardState["secondary"],
  isBw: boolean,
): Wave[] {
  const base: Wave[] = [
    {
      label: "Build — easy aerobic base",
      detail:
        "Most sessions are easy Z2 — a pace where you can hold a conversation. Builds your aerobic engine and recovery capacity.",
    },
    {
      label: "Stretch — longer Z2 sessions",
      detail:
        "Same shape as week 1, but each easy session runs longer. More time at conversational pace adds aerobic depth.",
    },
    {
      label: "Push — add the hard interval day",
      detail:
        "Easy Z2 sessions stay anchored. One harder VO2 day gets added (e.g. 4×4 min near max effort) for top-end fitness.",
    },
    {
      label: "Recover — easy minutes only",
      detail:
        "Half the minutes, same easy pace, no hard intervals. Lets the volume sink in before the next block.",
    },
  ];
  if (strength === 0) return base;
  const liftType = isBw
    ? secondary === "strength"
      ? `low-RIR bodyweight session${strength === 1 ? "" : "s"} with the hardest progressions`
      : secondary === "muscle"
        ? `moderate-RIR bodyweight session${strength === 1 ? "" : "s"} with extra accessory work`
        : `bodyweight maintenance session${strength === 1 ? "" : "s"} at low RIR`
    : secondary === "strength"
      ? `heavy strength session${strength === 1 ? "" : "s"} (singles/triples ≥ 90% TM)`
      : secondary === "muscle"
        ? `maintenance lift${strength === 1 ? "" : "s"} with extra accessory work`
        : `maintenance lift${strength === 1 ? "" : "s"} at heavy intensity`;
  return base.map((w, i) => {
    if (i < 3)
      return {
        ...w,
        detail:
          w.detail + ` Plus ${strength} ${liftType} — same dose every week to preserve strength.`,
      };
    return {
      ...w,
      detail:
        w.detail +
        ` Lift${strength === 1 ? "" : "s"} also drop${strength === 1 ? "s" : ""} to half the sets.`,
    };
  });
}

const HYBRID_WAVES: Wave[] = [
  {
    label: "Ramp in — both engines at low load",
    detail:
      "Sets of 5 at moderate weight. Cardio is steady Z2 — easy aerobic dose that won't tax the lifts.",
  },
  {
    label: "Build — add weight + minutes",
    detail: "Same sets of 5, a bit more weight on the bar. Cardio sessions also run longer.",
  },
  {
    label: "Push — your hardest week",
    detail:
      "Top set rises but stays ≤85% of your training max (cardio-safe). One harder VO2 cardio session gets added.",
  },
  {
    label: "Recover — lighter on both",
    detail:
      "Half the sets, half the cardio minutes. Same weights and pace — reset before next block.",
  },
];

const HYBRID_MUSCLE_WAVES: Wave[] = [
  {
    label: "Ramp in — both engines at low load",
    detail:
      "6–10 reps per set at moderate weight, leaving 1–2 reps in the tank. Cardio is steady Z2 — easy on the legs.",
  },
  {
    label: "Build — add weight + minutes",
    detail: "Same exercises and weights, one more working set per lift. Cardio sessions also run longer.",
  },
  {
    label: "Push — your hardest week",
    detail:
      "Top set rises but stays ≤85% of your training max (cardio-safe). One harder VO2 cardio session gets added.",
  },
  {
    label: "Recover — lighter on both",
    detail:
      "Half the sets, half the cardio minutes. Same weights and pace — your body catches up.",
  },
];

const REBUILD_WAVES: Wave[] = [
  {
    label: "Ease in — pain-free range only",
    detail:
      "Top set capped at ~60% of your training max. Light reintroduction — the goal is smooth movement, not heavy lifts.",
  },
  {
    label: "Step up — modest load progression",
    detail:
      "Bump top set to ~70%. Tendons start adapting; heavy slow resistance and isometric holds on the dedicated tendon days.",
  },
  {
    label: "Consolidate — hold the new range",
    detail:
      "Top set caps at 80% — the upper limit for this block. Stay here to let tendons catch up to your strength.",
  },
  {
    label: "Recover — back off to feel-good loads",
    detail: "Half the sets, same weights. Lets tendons catch up before the next block.",
  },
];

const BW_REBUILD_WAVES: Wave[] = [
  {
    label: "Ease in — pain-free range only",
    detail:
      "Easiest regression that still hits the pattern. The goal is smooth, pain-free movement — not progression.",
  },
  {
    label: "Step up — modest progression",
    detail:
      "Step up one node where it feels clean. Tendons start adapting; heavy slow resistance and isometric hold sessions on the dedicated tendon days.",
  },
  {
    label: "Consolidate — hold the new range",
    detail:
      "Stay at the same node — this is the upper limit for this block. Lets tendons catch up to your strength.",
  },
  {
    label: "Recover — back off to feel-good progressions",
    detail: "Half the sets at the easier regression. Lets tendons catch up before the next block.",
  },
];

const MAINTENANCE_WAVES: Wave[] = [
  {
    label: "Steady — keep what you have",
    detail:
      "Submaximal lifts and short Z2 sessions. Goal is to keep what you have, not add anything.",
  },
  {
    label: "Steady — keep what you have",
    detail: "Same shape as week 1. Two weeks total, then return to a full block.",
  },
];

const BW_MAINTENANCE_WAVES: Wave[] = [
  {
    label: "Steady — keep what you have",
    detail:
      "Moderate-RIR bodyweight sets and short Z2 sessions. Goal is to keep what you have, not add anything.",
  },
  {
    label: "Steady — keep what you have",
    detail: "Same shape as week 1. Two weeks total, then return to a full block.",
  },
];

function wavesFor(state: WizardState, a: ResolvedArchetype, isBw: boolean): Wave[] {
  if (a.id === "strength_anchor")
    return strengthWaves(a.sessions.hypertrophy, isBw, a.accessoryEmphasis === "hypertrophy");
  if (a.id === "hypertrophy_anchor") return hypertrophyWaves(a.sessions.strength, isBw);
  if (a.id === "endurance_anchor") return enduranceWaves(a.sessions.strength, state.secondary, isBw);
  if (a.id === "concurrent_hybrid") {
    if (isBw) return BW_HYBRID_WAVES;
    return state.goal === "muscle" || state.secondary === "muscle" ? HYBRID_MUSCLE_WAVES : HYBRID_WAVES;
  }
  if (a.id === "rebuild") return isBw ? BW_REBUILD_WAVES : REBUILD_WAVES;
  if (a.id === "maintenance") return isBw ? BW_MAINTENANCE_WAVES : MAINTENANCE_WAVES;
  return [];
}

function whyMatchText(state: WizardState, a: ResolvedArchetype, isBw: boolean): string {
  const h = a.sessions.hypertrophy;
  const c = a.sessions.cardio;
  const s = a.sessions.strength;
  if (a.id === "concurrent_hybrid") {
    return isBw
      ? "Hybrid Focus keeps bodyweight strength at RIR 2 so heavy training doesn't sap your cardio sessions. The aerobic side runs one easy Z2 and one harder VO2 / threshold day — protects both qualities without competing."
      : "Hybrid Focus caps the top set so heavy lifting doesn’t sap your cardio sessions. The aerobic side runs one easy Z2 and one harder VO2 / threshold day — protects both qualities without competing.";
  }
  if (a.id === "strength_anchor") {
    if (a.accessoryEmphasis === "hypertrophy" && c === 0)
      return isBw
        ? "Strength Focus runs a 4-week progression on the main bodyweight families — tempos slow and holds lengthen each week, peaking in week 3. Your muscle secondary adds hypertrophy accessory volume onto every strength day — extra back-off and accessory work after the heavy sets — so you build muscle without spending a separate day or diluting the strength signal."
        : "Strength Focus runs a 4-week intensity wave on the main lifts — top sets get heavier each week, peaking in week 3. Your muscle secondary adds hypertrophy accessory volume onto every strength day — extra accessory work after the heavy sets — so you build muscle without spending a separate day or diluting the strength signal.";
    if (h > 0 && c === 0)
      return isBw
        ? "Strength Focus runs a 4-week progression on the main bodyweight families — tempos slow and holds lengthen each week, peaking in week 3. The extra hypertrophy days add muscle without competing for the strength signal — moderate-RIR work and accessory variants on different days from your hardest sessions."
        : "Strength Focus runs a 4-week intensity wave on the main lifts — top sets get heavier each week, peaking in week 3. The extra hypertrophy days add muscle without competing for the strength signal — moderate weights and accessory work on different days from your heavy lifts.";
    if (c > 0)
      return isBw
        ? "Strength Focus runs a 4-week progression on the main bodyweight families. Easy cardio fills the remaining days for recovery and aerobic base — kept light so it doesn't compete with the strength signal."
        : "Strength Focus runs a 4-week intensity wave on the main lifts. Easy cardio fills the remaining days for recovery and aerobic base — kept light so it doesn’t compete with the strength signal.";
    return isBw
      ? "Strength Focus runs a 4-week progression on the main bodyweight families — tempos slow and holds lengthen each week, peaking in week 3. Single-focus block: full rest on the other days so recovery goes entirely into the work."
      : "Strength Focus runs a 4-week intensity wave on the main lifts — top sets get heavier each week, peaking in week 3. Single-focus block: full rest on the other days so recovery goes entirely into the lifts.";
  }
  if (a.id === "hypertrophy_anchor") {
    if (s > 0 && c === 0)
      return isBw
        ? "Hypertrophy Focus drives per-muscle volume across the block — same movements and tempos, more sets each week. The extra strength days keep the hardest progressions in the picture so you don't lose absolute strength while volume drives growth."
        : "Hypertrophy Focus drives per-muscle volume across the block — same exercises and weights, more sets each week. The extra strength days keep heavy lifting in the picture so you don’t lose absolute strength while volume drives growth.";
    if (c > 0)
      return isBw
        ? "Hypertrophy Focus drives per-muscle volume using compound bodyweight movements + accessory variants that fill the gaps compounds miss. Easy cardio fills the remaining days at a recovery dose."
        : "Hypertrophy Focus drives per-muscle volume using compound + machine isolation work, with accessory pools that fill the gaps compounds miss. Easy cardio fills the remaining days at a recovery dose.";
    return isBw
      ? "Hypertrophy Focus drives per-muscle volume using compound bodyweight movements + accessory variants that fill the gaps compounds miss. Single-focus block: full rest on the other days so muscles have time to grow."
      : "Hypertrophy Focus drives per-muscle volume using compound + machine isolation work, with accessory pools that fill the gaps compounds miss. Single-focus block: full rest on the other days so muscles have time to grow.";
  }
  if (a.id === "endurance_anchor") {
    if (s > 0)
      return isBw
        ? "Endurance Focus runs a polarized week (long Z2 + VO2 intervals) and holds strength with two low-RIR bodyweight sessions — hard work at low frequency preserves strength while cardio leads."
        : "Endurance Focus runs a polarized week (long Z2 + VO2 intervals) and holds strength with two heavy sessions — heavy work at low frequency preserves strength while cardio leads.";
    return "Endurance Focus runs a polarized week — easier Z2 sessions for aerobic base, with one harder VO2 / threshold day for top-end fitness. Single-focus block: pure cardio, no strength work.";
  }
  if (a.id === "rebuild")
    return isBw
      ? "Rebuild keeps progressions at sub-maximal nodes and adds dedicated heavy slow resistance and isometric hold sessions. Designed to load tendons and joints safely, not to chase progression."
      : "Rebuild caps top set at 80% of your training max and adds dedicated heavy slow resistance and isometric hold sessions. Designed to load tendons and joints safely, not to chase progression.";
  if (a.id === "maintenance")
    return "Two-week maintenance block. Strength and aerobic base are held at sub-adaptation volume — protects what you have without spending recovery on adaptation.";
  return "";
}

const ACCESSORY_VOLUME_OPTIONS: {
  level: AccessoryVolumeLevel;
  label: string;
  blurb: string;
}[] = [
  {
    level: "low",
    label: "Low",
    blurb:
      "Just the essentials: your main lifts plus a couple of key accessories. Best when you're short on time or recovery. Keeps strength; muscle growth is slower.",
  },
  {
    level: "medium",
    label: "Medium",
    blurb:
      "Balanced accessory work to build muscle alongside your main lifts. The default.",
  },
  {
    level: "high",
    label: "High",
    blurb:
      "Extra accessory volume to push muscle growth. Best when you have time and recovery to spare.",
  },
];

/** Server action prop type — the read-only per-level duration estimator. */
export type EstimateAccessoryVolumeAction = (
  input: EstimateAccessoryVolumeInput,
) => Promise<EstimateAccessoryVolumeResult>;

/**
 * ADR 0024 (+ addendum) — accessory-volume segmented control. Three options
 * (Low / Medium / High) with an always-visible explanation of the current
 * choice (acts as a touch-friendly tooltip). `medium` is the byte-identical
 * default. Only the accessory budget moves; main lifts + cardio are untouched.
 *
 * The addendum adds: a live ballpark time estimate under each level, an
 * engine-recommended pick (chip + reason), an honest "Low == Medium here" note
 * on archetypes whose accessory base is already minimal, and a DISABLED state
 * for archetypes that ship zero accessories (Maintenance) so the control is
 * still visible — never silently missing.
 */
function AccessoryVolumeControl({
  value,
  onChange,
  recommendation,
  disabled,
  estimates,
  estimateLoading,
  redundancy,
}: {
  value: AccessoryVolumeLevel;
  onChange: (level: AccessoryVolumeLevel) => void;
  recommendation: AccessoryVolumeRecommendation | null;
  disabled: boolean;
  estimates: Record<AccessoryVolumeLevel, number | null> | null;
  estimateLoading: boolean;
  redundancy: AccessoryVolumeRedundancy;
}): React.ReactElement {
  const active =
    ACCESSORY_VOLUME_OPTIONS.find((o) => o.level === value) ??
    ACCESSORY_VOLUME_OPTIONS[1]!;
  const levelLabel = (level: AccessoryVolumeLevel): string =>
    ACCESSORY_VOLUME_OPTIONS.find((o) => o.level === level)?.label ?? level;
  // Only apply redundancy once the live estimate has resolved (no flicker
  // against a stale config while a new estimate is in flight).
  const isRedundant = (level: AccessoryVolumeLevel): boolean =>
    !estimateLoading && redundancy.redundant.has(level);
  const anyRedundant = !estimateLoading && redundancy.redundant.size > 0;
  // If the recommended level turns out redundant, move the ★ to the leanest
  // level that yields the same session so we never recommend a greyed-out level.
  const effectiveRecLevel: AccessoryVolumeLevel | null = recommendation
    ? isRedundant(recommendation.level)
      ? (redundancy.equivalentLevel[recommendation.level] ?? recommendation.level)
      : recommendation.level
    : null;
  const recLabel = effectiveRecLevel ? levelLabel(effectiveRecLevel) : null;
  const minutesLabel = (level: AccessoryVolumeLevel): string | null => {
    if (estimateLoading) return "…";
    const m = estimates?.[level];
    return typeof m === "number" ? `~${m} min` : null;
  };
  return (
    <section
      style={reviewCardStyle}
      data-testid="accessory-volume-control"
      aria-disabled={disabled || undefined}
    >
      <h3 style={cardHeadStyle}>Accessory volume</h3>
      <div style={{ ...cardBodyStyle, opacity: disabled ? 0.6 : 1 }}>
        <div
          role="radiogroup"
          aria-label="Accessory volume"
          style={{ display: "flex", gap: 8, marginBottom: 10 }}
        >
          {ACCESSORY_VOLUME_OPTIONS.map((o) => {
            const selected = o.level === value;
            const isRecommended = effectiveRecLevel === o.level;
            const mins = minutesLabel(o.level);
            const levelRedundant = isRedundant(o.level);
            const levelDisabled = disabled || levelRedundant;
            const equivalentLabel = levelRedundant
              ? levelLabel(redundancy.equivalentLevel[o.level] ?? o.level)
              : null;
            return (
              <button
                key={o.level}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={
                  isRecommended ? `${o.label} (recommended)` : o.label
                }
                disabled={levelDisabled}
                title={
                  levelRedundant && equivalentLabel
                    ? `Same workout as ${equivalentLabel} — no extra accessory work fits at this setting.`
                    : undefined
                }
                data-testid={`accessory-volume-${o.level}`}
                data-recommended={isRecommended ? "true" : undefined}
                data-redundant={levelRedundant ? "true" : undefined}
                onClick={() => !levelDisabled && onChange(o.level)}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                  padding: "9px 6px",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: levelDisabled ? "default" : "pointer",
                  opacity: levelRedundant ? 0.45 : 1,
                  border: selected
                    ? "1px solid var(--cp-accent)"
                    : isRecommended
                      ? "1px solid var(--cp-accent)"
                      : "1px solid var(--cp-border)",
                  background: selected
                    ? "var(--cp-accent-soft, var(--cp-surface))"
                    : "var(--cp-surface)",
                  color: selected ? "var(--cp-accent)" : "var(--cp-text)",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  {o.label}
                  {isRecommended && (
                    <span
                      aria-hidden="true"
                      data-testid={`accessory-volume-rec-chip-${o.level}`}
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        padding: "1px 5px",
                        borderRadius: 999,
                        background: "var(--cp-accent)",
                        color: "var(--cp-accent-fg)",
                      }}
                    >
                      ★
                    </span>
                  )}
                </span>
                {mins && (
                  <span
                    data-testid={`accessory-volume-est-${o.level}`}
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: selected
                        ? "var(--cp-accent)"
                        : "var(--cp-text-muted)",
                    }}
                  >
                    {mins}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p
          aria-live="polite"
          style={{ margin: 0, fontSize: 12.5, color: "var(--cp-text-muted)", lineHeight: 1.5 }}
        >
          {active.blurb}
        </p>
        {!disabled && (estimates !== null || estimateLoading) && (
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
            Times are a rough estimate for one strength workout — main lifts,
            warm-ups, rest and accessories. Cardio days aren&apos;t affected by this
            setting.
          </p>
        )}
        {!disabled && anyRedundant && (
          <p
            data-testid="accessory-volume-redundant-note"
            style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--cp-text-muted)", lineHeight: 1.5 }}
          >
            Greyed-out levels would produce the same workout as a lower one —
            either the session is already at its time limit, or there&apos;s no
            extra accessory work to add at that setting. Pick a focus muscle to
            target specific areas.
          </p>
        )}
        {!disabled && recommendation && recLabel && (
          <p
            data-testid="accessory-volume-recommendation"
            style={{
              margin: "10px 0 0",
              fontSize: 12.5,
              color: "var(--cp-text)",
              lineHeight: 1.5,
            }}
          >
            <span style={{ color: "var(--cp-accent)", fontWeight: 700 }}>
              ★ Recommended: {recLabel}.
            </span>{" "}
            {effectiveRecLevel !== recommendation.level
              ? "Cardio leads this plan — the accessory work is already at the most this block adds without cutting into recovery."
              : recommendation.reason}
          </p>
        )}
        {disabled && (
          <p
            data-testid="accessory-volume-disabled-note"
            style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--cp-text-muted)", lineHeight: 1.5 }}
          >
            This block has no accessory work — it&apos;s strength-and-cardio
            maintenance only, so there&apos;s nothing to adjust here.
          </p>
        )}
      </div>
    </section>
  );
}

export function Step4Review({
  state,
  dispatch,
  resolved,
  equipmentPreset,
  estimateAction,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  resolved: ResolvedArchetype;
  /** Equipment preset from the user's profile. Drives bodyweight-aware copy. */
  equipmentPreset?: EquipmentPreset | null;
  /**
   * ADR 0024 addendum — read-only server action that prices a representative
   * strength workout at each accessory-volume level. Optional: when absent the
   * control still renders (recommendation + copy) without live time estimates.
   */
  estimateAction?: EstimateAccessoryVolumeAction;
}): React.ReactElement {
  const isBw = equipmentPreset === "bodyweight_only";
  const waves = wavesFor(state, resolved, isBw);

  // ADR 0024 addendum — the control is now shown on EVERY archetype. Its
  // applicability + the engine recommendation are derived from the archetype's
  // own aesthetic accessory base, the single source of truth that also drives
  // the engine floor, so this never drifts from real prescription behaviour.
  const secondaryFocus = resolveSecondaryFocus(state.secondary);
  const applicability = useMemo(
    () => accessoryVolumeApplicability(resolved.id),
    [resolved.id],
  );
  const recommendation = useMemo(
    () => recommendedAccessoryVolume({ archetypeId: resolved.id, secondary: secondaryFocus }),
    [resolved.id, secondaryFocus],
  );

  // Pre-select the recommended level (advisory). The reducer guards against
  // stomping a level the user picked manually.
  useEffect(() => {
    if (recommendation && applicability.enabled) {
      dispatch({ type: "recommend-accessory-volume", level: recommendation.level });
    }
  }, [recommendation, applicability.enabled, dispatch]);

  // Live per-level time estimates. Re-fetched whenever an input that changes the
  // representative strength day moves (archetype / days / secondary / focus /
  // power). The accessory level itself is NOT a dependency — all three levels
  // are priced in one round-trip. `loading` is DERIVED (not set synchronously
  // inside the effect) by comparing the current input key against the key the
  // loaded estimate was computed for — so setState only ever runs async.
  const [estimate, setEstimate] = useState<{
    key: string | null;
    minutes: Record<AccessoryVolumeLevel, number | null> | null;
  }>({ key: null, minutes: null });
  const focusKey = state.focusMuscles.join(",");
  const requestKey =
    estimateAction && state.days != null
      ? [resolved.id, state.days, state.secondary ?? "", state.power ? "1" : "0", focusKey].join("|")
      : null;
  const estimateLoading = requestKey !== null && estimate.key !== requestKey;
  useEffect(() => {
    if (!estimateAction || state.days == null || requestKey == null) return;
    let cancelled = false;
    estimateAction({
      archetype: resolved.id,
      daysPerWeek: state.days,
      secondaryFocus: state.secondary ?? null,
      focusMuscles: state.focusMuscles,
      powerEmphasis: state.power,
    })
      .then((res) => {
        if (cancelled) return;
        setEstimate({ key: requestKey, minutes: res.ok ? res.minutes : null });
      })
      .catch(() => {
        if (!cancelled) setEstimate({ key: requestKey, minutes: null });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateAction, requestKey]);

  // Realized-aware redundancy: on a cardio-led block the mandatory durability /
  // functional / focus floor saturates the strength day, so the aesthetic lever
  // produces an IDENTICAL session at two (or three) levels. Detect that from the
  // live estimate and (a) grey out the duplicate levels in the control, and
  // (b) clamp the selection down to the leanest equivalent so we never submit a
  // greyed-out level.
  const redundancy = useMemo<AccessoryVolumeRedundancy>(
    () => accessoryVolumeRedundancy(estimate.minutes),
    [estimate.minutes],
  );
  useEffect(() => {
    if (estimateLoading) return;
    if (!redundancy.redundant.has(state.accessoryVolume)) return;
    const equivalent = redundancy.equivalentLevel[state.accessoryVolume];
    if (equivalent && equivalent !== state.accessoryVolume) {
      dispatch({ type: "clamp-accessory-volume", level: equivalent });
    }
  }, [redundancy, estimateLoading, state.accessoryVolume, dispatch]);

  return (
    <section>
      <div style={pillStyle}>Step 4 of 5 · Review</div>
      <h1 className="wiz-title" style={titleStyle}>Confirm and start</h1>
      <p className="wiz-sub" style={subStyle}>Here&apos;s what the block will look like. Tap start when you&apos;re ready.</p>

      <section style={reviewCardStyle}>
        <h3 style={cardHeadStyle}>Why this match?</h3>
        <div style={cardBodyStyle}>{whyMatchText(state, resolved, isBw)}</div>
      </section>

      <AccessoryVolumeControl
        value={state.accessoryVolume}
        onChange={(level) => dispatch({ type: "set-accessory-volume", level })}
        recommendation={recommendation}
        disabled={!applicability.enabled}
        estimates={estimate.minutes}
        estimateLoading={estimateLoading}
        redundancy={redundancy}
      />

      {state.power && (
        <section
          data-testid="power-recommendation-card"
          style={{ ...reviewCardStyle, borderColor: "var(--cp-accent)" }}
        >
          <h3 style={cardHeadStyle}>
            <span aria-hidden="true" style={{ marginRight: 6 }}>⚡</span>
            Power emphasis — block-length recommendation
          </h3>
          <div style={cardBodyStyle}>
            Power adaptations plateau faster than strength gains. 3-week blocks with frequent
            re-cycling tend to outperform 4-week marathons. Consider rotating power emphasis ON /
            OFF every block.
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "var(--cp-text-muted)",
                lineHeight: 1.5,
              }}
            >
              Recommended block length: <strong>3 weeks</strong> · this block stays at{" "}
              <strong>{resolved.weeks} weeks</strong> as designed — the recommendation is a hint,
              not a cap.
            </div>
          </div>
        </section>
      )}

      <section style={reviewCardStyle}>
        <h3 style={cardHeadStyle}>What the weeks look like</h3>
        <div style={cardBodyStyle}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {waves.map((w, i) => (
              <li
                key={i}
                style={{
                  padding: "8px 0",
                  borderTop: i === 0 ? "none" : "1px solid var(--cp-border)",
                }}
              >
                <div style={weekHeadStyle}>
                  <span style={weekPillStyle}>Week {i + 1}</span>
                  <strong style={{ fontSize: 13.5 }}>{w.label}</strong>
                </div>
                <div style={weekDetailStyle}>{w.detail}</div>
              </li>
            ))}
          </ul>
          <p style={{ marginTop: 10, fontSize: 12, color: "var(--cp-text-muted)" }}>
            {isBw
              ? "Main movements come from your bodyweight progression — the picker rotates through 3 families per session based on your current nodes."
              : "Main lifts come from your training maxes; the picker swaps in the specific variants you've configured."}
          </p>
        </div>
      </section>
    </section>
  );
}

const pillStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
  marginBottom: 4,
};
const titleStyle: React.CSSProperties = {
  fontSize: 28,
  margin: 0,
  letterSpacing: "-0.01em",
  fontWeight: 700,
};
const subStyle: React.CSSProperties = {
  color: "var(--cp-text-muted)",
  fontSize: 14,
  margin: "8px 0 24px",
  maxWidth: 560,
};
const reviewCardStyle: React.CSSProperties = {
  marginTop: 12,
  borderRadius: 12,
  background: "var(--cp-surface)",
  border: "1px solid var(--cp-border)",
  padding: "16px 18px",
};
const cardHeadStyle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
const cardBodyStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--cp-text)",
  lineHeight: 1.55,
};
const weekHeadStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  marginBottom: 4,
};
const weekPillStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 600,
  minWidth: 56,
};
const weekDetailStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--cp-text-muted)",
  lineHeight: 1.5,
  paddingLeft: 64,
};
