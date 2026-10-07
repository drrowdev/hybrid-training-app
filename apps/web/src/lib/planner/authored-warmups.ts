import type { Prescription, PrescriptionItem } from "@hta/db";
import { isSystemLoadMovementSlug, resolveTargetLoadKg } from "@hta/domain";
import { generateWarmupItems, resolveWarmupScheme, roundWarmupLoadKg, type WarmupLoadOptions } from "./warmups";

export type AuthoredWarmupMovement = {
  id: string;
  slug: string;
  equipment: string | null;
  oneRmKg: number | null;
  tmKg: number | null;
  loadOptions: WarmupLoadOptions;
};

/** Issuance only: never call on a prescription already linked to a session. */
export function prepareAuthoredWarmups(
  prescription: Prescription,
  movements: readonly AuthoredWarmupMovement[],
  storedScheme: unknown,
  bodyweightKg: number | null,
): Prescription {
  if (!prescription.items.some((item) => typeof item.meta?.authoredPartId === "string") ||
      prescription.meta?.authoredWarmupsIssued === true) return prescription;
  const scheme = resolveWarmupScheme(storedScheme);
  const seen = new Set<string>();
  const items = prescription.items.flatMap((item): PrescriptionItem[] => {
    const partId = item.meta?.authoredPartId;
    if (item.kind !== "main" || item.circuit || item.meta?.rehab === true ||
        typeof partId !== "string" || seen.has(partId)) return [item];
    seen.add(partId);
    const movement = movements.find((entry) => entry.id === item.movementId);
    const systemLoad = movement && isSystemLoadMovementSlug(movement.slug);
    if (!movement || /band|bodyweight|body_weight|none/i.test(movement.equipment ?? "none") && !systemLoad ||
        prescription.items.some((entry) => entry.kind === "warmup" && entry.meta?.authoredPartId === partId)) return [item];
    const context = {
      tmKg: movement.tmKg, oneRmKg: movement.oneRmKg, bodyweightKg,
      isSystemLoad: systemLoad,
      roundKg: (kg: number) => roundWarmupLoadKg(kg, movement.loadOptions),
      roundAbsoluteKg: (kg: number) => roundWarmupLoadKg(kg, movement.loadOptions),
    };
    const workingLoad = resolveTargetLoadKg(item, context);
    if (workingLoad == null || workingLoad < 0 || workingLoad === 0 && !systemLoad ||
        systemLoad && !(bodyweightKg != null && bodyweightKg > 0)) return [item];
    const topPercent = Math.max(...prescription.items.filter((entry) =>
      entry.kind === "main" && entry.meta?.authoredPartId === partId).map((entry) => entry.percentTm ?? 0));
    const ramp = generateWarmupItems(item.movementId, topPercent || 100, scheme, item);
    let previousLoad: number | null = null;
    const warmups = ramp.flatMap((rung): PrescriptionItem[] => {
      const { authoredLoadRoundingKg: _rounding, restSeconds: _rest, programLoadBasis, ...meta } = item.meta ?? {};
      void _rounding;
      void _rest;
      const tmAnchored = scheme.anchor === "training_max";
      const warmup: PrescriptionItem = {
        ...rung, meta: { ...meta, ...(!tmAnchored && programLoadBasis ? { programLoadBasis } : {}) },
      };
      if (topPercent && !tmAnchored) warmup.intensityLabel = `${rung.percentTm}% 1RM`;
      if (tmAnchored && !(movement.tmKg != null && movement.tmKg > 0)) return [];
      if (!topPercent && !tmAnchored) {
        delete warmup.percentTm;
        delete warmup.intensityLabel;
        const anchor = workingLoad + (systemLoad ? bodyweightKg ?? 0 : 0);
        if (anchor <= 0) return [];
        warmup.targetWeightKg = anchor * (rung.percentTm ?? 0) / 100;
      }
      const load = resolveTargetLoadKg(warmup, context);
      if (load == null || systemLoad && previousLoad === load) return [];
      previousLoad = load;
      return [warmup];
    });
    return [...warmups, item];
  });
  if (items.length > 500) throw new Error("This workout exceeds 500 sets and cardio parts with warm-ups. Reduce its sets before starting.");
  return { ...prescription, items, meta: { ...prescription.meta, authoredWarmupsIssued: true } };
}
