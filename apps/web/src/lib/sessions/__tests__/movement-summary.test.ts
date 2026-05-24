import { describe, expect, it } from "vitest";
import type { Prescription } from "@hta/db";
import { groupPrescriptionByMovement } from "../movement-grouping";
import {
  bucketForGroup,
  summariseGroupForHeader,
} from "../movement-summary";
import type { FocusLoggedSet } from "@/components/session/MovementFocusView";

function p(items: Prescription["items"]): Prescription {
  return { items };
}

function groupOf(items: Prescription["items"]) {
  const groups = groupPrescriptionByMovement(p(items));
  return groups[0]!;
}

function logged(
  rows: Array<{
    weightKg: number | null;
    reps: number | null;
    skipped?: boolean;
  }>,
): FocusLoggedSet[] {
  return rows.map((r, i) => ({
    id: `s${i}`,
    weightKg: r.weightKg,
    reps: r.reps,
    rpe: null,
    skipped: r.skipped ?? false,
    skipReason: null,
  }));
}

describe("bucketForGroup", () => {
  it("classifies main when any item is a main kind", () => {
    const g = groupOf([
      { movementId: "sq", kind: "warmup", sets: 1, reps: 5 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
    ]);
    expect(bucketForGroup(g)).toBe("main");
  });

  it("classifies back-off as main", () => {
    const g = groupOf([{ movementId: "sq", kind: "back_off", sets: 1, reps: 8 }]);
    expect(bucketForGroup(g)).toBe("main");
  });

  it("classifies accessory-only as accessory", () => {
    const g = groupOf([
      { movementId: "fc", kind: "accessory", sets: 3, reps: 10 },
    ]);
    expect(bucketForGroup(g)).toBe("accessory");
  });

  it("treats tendon + warmup-only as accessory", () => {
    const g = groupOf([
      { movementId: "calf", kind: "tendon", sets: 1, reps: 20 },
      { movementId: "calf", kind: "warmup", sets: 1, reps: 5 },
    ]);
    expect(bucketForGroup(g)).toBe("accessory");
  });

  it("freestyle (no items) buckets as other", () => {
    const g = {
      movementId: "x",
      movementName: "X",
      movementSlug: null,
      itemIndices: [],
      items: [],
    };
    expect(bucketForGroup(g)).toBe("other");
  });
});

describe("summariseGroupForHeader — not started", () => {
  it("main lift with varying %TM and uniform reps", () => {
    const g = groupOf([
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 65 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 75 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 85 },
    ]);
    expect(summariseGroupForHeader(g, [])).toBe("5·5·5 @ 65/75/85% TM");
  });

  it("main lift with uniform sets", () => {
    const g = groupOf([
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
    ]);
    expect(summariseGroupForHeader(g, [])).toBe("3×5 @ 80% TM");
  });

  it("accessory with uniform reps", () => {
    const g = groupOf([
      { movementId: "fc", kind: "accessory", sets: 1, reps: 10 },
      { movementId: "fc", kind: "accessory", sets: 1, reps: 10 },
      { movementId: "fc", kind: "accessory", sets: 1, reps: 10 },
    ]);
    expect(summariseGroupForHeader(g, [])).toBe("3×10");
  });

  it("mixed main + back-off renders both blocks, truncated tastefully", () => {
    const g = groupOf([
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 65 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 75 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 85 },
      { movementId: "sq", kind: "back_off", sets: 1, reps: 3, percentTm: 70 },
      { movementId: "sq", kind: "back_off", sets: 1, reps: 3, percentTm: 70 },
      { movementId: "sq", kind: "back_off", sets: 1, reps: 3, percentTm: 70 },
      { movementId: "sq", kind: "back_off", sets: 1, reps: 3, percentTm: 70 },
      { movementId: "sq", kind: "back_off", sets: 1, reps: 3, percentTm: 70 },
    ]);
    const out = summariseGroupForHeader(g, []);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("summariseGroupForHeader — in progress", () => {
  it("2/5 sets logged shows last weight", () => {
    const g = groupOf([
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
    ]);
    const sets = logged([
      { weightKg: 80, reps: 5 },
      { weightKg: 82.5, reps: 5 },
    ]);
    expect(summariseGroupForHeader(g, sets)).toBe("2/5 · last 82.5kg");
  });
});

describe("summariseGroupForHeader — completed", () => {
  it("uniform completed sets render as N×R @ Wkg ✓", () => {
    const g = groupOf([
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
    ]);
    const sets = logged([
      { weightKg: 82.5, reps: 5 },
      { weightKg: 82.5, reps: 5 },
      { weightKg: 82.5, reps: 5 },
      { weightKg: 82.5, reps: 5 },
      { weightKg: 82.5, reps: 5 },
    ]);
    expect(summariseGroupForHeader(g, sets)).toBe("5×5 @ 82.5kg ✓");
  });

  it("varying weights → top set summary", () => {
    const g = groupOf([
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 65 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 75 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 85 },
    ]);
    const sets = logged([
      { weightKg: 70, reps: 5 },
      { weightKg: 85, reps: 5 },
      { weightKg: 102.5, reps: 5 },
    ]);
    expect(summariseGroupForHeader(g, sets)).toBe("Top: 102.5kg × 5 ✓");
  });
});

describe("summariseGroupForHeader — edges", () => {
  it("empty group + no logged sets → empty string", () => {
    const g = {
      movementId: "x",
      movementName: "X",
      movementSlug: null,
      itemIndices: [],
      items: [],
    };
    expect(summariseGroupForHeader(g, [])).toBe("");
  });

  it("never exceeds 30 chars", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      movementId: "sq",
      kind: "main" as const,
      sets: 1,
      reps: 5,
      percentTm: 60 + i,
    }));
    const g = groupOf(items);
    const out = summariseGroupForHeader(g, []);
    expect(out.length).toBeLessThanOrEqual(30);
  });

  it("skipped sets still count toward completion", () => {
    const g = groupOf([
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
      { movementId: "sq", kind: "main", sets: 1, reps: 5, percentTm: 80 },
    ]);
    const sets = logged([
      { weightKg: 80, reps: 5 },
      { weightKg: null, reps: null, skipped: true },
    ]);
    // 1 working + 1 skipped == 2/2 covered → completed branch. The
    // single working set is "uniform" so it renders 1×5 @ 80kg ✓.
    expect(summariseGroupForHeader(g, sets)).toBe("1×5 @ 80kg ✓");
  });
});
