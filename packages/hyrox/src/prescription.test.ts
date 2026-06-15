/**
 * HYROX prescribe() — render each grid ref to a SessionPrescription (ADR 0050 step 5).
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext, SessionPrescription } from "@hta/program-core";
import { hyroxEngine, type HyroxInstance } from "./program";
import { stationLoadLabel, getStation } from "./divisions";

const ctxNoMaxes: PlatformContext = { oneRepMaxes: {}, roundingKg: 2.5 };
const ctxWithMaxes: PlatformContext = {
  oneRepMaxes: { squat: 140, deadlift: 180, press: 70, bench: 100 },
  roundingKg: 2.5,
};

function inst(over: Partial<HyroxInstance> = {}): HyroxInstance {
  return hyroxEngine.setup(
    {
      values: {
        experience: over.experience ?? "intermediate",
        division: over.division ?? "open",
        sessionsPerWeek: over.sessionsPerWeek ?? 5,
      },
    },
    ctxNoMaxes,
  );
}

/** Every ref in the timeline, paired with its spec tags. */
function eachRef(instance: HyroxInstance) {
  return hyroxEngine.timeline(instance).map((s) => ({ ref: s.ref, tags: s.tags ?? [], kind: s.kind }));
}

describe("HYROX prescribe — coverage", () => {
  it("returns a non-empty prescription for every session at every level", () => {
    for (const experience of ["beginner", "intermediate", "advanced"] as const) {
      const i = inst({ experience });
      for (const { ref } of eachRef(i)) {
        const p = hyroxEngine.prescribe(i, ref, ctxWithMaxes);
        expect(p.items.length).toBeGreaterThan(0);
      }
    }
  });

  it("prescribes a light recovery item for the deload-marker cell", () => {
    const i = inst();
    const deloadRef = hyroxEngine
      .timeline(i)
      .find((s) => s.tags?.includes("deload"))?.ref;
    expect(deloadRef).toBeDefined();
    const p = hyroxEngine.prescribe(i, deloadRef!, ctxWithMaxes);
    // A single light Zone-2 cardio item (renders + survives adaptation, unlike a
    // standalone leading note which the platform adapter drops).
    expect(p.items).toHaveLength(1);
    expect(p.items[0]!.kind).toBe("cardio");
    expect(p.items[0]!.note).toMatch(/deload/i);
  });

  it("returns an empty prescription for an unknown ref", () => {
    expect(hyroxEngine.prescribe(inst(), "hx-w99-d9", ctxWithMaxes)).toEqual({ items: [] });
    expect(hyroxEngine.prescribe(inst(), "garbage", ctxWithMaxes)).toEqual({ items: [] });
  });
});

describe("HYROX prescribe — strength", () => {
  function strengthRef(i: HyroxInstance): string {
    const s = hyroxEngine
      .timeline(i)
      .find((sp) => sp.tags?.includes("modality:strength"));
    if (!s) throw new Error("no strength session in timeline");
    return s.ref;
  }

  it("loads working sets off the shared 1RM with a warm-up ramp", () => {
    const i = inst();
    const p = hyroxEngine.prescribe(i, strengthRef(i), ctxWithMaxes);
    const squatMain = p.items.find((it) => it.kind === "main" && it.movementId === "squat");
    expect(squatMain).toBeDefined();
    expect(squatMain!.weightKg).toBeGreaterThan(0);
    // base phase scheme is 75% → 140 × 0.75 = 105
    expect(squatMain!.weightKg).toBe(105);
    expect(p.items.some((it) => it.kind === "warmup" && it.movementId === "squat")).toBe(true);
  });

  it("anchors mains on the platform StrengthRole keys (squat/deadlift/press)", () => {
    const i = inst();
    const p = hyroxEngine.prescribe(i, strengthRef(i), ctxWithMaxes);
    const mainKeys = p.items.filter((it) => it.kind === "main").map((it) => it.movementId);
    expect(mainKeys).toContain("squat");
    expect(mainKeys.every((k) => ["squat", "deadlift", "press", "bench"].includes(k!))).toBe(true);
  });

  it("emits station accessories as category-tagged assistance intent (no movementId)", () => {
    const i = inst();
    const p = hyroxEngine.prescribe(i, strengthRef(i), ctxWithMaxes);
    const assist = p.items.filter((it) => it.kind === "assistance");
    expect(assist.length).toBeGreaterThan(0);
    for (const a of assist) {
      expect(a.movementId).toBeUndefined();
      expect(["push", "pull", "single_leg_or_core"]).toContain(a.assistanceCategory);
    }
  });

  it("rounds working weight to the platform increment", () => {
    const i = inst();
    const p = hyroxEngine.prescribe(i, strengthRef(i), {
      oneRepMaxes: { squat: 143 },
      roundingKg: 5,
    });
    const main = p.items.find((it) => it.kind === "main" && it.movementId === "squat");
    // 143 × 0.75 = 107.25 → rounds to nearest 5 = 105
    expect(main!.weightKg! % 5).toBe(0);
  });

  it("falls back to an effort-based prescription when no 1RM is on file", () => {
    const i = inst();
    const p = hyroxEngine.prescribe(i, strengthRef(i), ctxNoMaxes);
    const main = p.items.find((it) => it.kind === "main");
    expect(main).toBeDefined();
    expect(main!.weightKg).toBeUndefined();
    expect(main!.note).toMatch(/no 1rm/i);
  });
});

