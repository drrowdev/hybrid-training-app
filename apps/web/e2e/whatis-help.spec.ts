import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { seedEngineState } from "./fixtures/seed-engine";

/**
 * Desktop /app/stats/engine — `<MetricHelp />` "What is this?" pattern.
 *
 * Pre-condition (seeded via service-role admin client):
 *  - the same engine fixture as `stats-engine-desktop.spec.ts`, so the
 *    Decision Trace card renders (it's the easiest target — sits above
 *    the fold + always has a help icon).
 *
 * The spec asserts:
 *  - at least one `<MetricHelp>` icon is on the page;
 *  - clicking it opens the popover (data-open flips to "true");
 *  - the popover surfaces a non-empty title and body from the glossary;
 *  - pressing Esc closes it;
 *  - clicking outside also closes it.
 *
 * Chromium-only — same convention as the surrounding stats specs.
 */

test.describe("@desktop /app/stats/engine · what-is-this help", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("tap a help icon → popover renders the glossary entry; Esc and outside-click close it", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await seedEngineState(admin, freshUser.userId);

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats/engine");
    await page.waitForLoadState("networkidle");

    // The Decision Trace card carries a MetricHelp icon next to its
    // header pill — that's our canary.
    const helps = page.getByTestId("metric-help");
    const count = await helps.count();
    expect(count).toBeGreaterThanOrEqual(1);

    const target = helps.first();
    await expect(target).toHaveAttribute("data-open", "false");

    // ── Click → open ─────────────────────────────────────────
    await target.getByTestId("metric-help-trigger").click();
    await expect(target).toHaveAttribute("data-open", "true");

    // Popover wires title + body from the glossary.
    const title = target.getByTestId("metric-help-title");
    const body = target.getByTestId("metric-help-body");
    await expect(title).not.toBeEmpty();
    await expect(body).not.toBeEmpty();

    // ── Esc → close ──────────────────────────────────────────
    await page.keyboard.press("Escape");
    await expect(target).toHaveAttribute("data-open", "false");

    // ── Click outside → close ───────────────────────────────
    await target.getByTestId("metric-help-trigger").click();
    await expect(target).toHaveAttribute("data-open", "true");
    // Click somewhere far from the popover (top-left corner of the
    // viewport — well outside any interactive control on this page).
    await page.mouse.click(2, 2);
    await expect(target).toHaveAttribute("data-open", "false");
  });
});
