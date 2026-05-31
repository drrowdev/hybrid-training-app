"use client";

/**
 * /app/stats — command-center redesign (Direction C2).
 *
 * Replaces the flat card grid with a hero verdict band over a bento of
 * focused tiles. This component owns the range toggle (30d / 90d / all)
 * and swaps the range-dependent buckets from a precomputed record, the
 * same no-round-trip pattern the old StatsOverviewView used (audit F1).
 *
 * Honesty posture — every number here traces to a real, tested query:
 *  - The hero "Readiness" cell renders the ACWR-grounded readiness
 *    composite (lib/stats/readiness.ts). There is deliberately NO
 *    "stress budget" meter — readiness.ts replaced that vague notion
 *    with the acute:chronic workload ratio. The "Recovery & load" tile
 *    shows region freshness + the same ACWR ratio band, not a fabricated
 *    budget percentage.
 *  - The "Training volume" tile renders weekly tonnage (Σ weight × reps,
 *    working sets only) from getVolumeForRange — a retrospective load
 *    signal, range-aware like the rest of the bento. (The forward-looking
 *    "why today" decision trace lives on the Engine internals deep-dive,
 *    not on this overview — /stats is a retrospective surface.)
 *  - Strength / endurance / progress-verdict are the Phase-1 data-layer
 *    queries; cold-start ("building" / "no-run-data") states are honored
 *    rather than rendering misleading zeros.
 *
 * Tiles are presentational in Phase 2; the click-through drawers and the
 * orphan-subpage absorption land in Phase 3. Until then the bottom
 * deep-dive links carry navigation.
 */
import Link from "next/link";
import { useCallback, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { AdherenceResult } from "@/lib/stats/adherence";
import type { PrsRangeResult } from "@/lib/stats/prs-range";
import type { VolumeRangeResult } from "@/lib/stats/volume";
import type { FreshnessMiniRow } from "@/lib/stats/freshness-mini";
import type { BodyweightTrend } from "@/lib/stats/bodyweight-trend";
import type { ActiveBlockProgress } from "@/lib/stats/active-block-progress";
import type { Readiness, ReadinessVerdict } from "@/lib/stats/readiness";
import type { StrengthProgress } from "@/lib/stats/strength-progress";
import type { EnduranceProgress } from "@/lib/stats/endurance-progress";
import type { ProgressVerdict, ProgressVerdictKind } from "@/lib/stats/progress-verdict";
import type { WeeklyRhythm } from "@/lib/stats/weekly-rhythm";
import type { Streak } from "@/lib/stats/streak";
import { displayWeight, weightUnitLabel, type WeightUnit } from "@/lib/stats/units";
import { LOAD_BAND_THRESHOLDS } from "@/lib/stats/load-balance";
import type { ProfileForFormat } from "@/lib/format/datetime";
import { DEFAULT_RANGE, RANGE_LABEL, type Range } from "@/lib/stats/range";
import { Sparkline } from "@/components/stats/charts/Sparkline";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricHelp } from "@/components/ui/MetricHelp";

export type StatsRangeBucket = {
  adherence: AdherenceResult;
  prs: PrsRangeResult;
  volume: VolumeRangeResult;
  strength: StrengthProgress;
  endurance: EnduranceProgress;
  verdict: ProgressVerdict;
};

export type StatsCommandCenterProps = {
  initialRange: Range;
  byRange: Record<Range, StatsRangeBucket>;
  block: ActiveBlockProgress | null;
  readiness: Readiness;
  streak: Streak;
  rhythm: WeeklyRhythm;
  freshness: FreshnessMiniRow[];
  bodyweight: BodyweightTrend;
  units: WeightUnit;
  formatProfile: ProfileForFormat;
};

// ── tone helpers ─────────────────────────────────────────────────────

type Tone = "success" | "warning" | "danger" | "muted" | "accent" | "cardio";

function toneVar(tone: Tone): string {
  switch (tone) {
    case "success":
      return "var(--cp-success)";
    case "warning":
      return "var(--cp-warning)";
    case "danger":
      return "var(--cp-danger)";
    case "accent":
      return "var(--cp-accent)";
    case "cardio":
      return "var(--cp-link)";
    case "muted":
      return "var(--cp-text-muted)";
  }
}

function verdictTone(kind: ProgressVerdictKind): Tone {
  switch (kind) {
    case "up":
      return "success";
    case "down":
      return "danger";
    case "mixed":
      return "warning";
    case "holding":
      return "muted";
    case "building":
      return "muted";
  }
}

function verdictArrow(kind: ProgressVerdictKind): string {
  switch (kind) {
    case "up":
      return "↗";
    case "down":
      return "↘";
    case "mixed":
      return "↔";
    case "holding":
      return "→";
    case "building":
      return "•";
  }
}

function readinessTone(verdict: ReadinessVerdict): Tone {
  switch (verdict) {
    case "productive":
      return "success";
    case "pushing-tolerated":
      return "warning";
    case "watch":
      return "warning";
    case "overreaching":
      return "danger";
    case "detraining":
    case "building":
      return "muted";
  }
}

function directionTone(dir: string): Tone {
  switch (dir) {
    case "up":
      return "success";
    case "down":
      return "danger";
    default:
      return "muted";
  }
}

function dirArrow(dir: string): string {
  if (dir === "up") return "▲";
  if (dir === "down") return "▼";
  return "—";
}

// ── format helpers ───────────────────────────────────────────────────

function fmtPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── shared layout primitives ─────────────────────────────────────────

const CARD: CSSProperties = {
  background: "var(--cp-surface)",
  border: "1px solid var(--cp-border)",
  borderRadius: 16,
  padding: "16px 18px",
  boxShadow: "0 1px 2px rgba(0,0,0,.18)",
};

function TileHead({
  title,
  meta,
  helpTerm,
  right,
}: {
  title: string;
  meta?: string;
  helpTerm?: string;
  right?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>
        {title}
        {helpTerm != null && <MetricHelp term={helpTerm} />}
      </span>
      {meta != null && (
        <span style={{ fontSize: 11.5, color: "var(--cp-text-muted)" }}>{meta}</span>
      )}
      {right != null && <span style={{ marginLeft: "auto" }}>{right}</span>}
    </div>
  );
}

// ── top-level component ──────────────────────────────────────────────

