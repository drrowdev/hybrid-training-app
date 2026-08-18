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
import { TRAINING_MAX_ANCHORED_WARMUP_SCHEME } from "@/lib/planner/program-warmup-scheme";

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

describe("WarmupSettings — the program option is named, and defaults only when relevant", () => {
  const ACTIVE_531 = {
    id: "wendler-531",
    name: "5/3/1",
    scheme: TRAINING_MAX_ANCHORED_WARMUP_SCHEME,
  };

  it("names the option after the method it follows, not the mechanism", () => {
    // "Follow the program" said nothing about WHICH warm-up you would get.
    const html = renderToStaticMarkup(
      <WarmupSettings initial={null} activeProgramWithOwnRamp={ACTIVE_531} />,
    );
    expect(html).toContain("5/3/1 Warmup");
    expect(html).not.toContain("Follow the program");
  });

  it("selects the program option only when that program is actually running", () => {
    // Nothing stored + 5/3/1 active ⇒ the 5/3/1 ramp is what you get.
    const active = renderToStaticMarkup(
      <WarmupSettings initial={null} activeProgramWithOwnRamp={ACTIVE_531} />,
    );
    expect(active).toMatch(/<option value="program"[^>]*selected/);

    // Nothing stored + no such program ⇒ you are simply on the standard ramp,
    // so naming 5/3/1 here would describe a method you are not running.
    const inactive = renderToStaticMarkup(<WarmupSettings initial={null} />);
    expect(inactive).toMatch(/<option value="standard"[^>]*selected/);
    expect(inactive).not.toMatch(/<option value="program"[^>]*selected/);
  });

  it("keeps the option SELECTABLE even when no such program is running", () => {
    // Hiding it would strand a lifter who set a custom ladder: they could not
    // clear it back to automatic, and doing so after starting the program is
    // too late — warm-up changes never rewrite a materialised block (ADR 0072).
    const html = renderToStaticMarkup(
      <WarmupSettings
        initial={{ setCount: 2, percentLadder: [50, 75], repLadder: [5, 3] }}
      />,
    );
    expect(html).toContain('value="program"');
    expect(html).toContain("5/3/1 Warmup");
  });

  it("previews the program's actual ladder rather than an empty panel", () => {
    const html = renderToStaticMarkup(
      <WarmupSettings initial={null} activeProgramWithOwnRamp={ACTIVE_531} />,
    );
    // 5/3/1's fixed 40/50/60% of Training Max. TM-anchored, so there is no
    // second "% of top set" number to show.
    expect(html).toContain("40% TM × 5");
    expect(html).toContain("50% TM × 5");
    expect(html).toContain("60% TM × 3");
    expect(html).not.toContain("% of top set");
  });

  it("previews the standard ladder when nothing is stored and no program is running", () => {
    const html = renderToStaticMarkup(<WarmupSettings initial={null} />);
    // The ramp actually in force: 40/60/80 of the top set.
    expect(html).toContain("40% of top set = 34% TM");
    expect(html).toContain("80% of top set = 68% TM");
    expect(html).toContain('data-testid="warmup-preview-program-note"');
  });
});

describe("WarmupSettings — DC-K4 override-and-warn", () => {
  const ACTIVE_531 = {
    id: "wendler-531",
    name: "5/3/1",
    scheme: TRAINING_MAX_ANCHORED_WARMUP_SCHEME,
  };

  it("warns which program's own warm-up a configured ladder replaces", () => {
    // DC-K4: overriding a principle-derived default must be surfaced, never
    // applied silently.
    const html = renderToStaticMarkup(
      <WarmupSettings
        initial={{ setCount: 2, percentLadder: [50, 75], repLadder: [5, 3] }}
        activeProgramWithOwnRamp={ACTIVE_531}
      />,
    );
    expect(html).toContain('data-testid="warmup-program-override-warning"');
    expect(html).toContain("5/3/1");
    expect(html).toContain("5/3/1 Warmup");
  });

  it("does not warn when the lifter is following the program", () => {
    const html = renderToStaticMarkup(
      <WarmupSettings initial={null} activeProgramWithOwnRamp={ACTIVE_531} />,
    );
    expect(html).not.toContain('data-testid="warmup-program-override-warning"');
  });

  it("does not warn when no program with its own warm-up is running", () => {
    // Nothing methodological is being displaced, so the warning would be noise
    // — this is the complaint that prompted the rework.
    const html = renderToStaticMarkup(
      <WarmupSettings
        initial={{ setCount: 2, percentLadder: [50, 75], repLadder: [5, 3] }}
      />,
    );
    expect(html).not.toContain('data-testid="warmup-program-override-warning"');
  });

  it('"skip" still reads as skipping, not as following the program', () => {
    // The two null-ish states must stay visually distinct: an empty ladder is
    // an explicit "no warm-ups", not an absent preference.
    const html = renderToStaticMarkup(
      <WarmupSettings
        initial={{ setCount: 0, percentLadder: [], repLadder: [] }}
        activeProgramWithOwnRamp={ACTIVE_531}
      />,
    );
    expect(html).toContain("No warm-ups");
    expect(html).toContain('data-testid="warmup-program-override-warning"');
  });
});
