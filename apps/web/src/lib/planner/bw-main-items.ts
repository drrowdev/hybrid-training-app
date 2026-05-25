/**
 * Build PrescriptionItems for the bodyweight main-lift slot of a
 * planned session. Wraps `bwPrescription` (matrix) + `pickFamiliesForBwSession`
 * (rotation) and produces the per-family main + back_off items the
 * planner inserts ahead of accessories.
 *
 * Brand-purity (DC-Q6): all copy comes from the matrix; this module
 * passes it through verbatim.
 *
 * Pure module. No I/O.
 */
import type { PrescriptionItem } from "@hta/db";
import type { MovementFamily, MovementNode } from "@hta/db";
import type { Equipment } from "@/lib/settings/equipment-schema";
import type { ArchetypeId } from "./archetypes";
import { bwPrescription, type BwPrescription } from "./bw-prescription";
import { pickFamiliesForBwSession } from "./bw-family-rotation";

/**
 * Per-family progress row + the resolved node + the catalog movement
 * row that the focus view groups against. `movementId` MUST be a valid
 * `movements.id` so the existing per-movement grouping in
 * `lib/sessions/movement-grouping.ts` keeps working — the BW node
 * identity travels alongside on `item.bw.*`.
 */
export type BwFamilyContext = {
  family: MovementFamily;
  node: MovementNode;
  movementId: string;
  movementSlug?: string;
  movementName?: string;
  cleanRepHistory?: ReadonlyArray<{ reps?: number; seconds?: number }>;
  /**
   * Same-family children of the current node, lowest difficulty
   * first. Used by `buildBwPrescriptionItem` to stamp the Phase 4
   * "Next:" hint into the prescription payload. Empty array means
   * the family is at a terminal node ("Mastered" chip).
   */
  candidateNextNodes?: ReadonlyArray<MovementNode>;
};

/**
 * Convert one `BwPrescription` into the PrescriptionItem shape that
 * `planned_sessions.prescription.items` consumes.
 *
 * Each call returns ONE item with `sets = N` so the focus view's slot
 * grid renders N dots. (Accessories and main-lift items share this
 * convention — see actions.ts.) The full BW payload is embedded under
 * `item.bw` for the renderer + the future progression engine.
 */
export function buildBwPrescriptionItem(args: {
  ctx: BwFamilyContext;
  kind: "main" | "back_off";
  bw: BwPrescription;
}): PrescriptionItem {
  const item: PrescriptionItem = {
    movementId: args.ctx.movementId,
    movementSlug: args.ctx.movementSlug ?? args.ctx.node.nodeKey,
    movementName: args.ctx.movementName ?? args.ctx.node.displayName,
    kind: args.kind,
    sets: args.bw.sets,
    intensityCue: args.bw.intensityCue,
    notes: args.bw.notes,
    targetRir: { min: args.bw.targetRir, max: args.bw.targetRir },
    tempoEccentricSec: args.bw.tempoEccentricSec,
    bw: {
      prescriptionType: args.bw.prescriptionType,
      sets: args.bw.sets,
      reps: args.bw.reps,
      repRange: args.bw.repRange,
      holdSeconds: args.bw.holdSeconds,
      tempoEccentricSec: args.bw.tempoEccentricSec,
      targetRir: args.bw.targetRir,
      restSeconds: args.bw.restSeconds,
      intensityCue: args.bw.intensityCue,
      notes: args.bw.notes,
      nodeId: args.ctx.node.id,
      nodeKey: args.ctx.node.nodeKey,
      nodeDisplayName: args.ctx.node.displayName,
      family: args.ctx.family,
      externalLoadKg: args.bw.externalLoadKg,
      loadSource: args.bw.loadSource,
      effectiveTrainingMaxKg: args.bw.effectiveTrainingMaxKg,
      nextNodePreview: previewFromCandidates(
        args.ctx.candidateNextNodes,
        args.ctx.family,
      ),
    },
  };

  // Surface reps / holdSec on the top-level shape too so the existing
  // focus view (which already understands `holdSec` from PR #92's
  // isometric path) renders correctly even before the BW-specific
  // branch is hot.
  if (args.bw.prescriptionType === "isometric_hold" && args.bw.holdSeconds) {
    item.holdSec = { min: args.bw.holdSeconds, max: args.bw.holdSeconds };
  } else if (args.bw.reps != null) {
    item.reps = args.bw.reps;
  }

  return item;
}