export function StatsCommandCenter(props: StatsCommandCenterProps) {
  const {
    initialRange,
    byRange,
    block,
    readiness,
    streak,
    rhythm,
    freshness,
    bodyweight,
    units,
  } = props;
  const [range, setRange] = useState<Range>(initialRange);
  const [openTile, setOpenTile] = useState<
    "strength" | "recovery" | "endurance" | "consistency" | null
  >(null);

  const syncUrl = useCallback((next: Range) => {
    if (typeof window === "undefined") return;
    const url = next === DEFAULT_RANGE ? "/app/stats" : `/app/stats?range=${next}`;
    window.history.replaceState(null, "", url + window.location.hash);
  }, []);

  const onSelect = useCallback(
    (next: Range) => {
      setRange(next);
      syncUrl(next);
    },
    [syncUrl],
  );

  const bucket = byRange[range];

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <RangeToggle current={range} onSelect={onSelect} />
      </div>

      <Hero
        block={block}
        verdict={bucket.verdict}
        adherence={bucket.adherence}
        prs={bucket.prs}
        readiness={readiness}
        streak={streak}
        range={range}
      />

      <div
        data-testid="stats-bento"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, 1fr)",
          gap: 14,
        }}
      >
        <StrengthTile
          data={bucket.strength}
          range={range}
          onExpand={() => setOpenTile("strength")}
        />
        <EnduranceTile
          data={bucket.endurance}
          range={range}
          onExpand={() => setOpenTile("endurance")}
        />
        <RecoveryLoadTile
          freshness={freshness}
          readiness={readiness}
          onExpand={() => setOpenTile("recovery")}
        />
        <ConsistencyTile
          rhythm={rhythm}
          streak={streak}
          onExpand={() => setOpenTile("consistency")}
        />
        <BodyweightTile data={bodyweight} units={units} />
        <VolumeTile data={bucket.volume} range={range} units={units} />
      </div>

      <StrengthDrawer
        open={openTile === "strength"}
        onClose={() => setOpenTile(null)}
        data={bucket.strength}
        range={range}
      />
      <EnduranceDrawer
        open={openTile === "endurance"}
        onClose={() => setOpenTile(null)}
        data={bucket.endurance}
        range={range}
      />
      <ReadinessDrawer
        open={openTile === "recovery"}
        onClose={() => setOpenTile(null)}
        readiness={readiness}
      />
      <ConsistencyDrawer
        open={openTile === "consistency"}
        onClose={() => setOpenTile(null)}
        rhythm={rhythm}
        streak={streak}
      />
    </div>
  );
}

// ── range toggle (testids preserved from StatsOverviewView) ──────────

function RangeToggle({
  current,
  onSelect,
}: {
  current: Range;
  onSelect: (next: Range) => void;
}) {
  const opts: Range[] = ["30d", "90d", "all"];
  return (
    <nav
      data-testid="stats-range-toggle"
      aria-label="Range"
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 3,
        borderRadius: 999,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface)",
        width: "fit-content",
      }}
    >
      {opts.map((opt) => {
        const active = opt === current;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            data-testid="stats-range-option"
            data-range={opt}
            data-active={active ? "true" : "false"}
            aria-pressed={active}
            style={{
              fontSize: 12,
              padding: "5px 12px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              letterSpacing: "0.02em",
              color: active ? "var(--cp-accent)" : "var(--cp-text-muted)",
              background: active ? "var(--cp-accent-soft)" : "transparent",
            }}
          >
            {RANGE_LABEL[opt]}
          </button>
        );
      })}
    </nav>
  );
}

// ── HERO ─────────────────────────────────────────────────────────────

function Hero({
  block,
  verdict,
  adherence,
  prs,
  readiness,
  streak,
  range,
}: {
  block: ActiveBlockProgress | null;
  verdict: ProgressVerdict;
  adherence: AdherenceResult;
  prs: PrsRangeResult;
  readiness: Readiness;
  streak: Streak;
  range: Range;
}) {
  return (
    <section className="cp-card" style={{ ...CARD, padding: 0, overflow: "hidden" }}>
      <BlockContext block={block} adherence={adherence} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr 1fr",
          // mobile collapses via the wrapper media query below
        }}
        className="stats-hero-grid"
      >
        <HeroCell>
          <CellLabel>Progress · {RANGE_LABEL[range]}</CellLabel>
          <ProgressVerdictCell verdict={verdict} prs={prs} />
        </HeroCell>
        <HeroCell border>
          <CellLabel>Readiness · now</CellLabel>
          <ReadinessCell readiness={readiness} />
        </HeroCell>
        <HeroCell border>
          <CellLabel>Consistency · {RANGE_LABEL[range]}</CellLabel>
          <ConsistencyCell adherence={adherence} streak={streak} />
        </HeroCell>
      </div>
      <style>{`
        @media (max-width: 760px) {
          .stats-hero-grid { grid-template-columns: 1fr !important; }
          .stats-hero-grid > div + div { border-left: 0 !important; border-top: 1px solid var(--cp-border) !important; }
        }
        @media (max-width: 760px) {
          .stats-bento-span { grid-column: span 12 !important; }
        }
      `}</style>
    </section>
  );
}

function BlockContext({
  block,
  adherence,
}: {
  block: ActiveBlockProgress | null;
  adherence: AdherenceResult;
}) {
  if (!block) {
    return (
      <div
        data-testid="stats-card-active-block"
        data-empty="true"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "13px 20px",
          borderBottom: "1px solid var(--cp-border)",
          background: "var(--cp-surface-soft)",
          fontSize: 13,
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "var(--cp-text-muted)" }}>No active block</span>
        <Link
          href="/app/plan/new"
          data-testid="stats-active-block-cta"
          style={{ marginLeft: "auto", color: "var(--cp-accent)", fontWeight: 600, textDecoration: "none" }}
        >
          Start one →
        </Link>
      </div>
    );
  }

  // On-pace pill derived from real adherence in the current window — not
  // a fabricated label. ≥0.8 = on track, 0.5–0.8 = catching up, else behind.
  const r = adherence.ratio;
  const pill =
    adherence.scheduled === 0
      ? null
      : r >= 0.8
        ? { text: "On track", tone: "success" as Tone }
        : r >= 0.5
          ? { text: "Catching up", tone: "warning" as Tone }
          : { text: "Behind pace", tone: "danger" as Tone };

  return (
    <div
      data-testid="stats-card-active-block"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "13px 20px",
        borderBottom: "1px solid var(--cp-border)",
        background: "var(--cp-surface-soft)",
        fontSize: 13,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontWeight: 600 }}>{block.archetypeName}</span>
      <span style={{ color: "var(--cp-text-muted)" }}>
        · Week {block.currentWeek} of {block.weeks}
        {block.daysPerWeek != null && (
          <> · Day {block.currentDayInWeek} of {block.daysPerWeek} days/week</>
        )}
      </span>
      <span
        data-testid="stats-active-block-completion"
        style={{ color: "var(--cp-text-muted)" }}
      >
        · {block.logged} of {block.scheduledToDate} sessions logged
        {block.skipped > 0 && (
          <span style={{ color: "var(--cp-warning)" }}> · {block.skipped} skipped</span>
        )}
      </span>
      {pill != null && (
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11.5,
            fontWeight: 600,
            color: toneVar(pill.tone),
            background: "var(--cp-surface)",
            border: "1px solid var(--cp-border)",
            padding: "3px 11px",
            borderRadius: 999,
          }}
        >
          {pill.text}
        </span>
      )}
      <Link
        href="/app/plan/history"
        data-testid="stats-active-block-cta"
        style={{ marginLeft: pill ? 10 : "auto", color: "var(--cp-text-muted)", fontSize: 12, textDecoration: "none" }}
      >
        Block details →
      </Link>
    </div>
  );
}

