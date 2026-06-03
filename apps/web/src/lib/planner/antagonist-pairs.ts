/**
 * Antagonist-superset pairing — ADR 0026, Phase 1 (pure module).
 *
 * Pairs opposing accessory movements (e.g. biceps curl + triceps pushdown)
 * into supersets so the lifter rests ONCE per round instead of twice. The
 * evidence is strong that antagonist (reciprocal) paired-sets cut session time
 * ~30-50% at preserved total volume, and — unlike same-muscle supersets —
 * antagonist pairing preserves or even slightly enhances agonist output via
 * reciprocal facilitation (Robbins 2010 JSCR review; Weakley 2017/2020;
 * Maia 2014; Paz 2017; Krzysztofik 2019 review). The honest caveat is a
 * modest rise in acute RPE/lactate, surfaced in the UI.
 *
 * This module is the pure, DB-free machinery only. It:
 *   - classifies a movement's primary muscles into an antagonist group,
 *   - decides whether two accessory items are a valid reciprocal pair,
 *   - and runs a post-selection pass that GROUPS paired accessories by writing
 *     `meta.supersetGroup` / `meta.supersetSlot` and pulling each A2 partner up
 *     to sit immediately after its A1.
 *
 * Critically, pairing is a *post-selection annotation layer*: it never selects
 * volume. The duration governor always picks accessory volume on the unpaired
 * estimate; this pass runs AFTER the winning candidate is chosen. With the
 * feature off (default) it is never called, so prescriptions are byte-identical.
 * With it on, the item SET is unchanged — only `meta` and the within-accessory
 * ordering differ, and the displayed session time drops (P2 estimator).
 *
 * v1 scope (high confidence): TRUE reciprocal antagonists only, equal set
 * counts, isolation-clean classification. No "non-competing" filler pairs.
 */
import type { Muscle, PrescriptionItem } from "@hta/db";

/**
 * Reciprocal antagonist groups, keyed by joint action. Only muscles with a
 * clean, well-established reciprocal antagonist are mapped — this is anatomy,
 * not a tuned magnitude (no CP-2 constant).
 *
 * Deliberately UNMAPPED in v1:
 *   - side_delts: no true antagonist.
 *   - abs / lower_back: loaded trunk-flexion + lumbar-extension supersets are
 *     contentious; excluded for safety.
 *   - forearms: the muscle enum cannot separate wrist flexion from extension
 *     (single `forearms` value), so wrist curl vs extension is unclassifiable.
 *   - glutes / traps / lats-as-shrug / adductors / abductors / neck / obliques:
 *     no clean isolation antagonist pair for accessories.
 */
export type AntagonistGroup =
  | "elbow_flexors"
  | "elbow_extensors"
  | "knee_extensors"
  | "knee_flexors"
  | "horizontal_push"
  | "horizontal_pull"
  | "ankle_plantarflexors"
  | "ankle_dorsiflexors";

const MUSCLE_TO_GROUP: Partial<Record<Muscle, AntagonistGroup>> = {
  biceps: "elbow_flexors",
  triceps: "elbow_extensors",
  quads: "knee_extensors",
  hamstrings: "knee_flexors",
  chest: "horizontal_push",
  upper_chest: "horizontal_push",
  front_delts: "horizontal_push",
  lats: "horizontal_pull",
  mid_back: "horizontal_pull",
  rear_delts: "horizontal_pull",
  calves: "ankle_plantarflexors",
  tibialis: "ankle_dorsiflexors",
};

const RECIPROCAL: Record<AntagonistGroup, AntagonistGroup> = {
  elbow_flexors: "elbow_extensors",
  elbow_extensors: "elbow_flexors",
  knee_extensors: "knee_flexors",
  knee_flexors: "knee_extensors",
  horizontal_push: "horizontal_pull",
  horizontal_pull: "horizontal_push",
  ankle_plantarflexors: "ankle_dorsiflexors",
  ankle_dorsiflexors: "ankle_plantarflexors",
};

/** Meta keys written on paired items (engine-invisible; UI + estimator only). */
export const SUPERSET_GROUP_KEY = "supersetGroup";
export const SUPERSET_SLOT_KEY = "supersetSlot";
export type SupersetSlot = "A1" | "A2";

/**
 * Classify a movement's primary muscles into a single antagonist group.
 *
 * Conservative by design: returns a group ONLY when every mapped primary muscle
 * resolves to the SAME group (a clean isolation movement). A movement whose
 * primaries span two groups (e.g. a row hitting lats + biceps) is ambiguous and
 * returns `null` so it stays solo — we never guess a pairing for a compound.
 */
export function antagonistGroupOf(
  primaryMuscles: readonly Muscle[],
): AntagonistGroup | null {
  let found: AntagonistGroup | null = null;
  for (const m of primaryMuscles) {
    const g = MUSCLE_TO_GROUP[m];
    if (!g) continue;
    if (found === null) {
      found = g;
    } else if (found !== g) {
      // Primaries straddle more than one antagonist group → ambiguous.
      return null;
    }
  }
  return found;
}

