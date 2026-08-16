/**
 * Set-aware session duration estimate.
 *
 * Replaces the legacy `strengthCount * 5 min` flat-per-item heuristic (which
 * was set-count-blind and therefore useless for budgeting). This model prices
 * each working set as `work + rest`, so adding sets or items raises the
 * estimate monotonically — the property the ADR 0020 volume-tilt governor
 * relies on to keep a session inside the user's time budget.
 *
 * Shared by:
 *   - the Plan + Preview surfaces (the `~N min` the user sees), and
 *   - the planner's volume-tilt governor (the budget the tilt is trimmed to),
 * so the number the engine budgets against and the number the user sees are
 * the same.
 *
 * **Bias is intentionally conservative (slight over-count).** Every set is
 * charged its full inter-set rest, including the final set of an item and
 * sets a lifter might superset in practice. For a *governor* that must not
 * blow a hard 75-min ceiling, over-estimating is the safe direction.
 *
 * Calibration: `WORK_SEC_PER_SET` and the power-primer rest are CP-1 Stage-A
 * heuristics (no calibration data). Rest-per-kind reuses the single source of
 * truth in `./rest` (Schoenfeld 2016 strength rest ≥ 2 min; accessory 60–90 s).
 * Refine `WORK_SEC_PER_SET` against logged set timestamps once available.
 */

import type { PrescriptionItem, PrescriptionItemKind } from "@hta/db";
import { partitionRehabItems } from "@hta/domain";
import { restSecondsForKind } from "./rest";
import { SUPERSET_GROUP_KEY } from "../planner/antagonist-pairs";

/**
 * Per-set working time (concentric + eccentric + bar setup), independent of
 * load. ~40 s is a practitioner estimate spanning a heavy triple and a
 * 12-rep accessory. // heuristic, no calibration data
 */
export const WORK_SEC_PER_SET = 40;

/**
 * Antagonist-superset station-switch time (ADR 0026). When two opposing
 * accessories are paired, each round is `A1 work → switch → A2 work → one
 * rest` instead of two separate rests, so the only added cost vs the
 * overlapped rest is the brief move between stations. ~15 s spans grabbing
 * the second implement / stepping to the adjacent station.
 * // heuristic, no calibration data — refine against logged set timestamps.
 */
export const SUPERSET_TRANSITION_SEC = 15;

/**
 * `power_potentiation` primers (explosive submaximal doubles with full
 * recovery) have no entry in `restSecondsForKind` — it returns 0 for them.
 * Price the rest here so primers aren't counted as free.
 * // heuristic, no calibration data
 */
const POWER_POTENTIATION_REST_SEC = 90;

function isCardio(kind: PrescriptionItemKind | undefined): boolean {
  return (kind ?? "").startsWith("cardio_");
}

function workSecForItem(it: PrescriptionItem): number {
  // Isometric / tendon holds are time-under-tension, not rep-paced: charge
  // the hold midpoint rather than the generic per-set estimate.
  if (it.holdSec) return (it.holdSec.min + it.holdSec.max) / 2;
  return WORK_SEC_PER_SET;
}

function restSecForItem(kind: PrescriptionItemKind): number {
  if (kind === "power_potentiation") return POWER_POTENTIATION_REST_SEC;
  return restSecondsForKind(kind);
}

function supersetGroupOf(it: PrescriptionItem): string | null {
  const g = (it.meta as Record<string, unknown> | undefined)?.[
    SUPERSET_GROUP_KEY
  ];
  return typeof g === "string" && g.length > 0 ? g : null;
}

/**
 * How rest should be priced.
 *
 * - `"solo"` charges every set its own full rest, ignoring all grouping. This is
 *   what the ADR-0020 duration governor MUST use: if grouping fed the governor,
 *   linking two lifts would free up time and let it keep MORE accessory volume,
 *   so enabling a presentation feature would change the prescription. ADR 0026
 *   calls that invariant absolute, so it is encoded here as an explicit argument
 *   rather than left to depend on which call sites happen to produce grouping.
 * - `"grouped"` overlaps rest inside supersets and circuits. Display surfaces
 *   use it so the shown duration reflects how the session is actually run.
 */
