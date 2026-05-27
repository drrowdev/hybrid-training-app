/**
 * Coverage for the shared `<DisclosureArrow>` component used by
 * MovementCard / FreestyleMovementCard / page.tsx (Cardio "+ add
 * cardio block"). Asserts:
 *   1. closed state rotates the SVG 90° to point right (▸)
 *   2. open state leaves the SVG unrotated (▾)
 *   3. size prop drives both width AND height attributes
 *   4. always marked aria-hidden (decorative — state is announced by
 *      the parent control's `aria-expanded`)
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DisclosureArrow } from "../DisclosureArrow";

describe("DisclosureArrow", () => {
  it("renders rotated -90deg when closed (points right)", () => {
    const html = renderToStaticMarkup(<DisclosureArrow open={false} />);
    expect(html).toContain('data-testid="disclosure-arrow"');
    expect(html).toContain('data-open="false"');
    expect(html).toContain("rotate(-90deg)");
  });

  it("renders unrotated when open (points down)", () => {
    const html = renderToStaticMarkup(<DisclosureArrow open={true} />);
    expect(html).toContain('data-open="true"');
    expect(html).toContain("rotate(0deg)");
  });

  it("honours the size prop on both axes and stays aria-hidden", () => {
    const html = renderToStaticMarkup(<DisclosureArrow open={false} size={22} />);
    expect(html).toContain('width="22"');
    expect(html).toContain('height="22"');
    expect(html).toContain('aria-hidden="true"');
  });
});
