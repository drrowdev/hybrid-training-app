"use client";

/**
 * ReadinessCard — composite verdict card for /app/stats.
 *
 * Renders the readiness composite produced by `lib/stats/readiness.ts`:
 *   - confidence chip (top right)
 *   - big verdict word + load ratio
 *   - one-line subtext
 *   - banded acute:chronic gauge (detraining / productive / push / spiking
 *     over a 0–2.0 scale) with a triangle marker
 *   - "Does the evidence agree?" — 3 signal rows (effort / output / load
 *     balance)
 *   - honest-limit caveat box
 *
 * Drill-down: a "Fitness · Fatigue · Form" panel toggled open via a
 * button at the bottom of the card. v1 ships the **scalar** version
 * (current chronic, acute, and their difference plus the four-signal
 * breakdown + formula + citations) — a full 90-day daily PMC series
 * adds substantial query cost for marginal v1 value (no series live on
 * the read path today). We can swap the scalar block for an SVG PMC
 * later behind the same toggle.
 *
 * Cold-start: when verdict === "building" we render a muted state with
 * no gauge band assertion. Empty (no region_state at all) → friendly
 * EmptyState pointing back to "log a workout".
 *
 * Forbidden program-name scan: this file references AMRAP / TM% only
 * indirectly via shared vocabulary; no banned program names appear.
 */
import { useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { Readiness, ReadinessVerdict } from "@/lib/stats/readiness";
import { EmptyState } from "@/components/ui/EmptyState";

export type ReadinessCardProps = {
  readiness: Readiness;
};

type Tone = "accent" | "warning" | "danger" | "muted" | "success";

function toneFor(verdict: ReadinessVerdict): Tone {
  switch (verdict) {
    case "productive":
    case "pushing-tolerated":
      return verdict === "productive" ? "accent" : "warning";
    case "watch":
      return "warning";
    case "overreaching":
      return "danger";
    case "detraining":
    case "building":
      return "muted";
  }
}

function toneVar(tone: Tone): string {
  switch (tone) {
    case "accent":
      return "var(--cp-accent)";
    case "warning":
      return "var(--cp-warning)";
    case "danger":
      return "var(--cp-danger)";
    case "success":
      return "var(--cp-success)";
    case "muted":
      return "var(--cp-text-muted)";
  }
}

export function ReadinessCard({ readiness }: ReadinessCardProps): ReactElement {
  // Empty: no region_state at all → no acute, no chronic, no sessions.
  const isEmpty =
    readiness.summary.loadBalance.bodyAcute === 0 &&
    readiness.summary.loadBalance.bodyChronic === 0 &&
    readiness.summary.loadBalance.weeksOfData === 0;

  if (isEmpty) {
    return (
      <section
        className="cp-card"
        data-testid="stats-card-readiness"
        data-empty="true"
        style={{ padding: 18, display: "grid", gap: 8 }}
      >
        <CardHeader confidence={readiness.confidence} signalsAgree={readiness.signalsAgree} />
        <EmptyState
          variant="inline"
          title="Readiness lights up after a few workouts"
          body="Log a few sessions (strength or cardio) and your acute:chronic load, effort drift, and output trend populate here."
        />
      </section>
    );
  }

  return (
    <section
      className="cp-card"
      data-testid="stats-card-readiness"
      data-verdict={readiness.verdict}
      data-confidence={readiness.confidence}
      style={{ padding: 18, display: "grid", gap: 10 }}
    >
      <CardHeader confidence={readiness.confidence} signalsAgree={readiness.signalsAgree} />

      <VerdictRow
        verdict={readiness.verdict}
        verdictLabel={readiness.verdictLabel}
        ratio={readiness.summary.loadBalance.ratio}
      />

      <p
        data-testid="stats-readiness-subtext"
        style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.5 }}
      >
        {readiness.subtext}
      </p>

      {readiness.verdict !== "building" && (
        <Gauge
          markerPct={readiness.gaugeMarkerPct}
          ratio={readiness.summary.loadBalance.ratio}
          band={readiness.summary.loadBalance.band}
          bodyAcute={readiness.summary.loadBalance.bodyAcute}
          bodyChronic={readiness.summary.loadBalance.bodyChronic}
        />
      )}

      <SignalStack readiness={readiness} />

      <Caveat readiness={readiness} />

      <Drilldown readiness={readiness} />
    </section>
  );
}

