/**
 * Day-order placements — serialiser, Zod schema, and materialiser remap.
 *
 * Covers the four scenarios called out in the bugfix:
 *   A) wizard serialises a manually-rearranged schedule into placements
 *   B) materialiser remaps canonical activeDays to user-arranged dayIndex/slot
 *   C) backward compatibility — absent placements keeps canonical behaviour
 *   D) partial coverage — leftover canonical templates fall back gracefully
 *
 * The materialiser tests run against the pure helper rather than the full
 * server action so they don't need a Supabase double; the helper is the
 * unit under test for the day-order behaviour the bug was about.
 */
import { describe, it, expect } from "vitest";
import {
  applyPlacementsToActiveDays,
  buildPlacementsFromSchedule,
  dayIndexOverridesSchema,
  kindFromWeightKey,
  type Placement,
} from "../placements";
import type { ScheduleCell, SessionShape, WeightKey } from "../schedule";
import { daysForFrequency, ARCHETYPES, type DayTemplate } from "../../archetypes";

function shape(weightKey: WeightKey, title = String(weightKey)): SessionShape {
  return { icon: "🏋️", title, meta: "", weightKey, durationMin: 45 };
}

function emptyCells(): ScheduleCell[] {
  return Array.from({ length: 7 }, (_, day) => ({ day, am: null, pm: null }));
}

describe("kindFromWeightKey", () => {
  it("maps the wizard's WeightKey vocabulary onto materialiser kinds", () => {
    expect(kindFromWeightKey("Strength day (heavy)")).toBe("strength");
    expect(kindFromWeightKey("Hypertrophy day")).toBe("strength");
    expect(kindFromWeightKey("Maintenance lift")).toBe("strength");
    expect(kindFromWeightKey("Easy Z2 (recovery)")).toBe("cardio");
    expect(kindFromWeightKey("VO2 intervals")).toBe("cardio");
    expect(kindFromWeightKey("Long Z2 + alactic finisher")).toBe("cardio");
    expect(kindFromWeightKey("Tendon day")).toBe("tendon");
  });
});

describe("dayIndexOverridesSchema", () => {
  it("accepts the legacy {days,twoADay} payload (no placements)", () => {
    const parsed = dayIndexOverridesSchema.parse({ days: [0, 2, 4, 6], twoADay: false });
    expect(parsed.placements).toBeUndefined();
    expect(parsed.days).toEqual([0, 2, 4, 6]);
  });

  it("accepts the new {days,twoADay,placements} payload", () => {
    const parsed = dayIndexOverridesSchema.parse({
      days: [0, 2],
      twoADay: false,
      placements: [
        { dayIndex: 0, slot: "single", kind: "strength", weightKey: "Strength day (heavy)" },
        { dayIndex: 2, slot: "single", kind: "cardio", weightKey: "Easy Z2 (recovery)" },
      ],
    });
    expect(parsed.placements).toHaveLength(2);
  });

  it("rejects out-of-range dayIndex / unknown slot / unknown kind", () => {
    expect(() =>
      dayIndexOverridesSchema.parse({
        days: [0],
        twoADay: false,
        placements: [
          { dayIndex: 9, slot: "single", kind: "strength", weightKey: "x" },
        ],
      }),
    ).toThrow();
    expect(() =>
      dayIndexOverridesSchema.parse({
        days: [0],
        twoADay: false,
        placements: [{ dayIndex: 0, slot: "weird", kind: "strength", weightKey: "x" }],
      }),
    ).toThrow();
    expect(() =>
      dayIndexOverridesSchema.parse({
        days: [0],
        twoADay: false,
        placements: [{ dayIndex: 0, slot: "single", kind: "yoga", weightKey: "x" }],
      }),
    ).toThrow();
  });
});

