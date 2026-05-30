import { describe, expect, it } from "vitest";
import {
  suggestNextArchetype,
  suggestRealizationWeek,
  type SuggestNextArchetypeInput,
} from "../next-block-suggestion";

const base: SuggestNextArchetypeInput = {
  recentArchetypes: [],
  upcomingEventModality: null,
  recentReactiveDeloads: 0,
};

describe("suggestNextArchetype — null when no rule fires", () => {
  it("returns null with no history, no event, no deloads", () => {
    expect(suggestNextArchetype(base)).toBeNull();
  });

  it("returns null for a single block of any archetype", () => {
    expect(
      suggestNextArchetype({ ...base, recentArchetypes: ["strength_anchor"] }),
    ).toBeNull();
    expect(
      suggestNextArchetype({ ...base, recentArchetypes: ["maintenance"] }),
    ).toBeNull();
  });

  it("returns null for two strength blocks (below staleness, not accumulation)", () => {
    expect(
      suggestNextArchetype({
        ...base,
        recentArchetypes: ["strength_anchor", "strength_anchor"],
      }),
    ).toBeNull();
  });

  it("returns null for a mixed, non-repeating history", () => {
    expect(
      suggestNextArchetype({
        ...base,
        recentArchetypes: ["strength_anchor", "endurance_anchor", "hypertrophy_anchor"],
      }),
    ).toBeNull();
  });
});

describe("suggestNextArchetype — rule 1: recovery-aware (highest priority)", () => {
  it("suggests rebuild when reactive deloads hit the threshold", () => {
    const out = suggestNextArchetype({ ...base, recentReactiveDeloads: 2 });
    expect(out?.archetypeId).toBe("rebuild");
    expect(out?.reason).toMatch(/reactive deload/i);
  });

  it("recovery overrides an upcoming event", () => {
    const out = suggestNextArchetype({
      ...base,
      recentReactiveDeloads: 3,
      upcomingEventModality: "strength",
    });
    expect(out?.archetypeId).toBe("rebuild");
  });

  it("recovery overrides a hypertrophy accumulation run", () => {
    const out = suggestNextArchetype({
      ...base,
      recentReactiveDeloads: 2,
      recentArchetypes: ["hypertrophy_anchor", "hypertrophy_anchor"],
    });
    expect(out?.archetypeId).toBe("rebuild");
  });

  it("does not fire below threshold", () => {
    expect(suggestNextArchetype({ ...base, recentReactiveDeloads: 1 })).toBeNull();
  });
});

describe("suggestNextArchetype — rule 2: event-aware", () => {
  it("strength event ⇒ strength_anchor", () => {
    const out = suggestNextArchetype({ ...base, upcomingEventModality: "strength" });
    expect(out?.archetypeId).toBe("strength_anchor");
  });

  it("endurance event ⇒ endurance_anchor", () => {
    const out = suggestNextArchetype({ ...base, upcomingEventModality: "endurance" });
    expect(out?.archetypeId).toBe("endurance_anchor");
  });

  it("mixed event ⇒ concurrent_hybrid", () => {
    const out = suggestNextArchetype({ ...base, upcomingEventModality: "mixed" });
    expect(out?.archetypeId).toBe("concurrent_hybrid");
  });

  it("event overrides a hypertrophy accumulation run", () => {
    const out = suggestNextArchetype({
      ...base,
      upcomingEventModality: "endurance",
      recentArchetypes: ["hypertrophy_anchor", "hypertrophy_anchor"],
    });
    expect(out?.archetypeId).toBe("endurance_anchor");
  });
});

describe("suggestNextArchetype — rule 3: phase sequence (accumulation → strength)", () => {
  it("two hypertrophy blocks ⇒ strength_anchor", () => {
    const out = suggestNextArchetype({
      ...base,
      recentArchetypes: ["hypertrophy_anchor", "hypertrophy_anchor"],
    });
    expect(out?.archetypeId).toBe("strength_anchor");
    expect(out?.reason).toMatch(/consolidate/i);
  });

  it("three hypertrophy blocks still ⇒ strength_anchor (consolidation wins over staleness)", () => {
    const out = suggestNextArchetype({
      ...base,
      recentArchetypes: ["hypertrophy_anchor", "hypertrophy_anchor", "hypertrophy_anchor"],
    });
    expect(out?.archetypeId).toBe("strength_anchor");
  });

  it("a single hypertrophy block does not fire consolidation", () => {
    expect(
      suggestNextArchetype({ ...base, recentArchetypes: ["hypertrophy_anchor"] }),
    ).toBeNull();
  });

  it("hypertrophy run broken by a recent different block does not fire", () => {
    expect(
      suggestNextArchetype({
        ...base,
        recentArchetypes: ["strength_anchor", "hypertrophy_anchor", "hypertrophy_anchor"],
      }),
    ).toBeNull();
  });
});

