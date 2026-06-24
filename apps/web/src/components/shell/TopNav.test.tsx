/**
 * TopNav — verifies the mobile-cleanup contract:
 *
 *   1. The right cluster wrapper carries the `cp-topbar-right-wrap`
 *      class that globals.css uses to hide it under 768px.
 *   2. The primary tabs nav carries `cp-topnav-tabs` for the same.
 *   3. The brand link carries `cp-topnav-brand` so the S×C wordmark is
 *      hidden on mobile.
 *   4. globals.css actually contains a max-width:768px rule that sets
 *      these three classes to display:none — otherwise the markup
 *      contract above is meaningless.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app",
}));

vi.mock("@/components/cmd-k/CommandPaletteProvider", () => ({
  useCommandPalette: () => ({ open: () => {}, close: () => {}, isOpen: false }),
}));

import { TopNav } from "./TopNav";

describe("TopNav — mobile (<768px) cleanup", () => {
  const html = renderToStaticMarkup(
    <TopNav
      signOutAction={async () => {}}
      displayName="Test User"
      email="test@example.com"
      hasStravaConnection={false}
      lastSyncedAt={null}
    />,
  );

  it("tags the brand link, primary tabs, and right-cluster wrapper with hide-on-mobile classes", () => {
    expect(html).toContain('class="cp-topnav-brand"');
    expect(html).toContain('class="cp-topnav-tabs"');
    expect(html).toContain('data-testid="topbar-right-wrap"');
    expect(html).toContain("cp-topbar-right-wrap");
  });

  it("ships a globals.css rule that hides those three classes below 768px", () => {
    const css = readFileSync(
      resolve(__dirname, "../../app/globals.css"),
      "utf8",
    );
    // Normalize whitespace so the assertion isn't fooled by formatting.
    const flat = css.replace(/\s+/g, " ");
    expect(flat).toMatch(/@media\s*\(max-width:\s*768px\)/);
    expect(flat).toMatch(
      /@media\s*\(max-width:\s*768px\)\s*\{[^}]*\.cp-topnav-brand[^}]*display:\s*none/,
    );
    expect(flat).toMatch(
      /@media\s*\(max-width:\s*768px\)\s*\{[^}]*\.cp-topnav-tabs[^}]*display:\s*none/,
    );
    expect(flat).toMatch(
      /@media\s*\(max-width:\s*768px\)\s*\{[^}]*\.cp-topbar-right-wrap[^}]*display:\s*none/,
    );
  });
});
