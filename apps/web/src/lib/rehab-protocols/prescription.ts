import type { PrescriptionItem } from "@hta/db";
import type { RehabProtocolItem } from "./item-schema";
import type { SessionLink } from "@/lib/platform/session-links";
import { applyRehabLinks } from "@/lib/platform/rehab-links";
import { expandPrescriptionSetItems } from "@/lib/planner/expand-prescription-sets";

export function rehabPrescriptionItems(
  items: readonly RehabProtocolItem[],
  source: { protocolId: string | null; protocolName: string; sourceRef: string; revision?: number },
): PrescriptionItem[] {
  return items.map((item) => {
    const sideCue = item.side === "left" ? "Left side" : item.side === "right" ? "Right side" : "";
    const instructions = [sideCue, item.instructions].filter(Boolean).join(" · ");
    return {
      movementId: item.movementId, movementName: item.movementName, kind: "tendon", sets: item.sets,
      ...(item.reps != null ? { reps: item.reps } : {}),
      ...(item.repRange ? { repRange: item.repRange } : {}),
      ...(item.holdSeconds != null ? { holdSec: { min: item.holdSeconds, max: item.holdSeconds } } : {}),
      ...(item.targetWeightKg != null ? { targetWeightKg: item.targetWeightKg } : {}),
      ...(instructions ? { notes: instructions, intensityCue: instructions.slice(0, 80) } : {}),
      meta: { rehab: true, rehabProtocolId: source.protocolId, rehabProtocolName: source.protocolName,
        rehabSourceRef: source.sourceRef, rehabPlacement: "during_warmup",
        ...(source.revision != null ? { rehabProtocolRevision: source.revision } : {}),
        ...(item.side ? { side: item.side } : {}),
      },
    };
  });
}

export function compileLibraryRehab(
  protocol: { id: string; name: string; revision: number; items: RehabProtocolItem[]; links: SessionLink[] },
  sourceRef: string,
): PrescriptionItem[] {
  const items = rehabPrescriptionItems(protocol.items, {
    protocolId: protocol.id, protocolName: protocol.name, sourceRef, revision: protocol.revision,
  }).flatMap((item, itemIndex) => expandPrescriptionSetItems([item]).map((expanded, setIndex) => ({
    ...expanded, meta: { ...expanded.meta, rehabItemIndex: itemIndex, rehabSetIndex: setIndex },
  })));
  return applyRehabLinks(items, protocol.links, `${protocol.id}:${sourceRef}`);
}