describe("suggestNextArchetype — rule 4: anti-staleness", () => {
  it("three strength blocks ⇒ hypertrophy_anchor", () => {
    const out = suggestNextArchetype({
      ...base,
      recentArchetypes: ["strength_anchor", "strength_anchor", "strength_anchor"],
    });
    expect(out?.archetypeId).toBe("hypertrophy_anchor");
  });

  it("three endurance blocks ⇒ concurrent_hybrid", () => {
    const out = suggestNextArchetype({
      ...base,
      recentArchetypes: ["endurance_anchor", "endurance_anchor", "endurance_anchor"],
    });
    expect(out?.archetypeId).toBe("concurrent_hybrid");
  });

  it("three hybrid blocks ⇒ strength_anchor", () => {
    const out = suggestNextArchetype({
      ...base,
      recentArchetypes: ["concurrent_hybrid", "concurrent_hybrid", "concurrent_hybrid"],
    });
    expect(out?.archetypeId).toBe("strength_anchor");
  });

  it("three maintenance blocks do NOT nudge (repeatable by design)", () => {
    expect(
      suggestNextArchetype({
        ...base,
        recentArchetypes: ["maintenance", "maintenance", "maintenance"],
      }),
    ).toBeNull();
  });

  it("three rebuild blocks do NOT nudge (repeatable by design)", () => {
    expect(
      suggestNextArchetype({
        ...base,
        recentArchetypes: ["rebuild", "rebuild", "rebuild"],
      }),
    ).toBeNull();
  });

  it("a run of custom blocks does NOT nudge", () => {
    expect(
      suggestNextArchetype({
        ...base,
        recentArchetypes: ["custom", "custom", "custom"],
      }),
    ).toBeNull();
  });
});

describe("suggestNextArchetype — purity", () => {
  it("does not mutate its input array", () => {
    const recentArchetypes: SuggestNextArchetypeInput["recentArchetypes"] = [
      "hypertrophy_anchor",
      "hypertrophy_anchor",
    ];
    const snapshot = [...recentArchetypes];
    suggestNextArchetype({ ...base, recentArchetypes });
    expect(recentArchetypes).toEqual(snapshot);
  });
});

describe("suggestRealizationWeek — Decision 6 (opt-in, accumulation-gated)", () => {
  it("two consecutive strength blocks, no event ⇒ realization suggested", () => {
    const out = suggestRealizationWeek({
      recentArchetypes: ["strength_anchor", "strength_anchor"],
      upcomingEventModality: null,
    });
    expect(out).not.toBeNull();
    expect(out?.reason).toMatch(/realization week/i);
  });

  it("a single strength block does NOT earn a realization week", () => {
    expect(
      suggestRealizationWeek({
        recentArchetypes: ["strength_anchor"],
        upcomingEventModality: null,
      }),
    ).toBeNull();
  });

  it("an upcoming event suppresses the realization nudge (real taper handles it)", () => {
    expect(
      suggestRealizationWeek({
        recentArchetypes: ["strength_anchor", "strength_anchor"],
        upcomingEventModality: "strength",
      }),
    ).toBeNull();
  });

  it("a broken strength run does NOT earn a realization week", () => {
    expect(
      suggestRealizationWeek({
        recentArchetypes: ["strength_anchor", "hypertrophy_anchor", "strength_anchor"],
        upcomingEventModality: null,
      }),
    ).toBeNull();
  });

  it("a non-strength run does NOT earn a realization week", () => {
    expect(
      suggestRealizationWeek({
        recentArchetypes: ["hypertrophy_anchor", "hypertrophy_anchor"],
        upcomingEventModality: null,
      }),
    ).toBeNull();
  });
});
