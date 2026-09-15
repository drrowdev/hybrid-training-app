import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { conditioningSwimView } from "@/lib/swim/conditioning-view";
import { swimFixture } from "@/lib/swim/__tests__/fixtures";
import { PlanRedesign, SessionDrawer, type PlanSessionInput } from "../PlanRedesign";
import { buildWeekRailRows, RailList } from "../ThisWeekRail";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
const noop = () => {};
const swim = conditioningSwimView({
  ...swimFixture().workouts[0]!, planned_session_id: "planned", block_id: "block",
  plan_status: "active", block_status: "active", block_deleted_at: null, visible_session_id: null,
  native_completed_at: null, outcome_match_id: "match", outcome_metadata: {
    outcome: "stopped_early", previousOutcomeId: null, workoutRevision: 1,
  }, current_match_id: "match", matched_import_id: "recording", matched_workout_revision: 1,
  latest_import_id: "recording", recording_date: "2026-09-07",
});
const session: PlanSessionInput = {
  id: "planned", weekIndex: 0, dayIndex: 0, date: "2026-09-07", title: "Week 1 A",
  isCardio: true, isStrength: false, done: false, skipped: false, slot: "single",
  items: [{ movementId: "", kind: "cardio_external" }], estDurationMin: null, notes: null, swim,
};
describe("linked swimming in the shared plan", () => {
  it("exposes the linked primary identity in the programme schedule, not the Today-only rail", () => {
    const html = renderToStaticMarkup(<PlanRedesign archetypeName="Synthetic programme"
      startedOn="2026-09-07" weeks={3} today="2026-09-07" currentWeekIndex={0}
      sessions={[session]} view="timeline" moveAction={noop} skipAction={noop} unskipAction={noop}
      updateNotesAction={async () => ({ ok: true })} />);
    expect(html.match(/data-testid="plan-pill-planned"/g)).toHaveLength(1);
    expect(html).not.toContain('data-testid="plan-rail-');
    expect(html).toContain('class="plan-agenda-session"');
    expect(html).toContain('draggable="false"');
  });
  it.each([true, false])("uses the existing drawer without native completion controls (logging=%s)", (allowLogging) => {
    const html = renderToStaticMarkup(<SessionDrawer session={session} allowLogging={allowLogging}
      today="2026-09-15" weeks={3} onClose={noop} moveAction={noop} skipAction={noop} unskipAction={noop}
      updateNotesAction={async () => ({ ok: true })} startSessionAction={noop} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain(`href="/app/swim/${swim.id}?from=${allowLogging ? "today" : "plan"}"`);
    expect(html).toContain(swim.distance);
    expect(html).toContain("Stopped early");
    for (const control of ["mark-done", "edit", "skip", "swap", "notes"]) {
      expect(html).not.toContain(`data-testid="plan-drawer-${control}"`);
    }
    expect(html).not.toContain("/app/sessions/start");
    expect(html).not.toContain("Overdue");
  });
  it("renders one rail entry and does not award a completion for stopping early", () => {
    const html = renderToStaticMarkup(<RailList rail={buildWeekRailRows([session], 0)}
      today="2026-09-15" onOpen={noop} />);
    expect(html.match(/Week 1 A/g)).toHaveLength(1);
    expect(html).toContain("Stopped early");
    expect(html).not.toContain('aria-label="Done"');
    expect(html).not.toContain("Overdue");
  });
});
