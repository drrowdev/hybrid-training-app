import { describe, it, expect } from "vitest";
import type { Prescription, PrescriptionItem } from "@hta/db";
import { selectBlockState } from "../block-state";
import { selectUpNext } from "../up-next";

function rx(items: PrescriptionItem[]): Prescription {
  return { items } as Prescription;
}
function item(over: Partial<PrescriptionItem> = {}): PrescriptionItem {
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
function row(
  over: Partial<Parameters<typeof selectUpNext>[0]["all"][number]> = {},
) {
  return {
    id: "p1",
    date: "2026-06-01",
    slot: "single" as const,
    title: "Squat",
    prescription: rx([item()]),
    completedSessionId: null,
    skippedAt: null,
    ...over,
  };
}

describe("selectBlockState", () => {
  const today = "2026-06-10";

  it("returns 'no-block' when there is no active block", () => {
    const upNext = selectUpNext({ today, all: [] });
    const state = selectBlockState({ block: null, today, planned: [], upNext });
    expect(state.kind).toBe("no-block");
  });

  it("returns 'future' with daysUntil when startedOn is after today", () => {
    const upNext = selectUpNext({ today, all: [] });
    const state = selectBlockState({
      block: { startedOn: "2026-06-15" },
      today,
      planned: [],
      upNext,
    });
    expect(state.kind).toBe("future");
    if (state.kind === "future") {
      expect(state.daysUntil).toBe(5);
      expect(state.startsOn).toBe("2026-06-15");
    }
  });

  it("returns 'active' when today has at least one open session", () => {
    const all = [row({ id: "a", date: today })];
    const upNext = selectUpNext({ today, all });
    const state = selectBlockState({
      block: { startedOn: "2026-06-01" },
      today,
      planned: all,
      upNext,
    });
    expect(state.kind).toBe("active");
  });

  it("returns 'no-session-today' when today is empty but future sessions remain", () => {
    const all = [
      row({ id: "a", date: "2026-06-09", completedSessionId: "s1" }),
      row({ id: "b", date: "2026-06-12", title: "Next" }),
    ];
    const upNext = selectUpNext({ today, all });
    const state = selectBlockState({
      block: { startedOn: "2026-06-01" },
      today,
      planned: all,
      upNext,
    });
    expect(state.kind).toBe("no-session-today");
    if (state.kind === "no-session-today") {
      expect(state.nextDate).toBe("2026-06-12");
    }
  });

  it("returns 'completed' when every planned row is done or skipped", () => {
    const all = [
      row({ id: "a", date: "2026-06-02", completedSessionId: "s1" }),
      row({ id: "b", date: "2026-06-05", skippedAt: "2026-06-05T08:00:00Z" }),
      row({ id: "c", date: "2026-06-08", completedSessionId: "s2" }),
    ];
    const upNext = selectUpNext({ today, all });
    const state = selectBlockState({
      block: { startedOn: "2026-06-01" },
      today,
      planned: all,
      upNext,
    });
    expect(state.kind).toBe("completed");
  });

  it("prefers 'active' over 'completed' when today still has an open session", () => {
    const all = [
      row({ id: "a", date: "2026-06-02", completedSessionId: "s1" }),
      row({ id: "b", date: today, title: "Today" }),
    ];
    const upNext = selectUpNext({ today, all });
    const state = selectBlockState({
      block: { startedOn: "2026-06-01" },
      today,
      planned: all,
      upNext,
    });
    expect(state.kind).toBe("active");
  });

  it("'future' wins over 'active' — pre-start days never claim today's session", () => {
    // Edge case: a future-dated block with a planned row that happens
    // to share today's date should still surface the countdown until
    // the block officially starts.
    const all = [row({ id: "a", date: today })];
    const upNext = selectUpNext({ today, all });
    const state = selectBlockState({
      block: { startedOn: "2026-06-20" },
      today,
      planned: all,
      upNext,
    });
    expect(state.kind).toBe("future");
  });
});
