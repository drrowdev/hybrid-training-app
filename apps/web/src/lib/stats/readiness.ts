/**
 * Readiness composite — load balance + corroborating signals.
 *
 * Replaces a vague "stress budget" notion with an honest, research-
 * grounded readiness signal built only from data the app already
 * captures (no user check-ins). The acute:chronic workload ratio
 * (EWMA-ACWR via `load-balance.ts`) is the spine; sRPE drift
 * (`rpe-drift-queries.ts`) and objective output (`output-trend.ts`)
 * corroborate it.
 *
 * Signals
 * ───────
 *   1. Load balance (ratio band)             — headline band
 *   2. sRPE drift over 28d                   — stable / rising / easing
 *   3. Output trend over 28d vs prior 28d    — rising / flat / falling
 *   (Consistency / adherence is shown on the card but doesn't change the
 *    verdict — the user already sees the dedicated Adherence card.)
 *
 * Composite logic (HEURISTIC / CP-1, ADR 0019)
 * ────────────────────────────────────────────
 *   - building              cold-start gate when weeksOfData < 4
 *   - detraining            band = detraining
 *   - overreaching          pushing/spiking + sRPE rising + output falling
 *   - watch                 productive + sRPE rising + output falling
 *                             (mild overreach — band looks ok but signals
 *                              say work is slipping under steady load)
 *   - pushing-tolerated     pushing/spiking + sRPE stable/easing
 *                             + output rising/flat
 *   - productive            otherwise (default healthy state)
 *
 * Confidence
 * ──────────
 *   - building   cold-start
 *   - agree      all three signals agree with the headline (count == 3)
 *   - mixed      at least one signal disagrees / verdict was downgraded
 *
 * `signalsAgree` is the integer count (0..3) used by the "N signals
 * agree" chip in the card header.
 *
 * No write paths, no engine inputs — this is a read/stats surface only
 * (see ADR 0019 + the engine-live note: readiness does NOT feed
 * `buildPrescription`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLoadBalance, type LoadBalance, type LoadBand } from "./load-balance";
import { getRpeDrift, type RpeDrift } from "./rpe-drift-queries";
import { getOutputTrend, type OutputTrend } from "./output-trend";

export type ReadinessVerdict =
  | "building"
  | "detraining"
  | "productive"
  | "pushing-tolerated"
  | "watch"
  | "overreaching";

export type ReadinessConfidence = "agree" | "mixed" | "building";

export type ReadinessSummary = {
  rpeDrift: {
    verdict: RpeDrift["verdict"];
    verdictLabel: string;
    slopePerDay: number;
    meanRpe: number | null;
  };
  outputTrend: OutputTrend;
  loadBalance: LoadBalance;
};

export type Readiness = {
  verdict: ReadinessVerdict;
  verdictLabel: string;
  headline: string;
  subtext: string;
  confidence: ReadinessConfidence;
  /** 0..3 — count of corroborating signals that agree with the headline. */
  signalsAgree: number;
  /** Marker position on the 0–2.0 acute:chronic gauge, in [0, 100]. */
  gaugeMarkerPct: number;
  summary: ReadinessSummary;
};

/**
 * Cold-start gate: how many distinct ISO weeks of completed sessions we
 * need before any crisp band is asserted. HEURISTIC / CP-1.
 *
 * Why 4? An EWMA with a 28-day window is still warming up before ~4
 * weeks of history — the chronic term hasn't seen a full cycle yet, so
 * the ACWR can swing wildly on a single hard session. We hold off on a
 * crisp verdict until the denominator has settled.
 */
export const READINESS_BUILDING_WEEK_THRESHOLD = 4;

/** Gauge spans 0..2.0 on the acute:chronic axis. */
const GAUGE_MAX_RATIO = 2.0;

/** Clamp helper (kept inline since it's the only use). */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function gaugePct(ratio: number | null): number {
  if (ratio == null) return 0;
  return clamp01(ratio / GAUGE_MAX_RATIO) * 100;
}

function verdictLabel(v: ReadinessVerdict): string {
  switch (v) {
    case "building":
      return "Building baseline";
    case "detraining":
      return "Detraining";
    case "productive":
      return "Productive";
    case "pushing-tolerated":
      return "Pushing — tolerated";
    case "watch":
      return "Watch";
    case "overreaching":
      return "Overreaching";
  }
}

function bandLabel(band: LoadBand): string {
  switch (band) {
    case "detraining":
      return "Detraining (<0.8)";
    case "productive":
      return "Productive 0.8–1.3";
    case "pushing":
      return "Pushing 1.3–1.5";
    case "spiking":
      return "Spiking ≥1.5";
    case "unknown":
      return "No baseline yet";
  }
}

function subtextFor(
  verdict: ReadinessVerdict,
  loadBalance: LoadBalance,
  weeksLogged: number,
): string {
  switch (verdict) {
    case "building":
      return `Bands personalize as your training history grows (${weeksLogged} of ${READINESS_BUILDING_WEEK_THRESHOLD} weeks logged).`;
    case "detraining":
      return "Your recent training load is below your usual baseline — fine for a recovery week, but watch it doesn't become the new normal.";
    case "productive":
      return "You're building — and your output is keeping up, so the load is being absorbed, not just accumulated.";
    case "pushing-tolerated":
      return "Loading hard, but output is holding and effort is steady.";
    case "watch":
      return "Load looks ok on paper, but effort is rising and output is slipping — mild overreach, ease the next session.";
    case "overreaching":
      return "Ratio is high, work feels harder, output is regressing. A lighter week is due.";
  }
}