export type RestPricingMode = "solo" | "grouped";

/**
 * Price the circuit rounds present in `items`, returning the seconds spent and
 * the exact item instances consumed (so the caller prices nothing twice).
 *
 * Grouping is by circuit id, then by POSITION within the circuit. Keying by id
 * alone would be wrong: the platform adapter expands an engine item with
 * `sets > 1` into one loggable prescription item per set and copies the circuit
 * onto each, so a 3-movement × 3-round circuit is nine items sharing an id, not
 * three. The r-th item at each position is the r-th round, which resolves both
 * the adapter-stamped `circuit.round` form and legacy stored circuits that
 * predate the stamp.
 *
 * A round costs `Σ work + (size − 1) × switch + one overlapped rest` — you move
 * between stations and rest once, at the longest of the members' requirements.
 * Incomplete circuits (a member missing, or fewer rounds at some position) leave
 * their surplus sets to solo pricing, mirroring the widowed-member rule.
 */
function priceCircuitRounds(items: readonly PrescriptionItem[]): {
  seconds: number;
  consumed: Set<PrescriptionItem>;
} {
  const byId = new Map<string, PrescriptionItem[]>();
  for (const it of items) {
    const c = it.circuit;
    if (!c || typeof c.id !== "string" || c.id.length === 0) continue;
    if (!Number.isInteger(c.size) || c.size < 2) continue;
    if (!Number.isInteger(c.position) || c.position < 0 || c.position >= c.size) {
      continue;
    }
    const arr = byId.get(c.id);
    if (arr) arr.push(it);
    else byId.set(c.id, [it]);
  }

  let seconds = 0;
  const consumed = new Set<PrescriptionItem>();
  for (const members of byId.values()) {
    const size = members[0]!.circuit!.size;
    const byPosition = new Map<number, PrescriptionItem[]>();
    for (const it of members) {
      const pos = it.circuit!.position;
      const arr = byPosition.get(pos);
      if (arr) arr.push(it);
      else byPosition.set(pos, [it]);
    }
    // Every station must be present, exactly once per round.
    if (byPosition.size !== size) continue;
    const lanes: PrescriptionItem[][] = [];
    let ok = true;
    for (let pos = 0; pos < size; pos += 1) {
      const lane = byPosition.get(pos);
      if (!lane || lane.length === 0) {
        ok = false;
        break;
      }
      lanes.push(lane);
    }
    if (!ok) continue;
    const rounds = Math.min(...lanes.map((lane) => lane.length));
    for (let round = 0; round < rounds; round += 1) {
      const inRound = lanes.map((lane) => lane[round]!);
      const rest = Math.max(...inRound.map((it) => restSecForItem(it.kind)));
      const work = inRound.reduce((sum, it) => sum + workSecForItem(it), 0);
      seconds += work + (size - 1) * SUPERSET_TRANSITION_SEC + rest;
      inRound.forEach((it) => consumed.add(it));
    }
  }
  return { seconds, consumed };
}

/**
 * Total estimated wall-clock seconds for a planned session's items.
 * Cardio items contribute their planned `durationMin`; strength-family items
 * contribute `sets × (work + rest)`. `cardio_external` (no duration) and
 * empty inputs contribute nothing.
 *
 * **Grouped rest.** Two mechanisms overlap rest, and both are gated on `mode`:
 *   - antagonist supersets (ADR 0026), where two accessory items sharing a
 *     `meta.supersetGroup` with equal sets rest once per round, and
 *   - linked circuits (`item.circuit`), where every station in a round is
 *     performed back-to-back before a single rest.
 *
 * A "widowed" superset member whose partner was trimmed (ADR 0013 autoreg
 * end-slice), and any circuit set with no counterpart in its round, are priced
 * solo. With `mode: "solo"`, or with no grouping metadata present at all, this
 * reduces to the exact per-item computation — so the estimate is byte-identical
 * for un-grouped sessions and for the governor.
 */
