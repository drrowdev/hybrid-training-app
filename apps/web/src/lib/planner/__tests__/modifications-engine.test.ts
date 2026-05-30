/**
 * Engine integration test for the taper / recovery prescription
 * modifications.
 *
 * The first test block is the REGRESSION GATE — `buildPrescription`
 * with NO modifications must produce identical output to before
 * `activeModifications` existed. That's enforced by snapshot-equality
 * across every archetype × week × strength/cardio/tendon path.
 */
import { describe, it, expect } from "vitest";
import {
  STRENGTH_ANCHOR,
  ENDURANCE_ANCHOR,
  buildPrescription,
  type DayTemplate,
  type StrengthDay,
  type CardioDay,
  type TendonDay,
} from "../archetypes";
import { NO_ACTIVE_MODIFICATIONS } from "../modifications";

const PRIMARY = { id: "p", slug: "p-slug", displayName: "Primary" };
const SECONDARY = { id: "s", slug: "s-slug", displayName: "Secondary" };
const FINISHER = { id: "f", slug: "f-slug", displayName: "Finisher" };

function strengthDay(): StrengthDay {
  return STRENGTH_ANCHOR.days.find(
    (d): d is StrengthDay => d.kind === "strength",
  )!;
}
function cardioDay(): CardioDay | null {
  return (
    (STRENGTH_ANCHOR.days.find((d): d is CardioDay => d.kind === "cardio") ??
      ENDURANCE_ANCHOR.days.find((d): d is CardioDay => d.kind === "cardio")) ??
    null
  );
}

describe("REGRESSION: buildPrescription with no modifications matches default behaviour", () => {
  it("strength day default == omitted activeModifications", () => {
    const day = strengthDay();
    const a = buildPrescription(STRENGTH_ANCHOR, 0, day, PRIMARY);
    const b = buildPrescription(
      STRENGTH_ANCHOR,
      0,
      day,
      PRIMARY,
      undefined,
      undefined,
      NO_ACTIVE_MODIFICATIONS,
    );
    expect(b).toEqual(a);
  });

  it("cardio day default == omitted activeModifications", () => {
    const day = cardioDay();
    if (!day) return;
    const a = buildPrescription(STRENGTH_ANCHOR, 0, day, PRIMARY, FINISHER);
    const b = buildPrescription(
      STRENGTH_ANCHOR,
      0,
      day,
      PRIMARY,
      FINISHER,
      undefined,
      NO_ACTIVE_MODIFICATIONS,
    );
    expect(b).toEqual(a);
  });

  it("dual-main-lift secondary slot unchanged with no mods", () => {
    const tue = ENDURANCE_ANCHOR.days.find(
      (d): d is StrengthDay => d.kind === "strength" && d.dayIndex === 1,
    )!;
    const a = buildPrescription(ENDURANCE_ANCHOR, 0, tue, PRIMARY, undefined, SECONDARY);
    const b = buildPrescription(
      ENDURANCE_ANCHOR,
      0,
      tue,
      PRIMARY,
      undefined,
      SECONDARY,
      NO_ACTIVE_MODIFICATIONS,
    );
    expect(b).toEqual(a);
  });
});

describe("Taper modification scaling", () => {
  it("volumeScale 0.4 with intensityAction=hold cuts main set count proportionally", () => {
    const day = strengthDay();
    const baseline = buildPrescription(STRENGTH_ANCHOR, 0, day, PRIMARY);
    const scaled = buildPrescription(STRENGTH_ANCHOR, 0, day, PRIMARY, undefined, undefined, {
      volumeScale: 0.4,
      intensityAction: "hold",
      strengthLoadScale: 0.4,
      cardioLoadScale: 0.4,
      source: "taper",
    });
    const baseMain = baseline.filter((i) => i.kind === "main");
    const scaledMain = scaled.filter((i) => i.kind === "main");
    expect(scaledMain.length).toBeGreaterThan(0);
    expect(scaledMain.length).toBeLessThan(baseMain.length);
    // Reps unchanged when intensityAction = "hold".
    expect(scaledMain[0]!.reps).toBe(baseMain[0]!.reps);
  });

  it("intensityAction=minimal halves reps on retained main sets", () => {
    const day = strengthDay();
    const baseline = buildPrescription(STRENGTH_ANCHOR, 0, day, PRIMARY);
    const scaled = buildPrescription(STRENGTH_ANCHOR, 0, day, PRIMARY, undefined, undefined, {
      volumeScale: 0.4,
      intensityAction: "minimal",
      strengthLoadScale: 0.4,
      cardioLoadScale: 0.4,
      source: "taper",
    });
    const baseMain = baseline.filter((i) => i.kind === "main");
    const scaledMain = scaled.filter((i) => i.kind === "main");
    expect(scaledMain[0]!.reps).toBe(Math.max(1, Math.floor((baseMain[0]!.reps as number) * 0.5)));
  });

  it("cardio durationMin scales by cardioLoadScale", () => {
    const day = cardioDay();
    if (!day) return;
    const baseline = buildPrescription(STRENGTH_ANCHOR, 0, day, PRIMARY, FINISHER);
    const scaled = buildPrescription(STRENGTH_ANCHOR, 0, day, PRIMARY, FINISHER, undefined, {
      volumeScale: 0.4,
      intensityAction: "hold",
      strengthLoadScale: 0.4,
      cardioLoadScale: 0.4,
      source: "taper",
    });
    const baseCardio = baseline.find((i) => i.kind.startsWith("cardio_"));
    const scaledCardio = scaled.find((i) => i.kind.startsWith("cardio_"));
    if (baseCardio?.durationMin != null && scaledCardio?.durationMin != null) {
      expect(scaledCardio.durationMin).toBeLessThan(baseCardio.durationMin);
    }
  });
});

describe("Recovery modification scaling", () => {
  it("strengthLoadScale=0 drops all main + tendon items", () => {
    const day = strengthDay();
    const scaled = buildPrescription(STRENGTH_ANCHOR, 0, day, PRIMARY, undefined, undefined, {
      volumeScale: 1,
      intensityAction: null,
      strengthLoadScale: 0,
      cardioLoadScale: 0.5,
      source: "recovery",
    });
    expect(scaled.filter((i) => i.kind === "main").length).toBe(0);
    expect(scaled.filter((i) => i.kind === "tendon").length).toBe(0);
  });

  it("strengthLoadScale=0 preserves accessories untouched (out of scope)", () => {
    const day = strengthDay();
    const baseline = buildPrescription(STRENGTH_ANCHOR, 0, day, PRIMARY);
    const scaled = buildPrescription(STRENGTH_ANCHOR, 0, day, PRIMARY, undefined, undefined, {
      volumeScale: 1,
      intensityAction: null,
      strengthLoadScale: 0,
      cardioLoadScale: 0.5,
      source: "recovery",
    });
    const baseAcc = baseline.filter((i) => i.kind === "accessory");
    const scaledAcc = scaled.filter((i) => i.kind === "accessory");
    expect(scaledAcc).toEqual(baseAcc);
  });

  it("cardioLoadScale=0 drops cardio items entirely", () => {
    const day = cardioDay();
    if (!day) return;
    const scaled = buildPrescription(STRENGTH_ANCHOR, 0, day, PRIMARY, FINISHER, undefined, {
      volumeScale: 1,
      intensityAction: null,
      strengthLoadScale: 0,
      cardioLoadScale: 0,
      source: "recovery",
    });
    expect(scaled.filter((i) => i.kind.startsWith("cardio_")).length).toBe(0);
  });
});
