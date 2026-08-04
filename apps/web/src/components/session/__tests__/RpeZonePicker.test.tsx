/**
 * RpeZonePicker — static-render tests against the rendered markup.
 *
 * Project test env is Node (no JSDOM) so we assert against the markup
 * produced by `renderToStaticMarkup`. Click → onChange behaviour is
 * exercised indirectly: we pass an `onChange` spy via React's onClick
 * by rendering with a `_clickRef` is NOT feasible here, so we instead
 * cover the underlying mapping (zone → midpoint, midpoint → zone) in
 * `rpe-zones.test.ts`. The Playwright e2e `rpe-and-skip-desktop.spec.ts`
 * covers the live click → save round-trip.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RpeZonePicker } from "../RpeZonePicker";

describe("RpeZonePicker", () => {
  it("renders all four zones with their RPE range badges", () => {
    const html = renderToStaticMarkup(
      <RpeZonePicker value={undefined} onChange={() => {}} />,
    );
    expect(html).toContain('data-testid="rpe-zone-easy"');
    expect(html).toContain('data-testid="rpe-zone-moderate"');
    expect(html).toContain('data-testid="rpe-zone-hard"');
    expect(html).toContain('data-testid="rpe-zone-max"');
    expect(html).toContain("Easy");
    expect(html).toContain("Moderate");
    expect(html).toContain("Hard");
    expect(html).toContain("Max effort");
    expect(html).toContain("6 – 6.5");
    expect(html).toContain("7 – 8");
    expect(html).toContain("8.5 – 9");
    expect(html).toContain("9.5 – 10");
  });

  it("renders no selected zone when value is undefined", () => {
    const html = renderToStaticMarkup(
      <RpeZonePicker value={undefined} onChange={() => {}} />,
    );
    expect(html).toContain('data-active-zone=""');
    // None of the four cards should be flagged selected.
    expect(html).not.toMatch(/data-selected="true"/);
  });

  it("renders Moderate selected for value=7.5", () => {
    const html = renderToStaticMarkup(
      <RpeZonePicker value={7.5} onChange={() => {}} />,
    );
    expect(html).toContain('data-active-zone="moderate"');
    expect(html).toMatch(
      /data-testid="rpe-zone-moderate"[^>]*data-selected="true"/,
    );
  });

  it("renders Hard selected for the persisted midpoint 8.75", () => {
    const html = renderToStaticMarkup(
      <RpeZonePicker value={8.75} onChange={() => {}} />,
    );
    expect(html).toContain('data-active-zone="hard"');
    expect(html).toMatch(
      /data-testid="rpe-zone-hard"[^>]*data-selected="true"/,
    );
  });

  it("disables all zone cards when disabled", () => {
    const html = renderToStaticMarkup(
      <RpeZonePicker value={undefined} onChange={() => {}} disabled />,
    );
    // Each of the four radio cards must carry the disabled attribute.
    const disabledCount = (html.match(/disabled=""/g) ?? []).length;
    // 4 zone cards + the clear link (also disabled when no active zone).
    expect(disabledCount).toBeGreaterThanOrEqual(4);
  });

  it("renders a clear link", () => {
    const html = renderToStaticMarkup(
      <RpeZonePicker value={7.5} onChange={() => {}} />,
    );
    expect(html).toContain('data-testid="rpe-zone-clear"');
    expect(html).toContain(">clear<");
  });
});
