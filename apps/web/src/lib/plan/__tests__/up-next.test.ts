import { describe, it, expect } from "vitest";
import type { Prescription, PrescriptionItem } from "@hta/db";
import { selectUpNext } from "../up-next";

function rx(items: PrescriptionItem[]): Prescription {
  return { items } as Prescription;
}

function item(over: Partial<PrescriptionItem>): PrescriptionItem {
  return {
    movementId: "m1",
    movementSlug: "front_squat",
    movementName: "Front squat",
    kind: "main",
    sets: 1,
    reps: 5,
    ...over,
  };
}

function row(over: Partial<Parameters<typeof selectUpNext>[0]["all"][number]>) {
  return {
    id: "p1",
    date: "2026-06-01",
    slot: "single" as const,
    title: "Squat day",
    prescription: rx([item({})]),
    completedSessionId: null,
    skippedAt: null,
    ...over,
  };
}

describe("selectUpNext", () => {
  const today = "2026-06-01";

  it("returns today's session when one exists", () => {
    const out = selectUpNext({
      today,
      all: [
        row({ id: "a", date: "2026-06-01", title: "Today squat" }),
        row({ id: "b", date: "2026-06-03", title: "Future bench" }),
      ],
    });
    expect(out.today.map((s) => s.id)).toEqual(["a"]);
    expect(out.upcoming.map((s) => s.id)).toEqual(["b"]);
    expect(out.nextDate).toBe("2026-06-03");
  });

  it("orders today's two-a-day with AM before PM", () => {
    const out = selectUpNext({
      today,
      all: [
        row({ id: "pm", date: today, slot: "pm", title: "PM cardio" }),
        row({ id: "am", date: today, slot: "am", title: "AM lift" }),
      ],
    });
    expect(out.today.map((s) => s.id)).toEqual(["am", "pm"]);
  });

  it("skips completed/skipped sessions in both buckets", () => {
    const out = selectUpNext({
      today,
      all: [
        row({ id: "done", date: today, completedSessionId: "s1" }),
        row({ id: "sk", date: "2026-06-02", skippedAt: "2026-06-02T08:00:00Z" }),
        row({ id: "ok", date: "2026-06-04", title: "Real next" }),
      ],
    });
    expect(out.today).toHaveLength(0);
    expect(out.upcoming.map((s) => s.id)).toEqual(["ok"]);
    expect(out.nextDate).toBe("2026-06-04");
  });

  it("caps upcoming at 3 by default", () => {
    const out = selectUpNext({
      today,
      all: Array.from({ length: 5 }, (_, i) =>
        row({ id: `f${i}`, date: `2026-06-0${i + 2}`, title: `s${i}` }),
      ),
    });
    expect(out.upcoming).toHaveLength(3);
    expect(out.upcoming.map((s) => s.id)).toEqual(["f0", "f1", "f2"]);
  });

  it("populates shape counts from the prescription", () => {
    const out = selectUpNext({
      today,
      all: [
        row({
          id: "shape",
          date: today,
          prescription: rx([
            item({ kind: "warmup" }),
            item({ kind: "warmup" }),
            item({ kind: "main", percentTm: 80 }),
            item({ kind: "main", percentTm: 85 }),
            item({
              kind: "accessory",
              movementId: "bss",
              movementSlug: "bulgarian_split_squat",
              movementName: "Bulgarian split squat",
            }),
            item({
              kind: "cardio_z2",
              movementId: "run",
              movementSlug: "easy_run",
              movementName: "Easy run",
            }),
          ]),
        }),
      ],
    });
    const s = out.today[0]!;
    expect(s.warmupCount).toBe(2);
    expect(s.mainCount).toBe(2);
    expect(s.accessoryCount).toBe(1);
    expect(s.cardioCount).toBe(1);
  });

  it("nextDate is null when nothing future remains", () => {
    const out = selectUpNext({
      today,
      all: [row({ id: "a", date: today })],
    });
    expect(out.nextDate).toBeNull();
    expect(out.upcoming).toEqual([]);
  });
});
