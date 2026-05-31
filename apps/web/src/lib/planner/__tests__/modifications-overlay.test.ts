/**
 * Unit tests for the read-time taper/recovery overlay seam (ADR-0008
 * wiring). `resolveModificationsForDate` reduces applied rows to a
 * per-date scaling; `applyModificationsToPrescription` applies it to a
 * materialised prescription. The key invariant: with no applied row,
 * the transform is a byte-identical no-op (same object reference) so
 * users who never accept a taper see unchanged prescriptions.
 */
import { describe, it, expect } from "vitest";
import type { Prescription } from "@hta/db";
import {
  resolveModificationsForDate,
  applyModificationsToPrescription,
  type ActiveModificationRow,
} from "../modifications";

function taperRow(
  start: string,
  end: string,
  window: { date: string; volumeScale: number; intensityAction: "hold" | "hold_then_taper" | "minimal" }[],
): ActiveModificationRow {
  return {
    kind: "taper",
    start_date: start,
    end_date: end,
    ramp_end_date: null,
    payload: { eventId: "e", eventName: "Race", eventDate: end, window },
  };
}

function recoveryRow(start: string, end: string): ActiveModificationRow {
  return {
    kind: "recovery",
    start_date: start,
    end_date: end,
    ramp_end_date: end,
    payload: {
      eventId: "e",
      eventName: "Race",
      eventDate: start,
      days: 4,
      rampDays: 2,
      strengthLoadScale: 0,
      cardioLoadScale: 0.5,
      sourceWindow: {
        days: 4,
        rampDays: 2,
        strengthLoadScale: 0,
        cardioLoadScale: 0.5,
      },
    },
  };
}

const PRESCRIPTION: Prescription = {
  items: [
    { kind: "main", movementId: "sq", sets: 4, reps: 5, percentTm: 80 },
    { kind: "main", movementId: "sq", sets: 1, reps: 5, percentTm: 80 },
    { kind: "accessory", movementId: "curl", sets: 3, reps: 12 },
    { kind: "cardio_z2", movementId: "run", durationMin: 40 },
  ] as Prescription["items"],
};

describe("resolveModificationsForDate", () => {
  it("returns NO_ACTIVE for empty rows", () => {
    const m = resolveModificationsForDate([], "2026-06-01");
    expect(m.source).toBeNull();
  });

  it("returns NO_ACTIVE when date is outside every window", () => {
    const rows = [taperRow("2026-06-10", "2026-06-14", [
      { date: "2026-06-10", volumeScale: 0.6, intensityAction: "hold" },
    ])];
    expect(resolveModificationsForDate(rows, "2026-06-01").source).toBeNull();
  });

  it("resolves the taper day matching the target date", () => {
    const rows = [taperRow("2026-06-10", "2026-06-12", [
      { date: "2026-06-10", volumeScale: 0.6, intensityAction: "hold" },
      { date: "2026-06-11", volumeScale: 0.4, intensityAction: "minimal" },
    ])];
    const m = resolveModificationsForDate(rows, "2026-06-11");
    expect(m.source).toBe("taper");
    expect(m.volumeScale).toBe(0.4);
    expect(m.intensityAction).toBe("minimal");
  });

  it("recovery wins over taper when both span the day", () => {
    const rows = [
      taperRow("2026-06-10", "2026-06-12", [
        { date: "2026-06-11", volumeScale: 0.4, intensityAction: "hold" },
      ]),
      recoveryRow("2026-06-10", "2026-06-13"),
    ];
    const m = resolveModificationsForDate(rows, "2026-06-11");
    expect(m.source).toBe("recovery");
  });

  it("accepts a Date as well as a string", () => {
    const rows = [taperRow("2026-06-11", "2026-06-11", [
      { date: "2026-06-11", volumeScale: 0.5, intensityAction: "hold" },
    ])];
    const m = resolveModificationsForDate(rows, new Date("2026-06-11T00:00:00Z"));
    expect(m.source).toBe("taper");
  });
});

describe("applyModificationsToPrescription", () => {
  it("is a byte-identical no-op when there is no active modification", () => {
    const mods = resolveModificationsForDate([], "2026-06-01");
    expect(applyModificationsToPrescription(PRESCRIPTION, mods)).toBe(PRESCRIPTION);
  });

  it("cuts main set count and scales cardio under an applied taper", () => {
    const rows = [taperRow("2026-06-11", "2026-06-11", [
      { date: "2026-06-11", volumeScale: 0.5, intensityAction: "hold" },
    ])];
    const mods = resolveModificationsForDate(rows, "2026-06-11");
    const out = applyModificationsToPrescription(PRESCRIPTION, mods);
    const baseMain = PRESCRIPTION.items.filter((i) => i.kind === "main").length;
    const outMain = out.items.filter((i) => i.kind === "main").length;
    expect(outMain).toBeLessThan(baseMain);
    expect(outMain).toBeGreaterThan(0);
    // Accessories untouched.
    expect(out.items.filter((i) => i.kind === "accessory").length).toBe(1);
    // Cardio duration scaled down.
    const cardio = out.items.find((i) => i.kind === "cardio_z2");
    expect(cardio?.durationMin).toBeLessThan(40);
  });
});