// ── Header / confidence chip ─────────────────────────────────────────

function CardHeader({
  confidence,
  signalsAgree,
}: {
  confidence: Readiness["confidence"];
  signalsAgree: number;
}): ReactElement {
  const label =
    confidence === "agree"
      ? `${signalsAgree} signals agree`
      : confidence === "building"
      ? "Building baseline"
      : "Mixed signals";
  const color =
    confidence === "agree"
      ? "var(--cp-success)"
      : confidence === "mixed"
      ? "var(--cp-warning)"
      : "var(--cp-text-muted)";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        Readiness
      </div>
      <div
        data-testid="stats-readiness-confidence"
        data-confidence={confidence}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color,
          fontWeight: 600,
        }}
      >
        <ConfidenceDots signalsAgree={signalsAgree} confidence={confidence} />
        {label}
      </div>
    </div>
  );
}

function ConfidenceDots({
  signalsAgree,
  confidence,
}: {
  signalsAgree: number;
  confidence: Readiness["confidence"];
}): ReactElement {
  const dots = [0, 1, 2];
  const onColor =
    confidence === "agree" ? "var(--cp-success)" : "var(--cp-warning)";
  return (
    <span style={{ display: "inline-flex", gap: 3 }} aria-hidden="true">
      {dots.map((i) => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: i < signalsAgree ? onColor : "var(--cp-border)",
          }}
        />
      ))}
    </span>
  );
}

// ── Verdict row ──────────────────────────────────────────────────────

function VerdictRow({
  verdict,
  verdictLabel,
  ratio,
}: {
  verdict: ReadinessVerdict;
  verdictLabel: string;
  ratio: number | null;
}): ReactElement {
  const tone = toneFor(verdict);
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 11, flexWrap: "wrap" }}>
      <span
        data-testid="stats-readiness-verdict"
        style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.01em", color: toneVar(tone) }}
      >
        {verdictLabel}
      </span>
      {ratio != null && (
        <span style={{ fontSize: 12.5, color: "var(--cp-text-muted)" }}>
          load ratio{" "}
          <b style={{ color: "var(--cp-text)", fontWeight: 700 }} className="mono">
            {ratio.toFixed(2)}
          </b>
        </span>
      )}
    </div>
  );
}

// ── Gauge ────────────────────────────────────────────────────────────

const ZONE_DETRAIN_PCT = 40;
const ZONE_PROD_PCT = 25;
const ZONE_PUSH_PCT = 10;
const ZONE_SPIKE_PCT = 25;

function Gauge({
  markerPct,
  ratio,
  band,
  bodyAcute,
  bodyChronic,
}: {
  markerPct: number;
  ratio: number | null;
  band: string;
  bodyAcute: number;
  bodyChronic: number;
}): ReactElement {
  const bandLabel = (() => {
    switch (band) {
      case "detraining":
        return { text: "Detraining <0.8", color: "var(--cp-text-muted)" };
      case "productive":
        return { text: "Productive 0.8–1.3", color: "var(--cp-accent)" };
      case "pushing":
        return { text: "Pushing 1.3–1.5", color: "var(--cp-warning)" };
      case "spiking":
        return { text: "Spiking ≥1.5", color: "var(--cp-danger)" };
      default:
        return { text: "No baseline yet", color: "var(--cp-text-muted)" };
    }
  })();

  return (
    <div data-testid="stats-readiness-gauge" style={{ marginTop: 4 }}>
      <div style={{ position: "relative", paddingTop: 16 }}>
        <div
          aria-hidden="true"
          style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden" }}
        >
          <span
            style={{
              width: `${ZONE_DETRAIN_PCT}%`,
              background: "var(--cp-text-muted)",
              opacity: 0.4,
            }}
          />
          <span style={{ width: `${ZONE_PROD_PCT}%`, background: "var(--cp-accent)" }} />
          <span style={{ width: `${ZONE_PUSH_PCT}%`, background: "var(--cp-warning)" }} />
          <span style={{ width: `${ZONE_SPIKE_PCT}%`, background: "var(--cp-danger)" }} />
        </div>
        {ratio != null && <Marker pct={markerPct} ratio={ratio} />}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 8,
          fontSize: 10.5,
          color: "var(--cp-text-muted)",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span>
          acute:chronic —{" "}
          <b style={{ color: bandLabel.color, fontWeight: 600 }}>{bandLabel.text}</b>
        </span>
        <span className="mono">
          {Math.round(bodyAcute).toLocaleString()} / {Math.round(bodyChronic).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function Marker({ pct, ratio }: { pct: number; ratio: number }): ReactElement {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: -2,
        left: `${clamped}%`,
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          background: "var(--cp-text)",
          color: "var(--cp-bg, #1a1a1a)",
          padding: "1px 6px",
          borderRadius: 6,
          whiteSpace: "nowrap",
          marginBottom: 2,
        }}
        className="mono"
      >
        {ratio.toFixed(2)}
      </span>
      <span
        style={{
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: "7px solid var(--cp-text)",
        }}
      />
    </div>
  );
}

