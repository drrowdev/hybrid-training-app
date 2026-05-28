/**
 * ADR 0004 — Endurance Anchor dual-main-lift redesign + CONCURRENT_HYBRID
 * frequency-trim bug fix.
 *
 * Three behavioural contracts covered here:
 *
 *   (a) ENDURANCE_ANCHOR exposes both lower-body main lifts AND upper-body
 *       main lifts across the week, via the new `secondaryRole` field on
 *       its two strength days (Tue squat→OHP, Thu deadlift→bench).
 *
 *   (b) The secondary-slot set count cap (`secondaryMaxSets = 3`) is
 *       honoured by `buildPrescription`: the primary lift gets the full
 *       wave, the secondary lift gets at most `secondaryMaxSets` items.
 *
 *   (c) CONCURRENT_HYBRID at freq=2 trims to exactly the two anchor
 *       strength days (squat + deadlift) — fixes the prior bug where the
 *       four strength days were all `priority: "anchor"` so the trim
 *       returned all four no matter the frequency.
 */
import { describe, it, expect } from "vitest";
import {
  ENDURANCE_ANCHOR,
  CONCURRENT_HYBRID,
  buildPrescription,
  daysForFrequency,
  requiredStrengthRoles,
  allCandidateLiftSlugs,
  type DayTemplate,
  type StrengthDay,
} from "../archetypes";

const FAKE_PRIMARY = { id: "primary-id", slug: "primary-slug", displayName: "Primary" };
const FAKE_SECONDARY = { id: "secondary-id", slug: "secondary-slug", displayName: "Secondary" };

describe("ADR 0004 — ENDURANCE_ANCHOR dual-main-lift", () => {
  it("covers all four main movement patterns across the week (squat, deadlift, horizontal_press, vertical_press)", () => {
    const roles = new Set(requiredStrengthRoles(ENDURANCE_ANCHOR));
    expect(roles.has("squat")).toBe(true);
    expect(roles.has("deadlift")).toBe(true);
    expect(roles.has("horizontal_press")).toBe(true);
    expect(roles.has("vertical_press")).toBe(true);
  });

  it("Tue strength day pairs squat (primary) with vertical_press (secondary)", () => {
    const tue = ENDURANCE_ANCHOR.days.find(
      (d): d is StrengthDay => d.kind === "strength" && d.dayIndex === 1,
    );
    expect(tue).toBeDefined();
    expect(tue!.role).toBe("squat");
    expect(tue!.secondaryRole).toBe("vertical_press");
    expect(tue!.secondaryCandidateSlugs?.length ?? 0).toBeGreaterThan(0);
    expect(tue!.secondaryMaxSets).toBe(3);
    expect(tue!.title).toMatch(/squat/i);
    expect(tue!.title).toMatch(/overhead press/i);
  });

  it("Thu strength day pairs deadlift (primary) with horizontal_press (secondary)", () => {
    const thu = ENDURANCE_ANCHOR.days.find(
      (d): d is StrengthDay => d.kind === "strength" && d.dayIndex === 3,
    );
    expect(thu).toBeDefined();
    expect(thu!.role).toBe("deadlift");
    expect(thu!.secondaryRole).toBe("horizontal_press");
    expect(thu!.secondaryCandidateSlugs?.length ?? 0).toBeGreaterThan(0);
    expect(thu!.secondaryMaxSets).toBe(3);
    expect(thu!.title).toMatch(/deadlift/i);
    expect(thu!.title).toMatch(/bench press/i);
  });

  it("two-a-day variant carries the same dual-main-lift shape on both strength days", () => {
    const am1 = ENDURANCE_ANCHOR.twoADayDays!.find(
      (d): d is StrengthDay =>
        d.kind === "strength" && d.dayIndex === 1 && d.slot === "am",
    );
    const am3 = ENDURANCE_ANCHOR.twoADayDays!.find(
      (d): d is StrengthDay =>
        d.kind === "strength" && d.dayIndex === 3 && d.slot === "am",
    );
    expect(am1?.secondaryRole).toBe("vertical_press");
    expect(am1?.secondaryMaxSets).toBe(3);
    expect(am3?.secondaryRole).toBe("horizontal_press");
    expect(am3?.secondaryMaxSets).toBe(3);
  });

  it("allCandidateLiftSlugs includes both primary and secondary candidate slugs", () => {
    const slugs = new Set(allCandidateLiftSlugs(ENDURANCE_ANCHOR));
    // Primary: squat + deadlift representatives.
    expect(slugs.has("back-squat-high-bar")).toBe(true);
    expect(slugs.has("conventional-deadlift")).toBe(true);
    // Secondary: vertical_press + horizontal_press representatives.
    expect(slugs.has("ohp-standing")).toBe(true);
    expect(slugs.has("bench-press-flat")).toBe(true);
  });
});