function HeroCell({ children, border }: { children: ReactNode; border?: boolean }) {
  return (
    <div
      style={{
        padding: "18px 20px",
        borderLeft: border ? "1px solid var(--cp-border)" : undefined,
      }}
    >
      {children}
    </div>
  );
}

function CellLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: "var(--cp-text-muted)",
        marginBottom: 9,
      }}
    >
      {children}
    </div>
  );
}

function ProgressVerdictCell({ verdict, prs }: { verdict: ProgressVerdict; prs: PrsRangeResult }) {
  const tone = verdictTone(verdict.verdict);
  return (
    <>
      <div
        data-testid="stats-progress-verdict"
        style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 9 }}
      >
        <span style={{ color: toneVar(tone) }}>{verdictArrow(verdict.verdict)}</span>
        {verdict.label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 11 }}>
        {verdict.proofChips.map((chip, i) => (
          <ProofChip key={i} text={chip.text} cardio={chip.modality === "endurance"} />
        ))}
        {prs.uniqueMovementCount > 0 && (
          <ProofChip
            text={`${prs.uniqueMovementCount} PR${prs.uniqueMovementCount === 1 ? "" : "s"}`}
          />
        )}
      </div>
    </>
  );
}

function ProofChip({ text, cardio }: { text: string; cardio?: boolean }) {
  return (
    <span
      style={{
        fontSize: 12,
        padding: "4px 10px",
        borderRadius: 999,
        background: "var(--cp-surface-soft)",
        border: "1px solid var(--cp-border)",
        color: cardio ? "var(--cp-link)" : "var(--cp-text)",
        fontWeight: 600,
      }}
    >
      {text}
    </span>
  );
}

function ReadinessCell({ readiness }: { readiness: Readiness }) {
  const building = readiness.verdict === "building";
  const tone = readinessTone(readiness.verdict);
  return (
    <div data-testid="stats-readiness-cell">
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: toneVar(tone) }}>
        {building ? "Building" : readiness.verdictLabel}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--cp-text-muted)", marginTop: 7, lineHeight: 1.5 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: toneVar(tone),
            marginRight: 7,
          }}
        />
        {readiness.subtext || readiness.headline}
      </div>
    </div>
  );
}

function ConsistencyCell({ adherence, streak }: { adherence: AdherenceResult; streak: Streak }) {
  const pct = adherence.scheduled === 0 ? null : Math.round(adherence.ratio * 100);
  return (
    <div data-testid="stats-card-adherence">
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
        {pct == null ? "—" : `${pct}%`}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--cp-text-muted)", marginTop: 7, lineHeight: 1.5 }}>
        {streak.currentStreakWeeks > 0 && (
          <>
            {streak.currentStreakWeeks}-week streak ·{" "}
          </>
        )}
        {adherence.scheduled === 0 ? (
          "Nothing scheduled yet"
        ) : (
          <>
            {adherence.completed} of {adherence.scheduled} sessions
            {adherence.skipped > 0 && <> · {adherence.skipped} skipped</>}
          </>
        )}
      </div>
    </div>
  );
}

// ── BENTO TILES ──────────────────────────────────────────────────────

function Tile({
  span,
  testid,
  empty,
  children,
}: {
  span: number;
  testid: string;
  empty?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className="cp-card stats-bento-span"
      data-testid={testid}
      data-empty={empty ? "true" : "false"}
      style={{ ...CARD, gridColumn: `span ${span}` }}
    >
      {children}
    </section>
  );
}

