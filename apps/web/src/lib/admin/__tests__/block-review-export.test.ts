import { describe, it, expect, afterEach } from "vitest";
import { isAdminEmail } from "../access";
import {
  buildBlockReviewMarkdown,
  type BlockReviewData,
} from "../block-review-export";

describe("isAdminEmail", () => {
  const orig = process.env.ADMIN_EMAILS;
  afterEach(() => {
    if (orig === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = orig;
  });

  it("denies everyone when ADMIN_EMAILS is unset", () => {
    delete process.env.ADMIN_EMAILS;
    expect(isAdminEmail("me@example.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });

  it("matches case-insensitively and trims whitespace", () => {
    process.env.ADMIN_EMAILS = " Me@Example.com , other@x.io ";
    expect(isAdminEmail("me@example.com")).toBe(true);
    expect(isAdminEmail("OTHER@X.IO")).toBe(true);
    expect(isAdminEmail("nope@x.io")).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});

function sampleData(): BlockReviewData {
  return {
    generatedAt: "2026-06-07T16:00:00.000Z",
    athlete: {
      experienceTier: "intermediate_2y_5y",
      bodyweightKg: 82,
      bodyCompPhase: "maintain",
      phaseTargetWeeks: null,
      trainingDaysPerWeek: 4,
      allowsTwoADays: false,
      equipment: ["preset: full_gym", "bars (2)"],
    },
    limitations: [
      {
        region: "knee",
        kind: "tendinopathy",
        severity: "mild",
        affectedMuscles: ["quads"],
      },
    ],
    trainingMaxes: [
      {
        movementName: "Front Squat",
        oneRmKg: 120,
        effectivePercent: 90,
        tmKg: 108,
        source: "entered",
      },
    ],
    block: {
      archetypeId: "strength_anchor",
      archetypeName: "Strength Anchor",
      archetypeOneLiner: "Drive up the main lifts.",
      weeks: 4,
      startedOn: "2026-06-01",
      status: "active",
      goal: "strength",
      secondaryFocus: "muscle",
      focusMuscles: ["Biceps"],
      accessoryVolume: "medium",
      powerEmphasis: false,
      deloadWeekIndex: 3,
    },
    archetypeWeekProfiles: [
      { weekIndex: 0, intensityLabel: "Strength base", setIntensities: [0.75], setReps: 5 },
      { weekIndex: 3, intensityLabel: "Deload", setIntensities: [0.6], setReps: [5, 5] },
    ],
    sessions: [
      {
        weekIndex: 0,
        dayIndex: 0,
        slot: "single",
        title: "Strength · Front Squat",
        role: "squat",
        modality: "pure_strength",
        effectiveStressLoad: 12.5,
        items: [
          {
            kind: "main",
            movementName: "Front Squat",
            setsReps: "3×5",
            intensity: "85% TM, RIR 1-2",
            tempo: null,
            isAmrap: true,
            supersetGroup: null,
            why: null,
          },
          {
            kind: "accessory",
            movementName: "Barbell Curl",
            setsReps: "3×10",
            intensity: "RIR 1-3",
            tempo: null,
            isAmrap: false,
            supersetGroup: "A/1",
            why: "Biased toward your biceps focus.",
          },
        ],
      },
    ],
  };
}

describe("buildBlockReviewMarkdown", () => {
  it("emits the rubric, athlete context, block config, and the plan", () => {
    const md = buildBlockReviewMarkdown(sampleData());
    // Rubric
    expect(md).toContain("Reviewer brief");
    expect(md).toContain("Limitations & safety");
    // Design grounding — the intentional-decisions section that keeps the
    // reviewer from re-flagging settled TB/531-grounded choices.
    expect(md).toContain("Design grounding");
    expect(md).toContain("Load is held constant within a block");
    expect(md).toContain("guaranteed floors");
    // Athlete + limitation
    expect(md).toContain("Experience tier");
    expect(md).toContain("knee · tendinopathy");
    expect(md).toContain("affected: quads");
    // Training max table
    expect(md).toContain("| Front Squat | 120 kg | 90% | 108 kg | entered |");
    // Block config + archetype design grounding
    expect(md).toContain("Strength Anchor");
    expect(md).toContain("Drive up the main lifts.");
    expect(md).toContain("Deload week:** week 4");
    expect(md).toContain("Focus muscles:** Biceps");
    expect(md).toContain("Strength base");
    // Plan detail
    expect(md).toContain("Week 1");
    expect(md).toContain("Strength · Front Squat");
    expect(md).toContain("[main]");
    expect(md).toContain("AMRAP top set");
    expect(md).toContain("superset A/1");
    expect(md).toContain("why: Biased toward your biceps focus.");
  });
});
