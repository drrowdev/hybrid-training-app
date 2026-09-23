import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getActiveBlocksProgress } from "../active-block-progress";
import { getAdherence30d, getAdherenceForWindow } from "../adherence";
import { getBlockAdherence, getBlockIndex } from "../blocks";
import { getWeeklyAdherence } from "../adherence-detail";

const USER = "11111111-1111-4111-8111-111111111111";
const completedAt = "2026-06-01T12:00:00Z";
const session = (complete: boolean, deleted = false) => ({
  completed_at: complete ? completedAt : null,
  deleted_at: deleted ? completedAt : null,
  performed_at: completedAt,
});
function workout(id: string, day: number, state: "completed" | "started" | "deleted" | "skipped" | "rest" | "future") {
  return {
    id, title: id, week_index: state === "future" ? 1 : 0, day_index: day,
    role: state === "rest" ? "rest" : "primary",
    prescription: { kind: state === "rest" ? "rest" : "strength", items: [] },
    session_modality: "pure_strength",
    completed_session_id: ["completed", "started", "deleted"].includes(state) ? `${id}-session` : null,
    skipped_at: state === "skipped" ? completedAt : null,
    sessions: state === "completed" ? [session(true)] : state === "started" ? session(false) : state === "deleted" ? session(true, true) : null,
  };
}
function fixture() {
  const blocks = [
    { id: "strength", planned_sessions: [workout("done", 0, "completed"), workout("started", 2, "started"), workout("rest", 6, "rest")] },
    { id: "running", planned_sessions: [workout("run", 1, "completed"), workout("skip", 3, "skipped")] },
    { id: "hybrid", planned_sessions: [workout("deleted", 0, "deleted"), workout("future", 0, "future")] },
  ].map((block) => ({
    ...block, user_id: USER, archetype: "custom", notes: block.id, program_id: "authored",
    started_on: "2026-06-01", weeks: 2, days_per_week: 2, status: "active", deleted_at: null,
    power_emphasis: false, program_family: "authored", ended_at: null,
  }));
  const requests: URL[] = [];
  const client = createClient("https://stats-fixture.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const table = url.pathname.split("/").at(-1);
      let data: unknown = [];
      if (table === "training_blocks") {
        const id = url.searchParams.get("id")?.slice(3);
        data = id ? blocks.find((row) => row.id === id) ?? null : blocks;
      } else if (table === "planned_sessions") {
        const blockId = url.searchParams.get("block_id")?.slice(3);
        data = blocks.filter((block) => !blockId || block.id === blockId).flatMap((block) =>
          block.planned_sessions.map((row) => ({ ...row, block_id: block.id, training_blocks: block })));
      }
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    } },
  });
  return { client, requests };
}

afterEach(() => vi.useRealTimers());

describe("independent program progress reads", () => {
  it("returns every owned active program and counts only completed, visible workouts", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-06-07T12:00:00Z"));
    const { client, requests } = fixture();
    const result = await getActiveBlocksProgress(client, USER, "UTC");
    expect(result.map((row) => [row.blockId, row.totalScheduled, row.scheduledToDate, row.logged, row.skipped])).toEqual([
      ["strength", 2, 2, 1, 0], ["running", 2, 2, 1, 1], ["hybrid", 2, 1, 0, 0],
    ]);
    expect(result.map((row) => [row.blockId, row.streak.weeklyTarget, row.streak.thisWeekCompleted])).toEqual([
      ["strength", 2, 1], ["running", 2, 1], ["hybrid", 2, 0],
    ]);
    expect(requests.every((url) => url.pathname.endsWith("/training_blocks"))).toBe(true);
    expect(requests[0]!.searchParams.get("user_id")).toBe(`eq.${USER}`);
    expect(requests[0]!.searchParams.get("status")).toBe("eq.active");
    expect(requests[0]!.searchParams.get("deleted_at")).toBe("is.null");
    expect(requests[0]!.searchParams.has("limit")).toBe(false);
    expect(requests[0]!.searchParams.get("select")).toContain("completed_at");
  });

  it("does not carry another program's completed weeks into the owning program's streak", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-06-08T12:00:00Z"));
    const { client } = fixture();
    const result = await getActiveBlocksProgress(client, USER, "UTC");
    expect(result.every((row) => row.streak.currentStreakWeeks === 0)).toBe(true);
    expect(result.every((row) => row.streak.thisWeekCompleted === 0)).toBe(true);
  });

  it("uses the user's calendar date before offering a future program's weekly target", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-06-01T00:30:00Z"));
    const { client } = fixture();
    const result = await getActiveBlocksProgress(client, USER, "America/Los_Angeles");
    expect(result.every((row) => row.scheduledToDate === 0 && row.logged === 0)).toBe(true);
    expect(result.every((row) => row.streak.weeklyTarget === 0 && row.streak.thisWeekCompleted === 0)).toBe(true);
  });

  it("keeps overview, detail, program analytics and history on the same completed-workout contract", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-06-07T12:00:00Z"));
    const { client, requests } = fixture();
    const [month, all, detail, strength, index] = await Promise.all([
      getAdherence30d(client, USER, "UTC"), getAdherenceForWindow(client, USER, "UTC", null),
      getWeeklyAdherence(client, USER, "UTC", "all"),
      getBlockAdherence(client, "strength", USER, "2026-06-07"), getBlockIndex(client, USER, "2026-06-07"),
    ]);
    expect(month).toMatchObject({ completed: 2, scheduled: 5, skipped: 1 });
    expect(all).toEqual(month);
    expect(detail.reduce((sum, week) => sum + week.logged, 0)).toBe(2);
    expect(strength).toMatchObject({ completed: 1, scheduled: 2 });
    expect(index.map((row) => [row.id, row.totalSessions, row.loggedSessions, row.skippedSessions])).toEqual([
      ["strength", 2, 1, 0], ["running", 2, 1, 1], ["hybrid", 2, 0, 0],
    ]);
    const completionReads = requests.filter((url) => url.searchParams.get("select")?.includes("completed_session_id"));
    expect(completionReads.length).toBeGreaterThan(0);
    for (const url of completionReads) expect(url.searchParams.get("select")).toContain("completed_at");
  });

  it("surfaces failed progress reads instead of showing an empty successful result", async () => {
    const client = createClient("https://stats-fixture.invalid", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => new Response(JSON.stringify({ message: "read failed" }), { status: 400 }) },
    });
    await expect(getActiveBlocksProgress(client, USER, "UTC")).rejects.toThrow("read failed");
    await expect(getBlockIndex(client, USER, "2026-06-07")).rejects.toThrow("read failed");
  });
});