describe("buildPlacementsFromSchedule (Test A — wizard serialises placements)", () => {
  it("emits one placement per filled cell with slot=single in single-a-day mode", () => {
    const cells = emptyCells();
    cells[0]!.am = shape("Strength day (heavy)");
    cells[2]!.am = shape("Easy Z2 (recovery)");
    cells[3]!.am = shape("Strength day (heavy)");
    cells[5]!.am = shape("VO2 intervals");

    const placements = buildPlacementsFromSchedule(cells);
    expect(placements).toEqual([
      { dayIndex: 0, slot: "single", kind: "strength", weightKey: "Strength day (heavy)" },
      { dayIndex: 2, slot: "single", kind: "cardio", weightKey: "Easy Z2 (recovery)" },
      { dayIndex: 3, slot: "single", kind: "strength", weightKey: "Strength day (heavy)" },
      { dayIndex: 5, slot: "single", kind: "cardio", weightKey: "VO2 intervals" },
    ]);
  });

  it("preserves a user-driven Mon/Tue/Thu/Sat A/B/A/C arrangement (the bug repro)", () => {
    // User swaps cells so the order is intentionally non-canonical:
    // Mon=Strength, Tue=Z2, Thu=Strength, Sat=VO2.
    const cells = emptyCells();
    cells[0]!.am = shape("Strength day (heavy)");
    cells[1]!.am = shape("Easy Z2 (recovery)");
    cells[3]!.am = shape("Strength day (heavy)");
    cells[5]!.am = shape("VO2 intervals");

    const placements = buildPlacementsFromSchedule(cells);
    expect(placements.map((p) => [p.dayIndex, p.kind, p.weightKey])).toEqual([
      [0, "strength", "Strength day (heavy)"],
      [1, "cardio", "Easy Z2 (recovery)"],
      [3, "strength", "Strength day (heavy)"],
      [5, "cardio", "VO2 intervals"],
    ]);
  });

  it("emits am+pm placements for two-a-day cells", () => {
    const cells = emptyCells();
    cells[0]!.am = shape("Strength day (heavy)");
    cells[0]!.pm = shape("Easy Z2 (recovery)");
    cells[2]!.am = shape("Hypertrophy day");

    const placements = buildPlacementsFromSchedule(cells);
    expect(placements).toEqual([
      { dayIndex: 0, slot: "am", kind: "strength", weightKey: "Strength day (heavy)" },
      { dayIndex: 0, slot: "pm", kind: "cardio", weightKey: "Easy Z2 (recovery)" },
      { dayIndex: 2, slot: "single", kind: "strength", weightKey: "Hypertrophy day" },
    ]);
  });

  it("skips empty cells entirely", () => {
    const cells = emptyCells();
    cells[2]!.am = shape("Strength day (heavy)");
    expect(buildPlacementsFromSchedule(cells)).toHaveLength(1);
  });
});

