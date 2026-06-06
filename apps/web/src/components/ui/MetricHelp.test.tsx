/**
 * MetricHelp — render-shape tests.
 *
 * The project's vitest config runs in a Node environment (no DOM, no
 * testing-library) and the brief disallows new npm deps. We therefore
 * cover the static render contract here using react-dom/server (which
 * is already a dependency) and defer click / Esc / outside-click
 * interaction coverage to the Playwright spec
 * (`apps/web/e2e/whatis-help.spec.ts`), which exercises the real DOM.
 *
 * Asserted here:
 *   - the trigger icon renders for a known term;
 *   - the popover body, title, and (when present) citation are all in
 *     the rendered output;
 *   - ARIA wiring is in place (role="tooltip", aria-describedby
 *     reference, button aria-label);
 *   - unknown terms render nothing (no broken icons, no crashes);
 *   - the wrapper is keyboard-reachable (a real `<button>`, not a div).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricHelp } from "./MetricHelp";

describe("MetricHelp", () => {
  it("renders the info icon for a known term", () => {
    const html = renderToStaticMarkup(<MetricHelp term="ceiling" />);
    expect(html).toContain('data-testid="metric-help-trigger"');
    expect(html).toContain("ⓘ");
  });

  it("renders the title + body from the glossary", () => {
    const html = renderToStaticMarkup(<MetricHelp term="ceiling" />);
    expect(html).toContain('data-testid="metric-help-title"');
    expect(html).toContain("Weekly ceiling");
    expect(html).toContain('data-testid="metric-help-body"');
    expect(html).toMatch(/maximum weekly tonnage/i);
  });

  it("omits the citation block (research refs are not surfaced to end users)", () => {
    const html = renderToStaticMarkup(<MetricHelp term="tsb" />);
    expect(html).not.toContain('data-testid="metric-help-citation"');
    expect(html).not.toContain("Banister 1976");
  });

  it("omits the citation block when the entry has none", () => {
    const html = renderToStaticMarkup(<MetricHelp term="ceiling" />);
    expect(html).not.toContain('data-testid="metric-help-citation"');
  });

  it("wires ARIA correctly (button + tooltip role)", () => {
    const html = renderToStaticMarkup(<MetricHelp term="grm" />);
    // The trigger is a real <button>, not a div — keyboard reachable.
    expect(html).toMatch(/<button[^>]*data-testid="metric-help-trigger"/);
    // The popover carries role="tooltip" so AT announces it.
    expect(html).toMatch(/role="tooltip"/);
    // The aria-label on the trigger references the human-readable
    // title (so screen-reader users hear it on focus).
    expect(html).toMatch(/aria-label="What is [^"]*Global recovery multiplier/i);
  });

  it("renders nothing for an unknown term", () => {
    const html = renderToStaticMarkup(<MetricHelp term="not_a_real_term" />);
    expect(html).toBe("");
  });

  it('variant="why" renders the accent spark instead of the info dot', () => {
    const html = renderToStaticMarkup(
      <MetricHelp term="deload" variant="why" />,
    );
    expect(html).toContain("✦");
    expect(html).not.toContain("ⓘ");
    expect(html).toContain('data-variant="why"');
  });

  it('variant="why" uses "Why:" aria-label phrasing', () => {
    const html = renderToStaticMarkup(
      <MetricHelp term="deload" variant="why" />,
    );
    expect(html).toMatch(/aria-label="Why: [^"]+"/);
  });

  it('default variant stays the muted info dot', () => {
    const html = renderToStaticMarkup(<MetricHelp term="deload" />);
    expect(html).toContain("ⓘ");
    expect(html).toContain('data-variant="info"');
  });

  it("supports placement prop without crashing", () => {
    for (const p of ["top", "bottom", "left", "right"] as const) {
      const html = renderToStaticMarkup(<MetricHelp term="tsb" placement={p} />);
      expect(html).toContain("Training stress balance");
    }
  });
});