// A — Strength progress
function StrengthTile({
  data,
  range,
  onExpand,
}: {
  data: StrengthProgress;
  range: Range;
  onExpand?: () => void;
}) {
  const liftRows = data.perLift.filter((l) => l.pointCount > 0);
  const isEmpty = data.direction === "building" && liftRows.length === 0;
  return (
    <Tile span={4} testid="stats-tile-strength" empty={isEmpty}>
      <TileHead
        title="Strength progress"
        meta={`e1RM · ${RANGE_LABEL[range]}`}
        right={
          isEmpty || onExpand == null ? undefined : (
            <button
              type="button"
              onClick={onExpand}
              data-testid="stats-strength-expand"
              aria-label="Open strength progress detail"
              style={{
                background: "transparent",
                border: "1px solid var(--cp-border)",
                borderRadius: 6,
                color: "var(--cp-text-muted)",
                fontSize: 11,
                cursor: "pointer",
                padding: "3px 8px",
                whiteSpace: "nowrap",
              }}
            >
              Detail →
            </button>
          )
        }
      />
      {isEmpty ? (
        <EmptyState
          variant="inline"
          title="Building strength trend"
          body={data.detail}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {liftRows.map((l) => {
            const tone = directionTone(l.direction);
            const slope = l.slopePerWeek;
            const slopeText =
              slope == null
                ? "—"
                : `${slope > 0 ? "+" : ""}${round1(slope)} kg/wk`;
            return (
              <div
                key={l.movementId}
                data-testid="stats-strength-lift"
                style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}
              >
                <span style={{ color: "var(--cp-text-muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.label}
                </span>
                <span className="mono" style={{ marginLeft: "auto", fontWeight: 600, color: toneVar(tone) }}>
                  {slopeText}
                </span>
                <span style={{ width: 14, textAlign: "right", color: toneVar(tone), fontSize: 11 }}>
                  {dirArrow(l.direction)}
                </span>
              </div>
            );
          })}
          <div style={{ fontSize: 11.5, color: "var(--cp-text-muted)", marginTop: 2 }}>{data.detail}</div>
        </div>
      )}
    </Tile>
  );
}

// A (drawer) — per-lift e1RM detail, opened from StrengthTile
export function StrengthDrawer({
  open,
  onClose,
  data,
  range,
}: {
  open: boolean;
  onClose: () => void;
  data: StrengthProgress;
  range: Range;
}) {
  const liftRows = data.perLift.filter((l) => l.pointCount > 0);
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      testId="stats-strength-drawer"
      ariaLabelledById="stats-strength-drawer-title"
      title={
        <div>
          <div id="stats-strength-drawer-title" style={{ fontSize: 16, fontWeight: 600 }}>
            Strength progress
          </div>
          <div style={{ fontSize: 11.5, color: "var(--cp-text-muted)", marginTop: 2 }}>
            estimated 1RM per main lift · {RANGE_LABEL[range]}
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--cp-text-muted)" }}>{data.detail}</p>
        {liftRows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--cp-text-muted)" }}>
            No main lift has enough logged sets in this window to chart yet.
          </p>
        ) : (
          liftRows.map((l) => {
            const tone = directionTone(l.direction);
            const accent =
              l.direction === "up" ? "success" : l.direction === "down" ? "danger" : "accent";
            const latest = l.points.length > 0 ? l.points[l.points.length - 1]!.e1rm : null;
            const slope = l.slopePerWeek;
            const slopeText =
              slope == null ? "—" : `${slope > 0 ? "+" : ""}${round1(slope)} kg/wk`;
            return (
              <div
                key={l.movementId}
                data-testid="stats-strength-drawer-lift"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  paddingBottom: 12,
                  borderBottom: "1px solid var(--cp-border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{l.label}</span>
                  <span
                    className="mono"
                    style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: toneVar(tone) }}
                  >
                    {slopeText}
                  </span>
                  <span style={{ width: 12, textAlign: "right", color: toneVar(tone), fontSize: 11 }}>
                    {dirArrow(l.direction)}
                  </span>
                </div>
                <Sparkline
                  values={l.points.map((p) => p.e1rm)}
                  accent={accent}
                  ariaLabel={`${l.label} estimated 1RM trend, ${l.pointCount} sessions`}
                />
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11.5, color: "var(--cp-text-muted)" }}>
                  <span>
                    {l.pointCount} session{l.pointCount === 1 ? "" : "s"}
                    {latest != null && (
                      <>
                        {" · latest "}
                        <span className="mono">{round1(latest)} kg</span>
                      </>
                    )}
                  </span>
                  {l.slug != null && (
                    <Link
                      href={`/app/stats/movements/${l.slug}`}
                      style={{ marginLeft: "auto", color: "var(--cp-accent)", textDecoration: "none", fontWeight: 500 }}
                    >
                      Full history →
                    </Link>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </BottomSheet>
  );
}

// B — Endurance progress
function EnduranceTile({
  data,
  range,
  onExpand,
}: {
  data: EnduranceProgress;
  range: Range;
  onExpand?: () => void;
}) {
  const noRun = data.direction === "no-run-data";
  return (
    <Tile span={4} testid="stats-tile-endurance" empty={noRun}>
      <TileHead
        title="Endurance progress"
        meta={`easy run · ${RANGE_LABEL[range]}`}
        right={
          noRun || onExpand == null ? undefined : (
            <button
              type="button"
              onClick={onExpand}
              data-testid="stats-endurance-expand"
              aria-label="Open endurance progress detail"
              style={{
                background: "transparent",
                border: "1px solid var(--cp-border)",
                borderRadius: 6,
                color: "var(--cp-text-muted)",
                fontSize: 11,
                cursor: "pointer",
                padding: "3px 8px",
                whiteSpace: "nowrap",
              }}
            >
              Detail →
            </button>
          )
        }
      />
      {noRun ? (
        <EmptyState variant="inline" title="No easy runs yet" body={data.detail} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="mono" style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.01em" }}>
              {data.easyPaceSecPerKm == null ? "—" : fmtPace(data.easyPaceSecPerKm)}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--cp-text-muted)" }}>/km avg</span>
            {data.slopeSecPerKmPerWeek != null && data.direction !== "building" && (
              <span
                style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: toneVar(directionTone(data.direction)) }}
              >
                {data.slopeSecPerKmPerWeek > 0 ? "+" : ""}
                {round1(data.slopeSecPerKmPerWeek)} s/km·wk
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--cp-text-muted)", marginTop: 6 }}>{data.detail}</div>
          <ZoneBars zones={data.timeInZone} />
        </>
      )}
    </Tile>
  );
}

