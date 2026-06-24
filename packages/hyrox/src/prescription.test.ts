/**
 * HYROX prescribe() — render each grid ref to a SessionPrescription (ADR 0050 step 5).
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext, SessionPrescription } from "@hta/program-core";
import { hyroxEngine, type HyroxInstance } from "./program";
import { stationLoadLabel, getStation, wallBallTargetLabel, stationLoadsSummary, intervalTargetLabel } from "./divisions";
import { stationFocusForWeek } from "./prescription";

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
        ...(over.twoADay ? { twoADay: true } : {}),
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
    // base phase scheme is 72% → 140 × 0.72 = 100.8 → 100 (rounded)
    expect(squatMain!.weightKg).toBe(100);
    expect(p.items.some((it) => it.kind === "warmup" && it.movementId === "squat")).toBe(true);
  });

  it("anchors mains on the platform StrengthRole keys (squat/deadlift/press)", () => {
    const i = inst();
    const p = hyroxEngine.prescribe(i, strengthRef(i), ctxWithMaxes);
    const mainKeys = p.items.filter((it) => it.kind === "main").map((it) => it.movementId);
    expect(mainKeys).toContain("squat");
    expect(mainKeys.every((k) => ["squat", "deadlift", "press", "bench"].includes(k!))).toBe(true);
  });

  it("emits HYROX-specific station accessories, demand-matched per split day", () => {
    const i = inst();
    const strengthRefs = hyroxEngine
      .timeline(i)
      .filter((sp) => sp.tags?.includes("modality:strength"))
      .map((sp) => sp.ref);
    expect(strengthRefs.length).toBeGreaterThan(0);
    const allCats: string[] = [];
    for (const ref of strengthRefs) {
      const assist = hyroxEngine.prescribe(i, ref, ctxWithMaxes).items.filter((it) => it.kind === "assistance");
      expect(assist.length).toBeGreaterThan(0);
      for (const a of assist) {
        expect(a.movementId).toBeUndefined();
        expect([
          "push",
          "push_overhead",
          "pull",
          "pull_vertical",
          "pull_horizontal",
          "single_leg",
          "core",
          "carry",
          "prehab",
        ]).toContain(a.assistanceCategory);
      }
      allCats.push(...assist.map((a) => a.assistanceCategory as string));
    }
    // Across the split (or the solo full-body day): a guaranteed single-leg, a
    // loaded carry, and pulling all appear.
    expect(allCats).toContain("single_leg");
    expect(allCats).toContain("carry");
    expect(allCats.some((c) => c.startsWith("pull"))).toBe(true);
  });

  it("two-main split: Day A = Squat+Press, Day B = Deadlift + heavy vertical pull + overhead press + carry (ADR 0058)", () => {
    const i = inst(); // 5-day intermediate → base weeks carry the two-day split
    const refA = hyroxEngine.timeline(i).find((s) => s.tags?.includes("session:strength-a"))?.ref;
    const refB = hyroxEngine.timeline(i).find((s) => s.tags?.includes("session:strength-b"))?.ref;
    expect(refA).toBeDefined();
    expect(refB).toBeDefined();
    const a = hyroxEngine.prescribe(i, refA!, ctxWithMaxes).items;
    const b = hyroxEngine.prescribe(i, refB!, ctxWithMaxes).items;

    // Day A mains: Squat + Press only (two heavy efforts, no deadlift).
    expect(new Set(a.filter((it) => it.kind === "main").map((it) => it.movementId))).toEqual(
      new Set(["squat", "press"]),
    );
    // Day B main: Deadlift; the heavy VERTICAL pull (pull-up) is the promoted primary (4×4–6).
    expect(new Set(b.filter((it) => it.kind === "main").map((it) => it.movementId))).toEqual(
      new Set(["deadlift"]),
    );
    const bPull = b.find((it) => it.kind === "assistance" && it.assistanceCategory === "pull_vertical");
    expect(bPull?.sets).toBe(4);
    expect(bPull?.reps).toBe(4);
    // Day B carries the overhead power-endurance press + a loaded carry.
    const bCats = b.filter((it) => it.kind === "assistance").map((it) => it.assistanceCategory);
    expect(bCats).toContain("push_overhead");
    expect(bCats).toContain("carry");
    // Day A pulls HORIZONTAL (row) — the week rotates vertical (B) / horizontal (A).
    const aPull = a.find((it) => it.assistanceCategory === "pull_horizontal");
    expect(aPull?.reps).toBe(6);
    expect(aPull?.repsMax).toBe(10);
    // Day A includes a calf-prehab finisher.
    expect(a.some((it) => it.assistanceCategory === "prehab")).toBe(true);
    // Single-leg runs strength-endurance reps on both days (demand-matched to the lunge station).
    expect(a.find((it) => it.assistanceCategory === "single_leg")?.reps).toBe(12);
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
    // Zone/RPE guidance now lives in the structured cardioPlan.effort.
    expect(cardio?.cardioPlan?.effort).toMatch(/zone 2|rpe 4.5/i);
  });

  it("scales easy-run duration up with experience", () => {
    const durFor = (experience: "beginner" | "advanced") => {
      // 6 sessions/wk so a non-deload base week carries a dedicated easy-run
      // (at 5/wk the easy slot is spent on the 2nd strength day — ADR 0056).
      const i = inst({ experience, sessionsPerWeek: 6 });
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
    const sledLoad = (p: SessionPrescription) =>
      p.items.find((it) => it.movementId === "sled-push")?.cardioPlan?.stations?.[0]?.load ?? "";
    expect(sledLoad(open)).toContain("152");
    expect(sledLoad(pro)).toContain("202");
  });

  it("stationLoadLabel marks Doubles as Open (shared)", () => {
    const sled = getStation("sled-push")!;
    expect(stationLoadLabel(sled, "doubles")).toMatch(/shared/i);
  });

  it("surfaces the gender-correct station load when gender is known (ADR — weight category)", () => {
    const i = inst({ division: "open" });
    const sledLoad = (ctx: PlatformContext) =>
      hyroxEngine.prescribe(i, simRef(i), ctx).items.find((it) => it.movementId === "sled-push")
        ?.cardioPlan?.stations?.[0]?.load ?? "";
    // Open sled push: men 152 kg, women 102 kg.
    const male = sledLoad({ ...ctxWithMaxes, gender: "male" });
    const female = sledLoad({ ...ctxWithMaxes, gender: "female" });
    expect(male).toContain("152");
    expect(male).not.toContain("102");
    expect(female).toContain("102");
    expect(female).not.toContain("152");
    // No gender → both shown (confirm-at-log fallback).
    const both = sledLoad(ctxWithMaxes);
    expect(both).toContain("152");
    expect(both).toContain("102");
  });

  it("wall-ball target height + load are gender-correct (3.0 m / 6 kg men · 2.7 m / 4 kg women)", () => {
    const wb = getStation("wall-ball")!;
    expect(stationLoadLabel(wb, "open", "male")).toContain("6 kg");
    expect(stationLoadLabel(wb, "open", "female")).toContain("4 kg");
    expect(wallBallTargetLabel("male")).toContain("3.0 m");
    expect(wallBallTargetLabel("female")).toContain("2.7 m");
  });

  it("surfaces race loads on station sessions (intervals/circuit/compromised), not just sims", () => {
    // station-intervals carries loaded stations (sled / wall ball / sandbag).
    const summaryMale = stationLoadsSummary(
      ["sled-push", "sled-pull", "wall-ball", "sandbag-lunge", "skierg", "rowing-erg"],
      "open",
      "male",
    );
    expect(summaryMale).toContain("152 kg"); // sled push, men's Open
    expect(summaryMale).toContain("6 kg"); // wall ball, men's Open
    expect(summaryMale).not.toContain("/"); // gender known → single weights, no M/W slash
    // Unloaded-only movement set yields no load line.
    expect(stationLoadsSummary(["run"], "open", "male")).toBe("");
    // End-to-end: across the block the focused rotation (ADR 0062) hits a sled-power
    // week whose station rows carry the gender-correct load. Gather every
    // station-intervals session so we don't depend on which group week 1 lands on.
    const i = inst({ division: "pro", experience: "advanced" });
    const refs = hyroxEngine
      .timeline(i)
      .filter((s) => s.tags?.includes("session:station-intervals"))
      .map((s) => s.ref);
    const allStations = refs.flatMap(
      (ref) =>
        hyroxEngine.prescribe(i, ref, { ...ctxWithMaxes, gender: "female" }).items[0]?.cardioPlan
          ?.stations ?? [],
    );
    const sled = allStations.find((s) => s.name === "Sled Push");
    expect(sled?.load).toContain("152"); // Pro women sled push = 152 kg
  });

  it("station-intervals prescribe PER-ROUND volumes, not full race distances (ADR 0061)", () => {
    // Per-round interval chunks: ~¼ of a race so N rounds ≈ one race, not N races.
    expect(intervalTargetLabel(getStation("skierg")!)).toBe("250 m"); // race is 1000 m
    expect(intervalTargetLabel(getStation("rowing-erg")!)).toBe("250 m"); // race is 1000 m
    expect(intervalTargetLabel(getStation("sled-push")!)).toBe("12.5 m"); // race is 50 m
    expect(intervalTargetLabel(getStation("sandbag-lunge")!)).toBe("25 m"); // race is 100 m
    expect(intervalTargetLabel(getStation("wall-ball")!, "male")).toContain("25 reps"); // race is 100
    // End-to-end: NO station in ANY station-intervals session shows a full race
    // distance, and the loaded stations stay race-correct.
    const i = inst({ division: "open", experience: "advanced" });
    const refs = hyroxEngine
      .timeline(i)
      .filter((s) => s.tags?.includes("session:station-intervals"))
      .map((s) => s.ref);
    expect(refs.length).toBeGreaterThan(0);
    const allStations = refs.flatMap(
      (ref) =>
        hyroxEngine.prescribe(i, ref, { ...ctxWithMaxes, gender: "male" }).items[0]?.cardioPlan
          ?.stations ?? [],
    );
    expect(allStations.find((s) => s.name === "SkiErg")?.target).toBe("250 m"); // NOT "1000 m"
    expect(allStations.find((s) => s.name === "Sled Push")?.target).toBe("12.5 m"); // NOT "50 m"
    expect(allStations.find((s) => s.name === "Sled Push")?.load).toContain("152"); // load unchanged
    // No full-race distance leaks through anywhere.
    expect(allStations.some((s) => s.target === "1000 m" || s.target === "50 m")).toBe(false);
  });
});

describe("HYROX focused station rotation (ADR 0062)", () => {
  it("each station-intervals session targets a small focused subset, not all 6", () => {
    const i = inst({ division: "open", experience: "intermediate" });
    const refs = hyroxEngine
      .timeline(i)
      .filter((s) => s.tags?.includes("session:station-intervals"))
      .map((s) => s.ref);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const stations = hyroxEngine.prescribe(i, ref, ctxWithMaxes).items[0]?.cardioPlan?.stations ?? [];
      expect(stations.length).toBeGreaterThanOrEqual(1);
      expect(stations.length).toBeLessThanOrEqual(3); // focused, never the full 6
    }
  });

  it("the focus rotates across the block (more than one group appears)", () => {
    const i = inst({ division: "open", experience: "advanced" });
    const refs = hyroxEngine
      .timeline(i)
      .filter((s) => s.tags?.includes("session:station-intervals"))
      .map((s) => s.ref);
    const firstNames = new Set(
      refs.map(
        (ref) =>
          hyroxEngine.prescribe(i, ref, ctxWithMaxes).items[0]?.cardioPlan?.stations?.[0]?.name,
      ),
    );
    expect(firstNames.size).toBeGreaterThanOrEqual(2); // rotation is active, not static
  });

  it("stationFocusForWeek cycles deterministically and covers every station", () => {
    const all = ["sled-push", "sled-pull", "wall-ball", "sandbag-lunge", "skierg", "rowing-erg"];
    expect(stationFocusForWeek("station-intervals", 1, all).movements).toEqual(["sled-push", "sled-pull"]);
    expect(stationFocusForWeek("station-intervals", 2, all).movements).toEqual(["rowing-erg", "wall-ball"]);
    expect(stationFocusForWeek("station-intervals", 3, all).movements).toEqual(["skierg", "sandbag-lunge"]);
    expect(stationFocusForWeek("station-intervals", 4, all).movements).toEqual(["sled-push", "sled-pull"]); // wraps
    // Union across a full cycle covers all 6 station-intervals stations.
    const covered = new Set([1, 2, 3].flatMap((w) => stationFocusForWeek("station-intervals", w, all).movements));
    expect(covered).toEqual(new Set(all));
    // Unknown session id → fall back to the full movement list (e.g. vo2-intervals).
    expect(stationFocusForWeek("vo2-intervals", 1, ["run"]).movements).toEqual(["run"]);
  });
});

describe("HYROX prescribe — two-a-day (ADR 0054)", () => {
  it("attaches a PM companion the engine can prescribe as an easy erg", () => {
    const i = inst({ experience: "advanced", twoADay: true });
    const spec = hyroxEngine.timeline(i).find((s) => s.secondSession != null);
    expect(spec).toBeDefined();
    expect(spec!.tags).toContain("two-a-day");
    // The companion has its own "-pm" ref and resolves through prescribe().
    const pmRef = spec!.secondSession!.ref;
    expect(pmRef.endsWith("-pm")).toBe(true);
    const p = hyroxEngine.prescribe(i, pmRef, ctxWithMaxes);
    expect(p.items.length).toBeGreaterThan(0);
  });

  it("emits NO companion when two-a-day is off (byte-identical default)", () => {
    const i = inst({ experience: "advanced" });
    expect(hyroxEngine.timeline(i).some((s) => s.secondSession != null)).toBe(false);
  });
});
