/**
 * The warm-up settings preview must show the ladder that is actually
 * stored / being typed. Routing generation through `resolveWarmupScheme`
 * made the preview render the upgraded default while the Custom inputs
 * above it still showed the stored ladder — the UI contradicting itself.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LEGACY_DEFAULT_WARMUP_SCHEME,
  type WarmupScheme,
} from "@/lib/planner/warmups";
import { WarmupSettings } from "../WarmupSettings";

vi.mock("@/lib/settings/warmup-actions", () => ({
  updateWarmupScheme: vi.fn(async () => ({ ok: true })),
}));

describe("WarmupSettings preview", () => {
  it("previews the stored legacy ladder verbatim, not the upgraded default", () => {
    const html = renderToStaticMarkup(
      <WarmupSettings initial={LEGACY_DEFAULT_WARMUP_SCHEME} />,
    );

    // 85% top set × 40/50/60 → 34 / 42.5 / 51, reps 5/3/2.
    expect(html).toContain("34% TM × 5");
    expect(html).toContain("42.5% TM × 3");
    expect(html).toContain("51% TM × 2");
    // The 40/60/80 × 5/5/3 default would render these instead.
    expect(html).not.toContain("51% TM × 5");
    expect(html).not.toContain("68% TM");
  });

  it("keeps the Custom inputs and the preview in agreement", () => {
    const custom: WarmupScheme = {
      setCount: 3,
      percentLadder: [40, 50, 65],
      repLadder: [5, 3, 2],
    };
    const html = renderToStaticMarkup(<WarmupSettings initial={custom} />);

    // Custom mode: the raw ladder inputs are editable and visible...
    expect(html).toContain('data-testid="warmup-percent-0"');
    expect(html).toContain('value="40"');
    expect(html).toContain('value="50"');
    expect(html).toContain('value="65"');
    // ...and the preview directly below is that exact ladder at 85% TM.
    expect(html).toContain("34% TM × 5");
    expect(html).toContain("42.5% TM × 3");
    expect(html).toContain("55.5% TM × 2");
  });

  it("shows BOTH number spaces so the ladder never looks ignored", () => {
    // The reported confusion: a 40/60/80 ladder previewed as "34% TM", which
    // reads like the setting was overridden. Naming the anchor makes the
    // relationship between the two percentages explicit.
    const html = renderToStaticMarkup(
      <WarmupSettings
        initial={{ setCount: 3, percentLadder: [40, 60, 80], repLadder: [5, 5, 3] }}
      />,
    );
    expect(html).toContain("40% of top set = 34% TM");
    expect(html).toContain("60% of top set = 51% TM");
    expect(html).toContain("80% of top set = 68% TM");
  });
});

describe("WarmupSettings — DC-K4 override-and-warn", () => {
  const OWNERS = [{ id: "wendler-531", name: "5/3/1" }];

  it("warns which program's own warm-up a configured ladder replaces", () => {
    // DC-K4: overriding a principle-derived default must be surfaced, never
    // applied silently.
    const html = renderToStaticMarkup(
      <WarmupSettings
        initial={{ setCount: 2, percentLadder: [50, 75], repLadder: [5, 3] }}
        programsWithOwnRamp={OWNERS}
      />,
    );
    expect(html).toContain('data-testid="warmup-program-override-warning"');
    expect(html).toContain("5/3/1");
    expect(html).toContain("Follow the program");
  });

  it("does not warn when the lifter is following the program", () => {
    const html = renderToStaticMarkup(
      <WarmupSettings initial={null} programsWithOwnRamp={OWNERS} />,
    );
    expect(html).not.toContain('data-testid="warmup-program-override-warning"');
  });

  it('a cleared preference selects "Follow the program" and previews no single ladder', () => {
    const html = renderToStaticMarkup(
      <WarmupSettings initial={null} programsWithOwnRamp={OWNERS} />,
    );
    expect(html).toContain("Each program uses its own warm-up");
    expect(html).toContain("5/3/1");
    // No ladder rungs — there is no one ladder to show in this mode.
    expect(html).not.toContain('data-testid="warmup-preview-0"');
    expect(html).not.toContain("% of top set");
  });

  it('"skip" still reads as skipping, not as following the program', () => {
    // The two null-ish states must stay visually distinct: an empty ladder is
    // an explicit "no warm-ups", not an absent preference.
    const html = renderToStaticMarkup(
      <WarmupSettings
        initial={{ setCount: 0, percentLadder: [], repLadder: [] }}
        programsWithOwnRamp={OWNERS}
      />,
    );
    expect(html).toContain("No warm-ups");
    expect(html).toContain('data-testid="warmup-program-override-warning"');
  });
});