// ── Signal stack ─────────────────────────────────────────────────────

function SignalStack({ readiness }: { readiness: Readiness }): ReactElement {
  const { rpeDrift, outputTrend, loadBalance } = readiness.summary;

  const effortTone: Tone =
    rpeDrift.verdict === "rising"
      ? "danger"
      : rpeDrift.verdict === "easing" || rpeDrift.verdict === "stable"
      ? "success"
      : "muted";
  const effortArrow =
    rpeDrift.verdict === "rising" ? "↗" : rpeDrift.verdict === "easing" ? "↘" : "↔";

  const outputTone: Tone =
    outputTrend.direction === "rising"
      ? "success"
      : outputTrend.direction === "falling"
      ? "danger"
      : outputTrend.direction === "flat"
      ? "success"
      : "muted";
  const outputArrow =
    outputTrend.direction === "rising"
      ? "↗"
      : outputTrend.direction === "falling"
      ? "↘"
      : outputTrend.direction === "flat"
      ? "↔"
      : "·";

  const balanceTone: Tone =
    loadBalance.band === "productive"
      ? "success"
      : loadBalance.band === "pushing"
      ? "warning"
      : loadBalance.band === "spiking"
      ? "danger"
      : loadBalance.band === "detraining"
      ? "muted"
      : "muted";

  return (
    <div data-testid="stats-readiness-signals" style={{ marginTop: 8 }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--cp-text-muted)",
          paddingTop: 12,
          borderTop: "1px solid var(--cp-border)",
          marginBottom: 8,
        }}
      >
        Does the evidence agree?
      </div>
      <SignalRow
        name="Effort (sRPE)"
        tone={effortTone}
        value={prettyEffort(rpeDrift.verdict)}
        arrow={effortArrow}
      />
      <SignalRow
        name="Output"
        tone={outputTone}
        value={prettyOutput(outputTrend)}
        arrow={outputArrow}
      />
      <SignalRow
        name="Load balance"
        tone={balanceTone}
        value={
          loadBalance.ratio == null ? "no baseline" : `ratio ${loadBalance.ratio.toFixed(2)}`
        }
        arrow="·"
      />
    </div>
  );
}

function prettyEffort(verdict: string): string {
  switch (verdict) {
    case "rising":
      return "Rising";
    case "easing":
      return "Easing";
    case "stable":
      return "Stable";
    case "no-data":
    default:
      return "No data yet";
  }
}

function prettyOutput(t: Readiness["summary"]["outputTrend"]): string {
  if (t.direction === "no-data") return "No PRs yet";
  if (t.direction === "rising") return `${t.recentPrCount} new PR${t.recentPrCount === 1 ? "" : "s"} (28d)`;
  if (t.direction === "falling") return `${t.recentPrCount} vs ${t.priorPrCount} prior`;
  return `${t.recentPrCount} PR${t.recentPrCount === 1 ? "" : "s"} (28d)`;
}

