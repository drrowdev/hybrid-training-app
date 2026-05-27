/**
 * Today-page overdue notice: shown above the day's primary card when
 * the user has past planned sessions in limbo, hidden otherwise.
 *
 * Asserts the secondary nature of the notice — it's a Link to /app/plan,
 * NOT a primary CTA, so the day's actual session (or rest-day banner)
 * remains the lead action.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OverdueNotice } from "./OverdueNotice";

describe("OverdueNotice", () => {
  it("renders nothing when count is 0", () => {
    const html = renderToStaticMarkup(<OverdueNotice count={0} />);
    expect(html).toBe("");
  });

  it("renders nothing when count is negative", () => {
    const html = renderToStaticMarkup(<OverdueNotice count={-1} />);
    expect(html).toBe("");
  });

  it("renders a secondary link to /app/plan with the singular message", () => {
    const html = renderToStaticMarkup(<OverdueNotice count={1} />);
    expect(html).toContain('data-testid="today-overdue-notice"');
    expect(html).toContain('href="/app/plan"');
    expect(html).toContain("1</strong>");
    expect(html).toContain("overdue session");
    expect(html).toContain("review it");
    // Secondary: no primary-CTA class, no big button shape.
    expect(html).not.toMatch(/cp-btn primary/);
  });

  it("uses the plural message when count > 1", () => {
    const html = renderToStaticMarkup(<OverdueNotice count={4} />);
    expect(html).toContain("4</strong>");
    expect(html).toContain("overdue sessions");
    expect(html).toContain("review them");
  });
});
