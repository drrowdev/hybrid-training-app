/**
 * TrainingProgressionCards — settings-index card visibility.
 *
 * Covers the three branches called out in `fix/bw-sidebar-day-copy-
 * and-settings-card` Bug B:
 *   1. bodyweight_only preset → BW card only, Training maxes hidden.
 *   2. non-BW preset + bw_progress rows present → both cards shown.
 *   3. default user (non-BW preset, no bw_progress) → Training maxes
 *      only, no BW card.
 *
 * Static-markup render only, same pattern as the existing
 * `ArchetypePicker-bw` and `WizardSidebar-bw-meta` tests.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrainingProgressionCards } from "../TrainingProgressionCards";

function render(props: { isBodyweightOnly: boolean; hasBwProgress: boolean }): string {
  return renderToStaticMarkup(<TrainingProgressionCards {...props} />);
}

describe("TrainingProgressionCards", () => {
  it("bodyweight_only: shows BW card, hides Training maxes", () => {
    const html = render({ isBodyweightOnly: true, hasBwProgress: false });
    expect(html).toContain("Bodyweight progression");
    expect(html).toContain("/app/settings/bodyweight-progression");
    expect(html).not.toContain("Training maxes");
    expect(html).not.toContain("/app/settings/training-maxes");
  });

  it("non-BW preset + bw_progress rows: shows BOTH cards", () => {
    const html = render({ isBodyweightOnly: false, hasBwProgress: true });
    expect(html).toContain("Training maxes");
    expect(html).toContain("/app/settings/training-maxes");
    expect(html).toContain("Bodyweight progression");
    expect(html).toContain("/app/settings/bodyweight-progression");
  });

  it("default user (non-BW, no bw_progress): Training maxes only, no BW card", () => {
    const html = render({ isBodyweightOnly: false, hasBwProgress: false });
    expect(html).toContain("Training maxes");
    expect(html).toContain("/app/settings/training-maxes");
    expect(html).not.toContain("Bodyweight progression");
    expect(html).not.toContain("/app/settings/bodyweight-progression");
  });

  it("bodyweight_only with stale bw_progress rows still suppresses Training maxes", () => {
    const html = render({ isBodyweightOnly: true, hasBwProgress: true });
    expect(html).toContain("Bodyweight progression");
    expect(html).not.toContain("Training maxes");
  });
});
