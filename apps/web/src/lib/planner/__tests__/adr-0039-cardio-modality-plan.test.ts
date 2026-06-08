/**
 * ADR 0039 — specificity-aware cardio modality plan.
 *
 * Pins: goal-modality resolution priority (event → preference → running),
 * specificity classification (quality + anchor long protected; shorter base
 * diversifiable), the diversification gate (strength-constrained only), the
 * lower-interference-only target rule (a cyclist's base stays cycling; a
 * runner's filler drops to the bike), and the byte-identical no-event path.
 */
import { describe, it, expect } from "vitest";
import { ENDURANCE_ANCHOR, type CardioDay } from "../archetypes";
import {
  goalModalityFromEvent,
  resolveGoalModality,
  diversificationEnabled,
  classifyCardioSpecificity,
  modalityPreferenceForDay,
} from "../cardio-modality-plan";
import type { PreferredCardioModality } from "../preferred-cardio-modality";

const CARDIO = ENDURANCE_ANCHOR.days.filter(
  (d): d is CardioDay => d.kind === "cardio",
);
const byRole = (role: string) => CARDIO.find((d) => d.role === role)!;
const LONG = byRole("long_z2"); // 100 min — anchor
const EASY = byRole("easy_z2"); // 60 min — diversifiable
const BIKE_Z2 = byRole("z2_plus_alactic"); // 45 min bike — diversifiable
const VO2 = byRole("vo2_intervals"); // quality

describe("ADR 0039 — goalModalityFromEvent", () => {
  it("maps event modalities to cardio modalities; non-cardio → null", () => {
    expect(goalModalityFromEvent("run")).toBe("running");
    expect(goalModalityFromEvent("bike")).toBe("cycling");
    expect(goalModalityFromEvent("row")).toBe("rowing");
    expect(goalModalityFromEvent("swim")).toBe("swimming");
    expect(goalModalityFromEvent("ski")).toBe("ski_erg");
    expect(goalModalityFromEvent("strength")).toBeNull();
    expect(goalModalityFromEvent("padel")).toBeNull();
    expect(goalModalityFromEvent(null)).toBeNull();
  });
});

describe("ADR 0039 — resolveGoalModality priority", () => {
  it("event wins over preference", () => {
    expect(
      resolveGoalModality({ eventModality: "run", preferred: ["cycling"] }),
    ).toEqual({ modality: "running", source: "event" });
  });
  it("preference is used when no (cardio) event", () => {
    expect(
      resolveGoalModality({ eventModality: "strength", preferred: ["cycling"] }),
    ).toEqual({ modality: "cycling", source: "preference" });
  });
  it("defaults to running when neither", () => {
    expect(resolveGoalModality({ eventModality: null, preferred: [] })).toEqual({
      modality: "running",
      source: "default",
    });
  });
});

describe("ADR 0039 — diversificationEnabled", () => {
  it("is off for pure cardio (endurance + no strength/muscle 2nd)", () => {
    expect(diversificationEnabled("endurance_anchor", "none")).toBe(false);
    expect(diversificationEnabled("endurance_anchor", "cardio")).toBe(false);
  });
  it("is on for endurance + strength/muscle, hybrid, and strength-led", () => {
    expect(diversificationEnabled("endurance_anchor", "strength")).toBe(true);
    expect(diversificationEnabled("endurance_anchor", "muscle")).toBe(true);
    expect(diversificationEnabled("concurrent_hybrid", "none")).toBe(true);
    expect(diversificationEnabled("strength_anchor", "cardio")).toBe(true);
  });
  it("is off for non-concurrent builds", () => {
    expect(diversificationEnabled("maintenance", "none")).toBe(false);
    expect(diversificationEnabled("rebuild", "none")).toBe(false);
  });
});

describe("ADR 0039 — classifyCardioSpecificity", () => {
  it("quality kinds are quality", () => {
    expect(classifyCardioSpecificity(VO2, CARDIO)).toBe("quality");
  });
  it("the longest Z2 (long role) is the anchor; shorter Z2 is diversifiable", () => {
    expect(classifyCardioSpecificity(LONG, CARDIO)).toBe("anchor_long");
    expect(classifyCardioSpecificity(EASY, CARDIO)).toBe("diversifiable");
    expect(classifyCardioSpecificity(BIKE_Z2, CARDIO)).toBe("diversifiable");
  });
});

describe("ADR 0039 — modalityPreferenceForDay", () => {
  const base = {
    allCardioDays: CARDIO,
    archetypeId: "endurance_anchor" as const,
    userPreferred: [] as PreferredCardioModality[],
  };
  const runEventGoal = { modality: "running" as const, source: "event" as const };

  it("no-event goal → returns the user preference unchanged (byte-identical)", () => {
    const pref: PreferredCardioModality[] = ["cycling"];
    for (const day of CARDIO) {
      expect(
        modalityPreferenceForDay({
          ...base,
          day,
          secondaryFocus: "strength",
          goal: { modality: "cycling", source: "preference" },
          userPreferred: pref,
        }),
      ).toBe(pref);
    }
  });

  it("running event: quality + anchor long forced to running (override preference)", () => {
    for (const day of [VO2, LONG]) {
      expect(
        modalityPreferenceForDay({
          ...base,
          day,
          secondaryFocus: "strength",
          goal: runEventGoal,
          userPreferred: ["cycling"], // generic preference must NOT win here
        }),
      ).toEqual(["running"]);
    }
  });

  it("running event + strength block: diversifiable base auto-moves to lower-interference (bike first)", () => {
    const pref = modalityPreferenceForDay({
      ...base,
      day: EASY,
      secondaryFocus: "strength", // strength-constrained → diversify
      goal: runEventGoal,
      userPreferred: [],
    });
    // Ranked ascending interference, excluding running; cycling/ski first.
    expect(pref[0]).toBe("cycling");
    // The goal modality is appended as the consistency fallback at the end.
    expect(pref[pref.length - 1]).toBe("running");
  });

  it("running event + PURE block: base stays running (no diversification)", () => {
    expect(
      modalityPreferenceForDay({
        ...base,
        day: EASY,
        secondaryFocus: "none", // pure cardio
        goal: runEventGoal,
        userPreferred: [],
      }),
    ).toEqual(["running"]);
  });

  it("running event + explicit preference: diversifiable base respects the preference", () => {
    const pref: PreferredCardioModality[] = ["rowing"];
    expect(
      modalityPreferenceForDay({
        ...base,
        day: EASY,
        secondaryFocus: "strength",
        goal: runEventGoal,
        userPreferred: pref,
      }),
    ).toBe(pref);
  });

  it("cycling event: base stays cycling (no lower-interference target exists)", () => {
    expect(
      modalityPreferenceForDay({
        ...base,
        day: EASY,
        secondaryFocus: "strength",
        goal: { modality: "cycling", source: "event" },
        userPreferred: [],
      }),
    ).toEqual(["cycling"]);
  });
});
