import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrainingMonth, ScheduleViewToggle } from "./TrainingMonth";
import type { ThisWeekRailProps } from "@/components/plan/ThisWeekRail";
import type { TodayWeekWorkout } from "@/components/today/TodayDashboard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/plan/ThisWeekRail", () => ({ ThisWeekRail: () => null }));

const workout: TodayWeekWorkout = {
  id: "strength", title: "Lower B", date: "2026-09-25", program: "Strength",
  programId: "strength", kind: "strength", done: false, href: "/app/sessions/start/strength",
};
const preview: ThisWeekRailProps = {
  sessions: [{ id: "strength", title: workout.title, date: workout.date, weekIndex: 0, dayIndex: 4,
    isCardio: false, isStrength: true, done: false, skipped: false, slot: "am", items: [], estDurationMin: 30, notes: null }],
  today: workout.date, currentWeekIndex: 0, weeks: 4, logHrefBase: "/app/sessions/start",
  moveAction: vi.fn(), skipAction: vi.fn(), unskipAction: vi.fn(), startSessionAction: vi.fn(),
  updateNotesAction: async () => ({ ok: true }),
};

describe("Shared schedule month", () => {
  it("keeps every program on its actual date and opens the same planned preview", () => {
    const html = renderToStaticMarkup(<TrainingMonth today={workout.date} preview={preview} workouts={[
      workout,
      { ...workout, id: "run", kind: "running", title: "Easy run", href: "/app/sessions/run" },
      { ...workout, id: "swim", kind: "swimming", title: "Endurance swim", date: "2026-09-26", href: "/app/swim/swim?from=today" },
      { ...workout, id: "hybrid", kind: "hybrid", title: "Mixed workout", date: "2026-09-27", href: "/app/sessions/hybrid" },
    ]} />);
    expect(html).toContain('href="#session=strength"');
    expect(html).not.toContain('href="/app/sessions/start/strength"');
    expect(html).toContain('href="/app/swim/swim?from=today"');
    for (const kind of ["strength", "running", "swimming", "hybrid"]) expect(html).toContain(`data-kind="${kind}"`);
    expect(html).toContain('aria-label="Open Endurance swim, Saturday 26 Sept"');
    expect(html).toContain('aria-label="Open Mixed workout, Sunday 27 Sept"');
  });
  it("offers real URLs for both views and marks only the selected one", () => {
    for (const month of [false, true]) {
      const html = renderToStaticMarkup(<ScheduleViewToggle month={month} />);
      expect(html).toContain('href="/app/plan"');
      expect(html).toContain('href="/app/plan?view=month"');
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      expect(html).toMatch(month ? /aria-current="page"[^>]*>Month/ : /aria-current="page"[^>]*>Week/);
    }
  });
});
