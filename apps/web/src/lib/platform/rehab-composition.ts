import type { EmbeddedRehabSection } from "@hta/domain";
import {
  countDistinctRehabMovements,
  partitionRehabItems,
  prependRehabItems,
} from "@hta/domain";
import type { Prescription, PrescriptionItem } from "@hta/db";

export type RehabSectionSource = {
  protocolId: string | null;
  protocolName: string;
  sourceRef: string;
};

function tagRehabItems(
  items: readonly PrescriptionItem[],
  source: RehabSectionSource,
): PrescriptionItem[] {
  return items.map((item) => ({
    ...item,
    meta: {
      ...item.meta,
      rehab: true,
      rehabProtocolId: source.protocolId,
      rehabProtocolName: source.protocolName,
      rehabSourceRef: source.sourceRef,
      rehabPlacement: "during_warmup",
    },
  }));
}

function sectionFor(
  items: readonly PrescriptionItem[],
  source: RehabSectionSource,
): EmbeddedRehabSection {
  return {
    ...source,
    placement: "during_warmup",
    itemCount: items.length,
    movementCount: countDistinctRehabMovements(items),
  };
}

export function embedRehabPrescription(
  primary: Prescription,
  rehabItems: readonly PrescriptionItem[],
  source: RehabSectionSource,
): Prescription {
  const taggedItems = tagRehabItems(rehabItems, source);
  const priorSections = primary.meta?.embeddedRehabSections ?? [];
  return {
    ...primary,
    items: prependRehabItems(primary.items, taggedItems),
    meta: {
      ...primary.meta,
      embeddedRehabSections: [
        ...priorSections.filter((section) => section.sourceRef !== source.sourceRef),
        sectionFor(taggedItems, source),
      ],
    },
  };
}

export function embeddedRehabSnapshot(prescription: Prescription): {
  items: PrescriptionItem[];
  sections: EmbeddedRehabSection[];
} {
  return {
    items: partitionRehabItems(prescription.items).rehab,
    sections: prescription.meta?.embeddedRehabSections ?? [],
  };
}

export function rehabItemsForComparison(
  prescription: Prescription,
): PrescriptionItem[] {
  return embeddedRehabSnapshot(prescription).items.map((item) => {
    const stableMeta = { ...(item.meta ?? {}) };
    delete stableMeta.rehabProtocolId;
    delete stableMeta.rehabProtocolName;
    delete stableMeta.rehabSourceRef;
    delete stableMeta.rehabPlacement;
    return {
      ...item,
      meta: stableMeta,
    };
  });
}

export function replaceEmbeddedRehab(
  current: Prescription,
  generated: Prescription,
): Prescription {
  const generatedRehab = embeddedRehabSnapshot(generated);
  const currentMeta = { ...(current.meta ?? {}) };
  delete currentMeta.embeddedRehabSections;
  return {
    ...current,
    items: prependRehabItems(current.items, generatedRehab.items),
    meta: {
      ...currentMeta,
      ...(generatedRehab.sections.length > 0
        ? { embeddedRehabSections: generatedRehab.sections }
        : {}),
    },
  };
}

export function stripEmbeddedRehab(
  prescription: Prescription,
): Prescription {
  const currentMeta = { ...(prescription.meta ?? {}) };
  delete currentMeta.embeddedRehabSections;
  return {
    ...prescription,
    items: partitionRehabItems(prescription.items).core,
    meta: currentMeta,
  };
}