describe("ADR 0004 — buildPrescription secondary-slot cap", () => {
  const tue = ENDURANCE_ANCHOR.days.find(
    (d): d is StrengthDay => d.kind === "strength" && d.dayIndex === 1,
  )!;

  it("emits the full primary wave when no secondary movement is supplied (backward-compat)", () => {
    const items = buildPrescription(ENDURANCE_ANCHOR, 0, tue as DayTemplate, FAKE_PRIMARY);
    const primaryItems = items.filter((it) => it.movementId === FAKE_PRIMARY.id);
    const secondaryItems = items.filter((it) => it.movementId === FAKE_SECONDARY.id);
    expect(primaryItems.length).toBe(3); // wave is [0.75, 0.85, 0.90]
    expect(secondaryItems.length).toBe(0);
  });

  it("appends at most secondaryMaxSets items for the secondary movement when supplied", () => {
    const items = buildPrescription(
      ENDURANCE_ANCHOR,
      0,
      tue as DayTemplate,
      FAKE_PRIMARY,
      undefined,
      FAKE_SECONDARY,
    );
    const primaryItems = items.filter((it) => it.movementId === FAKE_PRIMARY.id);
    const secondaryItems = items.filter((it) => it.movementId === FAKE_SECONDARY.id);
    expect(primaryItems.length).toBe(3);
    expect(secondaryItems.length).toBeLessThanOrEqual(tue.secondaryMaxSets!);
    expect(secondaryItems.length).toBeGreaterThan(0);
    // Secondary items are emitted AFTER primary items so the user
    // sequences lower lift first (ADR Decision 2).
    const lastPrimaryIdx = items.map((it) => it.movementId).lastIndexOf(FAKE_PRIMARY.id);
    const firstSecondaryIdx = items.map((it) => it.movementId).indexOf(FAKE_SECONDARY.id);
    expect(firstSecondaryIdx).toBeGreaterThan(lastPrimaryIdx);
  });

  it("secondary items are tagged kind: 'main' so they flow through warmups + stress accounting", () => {
    const items = buildPrescription(
      ENDURANCE_ANCHOR,
      0,
      tue as DayTemplate,
      FAKE_PRIMARY,
      undefined,
      FAKE_SECONDARY,
    );
    const secondaryItems = items.filter((it) => it.movementId === FAKE_SECONDARY.id);
    for (const it of secondaryItems) {
      expect(it.kind).toBe("main");
      expect(it.percentTm).toBeTypeOf("number");
    }
  });

  it("deload week shrinks the secondary cap proportionally (volume scale applies to both lifts)", () => {
    // Week 3 in ENDURANCE_ANCHOR is the deload with strengthVolumeScale = 0.5.
    const items = buildPrescription(
      ENDURANCE_ANCHOR,
      3,
      tue as DayTemplate,
      FAKE_PRIMARY,
      undefined,
      FAKE_SECONDARY,
    );
    const secondaryItems = items.filter((it) => it.movementId === FAKE_SECONDARY.id);
    // 3 cap × 0.5 deload scale → rounded to 2 (or 1 minimum); never the
    // un-scaled 3.
    expect(secondaryItems.length).toBeLessThan(tue.secondaryMaxSets!);
    expect(secondaryItems.length).toBeGreaterThanOrEqual(1);
  });
});

describe("ADR 0004 — CONCURRENT_HYBRID daysForFrequency trim fix", () => {
  it("freq=2 returns exactly two distinct calendar days, both strength anchors (squat + deadlift)", () => {
    const days = daysForFrequency(CONCURRENT_HYBRID, 2, false);
    const calendarDays = new Set(days.map((d) => d.dayIndex));
    expect(calendarDays.size).toBe(2);

    const strengthRoles = days
      .filter((d) => d.kind === "strength")
      .map((d) => (d as StrengthDay).role);
    expect(strengthRoles).toContain("squat");
    expect(strengthRoles).toContain("deadlift");

    // The pre-fix bug: bench + OHP were `priority: anchor` so they came
    // back at freq=2 regardless of budget. Assert they do NOT.
    expect(strengthRoles).not.toContain("horizontal_press");
    expect(strengthRoles).not.toContain("vertical_press");
  });

  it("freq=3 keeps the two strength anchors and adds one cardio day (the rank-1 cardio optional/anchor)", () => {
    const days = daysForFrequency(CONCURRENT_HYBRID, 3, false);
    const calendarDays = new Set(days.map((d) => d.dayIndex));
    expect(calendarDays.size).toBe(3);

    const strengthRoles = days
      .filter((d) => d.kind === "strength")
      .map((d) => (d as StrengthDay).role);
    expect(strengthRoles).toContain("squat");
    expect(strengthRoles).toContain("deadlift");
    expect(strengthRoles).toHaveLength(2);

    const cardioCount = days.filter((d) => d.kind === "cardio").length;
    expect(cardioCount).toBe(1);
  });

  it("freq=6 returns all six day templates (4 strength + 2 cardio)", () => {
    const days = daysForFrequency(CONCURRENT_HYBRID, 6, false);
    const calendarDays = new Set(days.map((d) => d.dayIndex));
    expect(calendarDays.size).toBe(4 + 2); // squat/bench/dl/ohp + 2 cardio days
    const strengthCount = days.filter((d) => d.kind === "strength").length;
    const cardioCount = days.filter((d) => d.kind === "cardio").length;
    expect(strengthCount).toBe(4);
    expect(cardioCount).toBe(2);
  });

  it("squat and deadlift remain anchor priority; bench and OHP are now optional", () => {
    const squat = CONCURRENT_HYBRID.days.find(
      (d): d is StrengthDay => d.kind === "strength" && d.role === "squat",
    );
    const deadlift = CONCURRENT_HYBRID.days.find(
      (d): d is StrengthDay => d.kind === "strength" && d.role === "deadlift",
    );
    const bench = CONCURRENT_HYBRID.days.find(
      (d): d is StrengthDay => d.kind === "strength" && d.role === "horizontal_press",
    );
    const ohp = CONCURRENT_HYBRID.days.find(
      (d): d is StrengthDay => d.kind === "strength" && d.role === "vertical_press",
    );
    expect(squat?.priority).toBe("anchor");
    expect(deadlift?.priority).toBe("anchor");
    expect(bench?.priority).toBe("optional");
    expect(ohp?.priority).toBe("optional");
  });
});
