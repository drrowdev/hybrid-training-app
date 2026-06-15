/**
 * RestTimer label test — verifies the active-movement context renders
 * inside the visible rest-timer pill when a `movementName` is passed.
 *
 * Static render only (project test env is Node, no DOM) — the
 * countdown/interaction path is covered by the existing Playwright
 * `session-log-desktop.spec.ts` regression suite.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RestTimer } from "./RestTimer";

describe("RestTimer", () => {
  it("renders the active-movement name in the label when provided", () => {
    const html = renderToStaticMarkup(
      <RestTimer seconds={90} movementName="Front Squat" />,
    );
    expect(html).toContain('data-testid="rest-timer-context"');
    expect(html).toContain("next Front Squat");
    expect(html).toMatch(/before next Front Squat set/i);
  });

  it("omits the movement context line when no name is given", () => {
    const html = renderToStaticMarkup(<RestTimer seconds={60} />);
    expect(html).not.toContain('data-testid="rest-timer-context"');
  });

  it("renders nothing when seconds <= 0", () => {
    const html = renderToStaticMarkup(<RestTimer seconds={0} movementName="Squat" />);
    expect(html).toBe("");
  });

  it("renders a full-width bottom bar (Option B), not a floating corner pill", () => {
    const html = renderToStaticMarkup(<RestTimer seconds={90} movementName="Squat" />);
    // The shell is the full-width fixed bar docked above the nav.
    expect(html).toContain('data-testid="rest-timer-shell"');
    expect(html).toMatch(/position:fixed/);
    expect(html).toMatch(/left:0/);
    expect(html).toMatch(/right:0/);
    // Keeps the ±30s controls and the dismissable countdown.
    expect(html).toContain('data-testid="rest-timer-minus-30"');
    expect(html).toContain('data-testid="rest-timer-plus-30"');
    expect(html).toContain('data-testid="rest-timer"');
  });
});
