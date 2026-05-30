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

  it("falls back to a kind-based Intensity when neither protocolNote nor hrCap is set", () => {
    // The Long Z2 bug: a cardio_z2 with hrCap stripped (or any kind
    // that doesn't ship with one) used to render zero Intensity rows.
    // The fallback guarantees the hero / preview always have *some*
    // intensity guidance to surface.
    const z2 = cardioPreviewRows(
      cardio({
        kind: "cardio_z2" as PrescriptionItem["kind"],
        durationMin: 60,
      }),
    );
    expect(z2.find((r) => r.label === "Intensity")?.value).toMatch(/HRR/);

    const vo2 = cardioPreviewRows(
      cardio({
        kind: "cardio_vo2" as PrescriptionItem["kind"],
        durationMin: 30,
      }),
    );
    expect(vo2.find((r) => r.label === "Intensity")?.value).toMatch(/HRmax/);

    const threshold = cardioPreviewRows(
      cardio({
        kind: "cardio_threshold" as PrescriptionItem["kind"],
        durationMin: 30,
      }),
    );
    expect(threshold.find((r) => r.label === "Intensity")?.value).toMatch(
      /threshold/i,
    );

    const alactic = cardioPreviewRows(
      cardio({
        kind: "cardio_alactic" as PrescriptionItem["kind"],
        durationMin: 10,
      }),
    );
    expect(alactic.find((r) => r.label === "Intensity")?.value).toMatch(
      /max/i,
    );
  });

  it("falls back to a generic Intensity for unknown cardio kinds", () => {
    const rows = cardioPreviewRows(
      cardio({
        kind: "cardio_future_unknown" as unknown as PrescriptionItem["kind"],
        durationMin: 30,
      }),
    );
    expect(rows.find((r) => r.label === "Intensity")?.value).toBe(
      "Follow prescribed effort",
    );
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

  it("emits only the kind-based Intensity fallback for an otherwise-empty cardio item", () => {
    // The parser now always surfaces *some* intensity guidance — even
    // when the only signal is the kind itself — so downstream cards
    // never render an empty cardio block. Previously this returned
    // [] which left the Today hero with a single bare row for Z2.
    const rows = cardioPreviewRows(cardio({}));
    expect(rows).toEqual([
      { label: "Intensity", value: "90–95% HRmax (hard)" },
    ]);
  });
});