export function estimateSessionSeconds(
  items: readonly PrescriptionItem[] | null | undefined,
  mode: RestPricingMode = "grouped",
): number {
  if (!items || items.length === 0) return 0;

  let sec = 0;
  const pairedMembers = new Set<PrescriptionItem>();

  if (mode === "grouped") {
    // Collect superset members, then price valid pairs (exactly two present,
    // both accessory, equal sets) with overlapped rest. Everything else — incl.
    // widowed members — falls through to the solo pricing below.
    const groups = new Map<string, PrescriptionItem[]>();
    for (const it of items) {
      const g = supersetGroupOf(it);
      if (g) {
        const arr = groups.get(g);
        if (arr) arr.push(it);
        else groups.set(g, [it]);
      }
    }
    for (const members of groups.values()) {
      if (members.length !== 2) continue;
      const [a, b] = members;
      if (a.kind !== "accessory" || b.kind !== "accessory") continue;
      const rounds = Math.max(1, a.sets ?? 1);
      if (rounds !== Math.max(1, b.sets ?? 1)) continue;
      const restPair = Math.max(restSecForItem(a.kind), restSecForItem(b.kind));
      sec +=
        rounds *
        (workSecForItem(a) +
          workSecForItem(b) +
          SUPERSET_TRANSITION_SEC +
          restPair);
      pairedMembers.add(a);
      pairedMembers.add(b);
    }

    const circuits = priceCircuitRounds(
      items.filter((it) => !pairedMembers.has(it)),
    );
    sec += circuits.seconds;
    circuits.consumed.forEach((it) => pairedMembers.add(it));
  }

  for (const it of items) {
    if (pairedMembers.has(it)) continue;
    if (isCardio(it.kind)) {
      sec += (it.durationMin ?? 0) * 60;
      continue;
    }
    const sets = Math.max(1, it.sets ?? 1);
    sec += sets * (workSecForItem(it) + restSecForItem(it.kind));
  }
  return sec;
}

/**
 * Estimated session duration in whole minutes, or `null` when there's nothing
 * to price (no items, or an external-cardio-only session with no logged
 * duration) — matching the legacy "unknown ⇒ null" contract the preview UI
 * already handles.
 */
export function estimateSessionMinutes(
  items: readonly PrescriptionItem[] | null | undefined,
): number | null {
  if (!items || items.length === 0) return null;
  const sec = estimateSessionSeconds(items);
  if (sec <= 0) return null;
  return Math.round(sec / 60);
}

export type SessionDurationBreakdown = {
  /** Duration shown for the workout; embedded rehab overlaps its warm-up. */
  displayMinutes: number | null;
  coreMinutes: number | null;
  rehabMinutes: number | null;
  totalIfSequentialMinutes: number | null;
  hasEmbeddedRehab: boolean;
};

export function estimateSessionDurationBreakdown(
  items: readonly PrescriptionItem[] | null | undefined,
): SessionDurationBreakdown {
  const { rehab, core } = partitionRehabItems(items ?? []);
  const coreMinutes = estimateSessionMinutes(core);
  const rehabMinutes = estimateSessionMinutes(rehab);
  const hasEmbeddedRehab = rehab.length > 0 && core.length > 0;
  const totalIfSequentialMinutes =
    coreMinutes == null && rehabMinutes == null
      ? null
      : (coreMinutes ?? 0) + (rehabMinutes ?? 0);

  return {
    displayMinutes:
      core.length > 0 ? coreMinutes : rehabMinutes,
    coreMinutes,
    rehabMinutes,
    totalIfSequentialMinutes,
    hasEmbeddedRehab,
  };
}
