/**
 * Collapsed-card header summary for a movement group.
 *
 * Renders a one-line "what's prescribed / what's been logged" chip
 * that sits in the card header next to the TM chip. Three states:
 *
 *   • not_started — show planned prescription
 *   • in_progress — show progress + last weight
 *   • completed   — show top set / uniform summary with ✓
 *
 * Pure function. The wrapping `<MovementCard>` decides where it goes
 * and whether to hide it on narrow viewports.
 */

import type { PrescriptionItem } from "@hta/db";
import type { MovementGroup } from "./movement-grouping";
import type { FocusLoggedSet } from "@/components/session/MovementFocusView";

/** Hard cap on the summary string. Truncated with an ellipsis past this. */
const MAX_CHARS = 30;

/** Strength kinds that count as "main" work in the partition. */
export const MAIN_KIND_SET: ReadonlySet<PrescriptionItem["kind"]> = new Set([
  "main",
  "power_potentiation",
]);

export const SUPPLEMENTAL_KIND_SET: ReadonlySet<PrescriptionItem["kind"]> = new Set([
  "back_off",
]);

/** Strength kinds that count as "accessory" work in the partition. */
export const ACCESSORY_KIND_SET: ReadonlySet<PrescriptionItem["kind"]> = new Set([
  "accessory",
  "tendon",
  "warmup",
]);

export type LiftBucket = "main" | "supplemental" | "accessory" | "other";

/**
 * A group is "main" if any item is a main kind. A group containing only
 * back-off work is supplemental, not a main lift. Otherwise, groups made only
 * from accessory kinds are accessories. Empty item lists bucket as "other".
 */
export function bucketForGroup(group: MovementGroup): LiftBucket {
  if (group.items.length === 0) return "other";
  for (const it of group.items) if (MAIN_KIND_SET.has(it.kind)) return "main";
  for (const it of group.items) if (SUPPLEMENTAL_KIND_SET.has(it.kind)) return "supplemental";
  for (const it of group.items)
    if (!ACCESSORY_KIND_SET.has(it.kind)) return "other";
  return "accessory";
}

function formatWeight(kg: number): string {
  if (Number.isInteger(kg)) return `${kg}`;
  // Strip a trailing `.0` if Number.toFixed introduced one.
  return `${Math.round(kg * 10) / 10}`;
}

function truncate(s: string): string {
  if (s.length <= MAX_CHARS) return s;
  return `${s.slice(0, MAX_CHARS - 1).trimEnd()}…`;
}

function strengthItems(items: PrescriptionItem[]): PrescriptionItem[] {
  return items.filter(
    (it) =>
      MAIN_KIND_SET.has(it.kind) ||
      SUPPLEMENTAL_KIND_SET.has(it.kind) ||
      it.kind === "accessory" ||
      it.kind === "tendon",
  );
}

function summarisePlanned(items: PrescriptionItem[], tmLabel: "TM" | "1RM" = "TM"): string {
  const work = strengthItems(items);
  if (work.length === 0) return "";

  // Split off back-off (volume) work so a main+back-off card renders
  // as `3×5 @ 80% + 5×3 @ 70%` rather than getting collapsed into one
  // misleading rep list.
  const mainish = work.filter(
    (it) => it.kind === "main" || it.kind === "power_potentiation",
  );
  const backOff = work.filter((it) => it.kind === "back_off");
  const accessory = work.filter(
    (it) => it.kind === "accessory" || it.kind === "tendon",
  );

  const parts: string[] = [];
  if (mainish.length > 0) parts.push(summariseStrengthBlock(mainish, tmLabel));
  if (backOff.length > 0) parts.push(summariseStrengthBlock(backOff, tmLabel));
  if (accessory.length > 0) parts.push(summariseAccessoryBlock(accessory));

  return truncate(parts.join(" + "));
}