function headlineFor(verdict: ReadinessVerdict, loadBalance: LoadBalance, weeksLogged: number): string {
  if (verdict === "building") {
    return `Building baseline (${weeksLogged} of ${READINESS_BUILDING_WEEK_THRESHOLD} weeks)`;
  }
  if (loadBalance.ratio == null) {
    return verdictLabel(verdict);
  }
  return `${verdictLabel(verdict)} · ${bandLabel(loadBalance.band)}`;
}

/**
 * Pure composite — exposed so tests can exercise the full verdict matrix
 * without a Supabase round-trip (mirrors how `engine/recovered-weeks.ts`
 * splits its pure aggregator from the I/O layer).
 */
export function composeReadiness(
  loadBalance: LoadBalance,
  rpeDrift: RpeDrift,
  outputTrend: OutputTrend,
): Readiness {
  const weeksLogged = loadBalance.weeksOfData;
  const summary: ReadinessSummary = {
    rpeDrift: {
      verdict: rpeDrift.verdict,
      verdictLabel: rpeDrift.verdictLabel,
      slopePerDay: rpeDrift.slopePerDay,
      meanRpe: rpeDrift.meanRpe,
    },
    outputTrend,
    loadBalance,
  };

  // Cold-start gate: not enough data to assert a crisp band.
  if (weeksLogged < READINESS_BUILDING_WEEK_THRESHOLD) {
    return {
      verdict: "building",
      verdictLabel: verdictLabel("building"),
      headline: headlineFor("building", loadBalance, weeksLogged),
      subtext: subtextFor("building", loadBalance, weeksLogged),
      confidence: "building",
      signalsAgree: 0,
      gaugeMarkerPct: gaugePct(loadBalance.ratio),
      summary,
    };
  }

  const band = loadBalance.band;
  const rpeRising = rpeDrift.verdict === "rising";
  const rpeOkOrEasing = rpeDrift.verdict === "stable" || rpeDrift.verdict === "easing";
  const outputFalling = outputTrend.direction === "falling";
  const outputOkOrRising = outputTrend.direction === "rising" || outputTrend.direction === "flat";

  let verdict: ReadinessVerdict;
  if (band === "detraining") {
    verdict = "detraining";
  } else if ((band === "pushing" || band === "spiking") && rpeRising && outputFalling) {
    verdict = "overreaching";
  } else if ((band === "pushing" || band === "spiking") && rpeOkOrEasing && outputOkOrRising) {
    verdict = "pushing-tolerated";
  } else if (band === "productive" && rpeRising && outputFalling) {
    verdict = "watch";
  } else {
    verdict = "productive";
  }

  // signalsAgree counts how many corroborators are consistent with the
  // headline band. "Healthy" expectation = effort flat/easing AND output
  // rising/flat. Adherence-style consistency is shown on the card but
  // doesn't count toward agreement (the existing Adherence card is its
  // own surface — this composite focuses on load + effort + output).
  let signalsAgree = 0;
  if (band === "productive") {
    if (rpeOkOrEasing) signalsAgree++;
    if (outputOkOrRising) signalsAgree++;
    signalsAgree++; // headline band itself
  } else if (band === "pushing" || band === "spiking") {
    if (rpeOkOrEasing) signalsAgree++;
    if (outputOkOrRising) signalsAgree++;
    // The headline band only "agrees" if it survived the corroboration
    // pass (pushing-tolerated). Overreaching = signals contradict it.
    if (verdict === "pushing-tolerated") signalsAgree++;
  } else if (band === "detraining") {
    // Detraining is its own narrative — count it as agreeing with itself
    // and credit easing effort + non-rising output as consistent.
    signalsAgree++;
    if (rpeOkOrEasing) signalsAgree++;
    if (!outputFalling) signalsAgree++;
  }
  // No-data corroborators don't agree by default. Anything strictly
  // contradicting the headline pushes us to "mixed".

  const confidence: ReadinessConfidence =
    signalsAgree >= 3 ? "agree" : "mixed";

  return {
    verdict,
    verdictLabel: verdictLabel(verdict),
    headline: headlineFor(verdict, loadBalance, weeksLogged),
    subtext: subtextFor(verdict, loadBalance, weeksLogged),
    confidence,
    signalsAgree,
    gaugeMarkerPct: gaugePct(loadBalance.ratio),
    summary,
  };
}

/**
 * Read-side wrapper. Issues the three underlying queries in parallel,
 * then composes the verdict purely. Read path only — user-scoped client.
 */
export async function getReadiness(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<Readiness> {
  const [loadBalance, rpeDrift, outputTrend] = await Promise.all([
    getLoadBalance(supabase, userId, tz),
    getRpeDrift(supabase, userId),
    getOutputTrend(supabase, userId, tz),
  ]);
  return composeReadiness(loadBalance, rpeDrift, outputTrend);
}