describe("applyPlacementsToActiveDays (Test B — materialiser remap)", () => {
  it("rebinds canonical templates to the user-arranged dayIndex within each kind", () => {
    const canonical = daysForFrequency(ARCHETYPES.strength_anchor, 4, false);
    const canonicalDays = canonical.map((d) => d.dayIndex);

    // Pick distinct user dayIndices so the (kind, subKind) bucket
    // assignment is unambiguous.
    const userDays = [6, 5, 4, 3].slice(0, canonical.length);
    const placements: Placement[] = canonical.map((d, i) => ({
      dayIndex: userDays[i]!,
      slot: "single",
      kind: d.kind,
      weightKey:
        d.kind === "strength"
          ? "Strength day (heavy)"
          : d.kind === "tendon"
            ? "Tendon day"
            : (d as { cardioKind: string }).cardioKind === "cardio_vo2"
              ? "VO2 intervals"
              : "Easy Z2 (recovery)",
    }));

    const remapped = applyPlacementsToActiveDays(canonical, placements);

    // ADR 0006 — STRENGTH_ANCHOR @ freq=4 is now a mix of 2 strength
    // anchors + 2 cardio optionals (post-demotion of bench + OHP). The
    // remap groups by (kind, subKind) and hands out sorted user days
    // within each bucket. Assert per-kind that each canonical template
    // receives a user-arranged dayIndex.
    expect(remapped.map((d) => d.kind)).toEqual(canonical.map((d) => d.kind));
    expect(remapped.map((d) => d.title)).toEqual(canonical.map((d) => d.title));
    expect(remapped.map((d) => d.dayIndex)).not.toEqual(canonicalDays);

    const remappedByKind = (k: DayTemplate["kind"]) =>
      remapped
        .filter((d) => d.kind === k)
        .map((d) => d.dayIndex)
        .sort((a, b) => a - b);
    const userByKind = (k: DayTemplate["kind"]) =>
      canonical
        .map((d, i) => ({ kind: d.kind, day: userDays[i]! }))
        .filter((x) => x.kind === k)
        .map((x) => x.day)
        .sort((a, b) => a - b);
    for (const k of ["strength", "cardio", "tendon"] as const) {
      expect(remappedByKind(k)).toEqual(userByKind(k));
    }
  });

  it("distinguishes VO2 from Z2 within cardio so the user's sub-type pick is honoured", () => {
    const canonical = daysForFrequency(ARCHETYPES.concurrent_hybrid, 4, false);
    const cardioCanonical = canonical.filter(
      (d): d is Extract<DayTemplate, { kind: "cardio" }> => d.kind === "cardio",
    );
    const canonicalVo2 = cardioCanonical.find((d) => d.cardioKind === "cardio_vo2");
    const canonicalZ2 = cardioCanonical.find((d) => d.cardioKind === "cardio_z2");
    // Skip if the archetype shape changes and no longer has both.
    if (!canonicalVo2 || !canonicalZ2) return;

    // User wants VO2 on Sat (5) and Z2 on Sun (6).
    const placements: Placement[] = canonical.map((d) => {
      if (d.kind !== "cardio") {
        return {
          dayIndex: d.dayIndex,
          slot: "single",
          kind: d.kind,
          weightKey: d.kind === "strength" ? "Strength day (moderate)" : "Tendon day",
        } as Placement;
      }
      const isVo2 = d.cardioKind === "cardio_vo2";
      return {
        dayIndex: isVo2 ? 5 : 6,
        slot: "single",
        kind: "cardio",
        weightKey: isVo2 ? "VO2 intervals" : "Easy Z2 (recovery)",
      };
    });

    const remapped = applyPlacementsToActiveDays(canonical, placements);
    const remappedVo2 = remapped.find(
      (d): d is Extract<DayTemplate, { kind: "cardio" }> =>
        d.kind === "cardio" && d.cardioKind === "cardio_vo2",
    );
    const remappedZ2 = remapped.find(
      (d): d is Extract<DayTemplate, { kind: "cardio" }> =>
        d.kind === "cardio" && d.cardioKind === "cardio_z2",
    );
    expect(remappedVo2?.dayIndex).toBe(5);
    expect(remappedZ2?.dayIndex).toBe(6);
  });

  it("Test C — returns canonical activeDays unchanged when placements is absent", () => {
    const canonical = daysForFrequency(ARCHETYPES.strength_anchor, 4, false);
    expect(applyPlacementsToActiveDays(canonical, null)).toEqual(canonical);
    expect(applyPlacementsToActiveDays(canonical, undefined)).toEqual(canonical);
    expect(applyPlacementsToActiveDays(canonical, [])).toEqual(canonical);
  });

  it("Test D — leftover templates fall back to canonical dayIndex when placements are partial", () => {
    const canonical = daysForFrequency(ARCHETYPES.strength_anchor, 4, false);
    const firstStrengthIdx = canonical.findIndex((d) => d.kind === "strength");
    expect(firstStrengthIdx).toBeGreaterThanOrEqual(0);
    const firstStrength = canonical[firstStrengthIdx]!;

    // Provide a placement only for the first strength canonical day. Every
    // other canonical template must keep its (dayIndex, slot).
    const placements: Placement[] = [
      {
        dayIndex: 6, // user puts the first strength session on Sunday
        slot: "single",
        kind: "strength",
        weightKey: "Strength day (heavy)",
      },
    ];

    const remapped = applyPlacementsToActiveDays(canonical, placements);
    expect(remapped[firstStrengthIdx]!.dayIndex).toBe(6);
    canonical.forEach((day, i) => {
      if (i === firstStrengthIdx) return;
      expect(remapped[i]!.dayIndex).toBe(day.dayIndex);
      expect(remapped[i]!.slot).toBe(day.slot);
    });
    // Other strength templates (if any) keep their canonical dayIndex.
    const otherStrengths = canonical.filter(
      (d, i) => d.kind === "strength" && i !== firstStrengthIdx,
    );
    otherStrengths.forEach((d) => {
      const after = remapped.find(
        (rd, i) => i !== firstStrengthIdx && rd.title === d.title,
      );
      expect(after?.dayIndex).toBe(d.dayIndex);
    });
    // Sanity: original input is untouched.
    expect(firstStrength.dayIndex).toBe(canonical[firstStrengthIdx]!.dayIndex);
  });

  it("does not mutate the input activeDays array", () => {
    const canonical = daysForFrequency(ARCHETYPES.strength_anchor, 4, false);
    const before = canonical.map((d) => ({ ...d }));
    const placements: Placement[] = [
      { dayIndex: 6, slot: "single", kind: "strength", weightKey: "Strength day (heavy)" },
    ];
    applyPlacementsToActiveDays(canonical, placements);
    canonical.forEach((d, i) => {
      expect(d.dayIndex).toBe(before[i]!.dayIndex);
      expect(d.slot).toBe(before[i]!.slot);
    });
  });

  it("Test E — never emits duplicate (dayIndex, slot) when a placed day collides with a leftover canonical day", () => {
    // Regression for the production error:
    //   duplicate key value violates unique constraint
    //   "planned_sessions_block_week_day_slot_unique_idx"
    // strength_anchor@4 canonical = strength:0, cardio:2, strength:3, cardio:5.
    // The user places only ONE strength session, on day 3 — the day the
    // SECOND canonical strength template already occupies. The first strength
    // template remaps onto day 3; without the uniqueness guard the leftover
    // second strength template kept its canonical day 3 too → collision.
    const canonical = daysForFrequency(ARCHETYPES.strength_anchor, 4, false);
    const strengthDays = canonical.filter((d) => d.kind === "strength").map((d) => d.dayIndex);
    expect(strengthDays.length).toBeGreaterThanOrEqual(2);

    const placements: Placement[] = [
      { dayIndex: strengthDays[1]!, slot: "single", kind: "strength", weightKey: "Strength day (heavy)" },
    ];
    const remapped = applyPlacementsToActiveDays(canonical, placements);

    const keys = remapped.map((d) => `${d.dayIndex}|${d.slot ?? "single"}`);
    expect(new Set(keys).size).toBe(keys.length);
    // The placed strength session lands on the user-chosen day.
    expect(remapped.some((d) => d.kind === "strength" && d.dayIndex === strengthDays[1])).toBe(true);
    // Same session count and kind mix preserved (no day dropped).
    expect(remapped.length).toBe(canonical.length);
    expect(remapped.filter((d) => d.kind === "strength").length).toBe(
      canonical.filter((d) => d.kind === "strength").length,
    );
  });

  it("Test F — keeps every (dayIndex, slot) unique across a sweep of partial placements", () => {
    // Exhaustive guard: for each archetype/frequency, place a single
    // strength session on each possible weekday and assert the remap is
    // always collision-free regardless of where the user drops it.
    for (const archetype of Object.values(ARCHETYPES)) {
      for (const freq of [3, 4, 5, 6] as const) {
        const canonical = daysForFrequency(archetype, freq, false);
        if (!canonical.some((d) => d.kind === "strength")) continue;
        for (let day = 0; day <= 6; day++) {
          const placements: Placement[] = [
            { dayIndex: day, slot: "single", kind: "strength", weightKey: "Strength day (heavy)" },
          ];
          const remapped = applyPlacementsToActiveDays(canonical, placements);
          const keys = remapped.map((d) => `${d.dayIndex}|${d.slot ?? "single"}`);
          expect(new Set(keys).size).toBe(keys.length);
          expect(remapped.length).toBe(canonical.length);
        }
      }
    }
  });
});

