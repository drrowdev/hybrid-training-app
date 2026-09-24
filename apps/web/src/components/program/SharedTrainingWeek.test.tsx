import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ScheduleSnapshot } from "@/lib/schedule/storage";
import type { ThisWeekRailProps } from "@/components/plan/ThisWeekRail";
import { SharedTrainingWeek } from "./SharedTrainingWeek";
import { TrainingWeek } from "./TrainingWeek";
import type { StandaloneSwimState } from "@/lib/swim/standalone-state";

const mocks = vi.hoisted(() => ({
  load: vi.fn<() => Promise<ScheduleSnapshot | null>>(),
  active: vi.fn(async () => [{ id: "block-a", programId: "authored", archetype: null, notes: "Strength" }]),
  swim: vi.fn<() => Promise<Map<string, StandaloneSwimState>>>(async () => new Map()),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})), getAuthUser: vi.fn(async () => ({ data: { user: { id: "owner" } } })),
}));
vi.mock("@/lib/swim/standalone-state", () => ({ loadStandaloneSwimStates: mocks.swim }));
vi.mock("@/lib/schedule/storage", () => ({ loadAvailableTrainingSchedule: mocks.load }));
vi.mock("@/lib/planner/queries", () => ({
  getActiveBlocks: mocks.active,
  archetypeDisplayName: (_archetype: string | null, notes: string | null) => notes ?? "Program",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const snapshot: ScheduleSnapshot = {
  revision: "a".repeat(32),
  entries: [
    { id: "primary-a", source: "primary", programId: "block-a", date: "2026-09-22", title: "Strength A", state: "scheduled" },
    { id: "swim-a", source: "swim", programId: "swim-plan", date: "2026-09-22", title: "Swim A", state: "scheduled" },
  ],
};

const primaryWeek: ThisWeekRailProps = {
  sessions: [{
    id: "primary-a", weekIndex: 0, dayIndex: 1, date: "2026-09-22", title: "Strength A",
    isCardio: false, isStrength: true, isRehab: false, done: false, inProgress: false,
    skipped: false, slot: "single", items: [], estDurationMin: 30, notes: null, completedSessionId: null,
  }],
  today: "2026-09-22", currentWeekIndex: 0, weeks: 4, logHrefBase: "/app/sessions/start",
  moveAction: () => undefined, skipAction: () => undefined, unskipAction: () => undefined,
  updateNotesAction: async () => ({ ok: true }), startSessionAction: () => undefined,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(snapshot);
  mocks.active.mockResolvedValue([{ id: "block-a", programId: "authored", archetype: null, notes: "Strength" }]);
});

describe("SharedTrainingWeek", () => {
  it("renders each program once in one Home week and keeps primary preview links", async () => {
    const html = renderToStaticMarkup(await SharedTrainingWeek({ today: primaryWeek.today, primaryWeek }));
    expect(html.match(/>This week</g)).toHaveLength(1);
    expect(html.match(/>Strength A</g)).toHaveLength(1);
    expect(html.match(/>Swim A</g)).toHaveLength(1);
    expect(html).toContain('href="#session=primary-a"');
    expect(html).toContain('href="/app/swim/swim-a?from=today"');
    expect(html).toContain('data-testid="today-week-strip"');
    expect(html).not.toContain('data-testid="plan-this-week"');
  });

  it("retains the existing week during the app-first migration gap", async () => {
    mocks.load.mockResolvedValue(null);
    const html = renderToStaticMarkup(await SharedTrainingWeek({ today: primaryWeek.today, primaryWeek }));
    expect(html.match(/>This week</g)).toHaveLength(1);
    expect(html).toContain('data-testid="plan-this-week"');
    expect(html).toContain("Strength A");
    expect(html).not.toContain("Swim A");
  });

  it("DC-R5 keeps all three authored programs and Swimming in the same week with owned edit links", async () => {
    mocks.active.mockResolvedValue([
      { id: "block-a", programId: "authored", archetype: null, notes: "Strength" },
      { id: "block-b", programId: "authored", archetype: null, notes: "Running" },
      { id: "block-c", programId: "authored", archetype: null, notes: "Hybrid" },
    ]);
    mocks.load.mockResolvedValue({ ...snapshot, entries: [...snapshot.entries,
      { ...snapshot.entries[0]!, id: "running-a", programId: "block-b", title: "Easy run" },
      { ...snapshot.entries[0]!, id: "hybrid-a", programId: "block-c", title: "Mixed session" },
    ] });
    const html = renderToStaticMarkup(await SharedTrainingWeek({ today: primaryWeek.today }));
    for (const [block, workout] of [["block-a", "primary-a"], ["block-b", "running-a"], ["block-c", "hybrid-a"]]) {
      expect(html).toContain(`href="/app/program/build?edit=${block}&amp;workout=${workout}"`);
      expect(html).toContain(`href="/app/sessions/start/${workout}"`);
    }
    expect(html).toContain('href="/app/swim/swim-a?from=today"');
  });

  it("leaves other callers' primary workout destinations unchanged", async () => {
    const html = renderToStaticMarkup(await SharedTrainingWeek({ today: primaryWeek.today }));
    expect(html).toContain('href="/app/sessions/start/primary-a"');
    expect(html).not.toContain('href="#session=');
    expect(html).not.toContain('data-testid="today-week-strip"');
  });

  it("keeps direct navigation for active, completed and unavailable-to-preview sessions", () => {
    const entries: ScheduleSnapshot["entries"] = [
      { ...snapshot.entries[0]!, id: "started", state: "started" },
      { ...snapshot.entries[0]!, id: "completed", state: "completed" },
      { ...snapshot.entries[0]!, id: "outside-active-block" },
    ];
    const html = renderToStaticMarkup(<TrainingWeek entries={entries} today={primaryWeek.today}
      sessionLinks={{ started: "live-session", completed: "finished-session" }}
      primaryPreviewIds={["started", "completed"]} />);
    expect(html).toContain('href="/app/sessions/live-session"');
    expect(html).toContain('href="/app/sessions/finished-session"');
    expect(html).toContain('href="/app/sessions/start/outside-active-block"');
    expect(html).not.toContain('href="#session=');
  });

  it("does not convert a failed schedule read into the legacy fallback", async () => {
    mocks.load.mockRejectedValue(new Error("schedule unavailable"));
    await expect(SharedTrainingWeek({ today: primaryWeek.today, primaryWeek })).rejects.toThrow();
  });

  it("retains the missing-snapshot behavior for callers without a primary rail", async () => {
    mocks.load.mockResolvedValue(null);
    expect(await SharedTrainingWeek({ today: primaryWeek.today })).toBeNull();
  });
  it.each(["completed", "stopped_early", "needs_review", "scheduled"] as const)(
    "DC-SW5 shares the %s label without changing schedule occupancy or primary actions", (status) => {
      const html = renderToStaticMarkup(<TrainingWeek entries={snapshot.entries} today={primaryWeek.today}
        swimStatuses={{ "swim-a": status }} />);
      expect(html).toContain(`>${({ completed: "Completed", stopped_early: "Stopped early", needs_review: "Review recording", scheduled: "Start workout" })[status]}</span>`);
      expect(html).toContain('href="/app/swim/swim-a?from=today"');
      expect(html).toContain('href="/app/sessions/start/primary-a"');
      expect(snapshot.entries[1]!.state).toBe("scheduled");
    },
  );
});
