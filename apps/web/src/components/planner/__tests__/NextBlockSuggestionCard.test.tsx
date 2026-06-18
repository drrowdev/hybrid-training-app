/**
 * NextBlockSuggestionCard — static-render tests.
 *
 * Project test env is Node (no JSDOM) so we assert against
 * `renderToStaticMarkup` for visible structure, matching the existing
 * presentational-component test pattern (see RpeInput.test.tsx).
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextBlockSuggestionCard } from "../NextBlockSuggestionCard";

describe("NextBlockSuggestionCard", () => {
  it("renders nothing when both suggestion and realization are null", () => {
    const html = renderToStaticMarkup(
      <NextBlockSuggestionCard nudge={{ suggestion: null, realization: null }} />,
    );
    expect(html).toBe("");
  });

  it("renders the suggestion heading, reason, and default tail", () => {
    const html = renderToStaticMarkup(
      <NextBlockSuggestionCard
        nudge={{
          suggestion: {
            programId: "wendler-531",
            programName: "5/3/1",
            reason: "You stacked balanced blocks.",
          },
          realization: null,
        }}
      />,
    );
    expect(html).toContain("Consider a 5/3/1 block next");
    expect(html).toContain("You stacked balanced blocks.");
    expect(html).toContain("only a suggestion");
    // Default eyebrow.
    expect(html).toContain("Suggested next focus");
  });

  it("honours the eyebrow override and renders a CTA link when provided", () => {
    const html = renderToStaticMarkup(
      <NextBlockSuggestionCard
        nudge={{
          suggestion: {
            programId: "hybrid",
            programName: "Hybrid",
            reason: "Change the stimulus.",
          },
          realization: null,
        }}
        eyebrow="Final week"
        cta={{ href: "/app/program?program=hybrid", label: "Plan your next block" }}
        testId="block-ending-nudge"
      />,
    );
    expect(html).toContain("Final week");
    expect(html).not.toContain("Suggested next focus");
    expect(html).toContain('href="/app/program?program=hybrid"');
    expect(html).toContain("Plan your next block");
    expect(html).toContain('data-testid="block-ending-nudge"');
  });

  it("renders a realization-only nudge without a suggestion heading", () => {
    const html = renderToStaticMarkup(
      <NextBlockSuggestionCard
        nudge={{
          suggestion: null,
          realization: { reason: "Consider a peak week." },
        }}
      />,
    );
    expect(html).toContain("Consider a peak week.");
    expect(html).not.toContain("block next");
  });

  it("uses the heading override (Season-aware nudge) instead of the default", () => {
    const html = renderToStaticMarkup(
      <NextBlockSuggestionCard
        nudge={{
          suggestion: {
            programId: "tactical-barbell",
            programName: "Tactical Barbell",
            reason: "Add conditioning before the peak.",
          },
          realization: null,
        }}
        heading="Next up: a Tactical Barbell block"
        suggestionTail=""
        cta={{
          href: "/app/program?program=tactical-barbell&seasonBlockId=abc",
          label: "Start this block",
        }}
        testId="block-ending-nudge-season"
      />,
    );
    expect(html).toContain("Next up: a Tactical Barbell block");
    // The default "Consider a … block next" heading is suppressed.
    expect(html).not.toContain("Consider a Tactical Barbell block next");
    // Empty tail → no trailing "only a suggestion".
    expect(html).not.toContain("only a suggestion");
    expect(html).toContain("seasonBlockId=abc");
    expect(html).toContain("Start this block");
  });
});
