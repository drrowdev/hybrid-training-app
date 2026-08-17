/**
 * AddToWorkout — static render smoke tests.
 *
 * The component is mostly interactive; the test env is Node-only so we
 * verify the closed-state pill renders the unified label, and the
 * `mode` state machine starts at "closed". Interaction tests live in
 * the Playwright suite — these tests guard the surface contract:
 *   - single primary button labeled "+ Add to workout"
 *   - test-ids match the page wiring + Playwright selectors
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AddToWorkout } from "../AddToWorkout";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const noop = async () => ({ ok: true as const });

describe("AddToWorkout", () => {
  it("starts collapsed with a single unified pill button", () => {
    const html = renderToStaticMarkup(
      <AddToWorkout
        sessionId="s1"
        cardioAction={noop as unknown as React.ComponentProps<typeof AddToWorkout>["cardioAction"]}
      />,
    );
    expect(html).toContain('data-testid="add-to-workout"');
    expect(html).toContain('data-testid="add-to-workout-open"');
    expect(html).toContain("+ Add to workout");
    // The two-mode chooser shouldn't render until the user opens it.
    expect(html).not.toContain('data-testid="add-to-workout-pick-strength"');
    expect(html).not.toContain('data-testid="add-to-workout-pick-cardio"');
  });

  it("renders the prominent empty-state card as the trigger when prominent", () => {
    const html = renderToStaticMarkup(
      <AddToWorkout
        sessionId="s1"
        cardioAction={noop as unknown as React.ComponentProps<typeof AddToWorkout>["cardioAction"]}
        prominent
        primaryModality="strength"
      />,
    );
    // Same trigger test-id, but now a prominent card with the
    // empty-state copy instead of the small pill.
    expect(html).toContain('data-testid="add-to-workout-open"');
    expect(html).toContain("Pick movements to start logging");
    expect(html).not.toContain("+ Add to workout");
  });
});
