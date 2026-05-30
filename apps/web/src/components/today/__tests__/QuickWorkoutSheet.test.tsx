import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
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

  it("source: cardio tiles open the inline duration row before submitting", () => {
    // The Node-only vitest env can't simulate clicks. Verify the
    // contract at the source level: the sheet wires Run / Ride /
    // Other tiles to `openDuration(...)`, NEVER to a direct
    // `startCardio({ modality })` (which would skip the duration
    // prompt and revive the 30-min default).
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      path.resolve(here, "..", "QuickWorkoutSheet.tsx"),
      "utf8",
    );

    // Each cardio tile must hand off to openDuration().
    expect(src).toMatch(/onClick=\{\(\) => openDuration\("run", "run"\)\}/);
    expect(src).toMatch(/onClick=\{\(\) => openDuration\("bike", "ride"\)\}/);

    // No tile should fire startCardio directly with just a modality —
    // that pattern was the original bug.
    expect(src).not.toMatch(/startCardio\(\{\s*modality:\s*"run"\s*\}\)/);
    expect(src).not.toMatch(/startCardio\(\{\s*modality:\s*"bike"\s*\}\)/);

    // startCardio must always be called WITH durationMin from the
    // duration picker callback.
    expect(src).toMatch(/startCardio\(\{\s*modality:\s*durationFor\.modality,\s*durationMin\s*\}\)/);

    // Duration chips: 30 / 45 / 60 / 90 + Custom.
    for (const min of [30, 45, 60, 90]) {
      expect(src).toMatch(new RegExp(`\\{\\s*min:\\s*${min}\\b`));
    }
    expect(src).toMatch(/data-testid="quick-duration-custom"/);
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

  it("does NOT render the duration picker row until a cardio tile is tapped", () => {
    // Initial SSR render: no chip row visible. We can't simulate
    // clicks in static-markup tests, but the absence of the testId on
    // the first render is the regression contract that matters — the
    // sheet must NOT submit anything before the user picks a duration.
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
    expect(html).not.toContain('data-testid="quick-duration-row"');
    expect(html).not.toContain('data-testid="quick-duration-30"');
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