function summariseStrengthBlock(items: PrescriptionItem[], tmLabel: "TM" | "1RM" = "TM"): string {
  const reps = items.map((it) =>
    it.repRange ? `${it.repRange.min}–${it.repRange.max}` : String(it.reps ?? 0),
  );
  const pcts = items.map((it) => it.percentTm).filter((p): p is number => p != null);
  const sameReps = reps.every((r) => r === reps[0]);
  const samePct = pcts.length > 0 && pcts.every((p) => p === pcts[0]);
  const setRange = items[0]?.setRange;
  const setLabel = setRange
    ? `${setRange.min}–${setRange.max}`
    : String(items.length);

  // Uniform across the block: `3×5 @ 80% TM`.
  if (sameReps && samePct) {
    const head = `${setLabel}×${reps[0]}`;
    return pcts.length > 0 ? `${head} @ ${pcts[0]}% ${tmLabel}` : head;
  }
  // Same reps, varying intensity: `5·5·5 @ 65/75/85% TM`.
  if (sameReps) {
    const head = items.map(() => reps[0]).join("·");
    if (pcts.length > 0) return `${head} @ ${pcts.join("/")}% ${tmLabel}`;
    return head;
  }
  // Varying reps: list each rep count.
  const head = reps.join("/");
  if (pcts.length > 0) return `${head} @ ${pcts.join("/")}% ${tmLabel}`;
  return head;
}

function summariseAccessoryBlock(items: PrescriptionItem[]): string {
  // RIR / hold / intent / distance cue takes priority over a bare rep
  // count when the accessory carries intensity guidance. Legacy items
  // without these fields fall through to the original "NxR" / "5/8/8"
  // format.
  const first = items[0];
  if (first) {
    // Loaded carry — distance replaces reps. "3 × 30m carry" or
    // "3 × 30–40m carry".
    if (first.distanceM) {
      const { min, max } = first.distanceM;
      const range = min === max ? `${min}m` : `${min}–${max}m`;
      return `${items.length} × ${range} carry`;
    }
    // Isometric hold — "3 × 30s" or "3 × 30–60s hold".
    if (first.holdSec) {
      const { min, max } = first.holdSec;
      const range = min === max ? `${min}s` : `${min}–${max}s`;
      return `${items.length} × ${range} hold`;
    }
    // Plyometric / max-intent — "5 jumps · max intent".
    if (
      first.targetRpe &&
      first.targetRpe.min === 10 &&
      first.targetRpe.max === 10
    ) {
      return `${first.reps ?? 0} reps · max intent`;
    }
    // RIR-guided accessory — "3×10 @ RIR 1–2".
    if (first.targetRir) {
      const r = first.targetRir;
      const rir = r.min === r.max ? `RIR ${r.min}` : `RIR ${r.min}–${r.max}`;
      const reps = items.map((it) => it.reps ?? 0);
      const sameReps = reps.every((rp) => rp === reps[0]);
      const head = sameReps ? `${items.length}×${reps[0]}` : reps.join("/");
      return `${head} @ ${rir}`;
    }
  }
  // Group consecutive same-spec items into NxR, otherwise list reps.
  const reps = items.map((it) => it.reps ?? 0);
  const sameReps = reps.every((r) => r === reps[0]);
  if (sameReps) return `${items.length}×${reps[0]}`;
  return reps.join("/");
}

function workingSets(
  loggedSets: ReadonlyArray<FocusLoggedSet>,
): Array<{ weightKg: number; reps: number }> {
  const out: Array<{ weightKg: number; reps: number }> = [];
  for (const s of loggedSets) {
    if (s.skipped) continue;
    if (s.weightKg == null || s.reps == null || s.reps <= 0) continue;
    out.push({ weightKg: s.weightKg, reps: s.reps });
  }
  return out;
}

/**
 * Loaded-carry sets logged against the focus view. A row counts as a
 * "carry log" when it has a positive `distance_m` value (the focus
 * view writes `reps: 0` for carries, so the standard `workingSets`
 * filter drops them).
 */
function carrySets(
  loggedSets: ReadonlyArray<FocusLoggedSet>,
): Array<{ weightKg: number; distanceM: number }> {
  const out: Array<{ weightKg: number; distanceM: number }> = [];
  for (const s of loggedSets) {
    if (s.skipped) continue;
    if (s.distanceM == null || s.distanceM <= 0) continue;
    out.push({
      weightKg: s.weightKg ?? 0,
      distanceM: s.distanceM,
    });
  }
  return out;
}

