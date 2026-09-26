import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { ActiveBlock, PlannedDay } from "@/lib/planner/queries";
import { loadAvailableTrainingSchedule } from "@/lib/schedule/storage";
import { loadScheduleSessionLinks } from "@/lib/schedule/session-links";
import { loadTodayWeek, plannedTodayWorkout, plannedWeekSession } from "./workouts";

vi.mock("@/lib/planner/queries", () => ({ archetypeDisplayName: () => "Strength plan" }));
vi.mock("@/lib/sessions/queries", () => ({ summariseSessionSets: vi.fn() }));
vi.mock("@/lib/swim/queries", () => ({ loadSwimHistory: vi.fn(), workoutTrainingState: vi.fn() }));
vi.mock("@/lib/schedule/storage", () => ({ loadAvailableTrainingSchedule: vi.fn() }));
vi.mock("@/lib/schedule/session-links", () => ({ loadScheduleSessionLinks: vi.fn() }));

const client = createClient("https://example.supabase.co", "test-key");
const block: ActiveBlock = {
  id: "block", archetype: "strength_anchor", programKind: "strength", startedOn: "2026-09-23",
  weeks: 4, status: "active", notes: null, programId: null, programFamily: null,
  focusMuscles: [], powerEmphasis: false,
};
const planned: PlannedDay = {
  id: "workout", blockId: block.id, weekIndex: 0, dayIndex: 4, slot: "am", plannedAt: null,
  title: "Squat", role: "squat", prescription: { items: [] }, completedSessionId: null,
  completedAt: null, skippedAt: null, notes: null, date: "2026-09-25",
};
beforeEach(() => {
  vi.mocked(loadScheduleSessionLinks).mockResolvedValue({});
  vi.mocked(loadAvailableTrainingSchedule).mockResolvedValue(null);
});
describe("Today workout adapters", () => {
  it("retains the shared drawer's notes, slot, prescription and session state", () => {
    const input = { ...planned, notes: "Keep the last set controlled.", completedSessionId: "started",
      prescription: { items: [{ movementId: "squat", kind: "main" as const, sets: 3, reps: 5 }] } };
    expect(plannedWeekSession(input, [block])).toMatchObject({
      id: planned.id, date: planned.date, title: "Squat", slot: "am", items: input.prescription.items,
      notes: input.notes, completedSessionId: "started", inProgress: true, done: false,
      isCardio: false, isStrength: true, isRehab: false, skipped: false,
    });
    expect(plannedWeekSession({ ...input, completedAt: planned.date }, [block]))
      .toMatchObject({ done: true, inProgress: false });
    expect(plannedWeekSession({ ...input, role: "rehab", skippedAt: planned.date }, [block]))
      .toMatchObject({ isRehab: true, isStrength: false, skipped: true });
    expect(plannedWeekSession({ ...planned, prescription: { items: [
      { movementId: "run", kind: "cardio_z2", durationMin: 30 },
    ] } }, [block])).toMatchObject({ isCardio: true, isStrength: false });
  });
  it("preserves start, resume, completed and trash destinations", () => {
    expect(plannedTodayWorkout(planned, [block], []).href).toBe("/app/sessions/start/workout");
    const started = plannedTodayWorkout({ ...planned, completedSessionId: "session" }, [block], []);
    expect(started).toMatchObject({ done: false, href: "/app/sessions/session", action: "Continue workout" });
    expect(started.options).toBeUndefined();
    expect(plannedTodayWorkout({ ...planned, completedSessionId: "session", completedAt: "2026-09-25" }, [block], []))
      .toMatchObject({ done: true, href: "/app/sessions/session" });
    const deleted = plannedTodayWorkout({ ...planned, deletedCompletedSessionId: "deleted" }, [block], []);
    expect(deleted).toMatchObject({ done: false, action: "Restore workout" });
    expect(deleted.href).toBe("/app/settings/trash");
    expect(deleted.options).toBeUndefined();
  });
  it("offers swaps only for another unstarted same-program same-slot workout", () => {
    const candidate = { ...planned, id: "target", date: "2026-09-26" };
    const workout = plannedTodayWorkout(planned, [block], [planned, candidate,
      { ...candidate, id: "other-program", blockId: "other" },
      { ...candidate, id: "other-slot", slot: "pm" },
      { ...candidate, id: "started", completedSessionId: "session" },
      { ...candidate, id: "skipped", skippedAt: "2026-09-24" },
      { ...candidate, id: "rest", role: "rest" },
    ]);
    expect(workout.options).toMatchObject({ swapDates: [{ date: "2026-09-26", title: "Squat" }] });
  });
  it("uses canonical week dates and session links, including off-plan workouts", async () => {
    vi.mocked(loadAvailableTrainingSchedule).mockResolvedValue({ revision: "revision", entries: [
      { id: "workout", source: "primary", programId: "block", date: "2026-09-24", title: "Squat", state: "completed" },
      { id: "off-plan", source: "session", programId: null, date: "2026-09-22", title: "Quick strength", state: "completed" },
      { id: "rest", source: "primary", programId: "block", date: "2026-09-26", title: "Rest", state: "rest" },
    ] });
    vi.mocked(loadScheduleSessionLinks).mockResolvedValue({ workout: "logged" });
    const week = await loadTodayWeek(client, [block], [plannedTodayWorkout(planned, [block], [])]);
    expect(week).toHaveLength(2);
    expect(week[0]).toMatchObject({ date: "2026-09-24", done: true, href: "/app/sessions/logged" });
    expect(week[1]).toMatchObject({ date: "2026-09-22", done: true, href: "/app/sessions/off-plan" });
  });
  it("retains standalone swim outcome status rather than native schedule status", async () => {
    vi.mocked(loadAvailableTrainingSchedule).mockResolvedValue({ revision: "revision", entries: [
      { id: "swim", source: "swim", programId: "pool", date: "2026-09-24", title: "Swim", state: "scheduled" },
    ] });
    const workout = { ...plannedTodayWorkout(planned, [block], []), id: "swim", done: true,
      date: "2026-09-25", href: "/app/swim/recordings/import" };
    expect(await loadTodayWeek(client, [block], [workout])).toEqual([workout]);
  });
  it("allows only the existing migration-gap fallback and propagates read errors", async () => {
    const fallback = [plannedTodayWorkout(planned, [block], [])];
    expect(await loadTodayWeek(client, [block], fallback)).toEqual(fallback);
    vi.mocked(loadAvailableTrainingSchedule).mockRejectedValueOnce(new Error("Read failed"));
    await expect(loadTodayWeek(client, [block], fallback)).rejects.toThrow("Read failed");
  });
});
