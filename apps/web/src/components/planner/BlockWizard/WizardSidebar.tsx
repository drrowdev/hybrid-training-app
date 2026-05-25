/**
 * WizardSidebar — the right-rail live preview. Mirrors the mockup's
 * "Your block" card: archetype name, summary sentence, choice rows,
 * session breakdown, "Where the weekly emphasis goes" mini-chart, and the
 * 4-cell week ladder.
 *
 * All derived state comes from the canonical `resolveArchetype`; the
 * sidebar never re-implements distribution logic.
 */
"use client";

import { useState, type ReactElement } from "react";
import type { WizardState } from "@/lib/planner/wizard/wizard-state";
import type { ResolvedArchetype, Goal } from "@/lib/planner/wizard/wizard-mapping";
import { buildWeekShape, type SessionShape } from "@/lib/planner/wizard/schedule";
import { MetricHelp } from "@/components/ui/MetricHelp";
import type { EquipmentPreset } from "@/lib/settings/equipment-schema";
import { GOALS } from "./shared";

export function WizardSidebar({
  state,
  resolved,
  equipmentPreset,
}: {
  state: WizardState;
  resolved: ResolvedArchetype | null;
  /** Equipment preset from the user's profile. Drives bodyweight-aware copy. */
  equipmentPreset?: EquipmentPreset | null;
}): ReactElement {
  const isBw = equipmentPreset === "bodyweight_only";
  const fullyResolved = !!resolved;
  const name = !fullyResolved ? "Pick a few options →" : resolved.name;
  const summary = summarySentence(state, resolved);

  // Mobile-only accordion state. CSS hides the summary button entirely on
  // desktop (>768 px) and forces the body visible there regardless of
  // `data-open`, so this only affects the phone layout.
  const [open, setOpen] = useState(false);

  const collapsedDays =
    state.days == null ? "—" : `${state.days} day${state.days === 1 ? "" : "s"}/wk`;

  return (
    <div style={previewStyle}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="wiz-sidebar-body"
        className="wiz-sidebar-summary"
        style={summaryToggleStyle}
      >
        <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
          <span style={kickerStyle}>Your block</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: fullyResolved ? "var(--cp-accent)" : "var(--cp-text-muted)" }}>
            {name} · {collapsedDays}
          </span>
        </span>
        <span aria-hidden="true" style={{ fontSize: 18, color: "var(--cp-text-muted)" }}>
          {open ? "▾" : "▸"}
        </span>
      </button>
      <div
        id="wiz-sidebar-body"
        className="wiz-sidebar-body"
        data-open={open ? "true" : "false"}
      >
        <div style={headerStyle}>
          <span style={kickerStyle}>Your block</span>
        </div>
        <div style={nameStyle(fullyResolved)}>{name}</div>
        <p style={summaryStyle}>
          {summary.prefix}
          {summary.emphasis && (
            <strong style={{ color: "var(--cp-text)", fontWeight: 700 }}>
              {summary.emphasis}
            </strong>
          )}
          {summary.suffix}
        </p>

        <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
          <Row icon="📅" label="Days a week" value={state.days == null ? null : `${state.days} day${state.days === 1 ? "" : "s"}`} />
          {state.secondary === "maintenance" && !state.goal ? (
            <Row icon="🌴" label="Mode" value="Maintenance (busy stretch)" />
          ) : (
            <>
              <Row
                icon={state.goal ? GOALS[state.goal].icon : "🎯"}
                label="First focus"
                value={state.goal ? GOALS[state.goal].name : null}
              />
              {state.goal !== "resilience" && (
                <Row
                  icon={
                    state.secondary && state.secondary !== "skip" && state.secondary !== "maintenance"
                      ? GOALS[state.secondary as Goal].icon
                      : "➕"
                  }
                  label="Second focus"
                  value={
                    state.secondary === "skip"
                      ? "Single-focus"
                      : state.secondary && state.secondary !== "maintenance"
                        ? GOALS[state.secondary as Goal].name
                        : null
                  }
                />
              )}
            </>
          )}

          {resolved && (
            <>
              <div style={{ height: 1, background: "var(--cp-border)", margin: "6px 2px 2px" }} />
              <SessionBreakdown state={state} resolved={resolved} isBw={isBw} />
              <Row
                icon="🛡️"
                label="Tendons & joints"
                value="Integrated"
                help="tendons_joints_integrated"
              />
              {(() => {
                const total = totalSessions(resolved);
                const calendarDaysUsed = state.twoADay ? Math.ceil(total / 2) : total;
                if (state.days != null && state.days > calendarDaysUsed) {
                  const rest = state.days - calendarDaysUsed;
                  return (
                    <Row icon="🛌" label="Rest / flex" value={`${rest} day${rest === 1 ? "" : "s"}/wk`} />
                  );
                }
                return null;
              })()}
            </>
          )}

          {state.power && <PowerBadgeRow />}
          {state.twoADay && <Row icon="🌗" label="Two-a-day" value="AM + PM split" />}
        </div>

        <WeekLadder resolved={resolved} isBw={isBw} />

        <p style={noteStyle}>
          {isBw
            ? "The block-creation engine rotates through your bodyweight families — the picker chooses ~3 main families per session based on your current progression nodes."
            : "The block-creation engine picks the actual movements from your training maxes and the tagged catalog — no two blocks are identical."}
        </p>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  help,
}: {
  icon: string;
  label: string;
  value: string | null;
  /** Glossary term key to surface a small `<MetricHelp>` icon next to the label. */
  help?: string;
}): ReactElement {
  const pending = value == null;
  return (
    <div style={rowStyle(pending)}>
      <span style={iconBoxStyle}>{icon}</span>
      <span
        style={{
          color: "var(--cp-text-muted)",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {label}
        {help && <MetricHelp term={help} />}
      </span>
      <span style={{ color: "var(--cp-text)", fontWeight: 600, marginLeft: "auto" }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

/**
 * Click-to-expand power badge. Shows the ⚡ Power chip in the
 * sidebar's Your Block card; expanding reveals what the toggle
 * actually affects under the hood.
 */
function PowerBadgeRow(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-testid="power-emphasis-badge"
      style={{
        ...rowStyle(false),
        flexDirection: "column",
        alignItems: "stretch",
        gap: 6,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="power-badge-detail"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          fontFamily: "inherit",
          color: "inherit",
          fontSize: 13,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={iconBoxStyle}>⚡</span>
        <span style={{ color: "var(--cp-text-muted)" }}>Power emphasis</span>
        <span
          data-testid="power-emphasis-chip"
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            padding: "2px 8px",
            borderRadius: 999,
            background: "var(--cp-accent-soft, rgba(99, 102, 241, 0.12))",
            color: "var(--cp-accent)",
            border: "1px solid var(--cp-accent)",
          }}
        >
          ⚡ Power
        </span>
      </button>
      {open && (
        <div
          id="power-badge-detail"
          style={{
            fontSize: 11.5,
            color: "var(--cp-text-muted)",
            lineHeight: 1.5,
            padding: "6px 0 2px",
            borderTop: "1px dashed var(--cp-border)",
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--cp-text)", marginBottom: 4 }}>
            What this changes
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
            <li>Heavy-week top set capped at ≤ 90% TM (compensatory acceleration cue).</li>
            <li>One explosive primer prepended to each strength session (PAP/PAPE).</li>
            <li>Accessory picker biased toward plyometric / ballistic / Olympic work.</li>
            <li>Hint: 3-week blocks tend to outperform 4-week marathons here.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

function SessionBreakdown({
  state,
  resolved,
  isBw,
}: {
  state: WizardState;
  resolved: ResolvedArchetype;
  isBw: boolean;
}): ReactElement {
  // One row per session — no consolidation. Headers group by category
  // (Strength · Cardio · Tendons) so the week shape is scannable, but
  // every session still gets its own row so the count is accurate.
  const sessions = buildWeekShape(resolved, { goal: state.goal, secondary: state.secondary });
  const total = sessions.length;

  const groups: Array<{ label: string; items: { session: SessionShape; idx: number }[] }> = [
    { label: "Strength", items: [] },
    { label: "Cardio", items: [] },
    { label: "Tendons", items: [] },
  ];
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const cat = sessionCategory(s);
    const bucket = cat === "strength" ? 0 : cat === "cardio" ? 1 : 2;
    groups[bucket].items.push({ session: s, idx: i });
  }

  return (
    <>
      <div style={breakdownHeadingStyle}>
        Your week ({total} session{total === 1 ? "" : "s"})
      </div>
      {groups.map((g) =>
        g.items.length === 0 ? null : (
          <div key={g.label} style={{ display: "grid", gap: 4 }}>
            <div style={groupHeadingStyle}>
              {g.label} · {g.items.length}
            </div>
            {g.items.map(({ session, idx }) => (
              <SessionRow key={idx} session={session} isBw={isBw} />
            ))}
          </div>
        ),
      )}
    </>
  );
}

function sessionCategory(s: SessionShape): "strength" | "cardio" | "tendon" {
  const k = s.weightKey;
  if (k === "Tendon day") return "tendon";
  if (
    k === "Easy Z2 (recovery)" ||
    k === "Polarized Z2" ||
    k === "VO2 intervals" ||
    k === "Long Z2 + alactic finisher" ||
    k === "Maintenance Z2"
  )
    return "cardio";
  return "strength";
}

function SessionRow({ session, isBw }: { session: SessionShape; isBw: boolean }): ReactElement {
  // Title + meta only. No duration on the right — durations change
  // week-to-week (especially in endurance / hypertrophy blocks where
  // minutes or set counts grow over the wave), so a static "75 min"
  // label would contradict the per-week narrative shown in Step 4.
  return (
    <div style={sessionRowStyle}>
      <span style={iconBoxStyle}>{session.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={sessionTitleStyle}>{generalizeTitle(session.title)}</div>
        <div style={sessionMetaStyle}>{generalizeMetaForEquipment(session.meta, isBw)}</div>
      </div>
    </div>
  );
}

/**
 * Strip wave-specific or methodology-specific framing from session
 * titles so the right rail reads as "what you'll do every week" rather
 * than "what week 1 looks like". E.g. "Long Z2 + alactic finisher" →
 * "Long run / ride". The full session prescription lives on the Plan
 * page once the block exists.
 */
function generalizeTitle(title: string): string {
  if (title === "Long Z2" || title === "Long Z2 + alactic finisher") return "Long aerobic";
  if (title === "Easy Z2") return "Easy aerobic";
  if (title === "Polarized Z2") return "Long aerobic";
  if (title === "VO2 intervals") return "Intervals (hard day)";
  if (title === "Maintenance lift") return "Maintenance lift";
  if (title === "Strength day") return "Strength day";
  if (title === "Hypertrophy day") return "Hypertrophy day";
  if (title === "Capped lift") return "Capped lift";
  if (title === "Tendon day") return "Tendon day";
  return title;
}

/**
 * Strip duration / set-count / percent numbers from the secondary meta
 * line for the same reason — those scale per week. Keep the qualitative
 * descriptor ("conversational pace", "near-max effort", "accessory
 * pool").
 */
function generalizeMeta(meta: string): string {
  // Endurance descriptors — pace, not minutes.
  if (meta.startsWith("aerobic base")) return "conversational pace";
  if (meta.startsWith("recovery between")) return "easy recovery pace";
  if (meta.startsWith("aerobic floor")) return "easy aerobic floor";
  if (meta.startsWith("maintenance dose")) return "short and easy";
  if (meta.includes("90–95% HRmax")) return "hard intervals near max";
  if (meta.includes("near-max")) return "easy with short hard finishers";
  // Strength descriptors — strip the explicit %TM and set counts.
  if (meta.includes("≥ 95% TM") || meta.includes("≥ 90% TM"))
    return "heavy top set · few working sets";
  if (meta.includes("≥ 85% TM")) return "moderate-heavy top set";
  if (meta.includes("≤ 95% TM")) return "heavy top set";
  if (meta.includes("≤ 85% TM")) return "cardio-safe top set";
  if (meta.includes("≤ 80% TM")) return "capped top set";
  if (meta.includes("accessory")) return "moderate weight + accessories";
  if (meta.includes("HSR")) return "heavy-slow-resistance + isometric holds";
  if (meta.includes("65–70% TM")) return "submaximal lifts";
  if (meta.includes("60–75% TM")) return "moderate weight · multiple sets";
  return meta;
}

/**
 * Equipment-aware wrapper around {@link generalizeMeta}. For
 * bodyweight-only users the standard %TM / "weight" / "top set"
 * language is wrong — there's no external load, just reps × RIR ×
 * tempo × holds. We intercept the strength descriptors and route
 * everything else (aerobic / Z2 / intervals) through the default
 * mapping unchanged.
 *
 * Exported for unit tests; rendered indirectly via {@link SessionRow}.
 */
export function generalizeMetaForEquipment(meta: string, isBw: boolean): string {
  if (!isBw) return generalizeMeta(meta);
  // BW overrides for strength descriptors. Order mirrors the strength
  // branches in `generalizeMeta` so the two stay easy to diff.
  if (meta.includes("≥ 95% TM") || meta.includes("≥ 90% TM"))
    return "low-RIR top sets · slow eccentrics";
  if (meta.includes("≥ 85% TM")) return "moderate-RIR top sets";
  if (meta.includes("≤ 95% TM")) return "low-RIR top sets";
  if (meta.includes("≤ 85% TM")) return "moderate-RIR sets · cardio-safe";
  if (meta.includes("≤ 80% TM")) return "capped intensity · RIR 2+";
  if (meta.includes("accessory")) return "variant pool · moderate RIR";
  if (meta.includes("HSR")) return "isometric holds + slow eccentrics";
  if (meta.includes("65–70% TM")) return "sub-maximal sets · long holds";
  if (meta.includes("60–75% TM")) return "moderate intensity · longer TUT";
  // Fall back to non-BW mapping for cardio/aerobic descriptors etc.
  return generalizeMeta(meta);
}

function totalSessions(a: ResolvedArchetype): number {
  return a.sessions.strength + a.sessions.hypertrophy + a.sessions.cardio + a.sessions.tendon;
}

type SummaryParts = { prefix: string; emphasis: string | null; suffix: string };

function summarySentence(state: WizardState, a: ResolvedArchetype | null): SummaryParts {
  const dayLabel =
    state.days == null ? "? days/week" : `${state.days} day${state.days === 1 ? "" : "s"}/week`;
  if (state.secondary === "maintenance" && a) {
    return {
      prefix: "Short maintenance block. ",
      emphasis: `${formatSessions(a)} over ${dayLabel}`,
      suffix: " — protects what you have without spending recovery on adaptation.",
    };
  }
  if (!state.goal || !a) {
    return { prefix: "The program shapes up as you choose.", emphasis: null, suffix: "" };
  }
  if (state.goal === "resilience") {
    return {
      prefix:
        "Tendon-led return-to-load block. Top set capped at 80% TM; dedicated heavy slow resistance and isometric hold sessions across the week.",
      emphasis: null,
      suffix: "",
    };
  }
  const primary = GOALS[state.goal].short;
  if (state.secondary && state.secondary !== "skip") {
    const sec = GOALS[state.secondary as Goal]?.short;
    return {
      prefix: `Based on ${primary} + ${sec}, you'll do ${a.name}. `,
      emphasis: `${formatSessions(a)} over ${dayLabel}`,
      suffix: `, with a deload in week ${a.weeks}.`,
    };
  }
  if (state.secondary === "skip") {
    return {
      prefix: `Single-focus ${a.name}. `,
      emphasis: `${formatSessions(a)} over ${dayLabel}`,
      suffix: ".",
    };
  }
  return {
    prefix: `Leading ${primary}. `,
    emphasis: formatSessions(a),
    suffix: ".",
  };
}

function formatSessions(a: ResolvedArchetype): string {
  const parts: string[] = [];
  const { strength, hypertrophy, cardio, tendon } = a.sessions;
  if (strength > 0) parts.push(`${strength} strength`);
  if (hypertrophy > 0) parts.push(`${hypertrophy} hypertrophy`);
  if (cardio > 0) parts.push(`${cardio} cardio`);
  if (tendon > 0) parts.push(`${tendon} tendon`);
  return parts.join(" + ");
}

function WeekLadder({
  resolved,
  isBw,
}: {
  resolved: ResolvedArchetype | null;
  isBw: boolean;
}): ReactElement {
  // Always render 4 cells; pending cells when unresolved.
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 4,
        marginTop: 10,
      }}
    >
      {Array.from({ length: 4 }, (_, i) => {
        const filled = !!resolved && i < resolved.weeks;
        const label = filled ? labelForWave(resolved!, i, isBw) : "—";
        const isDeload = filled && /^Recover\b/i.test(label);
        return (
          <div key={i} style={weekCellStyle(filled, isDeload)}>
            <div
              style={{
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--cp-text-muted)",
                fontWeight: 600,
              }}
            >
              {filled ? `Wk ${i + 1}` : "—"}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--cp-text)", marginTop: 2 }}>
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function labelForWave(a: ResolvedArchetype, i: number, isBw: boolean): string {
  // Plain-language week labels. Each archetype reads as a 4-week story
  // the user can mentally rehearse: ramp-in -> build -> hardest week ->
  // recovery. Avoids jargon ("heavy week", "volume peak") in favour of
  // what the user will actually do.
  if (a.id === "strength_anchor")
    return (
      isBw
        ? [
            "Ramp in — find your tempo",
            "Build — more reps or longer holds",
            "Push — your hardest week",
            "Recover — pull back, sleep more",
          ]
        : [
            "Ramp in — get your bar speed back",
            "Build — heavier top sets each session",
            "Push — your hardest week",
            "Recover — lighter loads, sleep more",
          ]
    )[i] ?? "—";
  if (a.id === "hypertrophy_anchor")
    return (
      isBw
        ? [
            "Ramp in — find your tempo",
            "Build — add a working set",
            "Push — most sets of the block",
            "Recover — half the volume, full sleep",
          ]
        : [
            "Ramp in — find your working weights",
            "Build — add a working set per lift",
            "Push — most sets of the block",
            "Recover — half the volume, full sleep",
          ]
    )[i] ?? "—";
  if (a.id === "endurance_anchor")
    return [
      "Build — easy aerobic base",
      "Stretch — longer Z2 sessions",
      "Push — add the hard interval day",
      "Recover — easy minutes only",
    ][i] ?? "—";
  if (a.id === "concurrent_hybrid")
    return (
      isBw
        ? [
            "Ramp in — both engines at low load",
            "Build — add reps + minutes",
            "Push — your hardest week",
            "Recover — lighter on both",
          ]
        : [
            "Ramp in — both engines at low load",
            "Build — add weight + minutes",
            "Push — your hardest week",
            "Recover — lighter on both",
          ]
    )[i] ?? "—";
  if (a.id === "rebuild")
    return (
      isBw
        ? [
            "Ease in — pain-free range only",
            "Step up — modest progression",
            "Consolidate — hold the new range",
            "Recover — back off to feel-good progressions",
          ]
        : [
            "Ease in — pain-free range only",
            "Step up — modest load progression",
            "Consolidate — hold the new range",
            "Recover — back off to feel-good loads",
          ]
    )[i] ?? "—";
  if (a.id === "maintenance")
    return ["Steady — keep what you have", "Steady — keep what you have"][i] ?? "—";
  return "—";
}

// ── Styles ────────────────────────────────────────────────────────────────
const previewStyle: React.CSSProperties = {
  background: "var(--cp-surface)",
  border: "1.5px solid var(--cp-border)",
  borderRadius: 16,
  padding: 20,
  boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
};
const summaryToggleStyle: React.CSSProperties = {
  width: "100%",
  background: "transparent",
  border: "none",
  padding: 0,
  margin: "0 0 12px",
  cursor: "pointer",
  fontFamily: "inherit",
  color: "inherit",
  textAlign: "left",
  alignItems: "center",
  justifyContent: "space-between",
  minHeight: 44,
  gap: 12,
  // `display: flex` is applied via the wiz-sidebar-summary class at ≤768 px.
};
const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 14,
};
const kickerStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
};

function nameStyle(resolved: boolean): React.CSSProperties {
  return {
    fontSize: 22,
    fontWeight: resolved ? 700 : 600,
    margin: "0 0 4px",
    letterSpacing: "-0.01em",
    color: resolved ? "var(--cp-accent)" : "var(--cp-text-muted)",
  };
}

const summaryStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--cp-text-muted)",
  lineHeight: 1.5,
  margin: "0 0 14px",
  minHeight: 38,
};

function rowStyle(pending: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 8,
    background: "var(--cp-surface-soft)",
    fontSize: 13,
    opacity: pending ? 0.4 : 1,
    fontStyle: pending ? "italic" : "normal",
  };
}

const iconBoxStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--cp-bg-elevated)",
  borderRadius: 6,
  border: "1px solid var(--cp-border)",
  fontSize: 12,
  flexShrink: 0,
};

const sessionRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "9px 10px",
  borderRadius: 8,
  background: "var(--cp-surface-soft)",
  fontSize: 13,
};

const sessionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--cp-text)",
  lineHeight: 1.2,
  display: "inline-flex",
  alignItems: "baseline",
  gap: 6,
};

const sessionMetaStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
  marginTop: 2,
  lineHeight: 1.4,
};

const breakdownHeadingStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 600,
  padding: "4px 2px 2px",
};

const groupHeadingStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 600,
  padding: "8px 2px 2px",
  opacity: 0.7,
};

const noteStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
  lineHeight: 1.45,
  borderTop: "1px dashed var(--cp-border)",
  paddingTop: 12,
  marginTop: 12,
};

function weekCellStyle(filled: boolean, isDeload: boolean): React.CSSProperties {
  // Deload cells signal "different" with a dashed muted border and a
  // 60% opacity treatment — never a filled background, which the
  // previous warning-tinted fill made look like the highlighted /
  // starting week. The accent stays neutral so the user reads the cell
  // as "lighter" rather than "active".
  return {
    textAlign: "center",
    padding: "8px 4px",
    background: "var(--cp-surface-soft)",
    borderRadius: 6,
    border: isDeload
      ? "1px dashed var(--cp-border-strong, var(--cp-border))"
      : "1px solid var(--cp-border)",
    opacity: !filled ? 0.35 : isDeload ? 0.7 : 1,
  };
}