function SignalRow({
  name,
  tone,
  value,
  arrow,
}: {
  name: string;
  tone: Tone;
  value: string;
  arrow: string;
}): ReactElement {
  const arrowColor =
    arrow === "↗" ? "var(--cp-success)" : arrow === "↘" ? "var(--cp-danger)" : "var(--cp-text-muted)";
  return (
    <div
      data-testid="stats-readiness-signal"
      data-signal-name={name}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 0",
        fontSize: 12.5,
        borderTop: "1px solid var(--cp-surface-soft)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: toneVar(tone),
          flex: "none",
        }}
      />
      <span style={{ color: "var(--cp-text-muted)", width: 110, flex: "none" }}>{name}</span>
      <span style={{ color: "var(--cp-text)", fontWeight: 600, flex: 1, minWidth: 0 }}>{value}</span>
      <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 12, color: arrowColor }}>
        {arrow}
      </span>
    </div>
  );
}

// ── Caveat ───────────────────────────────────────────────────────────

function Caveat({ readiness }: { readiness: Readiness }): ReactElement {
  const weeks = readiness.summary.loadBalance.weeksOfData;
  const baselineLine =
    readiness.confidence === "building"
      ? `Building baseline (${weeks} of 4 weeks).`
      : `Baseline: ${weeks} week${weeks === 1 ? "" : "s"} logged — bands tuned to your history.`;
  return (
    <div
      data-testid="stats-readiness-caveat"
      style={{
        marginTop: 4,
        padding: "10px 12px",
        background: "var(--cp-surface-soft)",
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        fontSize: 11,
        color: "var(--cp-text-muted)",
        lineHeight: 1.55,
      }}
    >
      <b style={{ color: "var(--cp-text)" }}>{baselineLine}</b>{" "}
      <b style={{ color: "var(--cp-text)" }}>Honest limit:</b> built from training load + output, no
      HRV/sleep — reads how you&rsquo;re absorbing work, not autonomic recovery.
    </div>
  );
}

// ── Drill-down ───────────────────────────────────────────────────────

