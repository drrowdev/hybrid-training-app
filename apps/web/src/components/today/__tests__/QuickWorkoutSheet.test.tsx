import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QuickWorkoutSheet } from "../QuickWorkoutSheet";
import type { QuickRepeatCandidate } from "@/lib/sessions/queries";

const noop = async () => {};

function candidate(over: Partial<QuickRepeatCandidate> = {}): QuickRepeatCandidate {
  return {
    id: over.id ?? "10000000-0000-4000-8000-000000000001",
    title: over.title ?? "Tuesday push",
    performedAt: over.performedAt ?? "2026-05-05T10:00:00Z",
    summary: over.summary ?? "4 movements · 12 sets",
  };
}

describe("QuickWorkoutSheet", () => {
  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      <QuickWorkoutSheet
        open={false}
        onClose={() => {}}
        recent={[]}
        startCardio={noop}
        startStrength={noop}
        repeatRecent={noop}
      />,
    );
    expect(html).toBe("");
  });

  it("renders the four picker tiles when open", () => {
    const html = renderToStaticMarkup(
      <QuickWorkoutSheet
        open
        onClose={() => {}}
        recent={[]}
        startCardio={noop}
        startStrength={noop}
        repeatRecent={noop}
      />,
    );
    expect(html).toContain('data-testid="quick-workout-tiles"');
    expect(html).toContain('data-testid="quick-tile-run"');
    expect(html).toContain('data-testid="quick-tile-ride"');
    expect(html).toContain('data-testid="quick-tile-strength"');
    expect(html).toContain('data-testid="quick-tile-other"');
    // The four tile labels.
    expect(html).toContain(">Run<");
    expect(html).toContain(">Ride<");
    expect(html).toContain(">Strength<");
    expect(html).toContain(">Other<");
    // Title + framing copy from the spec.
    expect(html).toContain("Quick workout");
    expect(html).toContain("won&#x27;t replace your planned");
  });

  it("hides the recent list entirely when there are no recents", () => {
    const html = renderToStaticMarkup(
      <QuickWorkoutSheet
        open
        onClose={() => {}}
        recent={[]}
        startCardio={noop}
        startStrength={noop}
        repeatRecent={noop}
      />,
    );
    expect(html).not.toContain('data-testid="quick-workout-recent"');
    expect(html).not.toContain(">Recent<");
  });

  it("renders the recent list with a Repeat button per row when recents exist", () => {
    const html = renderToStaticMarkup(
      <QuickWorkoutSheet
        open
        onClose={() => {}}
        recent={[
          candidate({ id: "11111111-0000-4000-8000-000000000001", title: "Tuesday push" }),
          candidate({
            id: "11111111-0000-4000-8000-000000000002",
            title: "Easy run",
            summary: "Run · 32 min",
          }),
        ]}
        startCardio={noop}
        startStrength={noop}
        repeatRecent={noop}
      />,
    );
    expect(html).toContain('data-testid="quick-workout-recent"');
    expect(html).toContain('data-testid="quick-recent-11111111-0000-4000-8000-000000000001"');
    expect(html).toContain('data-testid="quick-recent-11111111-0000-4000-8000-000000000002"');
    expect(html).toContain('data-testid="quick-recent-repeat-11111111-0000-4000-8000-000000000001"');
    expect(html).toContain("Tuesday push");
    expect(html).toContain("Easy run");
    expect(html).toContain("Run · 32 min");
    expect(html).toContain("Repeat");
  });
});