function summariseCompleted(
  loggedSets: ReadonlyArray<FocusLoggedSet>,
): string {
  // Carry sets first — they don't carry a rep count so the default
  // `workingSets` filter would drop them, leaving a misleading "✓".
  const carries = carrySets(loggedSets);
  const work = workingSets(loggedSets);
  if (carries.length > 0 && work.length === 0) {
    const dists = carries.map((s) => s.distanceM);
    const weights = carries.map((s) => s.weightKg);
    const sameD = dists.every((d) => d === dists[0]);
    const sameW = weights.every((w) => Math.abs(w - weights[0]!) < 0.001);
    if (sameD && sameW) {
      return truncate(
        `${carries.length}×${dists[0]}m @ ${formatWeight(weights[0]!)}kg ✓`,
      );
    }
    // Top trip = furthest distance, tie-broken by weight.
    let top = carries[0]!;
    for (const s of carries) {
      if (s.distanceM > top.distanceM) top = s;
      else if (s.distanceM === top.distanceM && s.weightKg > top.weightKg) top = s;
    }
    return truncate(
      `Top: ${formatWeight(top.weightKg)}kg × ${top.distanceM}m ✓`,
    );
  }
  if (work.length === 0) return "✓";
  const weights = work.map((s) => s.weightKg);
  const reps = work.map((s) => s.reps);
  const sameW = weights.every((w) => Math.abs(w - weights[0]!) < 0.001);
  const sameR = reps.every((r) => r === reps[0]);
  if (sameW && sameR) {
    return truncate(`${work.length}×${reps[0]} @ ${formatWeight(weights[0]!)}kg ✓`);
  }
  // Top set = heaviest weight, tie-broken by reps.
  let top = work[0]!;
  for (const s of work) {
    if (s.weightKg > top.weightKg) top = s;
    else if (s.weightKg === top.weightKg && s.reps > top.reps) top = s;
  }
  return truncate(`Top: ${formatWeight(top.weightKg)}kg × ${top.reps} ✓`);
}

/**
 * Build the short header summary string for a collapsed movement card.
 * Returns "" when there's nothing useful to show (no prescription,
 * no logged sets).
 *
 * Warmup items are excluded from the "X of Y sets" count — the
 * collapsed summary is a glance at *working* sets, and auto-warmups
 * would inflate the total in a misleading way. The dot-strip pips in
 * the focus view still surface every warmup.
 *
 * Because `loggedSets` is a flat in-order list (not keyed by
 * prescription position), we assume the user logs in prescription
 * order — warmups first — and discard the first `warmupCount` rows
 * when partitioning. That matches how the focus-view auto-cursor
 * advances.
 *
 * The `tmKg` argument is accepted for symmetry with `formatPrescriptionItem`
 * but is intentionally unused: the TM is already visible in its own
 * header chip and we don't want to repeat it.
 */
export function summariseGroupForHeader(
  group: MovementGroup,
  loggedSets: ReadonlyArray<FocusLoggedSet>,
  _tmKg?: number,
  // Loading-basis noun for the "% X" suffix — "1RM" when the program loads
  // straight off the 1RM (e.g. Tactical Barbell off 1RM), else "TM".
  tmLabel: "TM" | "1RM" = "TM",
): string {
  const warmupCount = group.items.filter((it) => it.kind === "warmup").length;
  const workingItems = group.items.filter((it) => it.kind !== "warmup");
  // Drop the leading `warmupCount` logged rows — they're warmup logs.
  // If the user hasn't yet logged all warmups, slice still trims
  // correctly: it returns fewer rows when there's nothing past them.
  const workingLogged =
    warmupCount > 0 && loggedSets.length > 0
      ? loggedSets.slice(warmupCount)
      : loggedSets;

  const total = workingItems.length;
  const work = workingSets(workingLogged);
  const carries = carrySets(workingLogged);
  const skipped = workingLogged.filter((s) => s.skipped).length;
  const covered = work.length + carries.length + skipped;

  if (total === 0 && workingLogged.length === 0) return "";

  if (total > 0 && covered === 0) {
    return summarisePlanned(workingItems, tmLabel);
  }
  if (total > 0 && covered < total) {
    const lastRep = work.length > 0 ? work[work.length - 1]! : null;
    const lastCarry = carries.length > 0 ? carries[carries.length - 1]! : null;
    if (lastRep) {
      return truncate(`${covered}/${total} · last ${formatWeight(lastRep.weightKg)}kg`);
    }
    if (lastCarry) {
      return truncate(
        `${covered}/${total} · last ${lastCarry.distanceM}m @ ${formatWeight(lastCarry.weightKg)}kg`,
      );
    }
    return truncate(`${covered}/${total} sets`);
  }
  // Completed (covered >= total) — or freestyle (no prescription) with
  // logged sets: fall through to the completed summary.
  return summariseCompleted(workingLogged);
}
