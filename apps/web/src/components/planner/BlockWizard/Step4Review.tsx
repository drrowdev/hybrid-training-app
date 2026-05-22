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

type Wave = { label: string; detail: string };

function strengthWaves(strengthHypDays: number): Wave[] {
  const base: Wave[] = [
    {
      label: "Build",
      detail:
        "Sets of 5 at moderate weight. Foundation week — get your reps in and rehearse the lifts before adding load.",
    },
    {
      label: "Add weight",
      detail: "Sets of 3 at heavier weight. Same lifts, fewer reps, more weight on the bar.",
    },
    {
      label: "Heavy week",
      detail:
        "Top single up to ~95% of your training max — the heaviest work of the block. This is where the strength gains from the previous weeks show up.",
    },
    {
      label: "Recovery week",
      detail: "Half the sets at the same weights. Fatigue clears so the heavy work locks in.",
    },
  ];
  if (strengthHypDays === 0) return base;
  return base.map((w, i) => {
    if (i < 3)
      return {
        ...w,
        detail:
          w.detail +
          ` Plus ${strengthHypDays} hypertrophy day${strengthHypDays === 1 ? "" : "s"} at moderate weights with extra accessory work — same dose every week.`,
      };
    return {
      ...w,
      detail:
        w.detail +
        ` Hypertrophy day${strengthHypDays === 1 ? "" : "s"} also drop${strengthHypDays === 1 ? "s" : ""} to half the sets.`,
    };
  });
}

function hypertrophyWaves(hypStrengthDays: number): Wave[] {
  const base: Wave[] = [
    {
      label: "Volume base",
      detail:
        "4 working sets per lift at 6–10 reps. Moderate weights, leave 1–2 reps in the tank — this is your foundation.",
    },
    {
      label: "Add a set",
      detail: "5 working sets per lift at the same reps and weights. More total work this week.",
    },
    {
      label: "Volume peak",
      detail: "Highest weekly set count of the block — the top of your recoverable volume.",
    },
    {
      label: "Recovery week",
      detail:
        "Half the sets, same weights. Lets the volume sink in and muscles catch up before next block.",
    },
  ];
  if (hypStrengthDays === 0) return base;
  return base.map((w, i) => {
    if (i < 3)
      return {
        ...w,
        detail:
          w.detail +
          ` Plus ${hypStrengthDays} strength day${hypStrengthDays === 1 ? "" : "s"} keeping a heavy top set (≥85% TM) so you don’t lose absolute strength.`,
      };
    return {
      ...w,
      detail:
        w.detail +
        ` Strength day${hypStrengthDays === 1 ? "" : "s"} also drop${hypStrengthDays === 1 ? "s" : ""} to half the sets.`,
    };
  });
}

function enduranceWaves(strength: number, secondary: WizardState["secondary"]): Wave[] {
  const base: Wave[] = [
    {
      label: "Build the base",
      detail:
        "Most sessions are easy Z2 — a pace where you can hold a conversation. Builds your aerobic engine and recovery capacity.",
    },
    {
      label: "Add minutes",
      detail:
        "Same shape as week 1, but each easy session is a bit longer. More time at conversational pace.",
    },
    {
      label: "Add the hard day",
      detail:
        "Z2 sessions stay anchored. One harder VO2 session (e.g. 4×4 min near max effort) gets added for top-end fitness.",
    },
    {
      label: "Recovery week",
      detail:
        "Half the minutes, same easy pace. Lets the volume sink in before the next block.",
    },
  ];
  if (strength === 0) return base;
  const liftType =
    secondary === "strength"
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
    label: "Build",
    detail:
      "Sets of 5 at moderate weight. Cardio is steady Z2 — easy aerobic dose that won’t tax the lifts.",
  },
  {
    label: "Add weight",
    detail: "Same sets of 5, a bit more weight on the bar. Cardio unchanged.",
  },
  {
    label: "Add the hard day",
    detail:
      "Top set rises but stays ≤85% of your training max (cardio-safe). One harder VO2 cardio session gets added.",
  },
  {
    label: "Recovery week",
    detail:
      "Half the sets, half the cardio minutes. Same weights and pace — reset before next block.",
  },
];

const HYBRID_MUSCLE_WAVES: Wave[] = [
  {
    label: "Volume base",
    detail:
      "6–10 reps per set at moderate weight, leaving 1–2 reps in the tank. Cardio is steady Z2 — easy on the legs.",
  },
  {
    label: "Add a set",
    detail: "Same exercises and weights, one more working set per lift. Aerobic dose unchanged.",
  },
  {
    label: "Add the hard day",
    detail:
      "Top set rises but stays ≤85% of your training max (cardio-safe). One harder VO2 cardio session gets added.",
  },
  {
    label: "Recovery week",
    detail:
      "Half the sets, half the cardio minutes. Same weights and pace — your body catches up.",
  },
];

