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
});