function ZoneBars({ zones }: { zones: EnduranceProgress["timeInZone"] }) {
  if (zones.kind !== "ok") {
    const note =
      zones.kind === "no-strava"
        ? "Connect Strava to see time-in-zone."
        : zones.kind === "no-zones"
          ? "Set HR zones to see time-in-zone."
          : "No HR-stream data yet.";
    return (
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--cp-text-muted)" }}>{note}</div>
    );
  }
  const labels: Array<"Z1" | "Z2" | "Z3" | "Z4" | "Z5"> = ["Z1", "Z2", "Z3", "Z4", "Z5"];
  const max = Math.max(...labels.map((z) => zones.totals[z]), 1);
  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--cp-text-muted)",
          marginBottom: 6,
        }}
      >
        Time in zone · {zones.windowDays}d
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 54 }}>
        {labels.map((z) => {
          const h = Math.round((zones.totals[z] / max) * 100);
          return (
            <div key={z} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 5, height: "100%" }}>
              <div
                style={{
                  width: "100%",
                  height: `${Math.max(h, 2)}%`,
                  borderRadius: "4px 4px 0 0",
                  background: "var(--cp-link)",
                }}
              />
              <span style={{ fontSize: 10, color: "var(--cp-text-muted)" }}>{z}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// B (drawer) — easy-run pace trend + full time-in-zone, opened from EnduranceTile
export function EnduranceDrawer({
  open,
  onClose,
  data,
  range,
}: {
  open: boolean;
  onClose: () => void;
  data: EnduranceProgress;
  range: Range;
}) {
  const pace = data.weeklyPace;
  const accent: "success" | "danger" | "accent" =
    data.direction === "up" ? "success" : data.direction === "down" ? "danger" : "accent";
  const slope = data.slopeSecPerKmPerWeek;
  const slopeText =
    slope == null || data.direction === "building"
      ? "—"
      : `${slope > 0 ? "+" : ""}${round1(slope)} s/km·wk`;
  const z = data.timeInZone;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      testId="stats-endurance-drawer"
      ariaLabelledById="stats-endurance-drawer-title"
      title={
        <div>
          <div id="stats-endurance-drawer-title" style={{ fontSize: 16, fontWeight: 600 }}>
            Endurance progress
          </div>
          <div style={{ fontSize: 11.5, color: "var(--cp-text-muted)", marginTop: 2 }}>
            easy-run pace + time-in-zone · {RANGE_LABEL[range]}
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
              {data.easyPaceSecPerKm == null ? "—" : fmtPace(data.easyPaceSecPerKm)}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--cp-text-muted)" }}>/km easy avg</span>
            <span
              className="mono"
              style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: toneVar(directionTone(data.direction)) }}
            >
              {slopeText}
            </span>
          </div>
          {pace.length >= 2 && (
            <>
              <Sparkline
                values={pace}
                accent={accent}
                ariaLabel={`weekly easy-run pace trend, ${pace.length} weeks`}
              />
              <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                Weekly mean easy pace · lower = faster
              </div>
            </>
          )}
          <div style={{ fontSize: 11.5, color: "var(--cp-text-muted)" }}>{data.detail}</div>
          <div style={{ fontSize: 11.5, color: "var(--cp-text-muted)" }}>
            {data.sampleRuns} of {data.totalRuns} run{data.totalRuns === 1 ? "" : "s"} counted as easy
            {data.droppedRuns > 0 && (
              <>
                {" · "}
                {data.droppedRuns} dropped (effort unclear)
              </>
            )}
          </div>
        </section>

        <section
          data-testid="stats-endurance-zones"
          style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 14, borderTop: "1px solid var(--cp-border)" }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>Time in zone</div>
          {z.kind !== "ok" ? (
            <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
              {z.kind === "no-strava"
                ? "Connect Strava to see time-in-zone."
                : z.kind === "no-zones"
                  ? "Set your HR zones in Settings to see time-in-zone."
                  : "No HR-stream data in this window yet."}
            </p>
          ) : (
            <>
              <div style={{ fontSize: 11.5, color: "var(--cp-text-muted)" }}>
                {z.split.easyPct}% easy · {z.split.thresholdPct}% threshold · {z.split.hardPct}% hard
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
                {(["Z1", "Z2", "Z3", "Z4", "Z5"] as const).map((zone) => {
                  const mins = Math.round(z.totals[zone] / 60);
                  const maxMins = Math.max(
                    ...(["Z1", "Z2", "Z3", "Z4", "Z5"] as const).map((k) => z.totals[k]),
                    1,
                  ) / 60;
                  const pct = Math.round((mins / Math.max(maxMins, 1)) * 100);
                  const band =
                    zone === "Z1"
                      ? `<${z.bands.z1Max}`
                      : zone === "Z2"
                        ? `${z.bands.z1Max}–${z.bands.z2Max}`
                        : zone === "Z3"
                          ? `${z.bands.z2Max}–${z.bands.z3Max}`
                          : zone === "Z4"
                            ? `${z.bands.z3Max}–${z.bands.z4Max}`
                            : `≥${z.bands.z4Max}`;
                  return (
                    <div
                      key={zone}
                      data-testid="stats-endurance-zone-row"
                      style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}
                    >
                      <span style={{ width: 22, fontWeight: 600 }}>{zone}</span>
                      <span className="mono" style={{ width: 56, fontSize: 10.5, color: "var(--cp-text-muted)" }}>
                        {band} bpm
                      </span>
                      <span style={{ flex: 1, height: 8, background: "var(--cp-surface-soft)", borderRadius: 4, overflow: "hidden" }}>
                        <span
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${Math.max(mins > 0 ? 3 : 0, pct)}%`,
                            background: "var(--cp-link)",
                            borderRadius: 4,
                          }}
                        />
                      </span>
                      <span className="mono" style={{ width: 48, textAlign: "right", color: "var(--cp-text-muted)" }}>
                        {mins} min
                      </span>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 4 }}>
                {z.activityCount} activit{z.activityCount === 1 ? "y" : "ies"} · {z.windowDays}d ·{" "}
                {z.source === "measured"
                  ? "from measured HR streams"
                  : z.source === "approximated"
                    ? "estimated from average HR"
                    : "mixed measured + estimated"}
                {z.droppedCount > 0 && <> · {z.droppedCount} without HR dropped</>}
              </div>
            </>
          )}
        </section>

        <p style={{ margin: 0, fontSize: 11, color: "var(--cp-text-muted)" }}>
          Descriptive history — pace and zone distribution summarise what you ran, they do not
          drive workout prescription.
        </p>
      </div>
    </BottomSheet>
  );
}

// C — Recovery & load (region freshness + ACWR band, NO stress budget)
function RecoveryLoadTile({
  freshness,
  readiness,
  onExpand,
}: {
  freshness: FreshnessMiniRow[];
  readiness: Readiness;
  onExpand?: () => void;
}) {
  const colorByAccent: Record<FreshnessMiniRow["accent"], Tone> = {
    success: "success",
    warning: "warning",
    danger: "danger",
  };
  const lb = readiness.summary.loadBalance;
  return (
    <Tile span={4} testid="stats-card-freshness" empty={freshness.length === 0}>
      <TileHead
        title="Recovery & load"
        helpTerm="region_freshness"
        right={
          onExpand == null ? undefined : (
            <button
              type="button"
              onClick={onExpand}
              data-testid="stats-recovery-expand"
              aria-label="Open recovery and load detail"
              style={{
                background: "transparent",
                border: "1px solid var(--cp-border)",
                borderRadius: 6,
                color: "var(--cp-text-muted)",
                fontSize: 11,
                cursor: "pointer",
                padding: "3px 8px",
                whiteSpace: "nowrap",
              }}
            >
              Detail →
            </button>
          )
        }
      />
      {freshness.length === 0 ? (
        <EmptyState
          variant="inline"
          title="No region load yet"
          body="Log a session and freshness builds up region by region."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {freshness.map((r) => {
            const pct = Math.round(r.freshness * 100);
            return (
              <div
                key={r.region}
                data-testid="stats-freshness-row"
                style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}
              >
                <span style={{ width: 78, color: "var(--cp-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.regionLabel}
                </span>
                <span style={{ flex: 1, height: 8, borderRadius: 999, background: "var(--cp-surface-soft)", overflow: "hidden" }}>
                  <span style={{ display: "block", width: `${pct}%`, height: "100%", borderRadius: 999, background: toneVar(colorByAccent[r.accent]) }} />
                </span>
                <span className="mono" style={{ width: 30, textAlign: "right", fontWeight: 600, fontSize: 12 }}>
                  {pct}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <AcwrStrip loadBalance={lb} markerPct={readiness.gaugeMarkerPct} />
    </Tile>
  );
}

const ACWR_BAND_LABEL: Record<string, string> = {
  unknown: "Building baseline",
  detraining: "Detraining",
  productive: "Productive",
  pushing: "Pushing",
  spiking: "Spiking",
};

function AcwrStrip({
  loadBalance,
  markerPct,
}: {
  loadBalance: Readiness["summary"]["loadBalance"];
  markerPct: number;
}) {
  const ratio = loadBalance.ratio;
  return (
    <div style={{ marginTop: 14, paddingTop: 13, borderTop: "1px solid var(--cp-border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 7 }}>
        <span>
          Acute:chronic load
          <MetricHelp term="load_balance" />
        </span>
        <span className="mono" style={{ color: "var(--cp-text-muted)" }}>
          {ratio == null ? ACWR_BAND_LABEL.unknown : `${ratio.toFixed(2)} · ${ACWR_BAND_LABEL[loadBalance.band] ?? loadBalance.band}`}
        </span>
      </div>
      <div style={{ position: "relative", height: 10, borderRadius: 999, background: "var(--cp-surface-soft)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, Math.max(0, markerPct))}%`,
            background: "linear-gradient(90deg, var(--cp-accent), var(--cp-warning))",
            borderRadius: 999,
          }}
        />
      </div>
    </div>
  );
}

// C (drawer) — readiness / ACWR drilldown, opened from RecoveryLoadTile
export function ReadinessDrawer({
  open,
  onClose,
  readiness,
}: {
  open: boolean;
  onClose: () => void;
  readiness: Readiness;
}) {
  const lb = readiness.summary.loadBalance;
  const tone = readinessTone(readiness.verdict);
  const ratio = lb.ratio;
  const building = readiness.confidence === "building" || lb.weeksOfData < 4;
  // Band thresholds as positions on the 0..2.0 gauge axis.
  const tickPct = (t: number) => Math.min(100, Math.max(0, (t / 2.0) * 100));
  const ticks: Array<{ pct: number; label: string }> = [
    { pct: tickPct(LOAD_BAND_THRESHOLDS.detrainingMax), label: LOAD_BAND_THRESHOLDS.detrainingMax.toFixed(1) },
    { pct: tickPct(LOAD_BAND_THRESHOLDS.productiveMax), label: LOAD_BAND_THRESHOLDS.productiveMax.toFixed(1) },
    { pct: tickPct(LOAD_BAND_THRESHOLDS.pushingMax), label: LOAD_BAND_THRESHOLDS.pushingMax.toFixed(1) },
  ];
  const ot = readiness.summary.outputTrend;
  const rd = readiness.summary.rpeDrift;
  const signals: Array<{ label: string; value: string; detail: string }> = [
    {
      label: "Load balance",
      value:
        ratio == null
          ? "Building"
          : `${ratio.toFixed(2)} · ${ACWR_BAND_LABEL[lb.band] ?? lb.band}`,
      detail: `acute ${Math.round(lb.bodyAcute)} vs chronic ${Math.round(lb.bodyChronic)} (Σ ATL / Σ CTL)`,
    },
    {
      label: "sRPE drift · 28d",
      value: rd.verdictLabel,
      detail: rd.meanRpe == null ? "Not enough sessions yet" : `mean session RPE ${round1(rd.meanRpe)}`,
    },
    {
      label: "Output trend · 28d",
      value: ot.direction === "no-data" ? "No PR history yet" : ot.direction,
      detail: ot.direction === "no-data" ? ot.detail : `${ot.recentPrCount} PRs recent vs ${ot.priorPrCount} prior`,
    },
  ];
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      testId="stats-recovery-drawer"
      ariaLabelledById="stats-recovery-drawer-title"
      title={
        <div>
          <div id="stats-recovery-drawer-title" style={{ fontSize: 16, fontWeight: 600 }}>
            Recovery &amp; load
          </div>
          <div style={{ fontSize: 11.5, color: "var(--cp-text-muted)", marginTop: 2 }}>
            acute:chronic workload + corroborating signals
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: toneVar(tone) }}>
              {readiness.verdictLabel}
            </span>
            <span
              data-testid="stats-recovery-confidence"
              style={{ marginLeft: "auto", fontSize: 11, color: "var(--cp-text-muted)" }}
            >
              {building ? "building baseline" : `${readiness.signalsAgree} of 3 signals agree`}
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--cp-text)" }}>{readiness.headline}</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--cp-text-muted)" }}>{readiness.subtext}</p>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Acute:chronic ratio</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
              {ratio == null ? "—" : ratio.toFixed(2)}
            </span>
          </div>
          <div style={{ position: "relative", height: 12, borderRadius: 999, background: "var(--cp-surface-soft)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${Math.min(100, Math.max(0, readiness.gaugeMarkerPct))}%`,
                background: "linear-gradient(90deg, var(--cp-accent), var(--cp-warning))",
                borderRadius: 999,
              }}
            />
            {ticks.map((t) => (
              <span
                key={t.pct}
                aria-hidden
                style={{ position: "absolute", top: 0, bottom: 0, left: `${t.pct}%`, width: 1, background: "var(--cp-border-strong)" }}
              />
            ))}
          </div>
          <div style={{ position: "relative", height: 14, marginTop: 2, fontSize: 9.5, color: "var(--cp-text-muted)" }}>
            {ticks.map((t) => (
              <span key={t.pct} className="mono" style={{ position: "absolute", left: `${t.pct}%`, transform: "translateX(-50%)" }}>
                {t.label}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 8, lineHeight: 1.5 }}>
            Detraining &lt;{LOAD_BAND_THRESHOLDS.detrainingMax} · productive{" "}
            {LOAD_BAND_THRESHOLDS.detrainingMax}–{LOAD_BAND_THRESHOLDS.productiveMax} · pushing{" "}
            {LOAD_BAND_THRESHOLDS.productiveMax}–{LOAD_BAND_THRESHOLDS.pushingMax} · spiking &gt;
            {LOAD_BAND_THRESHOLDS.pushingMax}. EWMA acute:chronic on session load; thresholds echo
            the Gabbett 2016 sweet-spot range.
          </div>
          {building && (
            <div style={{ fontSize: 11, color: "var(--cp-warning)", marginTop: 6 }}>
              Only {lb.weeksOfData} week{lb.weeksOfData === 1 ? "" : "s"} of history — the chronic
              baseline is still warming up, so treat the band as provisional.
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--cp-text-muted)", marginBottom: 8 }}>
            Corroborating signals
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {signals.map((s) => (
              <div key={s.label} data-testid="stats-recovery-signal" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 12.5, color: "var(--cp-text-muted)" }}>{s.label}</span>
                  <span className="mono" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600 }}>{s.value}</span>
                </div>
                <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>{s.detail}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingTop: 4, borderTop: "1px solid var(--cp-border)" }}>
          <span style={{ fontSize: 10.5, color: "var(--cp-text-muted)" }}>
            Display only — readiness never feeds workout prescription.
          </span>
          <Link
            href="/app/stats/engine"
            data-testid="stats-recovery-engine-link"
            style={{ marginLeft: "auto", fontSize: 12, color: "var(--cp-accent)", textDecoration: "none", fontWeight: 500 }}
          >
            How the planner sees you →
          </Link>
        </div>
      </div>
    </BottomSheet>
  );
}