describe("end-to-end — wizard serialiser → materialiser remap (the bug repro)", () => {
  it("user-arranged strength + cardio survives the round-trip on concurrent_hybrid", () => {
    // concurrent_hybrid @ 4 d/wk returns 4 strength + 2 cardio canonical
    // sessions (every strength anchor + both cardio anchors). The user
    // rearranges all six sessions away from the archetype's default
    // calendar layout; we verify that every kind/sub-kind lands on the
    // user-chosen day rather than the canonical template's dayIndex.
    const archetype = ARCHETYPES.concurrent_hybrid;
    const canonical = daysForFrequency(archetype, 4, false);
    const strengthCount = canonical.filter((d) => d.kind === "strength").length;
    const cardioCount = canonical.filter((d) => d.kind === "cardio").length;
    expect(strengthCount).toBeGreaterThan(0);
    expect(cardioCount).toBeGreaterThan(0);

    // Build a placement set that covers every canonical session.
    // Strength sessions on Mon, Tue, Thu, Sat (or as many as the
    // archetype emits); cardio sessions on Wed (Z2) + Sun (VO2).
    const userStrengthDays = [0, 1, 3, 5, 6, 4].slice(0, strengthCount);
    const strengthPlacements: Placement[] = userStrengthDays.map((day) => ({
      dayIndex: day,
      slot: "single",
      kind: "strength",
      weightKey: "Strength day (moderate)",
    }));
    const cardioPlacements: Placement[] = (
      [
        { dayIndex: 2, slot: "single", kind: "cardio", weightKey: "Polarized Z2" },
        { dayIndex: 6, slot: "single", kind: "cardio", weightKey: "VO2 intervals" },
      ] satisfies Placement[]
    ).slice(0, cardioCount);

    const remapped = applyPlacementsToActiveDays(canonical, [
      ...strengthPlacements,
      ...cardioPlacements,
    ]);

    const remappedStrengthDays = remapped
      .filter((d) => d.kind === "strength")
      .map((d) => d.dayIndex)
      .sort();
    const remappedCardioDays = remapped
      .filter((d) => d.kind === "cardio")
      .map((d) => d.dayIndex)
      .sort();

    expect(remappedStrengthDays).toEqual([...userStrengthDays].sort());
    // Cardio should land on the user's Z2/VO2 days, and the VO2 template
    // specifically should land on Sun (6) thanks to (kind, subKind) match.
    expect(remappedCardioDays).toEqual([2, 6].slice(0, cardioCount).sort());
    const vo2 = remapped.find(
      (d): d is Extract<DayTemplate, { kind: "cardio" }> =>
        d.kind === "cardio" && d.cardioKind === "cardio_vo2",
    );
    if (vo2) expect(vo2.dayIndex).toBe(6);
  });

  it("also covers the round-trip via buildPlacementsFromSchedule (schedule grid → server remap)", () => {
    const archetype = ARCHETYPES.strength_anchor;
    const canonical = daysForFrequency(archetype, 4, false);
    // ADR 0006 — STRENGTH_ANCHOR @ 4 d/wk now returns 2 strength anchors
    // (squat + deadlift) + 2 cardio optionals (Z2, long Z2). Feed the
    // wizard's grid serialiser a schedule matching the canonical mix
    // and verify per-kind round-trip: each canonical template lands on
    // the user-chosen day for its kind.
    const strengthCount = canonical.filter((d) => d.kind === "strength").length;
    const cardioCount = canonical.filter((d) => d.kind === "cardio").length;

    const userStrengthDays = [6, 3].slice(0, strengthCount);
    const userCardioDays = [5, 0].slice(0, cardioCount);

    const cells = emptyCells();
    userStrengthDays.forEach((d) => {
      cells[d]!.am = shape("Strength day (heavy)");
    });
    userCardioDays.forEach((d) => {
      cells[d]!.am = shape("Easy Z2 (recovery)");
    });

    const placements = buildPlacementsFromSchedule(cells);
    const remapped = applyPlacementsToActiveDays(canonical, placements);

    const remappedStrength = remapped
      .filter((d) => d.kind === "strength")
      .map((d) => d.dayIndex)
      .sort((a, b) => a - b);
    const remappedCardio = remapped
      .filter((d) => d.kind === "cardio")
      .map((d) => d.dayIndex)
      .sort((a, b) => a - b);
    expect(remappedStrength).toEqual([...userStrengthDays].sort((a, b) => a - b));
    expect(remappedCardio).toEqual([...userCardioDays].sort((a, b) => a - b));
  });
});