/** True when the two groups are reciprocal antagonists. */
export function areReciprocal(a: AntagonistGroup, b: AntagonistGroup): boolean {
  return RECIPROCAL[a] === b;
}

function setsOf(item: PrescriptionItem): number {
  return item.sets ?? 1;
}

export interface AntagonistPairOptions {
  /**
   * Require equal set counts to pair (v1 default = true). Equal sets keep the
   * round model clean (one A1 + one A2 per round). Accessories in a block
   * usually share a uniform set count (the volume lever sets it), so this is
   * rarely binding.
   */
  requireEqualSets?: boolean;
}

/**
 * Decide whether two items form a valid antagonist accessory superset.
 * Both must be `accessory` kind, cleanly classifiable, reciprocal, and (by
 * default) equal-set. `musclesOf` resolves an item to its movement's primary
 * muscles (the pass has no DB access).
 */
export function arePairable(
  a: PrescriptionItem,
  b: PrescriptionItem,
  musclesOf: (item: PrescriptionItem) => readonly Muscle[],
  opts: AntagonistPairOptions = {},
): boolean {
  if (a.kind !== "accessory" || b.kind !== "accessory") return false;
  const ga = antagonistGroupOf(musclesOf(a));
  const gb = antagonistGroupOf(musclesOf(b));
  if (ga === null || gb === null) return false;
  if (!areReciprocal(ga, gb)) return false;
  if ((opts.requireEqualSets ?? true) && setsOf(a) !== setsOf(b)) return false;
  return true;
}

/**
 * Pair antagonist accessories within a materialised prescription.
 *
 * Pure and immutable — returns a new array; paired items are shallow-cloned
 * with merged `meta`. Non-accessory items, unclassifiable accessories, and
 * unmatched accessories are returned untouched and in their original position.
 *
 * Matching is greedy in picker (priority) order: for each unpaired classifiable
 * accessory, the nearest later unpaired reciprocal accessory becomes its A2.
 * The earlier member is A1 and KEEPS its position; A2 is pulled up to sit
 * immediately after A1. This preserves front-of-list priority so the ADR-0013
 * autoreg end-slice still trims the least-important tail. A pair split by a
 * later trim leaves a "widowed" member whose `supersetGroup` the UI must render
 * as a normal solo item.
 */
export function pairAntagonistAccessories(
  items: PrescriptionItem[],
  musclesOf: (item: PrescriptionItem) => readonly Muscle[],
  opts: AntagonistPairOptions = {},
): PrescriptionItem[] {
  const n = items.length;
  // partnerIndex[i] = index of i's pair partner, or -1 if unpaired.
  const partnerIndex = new Array<number>(n).fill(-1);
  const groupOfItem = new Array<AntagonistGroup | null>(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (items[i].kind === "accessory") {
      groupOfItem[i] = antagonistGroupOf(musclesOf(items[i]));
    }
  }

  for (let i = 0; i < n; i++) {
    if (partnerIndex[i] !== -1) continue;
    const gi = groupOfItem[i];
    if (gi === null) continue;
    for (let j = i + 1; j < n; j++) {
      if (partnerIndex[j] !== -1) continue;
      const gj = groupOfItem[j];
      if (gj === null) continue;
      if (!areReciprocal(gi, gj)) continue;
      if ((opts.requireEqualSets ?? true) && setsOf(items[i]) !== setsOf(items[j])) {
        continue;
      }
      partnerIndex[i] = j;
      partnerIndex[j] = i;
      break;
    }
  }

  // Assign a stable group id to each pair, ordered by A1 (earlier member) index.
  const groupIdOf = new Array<string>(n).fill("");
  const slotOf = new Array<SupersetSlot | "">(n).fill("");
  let pairCounter = 0;
  for (let i = 0; i < n; i++) {
    const j = partnerIndex[i];
    if (j > i) {
      // i is A1 (earlier), j is A2 (later).
      pairCounter += 1;
      const id = `ss-${pairCounter}`;
      groupIdOf[i] = id;
      slotOf[i] = "A1";
      groupIdOf[j] = id;
      slotOf[j] = "A2";
    }
  }

  const tag = (idx: number): PrescriptionItem => {
    if (!groupIdOf[idx]) return items[idx];
    return {
      ...items[idx],
      meta: {
        ...items[idx].meta,
        [SUPERSET_GROUP_KEY]: groupIdOf[idx],
        [SUPERSET_SLOT_KEY]: slotOf[idx],
      },
    };
  };

  // Emit in original order, pulling each A2 up to sit immediately after its A1.
  const out: PrescriptionItem[] = [];
  const emitted = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (emitted[i]) continue;
    const j = partnerIndex[i];
    if (j > i) {
      // A1 then its A2 partner.
      out.push(tag(i));
      out.push(tag(j));
      emitted[i] = true;
      emitted[j] = true;
    } else if (j !== -1 && j < i) {
      // This is an A2 already emitted right after its A1 — skip.
      emitted[i] = true;
    } else {
      out.push(tag(i));
      emitted[i] = true;
    }
  }
  return out;
}
