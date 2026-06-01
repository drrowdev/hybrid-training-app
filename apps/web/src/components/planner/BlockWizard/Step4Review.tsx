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

import type { WizardState } from "@/lib/planner/wizard/wizard-state";
import type { ResolvedArchetype } from "@/lib/planner/wizard/wizard-mapping";
import type { EquipmentPreset } from "@/lib/settings/equipment-schema";

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

export function Step4Review({
  state,
  resolved,
  equipmentPreset,
}: {
  state: WizardState;
  resolved: ResolvedArchetype;
  /** Equipment preset from the user's profile. Drives bodyweight-aware copy. */
  equipmentPreset?: EquipmentPreset | null;
}): React.ReactElement {
  const isBw = equipmentPreset === "bodyweight_only";
  const waves = wavesFor(state, resolved, isBw);
  return (
    <section>
      <div style={pillStyle}>Step 4 of 5 · Review</div>
      <h1 className="wiz-title" style={titleStyle}>Confirm and start</h1>
      <p className="wiz-sub" style={subStyle}>Here&apos;s what the block will look like. Tap start when you&apos;re ready.</p>

      <section style={reviewCardStyle}>
        <h3 style={cardHeadStyle}>Why this match?</h3>
        <div style={cardBodyStyle}>{whyMatchText(state, resolved, isBw)}</div>
      </section>

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
