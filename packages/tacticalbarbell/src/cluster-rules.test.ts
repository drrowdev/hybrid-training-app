/**
 * Cluster rules — the TB1 cluster taxonomy enforced in the engine + validator.
 *
 * Covers: variable-size Zulu A/B clusters (5/6/8 lifts) end-to-end, Operator's
 * optional bodyweight 4th (max-reps loading, exempt from the count), Gladiator's
 * minimalist 2-lift lock, and the validateCluster bounds/balance/duplicate rules.
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext } from "@hta/program-core";
import { itemsOfKind } from "@hta/program-core";
import { tacticalBarbellEngine as tb, type TbInstance } from "./program";
import { validateCluster, countingLifts } from "./validate";
import { getTbTemplate } from "./templates";

const ctx: PlatformContext = {
  oneRepMaxes: { squat: 200, bench: 100, deadlift: 250, press: 100, row: 100, curl: 50, pullup: 20 },
  roundingKg: 2.5,
};

function setup(values: Record<string, unknown> = {}): TbInstance {
  return tb.setup({ values }, ctx);
}

describe("cluster taxonomy — per-template bounds", () => {
  it("encodes the TB1 minimalist / standard / heavy ranges", () => {
    const bounds = (id: string) => {
      const t = getTbTemplate(id)!;
      return [t.clusterMin, t.clusterMax];
    };
    expect(bounds("operator")).toEqual([2, 3]);
    expect(bounds("fighter")).toEqual([2, 3]);
    expect(bounds("gladiator")).toEqual([2, 2]);
    expect(bounds("mass")).toEqual([3, 3]);
    expect(bounds("grey-man")).toEqual([3, 3]);
    expect(bounds("zulu")).toEqual([4, 8]);
  });

  it("only Operator allows an optional bodyweight movement", () => {
    expect(getTbTemplate("operator")!.allowsBodyweightFourth).toBe(true);
    for (const id of ["fighter", "gladiator", "mass", "grey-man", "zulu"]) {
      expect(getTbTemplate(id)!.allowsBodyweightFourth).toBeFalsy();
    }
  });
});

describe("Gladiator — minimalist 2-lift lock", () => {
  it("defaults to exactly 2 lifts", () => {
    const inst = setup({ templateId: "gladiator" });
    expect(inst.cluster.map((c) => c.movement)).toEqual(["deadlift", "bench"]);
  });

  it("clamps a 3-lift cluster down to 2", () => {
    const inst = setup({ templateId: "gladiator", cluster: ["squat", "bench", "deadlift"] });
    expect(inst.cluster).toHaveLength(2);
    expect(inst.cluster.map((c) => c.movement)).toEqual(["squat", "bench"]);
  });
});

describe("Operator — TB3 fixed loadout", () => {
  it("keeps a bodyweight lift on top of the 3 barbell lifts (exempt from the cap)", () => {
    const inst = setup({
      templateId: "operator",
      cluster: [
        { movement: "squat" },
        { movement: "bench" },
        { movement: "deadlift" },
        { movement: "pullup", kind: "bodyweight" },
      ],
    });
    expect(inst.cluster).toHaveLength(4);
    expect(inst.cluster[3]).toEqual({ movement: "pullup", kind: "bodyweight" });
  });

  it("still caps barbell lifts at 3 even with a bodyweight extra", () => {
    const inst = setup({
      templateId: "operator",
      cluster: [
        { movement: "squat" },
        { movement: "bench" },
        { movement: "deadlift" },
        { movement: "press" },
        { movement: "pullup", kind: "bodyweight" },
      ],
    });
    expect(inst.cluster.filter((c) => c.kind !== "bodyweight")).toHaveLength(3);
    expect(inst.cluster.filter((c) => c.kind === "bodyweight")).toHaveLength(1);
  });

  it("prescribes the TB3 weighted pull-up even when a legacy custom cluster is stored", () => {
    const inst = setup({
      templateId: "operator",
      cluster: [
        { movement: "squat" },
        { movement: "pullup", kind: "bodyweight" },
      ],
    });
    const p = tb.prescribe(inst, "b0-w1-s1", ctx);
    const pull = p.items.find(
      (i) => i.movementId === "weighted-pullup" && i.kind === "main",
    )!;
    expect(pull.percentOfTm).toBe(0.75);
    expect(pull.reps).toBe(5);
    expect(p.items.some((i) => i.movementId === "pullup")).toBe(false);
    const squat = p.items.find((i) => i.movementId === "squat" && i.kind === "main")!;
    expect(squat.weightKg).toBe(150);
  });
});

describe("Zulu — TB3 fixed A/B work", () => {
  it("keeps a legacy custom cluster in the instance but prescribes the TB3 loadout", () => {
    const inst = setup({
      templateId: "zulu",
      splitA: ["squat", "press", "row"],
      splitB: ["bench", "deadlift"],
    });
    expect(inst.cluster).toHaveLength(5);
    const a = tb.prescribe(inst, "b0-w1-p1a", ctx);
    const b = tb.prescribe(inst, "b0-w1-p1b", ctx);
    expect(itemsOfKind(a, "main").map((i) => i.movementId)).toEqual(["bench", "squat"]);
    expect(itemsOfKind(b, "main").map((i) => i.movementId)).toEqual([
      "deadlift",
      "weighted-pullup",
    ]);
    expect(itemsOfKind(a, "supplemental").map((i) => i.movementId)).toEqual([
      "overhead-press",
    ]);
    expect(itemsOfKind(a, "assistance").map((i) => i.movementId)).toEqual([
      "hanging-leg-raise",
      "hanging-knee-raise",
      "toes-to-bar",
    ]);
  });

  it("supports a 6-lift cluster (A:3 / B:3)", () => {
    const inst = setup({
      templateId: "zulu",
      splitA: ["squat", "press", "row"],
      splitB: ["bench", "deadlift", "curl"],
    });
    expect(inst.cluster).toHaveLength(6);
    const tl = tb.timeline(inst);
    expect(tl).toHaveLength(24); // 6 weeks × 4 sessions, unchanged by cluster size
  });

  it("the second pass opens heavier for a custom cluster", () => {
    const inst = setup({ templateId: "zulu", splitA: ["squat", "row"], splitB: ["deadlift", "bench"] });
    const pass1 = tb.prescribe(inst, "b0-w1-p1a", ctx);
    const pass2 = tb.prescribe(inst, "b0-w1-p2a", ctx);
    expect(itemsOfKind(pass1, "main").map((i) => i.percentOfTm)).toEqual([0.7, 0.7]);
    expect(itemsOfKind(pass2, "main").map((i) => i.percentOfTm)).toEqual([0.75, 0.75]);
  });
});

describe("validateCluster", () => {
  const t = (id: string) => getTbTemplate(id)!;
  const lift = (movement: string, extra: Record<string, unknown> = {}) => ({ movement, ...extra });

  it("passes a valid Operator 3-lift cluster", () => {
    const v = validateCluster(t("operator"), [lift("squat"), lift("bench"), lift("deadlift")]);
    expect(v.ok).toBe(true);
    expect(v.countingLifts).toBe(3);
  });

  it("flags an under-sized Operator cluster", () => {
    const v = validateCluster(t("operator"), [lift("squat")]);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("at least 2");
  });

  it("flags an over-sized Operator cluster but exempts one bodyweight lift", () => {
    const four = [lift("squat"), lift("bench"), lift("deadlift"), lift("press")];
    expect(validateCluster(t("operator"), four).ok).toBe(false);
    const withBw = [lift("squat"), lift("bench"), lift("deadlift"), lift("pullup", { kind: "bodyweight" })];
    const v = validateCluster(t("operator"), withBw);
    expect(v.ok).toBe(true);
    expect(v.countingLifts).toBe(3);
  });

  it("rejects more than one optional bodyweight movement", () => {
    const v = validateCluster(t("operator"), [
      lift("squat"),
      lift("pullup", { kind: "bodyweight" }),
      lift("dip", { kind: "bodyweight" }),
    ]);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("only one optional bodyweight");
  });

  it("requires Gladiator to use exactly 2 lifts", () => {
    expect(validateCluster(t("gladiator"), [lift("squat"), lift("bench"), lift("deadlift")]).ok).toBe(false);
    expect(validateCluster(t("gladiator"), [lift("squat"), lift("bench")]).ok).toBe(true);
  });

  it("requires Zulu to have at least 4 lifts split across A and B", () => {
    const three = [
      lift("squat", { split: "A" }),
      lift("press", { split: "A" }),
      lift("bench", { split: "B" }),
    ];
    expect(validateCluster(t("zulu"), three).ok).toBe(false);

    const fourValid = [
      lift("squat", { split: "A" }),
      lift("press", { split: "A" }),
      lift("bench", { split: "B" }),
      lift("deadlift", { split: "B" }),
    ];
    expect(validateCluster(t("zulu"), fourValid).ok).toBe(true);
  });

  it("rejects a Zulu cluster with an empty split", () => {
    const allA = [
      lift("squat", { split: "A" }),
      lift("press", { split: "A" }),
      lift("bench", { split: "A" }),
      lift("deadlift", { split: "A" }),
    ];
    const v = validateCluster(t("zulu"), allA);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("A and a B session");
  });

  it("rejects duplicate movements", () => {
    const v = validateCluster(t("operator"), [lift("squat"), lift("squat"), lift("bench")]);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("Duplicate");
  });
});

describe("countingLifts", () => {
  it("excludes one bodyweight lift for Operator", () => {
    const cluster = [{ kind: "barbell" as const }, { kind: "barbell" as const }, { kind: "bodyweight" as const }];
    expect(countingLifts(getTbTemplate("operator")!, cluster)).toBe(2);
  });

  it("counts every lift for templates without the bodyweight exemption", () => {
    const cluster = [{ kind: "barbell" as const }, { kind: "bodyweight" as const }];
    expect(countingLifts(getTbTemplate("zulu")!, cluster)).toBe(2);
  });
});
