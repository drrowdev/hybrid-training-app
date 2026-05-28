/**
 * Static-markup render test for the LimitationsToggleSection client
 * component. Verifies the test-id contract the PR spec promises and
 * the visible labels.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { LimitationsToggleSection } from "../limitations/LimitationsToggleSection";

describe("LimitationsToggleSection (static markup)", () => {
  it("renders a checkbox for each engine region with the testid contract", () => {
    const html = renderToStaticMarkup(
      React.createElement(LimitationsToggleSection, {
        initialBlockedRegions: [],
        initialTendinopathyActive: false,
      }),
    );
    for (const region of [
      "foot_ankle_calf",
      "knee",
      "hamstring_posterior",
      "adductor_groin",
      "lumbar_trunk",
      "shoulder_scapular",
      "elbow_forearm",
    ]) {
      expect(html).toContain(`data-testid="limitations-region-${region}"`);
    }
    expect(html).toContain('data-testid="limitations-tendinopathy"');
  });

  it("includes the user-facing caption", () => {
    const html = renderToStaticMarkup(
      React.createElement(LimitationsToggleSection, {
        initialBlockedRegions: [],
        initialTendinopathyActive: false,
      }),
    );
    expect(html).toContain("Used to filter accessories and power primers");
    expect(html).toContain("Set once; clear when symptoms resolve.");
  });

  it("pre-checks regions and the tendinopathy flag from initial state", () => {
    const html = renderToStaticMarkup(
      React.createElement(LimitationsToggleSection, {
        initialBlockedRegions: ["knee"],
        initialTendinopathyActive: true,
      }),
    );
    expect(html).toMatch(
      /data-testid="limitations-region-knee"[^>]*checked=""/,
    );
    expect(html).toMatch(
      /data-testid="limitations-tendinopathy"[^>]*checked=""/,
    );
    expect(html).not.toMatch(
      /data-testid="limitations-region-elbow_forearm"[^>]*checked=""/,
    );
  });
});
