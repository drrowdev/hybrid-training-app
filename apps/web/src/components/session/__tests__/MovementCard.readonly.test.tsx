/**
 * Render contract for the completed-session read-only set breakdown.
 *
 * The web test env is Node (no JSDOM), so we assert static markup via
 * `renderToStaticMarkup` against the exported pure `ReadOnlySetList`
 * helper — mirroring the LastSetHintRow approach. The live wiring
 * (collapse-by-default, edit suppression on completed sessions) is
 * exercised in the Playwright spec; here we pin the presentational
 * contract: per-set weight × reps + RPE, skipped flagging, and the
 * empty state.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReadOnlySetList } from "../MovementCard";
import type { MovementGroup } from "@/lib/sessions/movement-grouping";
import type { FocusLoggedSet } from "../MovementFocusView";

const group = { movementId: "m1", movementName: "Front Squat" } as MovementGroup;

function set(over: Partial<FocusLoggedSet> = {}): FocusLoggedSet {
  return {
    id: "s1",
    weightKg: 85,
    reps: 5,
    distanceM: null,
    durationSec: null,
    rpe: 8,
    skipped: false,
    skipReason: null,
    ...over,
  };
}

describe("ReadOnlySetList", () => {
  it("renders each logged set with weight × reps and RPE", () => {
    const html = renderToStaticMarkup(
      <ReadOnlySetList
        group={group}
        loggedSets={[set({ id: "a", weightKg: 85, reps: 5, rpe: 8 })]}
      />,
    );
    expect(html).toContain('data-testid="movement-card-readonly-sets-m1"');
    expect(html).toContain("Set 1");
    expect(html).toContain("85 kg × 5");
    expect(html).toContain("RPE 8");
  });

  it("flags a skipped set with its reason and no RPE", () => {
    const html = renderToStaticMarkup(
      <ReadOnlySetList
        group={group}
        loggedSets={[set({ id: "b", skipped: true, skipReason: "fatigue", rpe: null })]}
      />,
    );
    expect(html).toContain("Skipped");
    expect(html).toContain("fatigue");
    expect(html).not.toContain("RPE");
  });

  it("renders the empty state when no sets were logged", () => {
    const html = renderToStaticMarkup(
      <ReadOnlySetList group={group} loggedSets={[]} />,
    );
    expect(html).toContain('data-testid="movement-card-readonly-empty-m1"');
    expect(html).toContain("No sets were logged");
  });

  it("adds an Edit link per logged set when sessionId is provided", () => {
    const html = renderToStaticMarkup(
      <ReadOnlySetList
        group={group}
        sessionId="sess-1"
        loggedSets={[set({ id: "a", weightKg: 85, reps: 5, rpe: 8 })]}
      />,
    );
    expect(html).toContain('data-testid="readonly-set-edit-a"');
    expect(html).toContain('href="/app/sessions/sess-1/sets/a/edit"');
  });

  it("does not add an Edit link for skipped sets", () => {
    const html = renderToStaticMarkup(
      <ReadOnlySetList
        group={group}
        sessionId="sess-1"
        loggedSets={[set({ id: "b", skipped: true, skipReason: "fatigue", rpe: null })]}
      />,
    );
    expect(html).not.toContain('data-testid="readonly-set-edit-b"');
  });

  it("omits Edit links entirely without sessionId (in-session recap)", () => {
    const html = renderToStaticMarkup(
      <ReadOnlySetList group={group} loggedSets={[set({ id: "a" })]} />,
    );
    expect(html).not.toContain("readonly-set-edit-");
  });
});
