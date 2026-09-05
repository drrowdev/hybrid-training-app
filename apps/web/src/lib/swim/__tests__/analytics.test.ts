import { afterEach, describe, expect, it, vi } from "vitest";
import { formatSwimDistance } from "@hta/domain";
import { loadSwimHubView } from "../queries";
import { listSwimWorkouts, type SwimPlanRow } from "../storage";
import { swimFixture, userId, sessionId } from "./fixtures";

vi.mock("../storage", () => ({ listSwimWorkouts: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("ADR0079 native analytics", () => {
  it("keeps a late actual in its performed week and actual course without relabelling the plan", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
    const { plan, workouts, history } = swimFixture();
    vi.mocked(listSwimWorkouts).mockResolvedValue([
      { ...workouts[0]!, status: "completed", session_id: sessionId },
    ]);
    const result = {
      ...history[0]!.result!, lengths: 12,
      snapshot: { ...history[0]!.result!.snapshot, course: { numerator: 50, denominator: 1, unit: "m" } },
    };
    const client = {
      from: (table: string) => ({
        select: () => table === "profiles" ? {
          eq: () => ({ maybeSingle: async () => ({ data: { timezone: "UTC" }, error: null }) }),
        } : {
          in: async () => ({ error: null, data: table === "sessions" ? [{
            id: sessionId, performed_at: "2026-09-21T12:00:00Z", completed_at: "2026-09-21T12:20:00Z",
            deleted_at: null, notes: null,
          }] : [{ session_id: sessionId, swim_result: result, notes: null }] }),
        },
      }),
    };
    const view = await loadSwimHubView(client as never, userId, { ...plan, status: "archived" });
    const planned = view.analytics.weeks.find((row) => row.week === "2026-09-07")!;
    expect(planned.course).toContain("yd");
    expect(planned.planned).toContain("yd");
    expect(planned.frequency).toBe(0);
    const actual = view.analytics.weeks.find((row) => row.week === "2026-09-21")!;
    expect(actual).toMatchObject({ actual: "600 m", planned: "—", frequency: 1 });
    expect(actual.course).toContain("50 m");
    expect(view.proposals).toEqual([]);
  });
  it("shows pause-time actual frequency before and after resume without an adherence figure", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
    const { plan, history } = swimFixture();
    const row = history[1]!;
    vi.mocked(listSwimWorkouts).mockResolvedValue([row.workout]);
    const client = {
      from: (table: string) => ({
        select: () => table === "profiles" ? {
          eq: () => ({ maybeSingle: async () => ({ data: { timezone: "UTC" }, error: null }) }),
        } : {
          in: async () => ({ error: null, data: table === "sessions" ? [{
            id: sessionId, performed_at: row.performedAt, completed_at: row.completedAt,
            deleted_at: null, notes: null,
          }] : [{ session_id: sessionId, swim_result: row.result, notes: null }] }),
        },
      }),
    };
    const pause = { from: "active" as const, to: "paused" as const, recordedAt: "2026-09-10T12:05:00Z" };
    const paused: SwimPlanRow = { ...plan, status: "paused", state: { ...plan.state, lifecycle: [pause] } };
    const resumed: SwimPlanRow = { ...paused, status: "active", state: { ...paused.state, lifecycle: [pause, {
      from: "paused", to: "active", recordedAt: "2026-09-13T09:00:00Z",
    }] } };
    for (const current of [paused, resumed]) {
      const view = await loadSwimHubView(client as never, userId, current);
      expect(view.analytics.weeks).toEqual([expect.objectContaining({
        frequency: 1, adherence: "—",
        actual: formatSwimDistance(row.result!.lengths, row.result!.snapshot.course),
      })]);
    }
  });
});
