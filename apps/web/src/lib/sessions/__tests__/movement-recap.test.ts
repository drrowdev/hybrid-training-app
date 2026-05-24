import { describe, it, expect } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import { buildMovementRecap } from "../movement-recap";

function item(kind: PrescriptionItem["kind"], reps = 5, percentTm: number | null = null): PrescriptionItem {
  return {
    kind,
    movementId: "m1",
    movementSlug: "back-squat-high-bar",
    movementName: "Back Squat",
    sets: 1,
    reps,
    percentTm,
  } as unknown as PrescriptionItem;
}

describe("buildMovementRecap", () => {
  it("collapses identical working sets into one `N×R @ W kg` line", () => {
    const items: PrescriptionItem[] = [
      item("main", 5),
      item("main", 5),
      item("main", 5),
      item("main", 5),
      item("main", 5),
    ];
    const logged = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      weightKg: 82.5,
      reps: 5,
      rpe: null,
    }));
    const recap = buildMovementRecap(items, logged);
    expect(recap).toHaveLength(1);
    expect(recap[0]!.kind).toBe("main");
    expect(recap[0]!.text).toBe("Working · 5×5 @ 82.5 kg");
  });

  it("shows a weight range when working sets vary in load but match reps", () => {
    const items = [item("main", 5), item("main", 5), item("main", 5)];
    const logged = [
      { id: "a", weightKg: 70, reps: 5, rpe: null },
      { id: "b", weightKg: 77.5, reps: 5, rpe: null },
      { id: "c", weightKg: 85, reps: 5, rpe: null },
    ];
    expect(buildMovementRecap(items, logged)[0]!.text).toBe(
      "Working · 3×5 @ 70 – 85 kg",
    );
  });

  it("groups warm-ups, working, and back-off into separate lines", () => {
    const items: PrescriptionItem[] = [
      item("warmup", 5),
      item("warmup", 5),
      item("main", 5),
      item("main", 5),
      item("back_off", 3),
      item("back_off", 3),
    ];
    const logged = [
      { id: "w1", weightKg: 40, reps: 5, rpe: null },
      { id: "w2", weightKg: 60, reps: 5, rpe: null },
      { id: "m1", weightKg: 82.5, reps: 5, rpe: null },
      { id: "m2", weightKg: 82.5, reps: 5, rpe: null },
      { id: "b1", weightKg: 92.5, reps: 3, rpe: null },
      { id: "b2", weightKg: 92.5, reps: 3, rpe: null },
    ];
    const recap = buildMovementRecap(items, logged);
    expect(recap.map((l) => l.text)).toEqual([
      "Warm-ups · 2 sets · 40 – 60 kg",
      "Working · 2×5 @ 82.5 kg",
      "Volume · 2×3 @ 92.5 kg",
    ]);
  });

  it("appends a `N skipped (reason)` line when any sets were skipped", () => {
    const items = [item("main", 5), item("main", 5)];
    const logged = [
      { id: "m1", weightKg: 80, reps: 5, rpe: null },
      { id: "x1", weightKg: null, reps: null, rpe: null, skipped: true, skipReason: "pain" as const },
    ];
    const recap = buildMovementRecap(items, logged);
    expect(recap.map((l) => l.text)).toEqual([
      "Working · 1×5 @ 80 kg",
      "1 skipped (pain)",
    ]);
  });
});
