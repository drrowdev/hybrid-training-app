/**
 * Progress verdict — single honest headline that fuses the strength
 * and endurance trend modules into one dual-modality verdict.
 *
 * Pure function (no I/O): takes the already-composed
 * `StrengthProgress` and `EnduranceProgress` and decides one of:
 *
 *   - up        both modalities up, OR one up + the other flat/no-data
 *   - down      either modality clearly down (regression honesty —
 *               a real regression must not be hidden by a quieter peer)
 *   - mixed     one up and the other down
 *   - holding   both flat (steady-state, no movement either way)
 *   - building  both cold-start / insufficient data
 *
 * "Proof chips" surface the underlying numbers so the hero is
 * defensible — every chip text traces back to a slope/sample we
 * actually computed, never a hard-coded "good news" string.
 *
 * Regression honesty
 * ──────────────────
 * The matrix deliberately privileges "down": a falling strength trend
 * alongside a flat run pace is "down", not "mixed". We'd rather the
 * user see a regression and act on it than have a happier-looking
 * verdict average it away.
 *
 * Read-only / no engine inputs (mirrors `readiness.ts`).
 */
import type { StrengthProgress, StrengthDirection } from "./strength-progress";
import type { EnduranceProgress, EnduranceDirection } from "./endurance-progress";

export type ProgressVerdictKind = "up" | "down" | "mixed" | "holding" | "building";

export type ProgressProofChip = {
  modality: "strength" | "endurance";
  /** Direction reflected in this chip — always matches the underlying signal, never massaged. */
  direction: StrengthDirection | EnduranceDirection;
  text: string;
};

export type ProgressVerdict = {
  verdict: ProgressVerdictKind;
  label: string;
  proofChips: ProgressProofChip[];
  detail: string;
};

function verdictLabel(v: ProgressVerdictKind): string {
  switch (v) {
    case "up":
      return "Progressing";
    case "down":
      return "Regressing";
    case "mixed":
      return "Mixed — one up, one down";
    case "holding":
      return "Holding";
    case "building":
      return "Building baseline";
  }
}

function strengthChip(s: StrengthProgress): ProgressProofChip {
  if (s.direction === "building") {
    return {
      modality: "strength",
      direction: "building",
      text: "Strength building — log more main lifts to see a trend.",
    };
  }
  // Pick the lift with the largest |slope| as the headline chip — it's
  // the most informative single number for the hero. Falls back to the
  // first per-lift entry when slopes are all null.
  const ranked = [...s.perLift]
    .filter((l) => l.slopePerWeek != null)
    .sort((a, b) => Math.abs(b.slopePerWeek!) - Math.abs(a.slopePerWeek!));
  const top = ranked[0];
  if (!top || top.slopePerWeek == null) {
    return {
      modality: "strength",
      direction: s.direction,
      text:
        s.direction === "flat"
          ? "Main lifts holding."
          : s.direction === "up"
            ? "Main lifts trending up."
            : "Main lifts trending down.",
    };
  }
  const sign = top.slopePerWeek > 0 ? "+" : "";
  const rounded = `${sign}${top.slopePerWeek.toFixed(1)} kg/wk`;
  return {
    modality: "strength",
    direction: top.direction,
    text: `${top.label} ${rounded}`,
  };
}

function enduranceChip(e: EnduranceProgress): ProgressProofChip {
  if (e.direction === "no-run-data") {
    return {
      modality: "endurance",
      direction: "no-run-data",
      text:
        e.totalRuns === 0
          ? "No runs in window — pace trend is running-specific."
          : `${e.totalRuns} run${e.totalRuns === 1 ? "" : "s"} logged, none classifiable as easy effort.`,
    };
  }
  if (e.direction === "building") {
    return {
      modality: "endurance",
      direction: "building",
      text: `Easy-run pace building (${e.sampleRuns} sample${e.sampleRuns === 1 ? "" : "s"}).`,
    };
  }
  if (e.slopeSecPerKmPerWeek == null) {
    return { modality: "endurance", direction: e.direction, text: "Easy pace holding." };
  }
  if (e.direction === "up") {
    return { modality: "endurance", direction: "up", text: "Easy runs getting faster" };
  }
  if (e.direction === "down") {
    return { modality: "endurance", direction: "down", text: "Easy runs slowing down" };
  }
  return { modality: "endurance", direction: "flat", text: "Easy pace steady" };
}

/** Reduce a directional signal to one of {up, down, flat, building}. */
type Triage = "up" | "down" | "flat" | "building";
function triageStrength(d: StrengthDirection): Triage {
  return d; // 1:1 — same alphabet.
}
function triageEndurance(d: EnduranceDirection): Triage {
  if (d === "no-run-data") return "building";
  return d;
}

/**
 * Pure verdict composer. Order of precedence:
 *   1. Either side "down" + neither side "up"          → "down"
 *   2. One side "up" and the other "down"              → "mixed"
 *   3. Both sides "up"                                  → "up"
 *   4. One side "up" and the other "flat"|"building"   → "up"
 *   5. Both sides "building"                            → "building"
 *   6. Both sides "flat" (or flat + building)           → "holding"
 *   7. Anything else (shouldn't happen)                 → "holding"
 */
export function getProgressVerdict(
  strength: StrengthProgress,
  endurance: EnduranceProgress,
): ProgressVerdict {
  const s = triageStrength(strength.direction);
  const e = triageEndurance(endurance.direction);
  const chips: ProgressProofChip[] = [strengthChip(strength), enduranceChip(endurance)];

  let verdict: ProgressVerdictKind;
  if ((s === "down" || e === "down") && s !== "up" && e !== "up") {
    verdict = "down";
  } else if ((s === "up" && e === "down") || (s === "down" && e === "up")) {
    verdict = "mixed";
  } else if (s === "up" || e === "up") {
    verdict = "up";
  } else if (s === "building" && e === "building") {
    verdict = "building";
  } else {
    // Remaining combos: both flat, or flat + building.
    verdict = "holding";
  }

  const detail = detailFor(verdict, strength, endurance);

  return {
    verdict,
    label: verdictLabel(verdict),
    proofChips: chips,
    detail,
  };
}

function detailFor(
  verdict: ProgressVerdictKind,
  s: StrengthProgress,
  e: EnduranceProgress,
): string {
  switch (verdict) {
    case "up":
      return "Both signals trending forward — keep the current cadence.";
    case "down":
      return "At least one modality is regressing — review intensity vs recovery before the next week.";
    case "mixed":
      return "Strength and endurance disagree — pick the one that matters most this block and protect it.";
    case "holding":
      return "Both signals are flat — neither growing nor slipping.";
    case "building":
      return `Not enough history yet (strength: ${s.direction}, endurance: ${e.direction}).`;
  }
}