function Drilldown({ readiness }: { readiness: Readiness }): ReactElement {
  const [open, setOpen] = useState(false);
  const { loadBalance, rpeDrift, outputTrend } = readiness.summary;
  const form = loadBalance.bodyChronic - loadBalance.bodyAcute;

  return (
    <div data-testid="stats-readiness-drilldown" style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="stats-readiness-drilldown-toggle"
        style={{
          background: "transparent",
          border: "1px solid var(--cp-border)",
          color: "var(--cp-text-muted)",
          borderRadius: 999,
          padding: "5px 12px",
          fontSize: 11.5,
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        {open ? "Hide" : "Show"} Fitness · Fatigue · Form →
      </button>

      {open && (
        <div
          data-testid="stats-readiness-drilldown-panel"
          style={{ marginTop: 12, display: "grid", gap: 14 }}
        >
          {/* Scalar PMC view — v1 ships the three current scalars rather than
              a full 90-day daily series (that adds substantial query cost
              with no live read-path equivalent today). */}
          <Section title="Fitness · Fatigue · Form (current)">
            <div className="four" style={fourGridStyle}>
              <ScalarCard
                dotColor="var(--cp-cardio)"
                label="Fitness (chronic)"
                value={Math.round(loadBalance.bodyChronic).toLocaleString()}
                sub="Σ CTL across regions — 28-day EWMA of training load."
              />
              <ScalarCard
                dotColor="var(--cp-warning)"
                label="Fatigue (acute)"
                value={Math.round(loadBalance.bodyAcute).toLocaleString()}
                sub="Σ ATL across regions — 7-day EWMA."
              />
              <ScalarCard
                dotColor="var(--cp-accent)"
                label="Form (chronic − acute)"
                value={Math.round(form).toLocaleString()}
                sub="Banister TSB analogue — positive = fresh, negative = loaded."
              />
              <ScalarCard
                dotColor={toneVar(toneFor(readiness.verdict))}
                label="Load ratio"
                value={loadBalance.ratio == null ? "—" : loadBalance.ratio.toFixed(2)}
                sub="acute / chronic. Headline band on the gauge."
              />
            </div>
          </Section>

          <Section title="The four signals">
            <div className="four" style={fourGridStyle}>
              <ScalarCard
                dotColor="var(--cp-accent)"
                label="Load balance"
                value={`${loadBalance.ratio == null ? "—" : loadBalance.ratio.toFixed(2)} · ${loadBalance.band}`}
                sub="Acute 7-day vs chronic 28-day EWMA of RPE-weighted load (per-region sum)."
              />
              <ScalarCard
                dotColor={toneVar(rpeDrift.verdict === "rising" ? "danger" : "success")}
                label="Effort drift"
                value={prettyEffort(rpeDrift.verdict)}
                sub="sRPE slope over the last 28 days — same work isn't supposed to feel harder."
              />
              <ScalarCard
                dotColor={toneVar(
                  outputTrend.direction === "rising"
                    ? "success"
                    : outputTrend.direction === "falling"
                    ? "danger"
                    : "muted",
                )}
                label="Output"
                value={prettyOutput(outputTrend)}
                sub="Unique-movement e1RM PRs in the last 28d vs the prior 28d window."
              />
              <ScalarCard
                dotColor="var(--cp-text-muted)"
                label="Cold-start gate"
                value={`${loadBalance.weeksOfData}/${4} wk`}
                sub="Bands stay wide until ~4 weeks of completed sessions; we show 'Building' until then."
              />
            </div>
          </Section>

          <Section title="How they combine">
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.62 }}>
              The <b>load ratio sets the headline</b> band. Corroborators can{" "}
              <span style={{ color: "var(--cp-success)" }}>confirm</span> or{" "}
              <span style={{ color: "var(--cp-danger)" }}>override</span> it: high load +{" "}
              <b>rising</b> effort + <b>falling</b> output downgrades to{" "}
              <b style={{ color: "var(--cp-danger)" }}>Overreaching</b> even if the ratio looks ok;
              high load + <b>stable</b> effort + <b>rising/flat</b> output reads as{" "}
              <b style={{ color: "var(--cp-warning)" }}>Pushing — tolerated</b>. When signals
              disagree we say &ldquo;mixed&rdquo; rather than fake a verdict.
            </p>
            <div
              className="mono"
              style={{
                marginTop: 10,
                fontSize: 12,
                padding: "11px 13px",
                background: "var(--cp-bg, var(--cp-surface-soft))",
                border: "1px solid var(--cp-border)",
                borderRadius: 9,
                color: "var(--cp-text)",
                lineHeight: 1.7,
              }}
            >
              balance = EWMA(load,7) ÷ EWMA(load,28)
              <br />
              load = Σ region [ reps×wt×rpe_mult + cardio_TRIMP ]
              <br />
              verdict = band(balance) then adjust by &#123; sRPE drift, output trend &#125;
            </div>
          </Section>

          <Section title="Grounding &amp; confidence">
            <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.6 }}>
              Confidence is <b style={{ color: "var(--cp-text)" }}>moderate, directional</b> — a
              population guardrail, personalized as your data grows.
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--cp-text-muted)", lineHeight: 1.6 }}>
              <b style={{ color: "var(--cp-text)" }}>Lit:</b> Foster sRPE &amp; monotony/strain ·
              Banister impulse-response / TrainingPeaks PMC (CTL·ATL·TSB) · Gabbett 2016 ACWR
              sweet-spot · Hulin 2014–16 · Williams 2017 EWMA-ACWR · Lolli 2019 (uncoupled) ·
              Impellizzeri 2020 (don&rsquo;t over-claim injury prediction) · Pareja-Blanco
              2017/2020 (RPE weighting).
            </p>
          </Section>
        </div>
      )}
    </div>
  );
}

const fourGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 11,
};

function Section({ title, children }: { title: string; children: React.ReactNode }): ReactElement {
  return (
    <div>
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
        {title}
      </div>
      {children}
    </div>
  );
}

function ScalarCard({
  dotColor,
  label,
  value,
  sub,
}: {
  dotColor: string;
  label: string;
  value: string;
  sub: string;
}): ReactElement {
  return (
    <div
      style={{
        background: "var(--cp-bg, var(--cp-surface-soft))",
        border: "1px solid var(--cp-border)",
        borderRadius: 11,
        padding: "12px 13px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-text-muted)",
          display: "flex",
          alignItems: "center",
          gap: 7,
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor }}
        />
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, margin: "5px 0 2px" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--cp-text-muted)", lineHeight: 1.45 }}>{sub}</div>
    </div>
  );
}
