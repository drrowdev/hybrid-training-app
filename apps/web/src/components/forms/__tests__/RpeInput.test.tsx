/**
 * RpeInput — static-render tests + pure-toggle helper test.
 *
 * Project test env is Node (no JSDOM) so we follow the same pattern as
 * the existing RpeZonePicker tests:
 *   - Assert against `renderToStaticMarkup` for visible structure.
 *   - Test the click-then-deselect behaviour via the pure `toggleRpe`
 *     helper exported from the component.
 *   - The 320px viewport "label fit" check is a static-length assertion
 *     on the short word forms (they must each be ≤ ~9 chars so all
 *     six fit inside a 320 / 6 ≈ 53 px chip at 10 px font).
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RpeInput, toggleRpe } from "../RpeInput";

const SHORT_LABELS = ["easy", "moderate", "hard", "tough", "brutal", "max"];

describe("RpeInput", () => {
  it("renders all six primary chips with the short word labels", () => {
    const html = renderToStaticMarkup(
      <RpeInput name="rpe" context="strength" />,
    );
    for (const value of [5, 6, 7, 8, 9, 10]) {
      expect(html).toContain(`data-testid="rpe-chip-${value}"`);
    }
    for (const label of SHORT_LABELS) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it("does NOT use the long-form labels that would overflow at 320px", () => {
    const html = renderToStaticMarkup(
      <RpeInput name="rpe" context="strength" />,
    );
    expect(html).not.toMatch(/>very hard</);
    expect(html).not.toMatch(/>all-out</);
    expect(html).not.toMatch(/>challenging</);
  });

  it("keeps every short label within the 320px chip budget", () => {
    // 320 viewport / 6 chips ≈ 53 px per chip. A 10 px font averages
    // ~5.5 px/char, so a 9-char ceiling leaves padding for the chip
    // gutter and a safe horizontal margin. Bumping any label past this
    // re-introduces the overflow that motivated the short-form choice.
    for (const label of SHORT_LABELS) {
      expect(label.length).toBeLessThanOrEqual(9);
    }
  });

  it("renders no chip as selected when value is null", () => {
    const html = renderToStaticMarkup(
      <RpeInput name="rpe" context="strength" value={null} onChange={() => {}} />,
    );
    expect(html).not.toMatch(/data-selected="true"/);
    expect(html).toContain('data-testid="rpe-input-hidden"');
    expect(html).toMatch(/data-testid="rpe-input-hidden"[^>]*value=""/);
  });

  it("renders the matching chip as selected for a given value", () => {
    const html = renderToStaticMarkup(
      <RpeInput name="rpe" context="strength" value={8} onChange={() => {}} />,
    );
    expect(html).toMatch(/data-testid="rpe-chip-8"[^>]*data-selected="true"/);
    expect(html).toMatch(/data-testid="rpe-input-hidden"[^>]*value="8"/);
  });

  it("uses the field name passed in so backends don't have to branch on context", () => {
    const strength = renderToStaticMarkup(
      <RpeInput name="rpe" context="strength" />,
    );
    const cardio = renderToStaticMarkup(
      <RpeInput name="avgRpe" context="cardio" />,
    );
    expect(strength).toMatch(/name="rpe"/);
    expect(cardio).toMatch(/name="avgRpe"/);
    expect(strength).toContain('data-context="strength"');
    expect(cardio).toContain('data-context="cardio"');
  });

  it("hides the legend by default", () => {
    const html = renderToStaticMarkup(
      <RpeInput name="rpe" context="strength" />,
    );
    expect(html).not.toContain('data-testid="rpe-input-legend"');
    expect(html).toContain('data-testid="rpe-input-info-toggle"');
  });
});

describe("toggleRpe", () => {
  it("selects when nothing was selected", () => {
    expect(toggleRpe(null, 7)).toBe(7);
    expect(toggleRpe(undefined, 5)).toBe(5);
  });

  it("replaces a different selection", () => {
    expect(toggleRpe(7, 9)).toBe(9);
  });

  it("clears when tapping the already-selected chip", () => {
    expect(toggleRpe(8, 8)).toBeNull();
  });
});