const REBUILD_WAVES: Wave[] = [
  {
    label: "Ease in",
    detail:
      "Top set capped at ~60% of your training max. Light reintroduction — the goal is smooth movement, not heavy lifts.",
  },
  {
    label: "Step up",
    detail:
      "Bump top set to ~70%. Tendons start adapting; heavy slow resistance and isometric holds on the dedicated tendon days.",
  },
  {
    label: "Consolidate",
    detail:
      "Top set caps at 80% — the upper limit for this block. Stay here to let tendons catch up to your strength.",
  },
  {
    label: "Recovery week",
    detail: "Half the sets, same weights. Lets tendons catch up before the next block.",
  },
];

const MAINTENANCE_WAVES: Wave[] = [
  {
    label: "Steady week",
    detail:
      "Submaximal lifts and short Z2 sessions. Goal is to keep what you have, not add anything.",
  },
  {
    label: "Steady week",
    detail: "Same shape as week 1. Two weeks total, then return to a full block.",
  },
];

function wavesFor(state: WizardState, a: ResolvedArchetype): Wave[] {
  if (a.id === "strength_anchor") return strengthWaves(a.sessions.hypertrophy);
  if (a.id === "hypertrophy_anchor") return hypertrophyWaves(a.sessions.strength);
  if (a.id === "endurance_anchor") return enduranceWaves(a.sessions.strength, state.secondary);
  if (a.id === "concurrent_hybrid")
    return state.goal === "muscle" || state.secondary === "muscle" ? HYBRID_MUSCLE_WAVES : HYBRID_WAVES;
  if (a.id === "rebuild") return REBUILD_WAVES;
  if (a.id === "maintenance") return MAINTENANCE_WAVES;
  return [];
}

function whyMatchText(state: WizardState, a: ResolvedArchetype): string {
  const h = a.sessions.hypertrophy;
  const c = a.sessions.cardio;
  const s = a.sessions.strength;
  if (a.id === "concurrent_hybrid") {
    return "Hybrid Focus caps the top set so heavy lifting doesn’t sap your cardio sessions. The aerobic side runs one easy Z2 and one harder VO2 / threshold day — protects both qualities without competing.";
  }
  if (a.id === "strength_anchor") {
    if (h > 0 && c === 0)
      return "Strength Focus runs a 4-week intensity wave on the main lifts — top sets get heavier each week, peaking in week 3. The extra hypertrophy days add muscle without competing for the strength signal — moderate weights and accessory work on different days from your heavy lifts.";
    if (c > 0)
      return "Strength Focus runs a 4-week intensity wave on the main lifts. Easy cardio fills the remaining days for recovery and aerobic base — kept light so it doesn’t compete with the strength signal.";
    return "Strength Focus runs a 4-week intensity wave on the main lifts — top sets get heavier each week, peaking in week 3. Single-focus block: full rest on the other days so recovery goes entirely into the lifts.";
  }
  if (a.id === "hypertrophy_anchor") {
    if (s > 0 && c === 0)
      return "Hypertrophy Focus drives per-muscle volume across the block — same exercises and weights, more sets each week. The extra strength days keep heavy lifting in the picture so you don’t lose absolute strength while volume drives growth.";
    if (c > 0)
      return "Hypertrophy Focus drives per-muscle volume using compound + machine isolation work, with accessory pools that fill the gaps compounds miss. Easy cardio fills the remaining days at a recovery dose.";
    return "Hypertrophy Focus drives per-muscle volume using compound + machine isolation work, with accessory pools that fill the gaps compounds miss. Single-focus block: full rest on the other days so muscles have time to grow.";
  }
  if (a.id === "endurance_anchor") {
    if (s > 0)
      return "Endurance Focus runs a polarized week (long Z2 + VO2 intervals) and holds strength with two heavy sessions — heavy work at low frequency preserves strength while cardio leads.";
    return "Endurance Focus runs a polarized week — easier Z2 sessions for aerobic base, with one harder VO2 / threshold day for top-end fitness. Single-focus block: pure cardio, no strength work.";
  }
  if (a.id === "rebuild")
    return "Rebuild caps top set at 80% of your training max and adds dedicated heavy slow resistance and isometric hold sessions. Designed to load tendons and joints safely, not to chase progression.";
  if (a.id === "maintenance")
    return "Two-week maintenance block. Strength and aerobic base are held at sub-adaptation volume — protects what you have without spending recovery on adaptation.";
  return "";
}

export function Step4Review({
  state,
  resolved,
}: {
  state: WizardState;
  resolved: ResolvedArchetype;
}): React.ReactElement {
  const waves = wavesFor(state, resolved);
  return (
    <section>
      <div style={pillStyle}>Step 4 of 5 · Review</div>
      <h1 className="wiz-title" style={titleStyle}>Confirm and start</h1>
      <p className="wiz-sub" style={subStyle}>Here&apos;s what the block will look like. Tap start when you&apos;re ready.</p>

      <section style={reviewCardStyle}>
        <h3 style={cardHeadStyle}>Why this match?</h3>
        <div style={cardBodyStyle}>{whyMatchText(state, resolved)}</div>
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
            Main lifts come from your training maxes; the picker swaps in the specific variants
            you&apos;ve configured.
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
