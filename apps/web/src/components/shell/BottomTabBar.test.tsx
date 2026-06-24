/**
 * BottomTabBar — mobile primary navigation. Verifies the MORE tab routes
 * to the settings hub.
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

describe("BottomTabBar", () => {
  it("MORE tab links to /app/settings (card-grid hub, not /app/profile)", () => {
    const html = renderToStaticMarkup(<BottomTabBar />);
    // Render attribute order isn't stable, so locate the MORE tab's
    // surrounding anchor and extract whichever href it carries.
    const moreBlock = html.match(/<a[^>]*data-testid="bottomtab-more"[^>]*>/);
    expect(moreBlock).not.toBeNull();
    const href = moreBlock?.[0].match(/href="([^"]+)"/)?.[1];
    expect(href).toBe("/app/settings");
  });
});
