import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RegionSpikeBanner } from "../RegionSpikeBanner";
import type { RegionSpike } from "@/lib/engine/region-spike-detector";

function spike(region: string, pct: number, currentAtl = 100 * (1 + pct), trailingAvg = 100): RegionSpike {
  return { region, currentAtl, trailingAvg, spikePct: pct };
}

describe("RegionSpikeBanner", () => {
  it("renders nothing when spikes is empty", () => {
    const html = renderToStaticMarkup(<RegionSpikeBanner spikes={[]} />);
    expect(html).toBe("");
  });

  it("renders the worst region's friendly name and rounded percent", () => {
    const html = renderToStaticMarkup(
      <RegionSpikeBanner spikes={[spike("knee", 0.32)]} />,
    );
    expect(html).toContain('data-testid="region-spike-banner"');
    expect(html).toContain("Knee"); // friendly label from REGION_LABELS
    expect(html).toContain("32%");
    expect(html).toContain("consider holding pace");
    // Read-only: no buttons, no links to mutation surfaces.
    expect(html).not.toMatch(/<button/);
    expect(html).not.toMatch(/<a /);
  });

  it("with multiple spikes, renders only the worst row but lists the rest in the title attribute", () => {
    const html = renderToStaticMarkup(
      <RegionSpikeBanner
        spikes={[
          spike("shoulder_scapular", 1.0),
          spike("lumbar_trunk", 0.5),
          spike("knee", 0.3),
        ]}
      />,
    );
    // Visible body line is the worst one only.
    expect(html).toContain("Shoulder / scapular");
    expect(html).toContain("100%");
    // The other regions appear only in the title attribute.
    expect(html).toMatch(/title="[^"]*Lumbar \/ trunk \+50%[^"]*"/);
    expect(html).toMatch(/title="[^"]*Knee \+30%[^"]*"/);
    // And they should NOT appear outside the title attribute (only one
    // worst-region row is rendered into the body).
    const withoutTitle = html.replace(/title="[^"]*"/g, "");
    expect(withoutTitle).not.toContain("Lumbar / trunk");
    expect(withoutTitle).not.toContain("Knee");
  });

  it("omits the title attribute when there is only one spike", () => {
    const html = renderToStaticMarkup(
      <RegionSpikeBanner spikes={[spike("knee", 0.3)]} />,
    );
    expect(html).not.toMatch(/title="/);
  });
});