/**
 * Assemble the BW main-lift PrescriptionItems for one planned session.
 *
 * Inputs:
 *   - `byFamily` — user's bw_progress + resolved node + catalog movement,
 *     keyed by family. The caller passes ONLY families with a valid row.
 *   - `archetype` / `weekIndex` — drive the matrix.
 *   - `seed` — block_id + dayIndex + slot, hashed inside `pickFamiliesForBwSession`
 *     to keep the rotation deterministic across re-renders.
 *   - `includeBackOff` — when true, append a back-off item per main
 *     (Phase 3 contract — see plan: "main + back_off only").
 *
 * Returns items in the order [family1.main, family1.back_off,
 * family2.main, family2.back_off, family3.main, family3.back_off].
 */
export function buildBwMainItemsForSession(args: {
  byFamily: ReadonlyMap<MovementFamily, BwFamilyContext>;
  archetype: ArchetypeId | string;
  weekIndex: 0 | 1 | 2 | 3;
  seed: string;
  includeBackOff?: boolean;
  /**
   * Phase 7 — user's resolved equipment + body mass. When supplied,
   * loadable nodes (`external_load_capable=true`) get a vest / belt /
   * ankle / band-assist suggestion via `bwPrescription`. Omit on
   * bodyweight-only setups to preserve the Phase 3 behaviour.
   */
  equipment?: Equipment;
  userBodyweightKg?: number;
}): PrescriptionItem[] {
  const available = new Set(args.byFamily.keys());
  const families = pickFamiliesForBwSession({
    availableFamilies: available,
    archetype: args.archetype,
    seed: args.seed,
  });

  const items: PrescriptionItem[] = [];
  for (const family of families) {
    const ctx = args.byFamily.get(family);
    if (!ctx) continue;
    const main = bwPrescription({
      node: ctx.node,
      family,
      archetype: args.archetype,
      bucket: "main",
      weekIndex: args.weekIndex,
      cleanRepHistory: ctx.cleanRepHistory,
      equipment: args.equipment,
      userBodyweightKg: args.userBodyweightKg,
    });
    items.push(buildBwPrescriptionItem({ ctx, kind: "main", bw: main }));

    if (args.includeBackOff !== false) {
      const backOff = bwPrescription({
        node: ctx.node,
        family,
        archetype: args.archetype,
        bucket: "back_off",
        weekIndex: args.weekIndex,
        cleanRepHistory: ctx.cleanRepHistory,
        equipment: args.equipment,
        userBodyweightKg: args.userBodyweightKg,
      });
      items.push(buildBwPrescriptionItem({ ctx, kind: "back_off", bw: backOff }));
    }
  }
  return items;
}

/**
 * Stamp the Phase 4 "Next:" hint onto a prescription item. Picks the
 * lowest-anchor same-family child of the current node, or returns the
 * `mastered: true` terminal marker when none exist.
 */
function previewFromCandidates(
  candidates: ReadonlyArray<MovementNode> | undefined,
  family: MovementFamily,
):
  | { nodeKey: string; displayName: string; difficultyAnchor: number }
  | { mastered: true }
  | undefined {
  if (!candidates) return undefined;
  const sameFamily = candidates.filter((n) => n.family === family);
  if (sameFamily.length === 0) return { mastered: true };
  const sorted = [...sameFamily].sort((a, b) => {
    if (a.difficultyAnchor !== b.difficultyAnchor) {
      return a.difficultyAnchor - b.difficultyAnchor;
    }
    return a.nodeKey.localeCompare(b.nodeKey);
  });
  const next = sorted[0]!;
  return {
    nodeKey: next.nodeKey,
    displayName: next.displayName,
    difficultyAnchor: next.difficultyAnchor,
  };
}