// D — Consistency & balance (weekly rhythm bars + this-week)
function ConsistencyTile({
  rhythm,
  streak,
  onExpand,
}: {
  rhythm: WeeklyRhythm;
  streak: Streak;
  onExpand?: () => void;
}) {
  const weeks = rhythm.weeks.slice(-12);
  const maxCount = Math.max(
    ...weeks.map((w) => Math.max(w.strengthCount + w.cardioCount, w.plannedCount)),
    1,
  );
  const isEmpty = weeks.every((w) => w.strengthCount + w.cardioCount + w.plannedCount === 0);
  return (
    <Tile span={8} testid="stats-tile-consistency" empty={isEmpty}>
      <TileHead
        title="Consistency & balance"
        right={
          <span style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "var(--cp-text-muted)" }}>
            <Legend color="var(--cp-accent)" label="Strength" />
            <Legend color="var(--cp-link)" label="Cardio" />
            <Legend dashed label="Planned" />
            {!isEmpty && onExpand != null && (
              <button
                type="button"
                onClick={onExpand}
                data-testid="stats-consistency-expand"
                aria-label="Open consistency detail"
                style={{
                  background: "transparent",
                  border: "1px solid var(--cp-border)",
                  borderRadius: 6,
                  color: "var(--cp-text-muted)",
                  fontSize: 11,
                  cursor: "pointer",
                  padding: "3px 8px",
                  whiteSpace: "nowrap",
                }}
              >
                Detail →
              </button>
            )}
          </span>
        }
      />
      {isEmpty ? (
        <EmptyState
          variant="inline"
          title="No sessions logged yet"
          body="Log strength and cardio sessions and your weekly rhythm builds up here."
        />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 9, height: 118, paddingTop: 6 }}>
            {weeks.map((w) => {
              const isNow = w === weeks[weeks.length - 1];
              return (
                <div key={w.weekStart} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%" }}>
                  <div style={{ position: "relative", width: "100%", maxWidth: 30, height: 92, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
                    {w.plannedCount > 0 && (
                      <div
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          left: "50%",
                          transform: "translateX(-50%)",
                          bottom: 0,
                          width: "100%",
                          maxWidth: 30,
                          height: `${(w.plannedCount / maxCount) * 100}%`,
                          border: "1px dashed var(--cp-border)",
                          borderRadius: 5,
                        }}
                      />
                    )}
                    {w.cardioCount > 0 && (
                      <div
                        style={{
                          width: "100%",
                          maxWidth: 30,
                          height: `${(w.cardioCount / maxCount) * 100}%`,
                          background: "var(--cp-link)",
                          borderRadius: w.strengthCount > 0 ? 0 : "5px 5px 0 0",
                        }}
                      />
                    )}
                    {w.strengthCount > 0 && (
                      <div
                        style={{
                          width: "100%",
                          maxWidth: 30,
                          height: `${(w.strengthCount / maxCount) * 100}%`,
                          background: "var(--cp-accent)",
                          borderRadius: "0 0 5px 5px",
                        }}
                      />
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: isNow ? "var(--cp-accent)" : "var(--cp-text-muted)", fontWeight: isNow ? 600 : 400 }}>
                    {isNow ? "now" : weekShort(w.weekStart)}
                  </span>
                </div>
              );
            })}
          </div>
          <ThisWeek streak={streak} />
        </>
      )}
    </Tile>
  );
}

