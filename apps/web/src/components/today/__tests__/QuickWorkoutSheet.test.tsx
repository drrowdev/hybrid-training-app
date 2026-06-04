import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QuickWorkoutSheet } from "../QuickWorkoutSheet";
import type { QuickRepeatCandidate } from "@/lib/sessions/queries";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const noop = async () => "00000000-0000-4000-8000-0000000000ff";
const genNoop = async (_: { length: "short" | "normal" }) =>
  "00000000-0000-4000-8000-0000000000fe";

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
        startStrength={noop}
        repeatRecent={noop}
        generateStrength={genNoop}
      />,
    );
    expect(html).toBe("");
  });

  it("renders the Generate (Short/Normal) tiles plus the Start-empty tile", () => {
    const html = renderToStaticMarkup(
      <QuickWorkoutSheet
        open
        onClose={() => {}}
        recent={[]}
        startStrength={noop}
        repeatRecent={noop}
        generateStrength={genNoop}
      />,
    );
    expect(html).toContain('data-testid="quick-workout-generate"');
    expect(html).toContain('data-testid="quick-tile-generate-short"');
    expect(html).toContain('data-testid="quick-tile-generate-normal"');
    expect(html).toContain(">Short<");
    expect(html).toContain(">Normal<");
    expect(html).toContain("~30 min");
    expect(html).toContain("up to ~60 min");
    expect(html).toContain('data-testid="quick-workout-tiles"');
    expect(html).toContain('data-testid="quick-tile-strength"');
    expect(html).toContain(">Start empty<");
    expect(html).not.toContain('data-testid="quick-tile-run"');
    expect(html).not.toContain('data-testid="quick-tile-ride"');
    expect(html).not.toContain('data-testid="quick-tile-other"');
    expect(html).toContain("Quick workout");
    expect(html).toContain("won&#x27;t replace your planned");
  });

  it("never renders a cardio duration picker row", () => {
    const html = renderToStaticMarkup(
      <QuickWorkoutSheet
        open
        onClose={() => {}}
        recent={[]}
        startStrength={noop}
        repeatRecent={noop}
        generateStrength={genNoop}
      />,
    );
    expect(html).not.toContain('data-testid="quick-duration-row"');
    expect(html).not.toContain('data-testid="quick-duration-30"');
  });

  it("hides the recent list entirely when there are no recents", () => {
    const html = renderToStaticMarkup(
      <QuickWorkoutSheet
        open
        onClose={() => {}}
        recent={[]}
        startStrength={noop}
        repeatRecent={noop}
        generateStrength={genNoop}
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
            title: "Leg day",
            summary: "5 movements · 15 sets",
          }),
        ]}
        startStrength={noop}
        repeatRecent={noop}
        generateStrength={genNoop}
      />,
    );
    expect(html).toContain('data-testid="quick-workout-recent"');
    expect(html).toContain('data-testid="quick-recent-11111111-0000-4000-8000-000000000001"');
    expect(html).toContain('data-testid="quick-recent-11111111-0000-4000-8000-000000000002"');
    expect(html).toContain('data-testid="quick-recent-repeat-11111111-0000-4000-8000-000000000001"');
    expect(html).toContain("Tuesday push");
    expect(html).toContain("Leg day");
    expect(html).toContain("5 movements · 15 sets");
    expect(html).toContain("Repeat");
  });
});