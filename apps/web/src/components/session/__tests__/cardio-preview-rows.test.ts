import { describe, it, expect } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import { cardioPreviewRows } from "../cardio-preview-rows";

const cardio = (over: Partial<PrescriptionItem>): PrescriptionItem =>
  ({
    kind: "cardio_vo2",
    movementId: "m1",
    ...over,
  }) as unknown as PrescriptionItem;

describe("cardioPreviewRows", () => {
  it("splits the classic VO2 protocolNote into Duration / Intervals / Intensity / Recovery rows", () => {
    const rows = cardioPreviewRows(
      cardio({
        durationMin: 35,
        protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
      }),
    );
    expect(rows.map((r) => r.label)).toEqual([
      "Duration",
      "Intervals",
      "Intensity",
      "Recovery",
    ]);
    expect(rows[0]!.value).toBe("35 min");
    expect(rows[1]!.value).toMatch(/4\s*×\s*4\s*min/);
    expect(rows[2]!.value).toContain("HRmax");
    expect(rows[3]!.value).toMatch(/3 min easy recovery/);
  });

  it("recognises 'walk back down for recovery' as the Recovery row", () => {
    const rows = cardioPreviewRows(
      cardio({
        kind: "cardio_alactic" as PrescriptionItem["kind"],
        durationMin: 10,
        protocolNote:
          "6–10 × 10–15s near-max hill sprints, walk back down for recovery (~90–120s)",
      }),
    );
    const labels = rows.map((r) => r.label);
    expect(labels).toContain("Duration");
    expect(labels).toContain("Intervals");
    expect(labels).toContain("Recovery");
  });

  it("falls back to a Protocol row for notes that don't match known patterns", () => {
    const rows = cardioPreviewRows(
      cardio({
        durationMin: 45,
        protocolNote: "steady aerobic effort, nasal breathing only",
      }),
    );
    const labels = rows.map((r) => r.label);
    expect(labels).toContain("Duration");
    expect(labels).toContain("Protocol");
  });

  it("uses hrCap as the Intensity row when the protocolNote didn't already supply one", () => {
    const rows = cardioPreviewRows(
      cardio({
        kind: "cardio_z2" as PrescriptionItem["kind"],
        durationMin: 60,
        hrCap: "≤ 70% HRR",
      }),
    );
    const intensity = rows.find((r) => r.label === "Intensity");
    expect(intensity?.value).toBe("≤ 70% HRR");
  });

  it("drops the hrCap row entirely when the protocolNote already produced an Intensity row", () => {
    const rows = cardioPreviewRows(
      cardio({
        durationMin: 35,
        protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
        hrCap: "90–95% HRmax during work",
      }),
    );
    // Intensity comes from the note, NOT from the hrCap field.
    expect(rows.find((r) => r.label === "Intensity")?.value).toContain(
      "HRmax",
    );
    expect(rows.find((r) => r.label === "Intensity")?.value).not.toContain(
      "during work",
    );
    // The duplicate "HR cap" row is gone.
    expect(rows.find((r) => r.label === "HR cap")).toBeUndefined();
    // Defence in depth: the hrCap label literal must not appear in any row.
    expect(rows.map((r) => r.label)).not.toContain("HR cap");
  });

  it("returns an empty list for a wholly empty cardio item (defensive)", () => {
    const rows = cardioPreviewRows(cardio({}));
    expect(rows).toEqual([]);
  });
});
