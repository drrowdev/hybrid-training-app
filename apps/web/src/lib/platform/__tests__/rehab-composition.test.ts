import { describe, expect, it } from "vitest";
import type { Prescription, PrescriptionItem } from "@hta/db";
import {
  embedRehabPrescription,
  embeddedRehabSnapshot,
  rehabItemsForComparison,
  replaceEmbeddedRehab,
} from "../rehab-composition";

const mainItem: PrescriptionItem = {
  movementId: "main",
  movementSlug: "main",
  movementName: "Main",
  kind: "main",
  sets: 1,
  reps: 5,
};

const rehabItem: PrescriptionItem = {
  movementId: "rehab",
  movementSlug: "rehab",
  movementName: "Rehab",
  kind: "tendon",
  sets: 1,
  reps: 10,
};

const source = {
  protocolId: "adductor-v1",
  protocolName: "Adductor",
  sourceRef: "rehab-assignment-0",
};

describe("rehab prescription composition", () => {
  it("embeds tagged rehab before strength and records its provenance", () => {
    const result = embedRehabPrescription({ items: [mainItem] }, [rehabItem], source);

    expect(result.items.map((item) => item.movementId)).toEqual(["rehab", "main"]);
    expect(result.items[0]?.meta).toMatchObject({
      rehab: true,
      rehabProtocolId: "adductor-v1",
      rehabSourceRef: "rehab-assignment-0",
      rehabPlacement: "during_warmup",
    });
    expect(result.meta?.embeddedRehabSections).toEqual([
      {
        ...source,
        placement: "during_warmup",
        itemCount: 1,
        movementCount: 1,
      },
    ]);
  });

  it("replaces only embedded rehab when today's strength prescription was edited", () => {
    const current: Prescription = embedRehabPrescription(
      {
        items: [{ ...mainItem, movementId: "user-main" }],
        userEdited: true,
      },
      [rehabItem],
      source,
    );
    current.meta = {
      ...current.meta,
      embeddedRehabMigrationSources: [
        {
          migrationSource: {
            migration: "0127_embed_same_day_rehab",
            plannedSessionId: "legacy-rehab-row",
            originalStrengthPrescription: { items: [mainItem] },
            originalStrengthRow: { id: "strength-row" },
            originalRehabRow: { id: "rehab-row" },
          },
        },
      ],
    };
    const generated = embedRehabPrescription(
      { items: [mainItem] },
      [{ ...rehabItem, movementId: "updated-rehab" }],
      source,
    );

    const result = replaceEmbeddedRehab(current, generated);
    expect(result.userEdited).toBe(true);
    expect(result.items.map((item) => item.movementId)).toEqual([
      "updated-rehab",
      "user-main",
    ]);
    expect(embeddedRehabSnapshot(result).items).toHaveLength(1);
    expect(result.meta?.embeddedRehabMigrationSources).toEqual(
      current.meta.embeddedRehabMigrationSources,
    );
  });

  it("compares legacy and embedded rehab without provenance-only differences", () => {
    const legacy: Prescription = {
      items: [{ ...rehabItem, meta: { rehab: true } }],
    };
    const embedded = embedRehabPrescription(
      { items: [mainItem] },
      [legacy.items[0]!],
      source,
    );

    expect(rehabItemsForComparison(embedded)).toEqual(
      rehabItemsForComparison(legacy),
    );
  });
});