describe("HYROX prescribe — aerobic / intervals", () => {
  function firstRefWithTag(i: HyroxInstance, tag: string): string | undefined {
    return hyroxEngine.timeline(i).find((s) => s.tags?.includes(tag))?.ref;
  }

  it("prescribes a duration target for easy runs/ergs", () => {
    const i = inst();
    const ref = firstRefWithTag(i, "session:easy-run")!;
    const p = hyroxEngine.prescribe(i, ref, ctxWithMaxes);
    const cardio = p.items.find((it) => it.kind === "cardio");
    expect(cardio?.durationSec).toBeGreaterThan(0);
    expect(cardio?.note).toMatch(/zone 2|rpe 4-5/i);
  });

  it("scales easy-run duration up with experience", () => {
    const durFor = (experience: "beginner" | "advanced") => {
      const i = inst({ experience });
      const ref = firstRefWithTag(i, "session:easy-run")!;
      const p = hyroxEngine.prescribe(i, ref, ctxWithMaxes);
      return p.items.find((it) => it.kind === "cardio")!.durationSec!;
    };
    expect(durFor("advanced")).toBeGreaterThan(durFor("beginner"));
  });
});

describe("HYROX prescribe — simulations & divisions", () => {
  function simRef(i: HyroxInstance): string {
    const s = hyroxEngine.timeline(i).find((sp) => sp.tags?.includes("simulation"));
    if (!s) throw new Error("no sim in timeline");
    return s.ref;
  }

  it("renders the stations in race order for a half simulation", () => {
    const i = inst();
    const p = hyroxEngine.prescribe(i, simRef(i), ctxWithMaxes);
    const stationItems = p.items.filter((it) => it.kind === "conditioning");
    expect(stationItems.length).toBe(4); // half = first 4 stations
    expect(stationItems[0]!.movementId).toBe("skierg");
  });

  it("reflects the chosen division in the station load reference", () => {
    const open = hyroxEngine.prescribe(inst({ division: "open" }), simRef(inst({ division: "open" })), ctxWithMaxes);
    const pro = hyroxEngine.prescribe(inst({ division: "pro" }), simRef(inst({ division: "pro" })), ctxWithMaxes);
    const sledNote = (p: SessionPrescription) =>
      p.items.find((it) => it.movementId === "sled-push")?.note ?? "";
    expect(sledNote(open)).toContain("152");
    expect(sledNote(pro)).toContain("202");
  });

  it("stationLoadLabel marks Doubles as Open (shared)", () => {
    const sled = getStation("sled-push")!;
    expect(stationLoadLabel(sled, "doubles")).toMatch(/shared/i);
  });
});

describe("HYROX prescribe — two-a-day", () => {
  it("appends a second session for an 8/week two-a-day day", () => {
    const i = inst({ experience: "advanced", sessionsPerWeek: 8 });
    const twoADayRef = hyroxEngine.timeline(i).find((s) => s.tags?.includes("two-a-day"))?.ref;
    expect(twoADayRef).toBeDefined();
    const p = hyroxEngine.prescribe(i, twoADayRef!, ctxWithMaxes);
    expect(p.items.some((it) => it.name.startsWith("Two-a-day"))).toBe(true);
  });
});