// D (drawer) — weekly rhythm + adherence summary, opened from ConsistencyTile
export function ConsistencyDrawer({
  open,
  onClose,
  rhythm,
  streak,
}: {
  open: boolean;
  onClose: () => void;
  rhythm: WeeklyRhythm;
  streak: Streak;
}) {
  const weeks = rhythm.weeks.slice(-16);
  const totalStrength = weeks.reduce((a, w) => a + w.strengthCount, 0);
  const totalCardio = weeks.reduce((a, w) => a + w.cardioCount, 0);
  const totalDone = totalStrength + totalCardio;
  const balancePct = totalDone === 0 ? null : Math.round((totalStrength / totalDone) * 100);
  const activeWeeks = weeks.filter((w) => w.strengthCount + w.cardioCount > 0).length;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      testId="stats-consistency-drawer"
      ariaLabelledById="stats-consistency-drawer-title"
      title={
        <div>
          <div id="stats-consistency-drawer-title" style={{ fontSize: 16, fontWeight: 600 }}>
            Consistency &amp; balance
          </div>
          <div style={{ fontSize: 11.5, color: "var(--cp-text-muted)", marginTop: 2 }}>
            weekly rhythm · last {weeks.length} weeks
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <section style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <Stat label="Current streak" value={`${streak.currentStreakWeeks} wk`} />
          <Stat label="Weekly target" value={streak.weeklyTarget > 0 ? `${streak.weeklyTarget}/wk` : "—"} />
          <Stat label="Active weeks" value={`${activeWeeks} of ${weeks.length}`} />
          <Stat
            label="Strength : cardio"
            value={balancePct == null ? "—" : `${balancePct} : ${100 - balancePct}`}
          />
        </section>

        {streak.hasActiveBlock && streak.thisWeekTarget > 0 && (
          <p style={{ margin: 0, fontSize: 12.5 }}>
            <span style={{ fontWeight: 600 }}>
              This week · {streak.thisWeekCompleted} of {streak.thisWeekTarget} done
            </span>
          </p>
        )}

        <section style={{ display: "flex", flexDirection: "column", gap: 5, paddingTop: 14, borderTop: "1px solid var(--cp-border)" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>Week by week</div>
          {weeks
            .slice()
            .reverse()
            .map((w) => {
              const done = w.strengthCount + w.cardioCount;
              return (
                <div
                  key={w.weekStart}
                  data-testid="stats-consistency-week-row"
                  style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}
                >
                  <span className="mono" style={{ width: 44, color: "var(--cp-text-muted)" }}>
                    {weekShort(w.weekStart)}
                  </span>
                  <span style={{ flex: 1, display: "flex", gap: 4, alignItems: "center" }}>
                    {w.strengthCount > 0 && (
                      <span style={{ height: 9, borderRadius: 2, background: "var(--cp-accent)", width: `${w.strengthCount * 14}px`, maxWidth: 110 }} />
                    )}
                    {w.cardioCount > 0 && (
                      <span style={{ height: 9, borderRadius: 2, background: "var(--cp-link)", width: `${w.cardioCount * 14}px`, maxWidth: 110 }} />
                    )}
                    {done === 0 && (
                      <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>—</span>
                    )}
                  </span>
                  <span className="mono" style={{ color: "var(--cp-text-muted)", width: 78, textAlign: "right" }}>
                    {w.strengthCount}S · {w.cardioCount}C
                    {w.plannedCount > 0 && <> / {w.plannedCount}</>}
                  </span>
                </div>
              );
            })}
        </section>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid var(--cp-border)" }}>
          <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
            Completion, weekday mix, archetype split and skip notes
          </span>
          <Link
            href="/app/stats/adherence"
            data-testid="stats-consistency-adherence-link"
            style={{ fontSize: 12.5, color: "var(--cp-accent)", textDecoration: "none", fontWeight: 500, whiteSpace: "nowrap" }}
          >
            Consistency details →
          </Link>
        </div>
      </div>
    </BottomSheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
        {value}
      </span>
      <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>{label}</span>
    </div>
  );
}

function Legend({ color, dashed, label }: { color?: string; dashed?: boolean; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <i
        style={{
          display: "inline-block",
          width: 9,
          height: 9,
          borderRadius: 2,
          background: dashed ? "transparent" : color,
          border: dashed ? "1px dashed var(--cp-border)" : undefined,
        }}
      />
      {label}
    </span>
  );
}

function ThisWeek({ streak }: { streak: Streak }) {
  if (!streak.hasActiveBlock || streak.thisWeekTarget === 0) return null;
  const done = streak.thisWeekCompleted;
  const target = streak.thisWeekTarget;
  const remaining = Math.max(0, target - done);
  const dots: Array<"done" | "todo"> = [];
  for (let i = 0; i < target; i++) dots.push(i < done ? "done" : "todo");
  return (
    <div style={{ marginTop: 14, paddingTop: 13, borderTop: "1px solid var(--cp-border)", display: "flex", alignItems: "center", gap: 16 }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>
          This week · {done} of {target} done
        </div>
        <div style={{ fontSize: 11.5, color: "var(--cp-text-muted)", marginTop: 2 }}>
          {remaining === 0
            ? "Week target met — nice work"
            : `${remaining} session${remaining === 1 ? "" : "s"} to go to keep the streak`}
        </div>
      </div>
      <div style={{ display: "flex", gap: 9, marginLeft: "auto" }}>
        {dots.map((d, i) => (
          <span
            key={i}
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              fontSize: 11,
              background: d === "done" ? "var(--cp-accent)" : "transparent",
              color: d === "done" ? "#1a1a1a" : "var(--cp-text-muted)",
              border: d === "done" ? undefined : "1.5px dashed var(--cp-border)",
            }}
          >
            {d === "done" ? "✓" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function weekShort(ymd: string): string {
  // ymd = YYYY-MM-DD (monday). Render "d/m" compactly.
  const parts = ymd.split("-");
  if (parts.length !== 3) return "";
  return `${Number(parts[2])}/${Number(parts[1])}`;
}

// E — Bodyweight
function BodyweightTile({ data, units }: { data: BodyweightTrend; units: WeightUnit }) {
  const unit = weightUnitLabel(units);
  if (!data.latest) {
    return (
      <Tile span={4} testid="stats-card-bodyweight" empty>
        <TileHead title="Bodyweight" meta={`${unit} · 30d`} helpTerm="bodyweight_trend" />
        <EmptyState
          variant="inline"
          title="No bodyweight logged"
          body="Log bodyweight on the Today page or in Settings and your 30-day trend appears here."
        />
      </Tile>
    );
  }
  const latest = displayWeight(data.latest.kg, units);
  const delta = data.delta30dKg == null ? null : displayWeight(data.delta30dKg, units);
  const accent: "success" | "warning" | "accent" =
    delta == null ? "accent" : delta > 0 ? "warning" : delta < 0 ? "success" : "accent";
  return (
    <Tile span={4} testid="stats-card-bodyweight">
      <TileHead title="Bodyweight" meta={`${unit} · 30d`} helpTerm="bodyweight_trend" />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="mono" style={{ fontSize: 21, fontWeight: 700 }}>
          {round1(latest)}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--cp-text-muted)" }}>{unit}</span>
        {delta != null && (
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: toneVar(accent === "accent" ? "muted" : accent) }}>
            {delta > 0 ? "▲ +" : delta < 0 ? "▼ " : ""}
            {round1(delta)} {unit}
          </span>
        )}
      </div>
      <div style={{ marginTop: 6 }}>
        <Sparkline
          values={data.series.map((p) => displayWeight(p.kg, units))}
          accent={accent}
          ariaLabel="bodyweight over the last 30 days"
        />
      </div>
    </Tile>
  );
}

// F — Training volume (weekly tonnage over the selected range)
function fmtTonnage(v: number): string {
  // Locale-independent thousands grouping so tests stay deterministic.
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function VolumeTile({
  data,
  range,
  units,
}: {
  data: VolumeRangeResult;
  range: Range;
  units: WeightUnit;
}) {
  const unit = weightUnitLabel(units);
  const buckets = data.weeklyKg;
  const isEmpty = data.totalKg <= 0;
  const maxKg = Math.max(...buckets, 1);
  const totalDisp = displayWeight(data.totalKg, units);
  const thisWeekKg = buckets.length > 0 ? buckets[buckets.length - 1] : 0;
  const thisWeekDisp = displayWeight(thisWeekKg, units);
  const labelStride = buckets.length > 18 ? 4 : buckets.length > 9 ? 2 : 1;
  return (
    <Tile span={12} testid="stats-tile-volume" empty={isEmpty}>
      <TileHead title="Training volume" meta={`tonnage · ${RANGE_LABEL[range]}`} />
      {isEmpty ? (
        <EmptyState
          variant="inline"
          title="No strength volume yet"
          body="Log working strength sets and your weekly tonnage builds up here."
        />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="mono" style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.01em" }}>
              {fmtTonnage(totalDisp)}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--cp-text-muted)" }}>{unit} total · {RANGE_LABEL[range]}</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 96, paddingTop: 10 }}>
            {buckets.map((kg, i) => {
              const isNow = i === buckets.length - 1;
              const ws = data.weekStarts[i] ?? String(i);
              const heightPct = (kg / maxKg) * 100;
              const showLabel = isNow || i % labelStride === 0;
              return (
                <div key={ws} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%" }}>
                  <div style={{ width: "100%", height: 70, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
                    <div
                      data-testid="stats-volume-bar"
                      title={`${fmtTonnage(displayWeight(kg, units))} ${unit}`}
                      style={{
                        width: "100%",
                        maxWidth: 26,
                        height: `${kg > 0 ? Math.max(3, heightPct) : 0}%`,
                        background: "var(--cp-accent)",
                        opacity: isNow ? 1 : 0.5,
                        borderRadius: "4px 4px 0 0",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: isNow ? "var(--cp-accent)" : "var(--cp-text-muted)", fontWeight: isNow ? 600 : 400, minHeight: 12 }}>
                    {showLabel ? (isNow ? "now" : weekShort(data.weekStarts[i] ?? "")) : ""}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 14, paddingTop: 13, borderTop: "1px solid var(--cp-border)", fontSize: 12.5 }}>
            <span style={{ fontWeight: 600 }}>This week · {fmtTonnage(thisWeekDisp)} {unit}</span>
            <span style={{ color: "var(--cp-text-muted)" }}> · Σ weight × reps, working sets only</span>
          </div>
        </>
      )}
    </Tile>
  );
}
