/**
 * BottomTabBar — mobile primary navigation. Verifies the MORE-tab
 * unread-notification dot toggles on `auditCount`.
 *
 * SSR-friendly: relies on usePathname() which has no effect under
 * renderToStaticMarkup (returns null → component defaults to "/app").
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app",
}));

import { BottomTabBar } from "./BottomTabBar";

describe("BottomTabBar — MORE notification dot", () => {
  it("hides the MORE dot when auditCount is 0", () => {
    const html = renderToStaticMarkup(<BottomTabBar auditCount={0} />);
    expect(html).toContain('data-testid="bottomtab-more"');
    expect(html).not.toContain('data-testid="bottomtab-more-dot"');
  });

  it("renders the MORE dot when auditCount > 0", () => {
    const html = renderToStaticMarkup(<BottomTabBar auditCount={3} />);
    expect(html).toContain('data-testid="bottomtab-more-dot"');
    expect(html).toContain("3 unread notifications");
  });

  it("defaults auditCount to 0 when omitted", () => {
    const html = renderToStaticMarkup(<BottomTabBar />);
    expect(html).not.toContain('data-testid="bottomtab-more-dot"');
  });
});
