import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

/**
 * Top-bar status cluster — desktop coverage.
 *
 * Verifies that the right-side cluster renders the Search button (which
 * replaced the older ⌘K hint chip), the notifications bell, and the
 * user-initials avatar after a fresh sign-in to /app, and that each
 * pop-out behaves:
 *   - Clicking the Search button opens the quick-jump palette dialog.
 *   - Clicking the bell <summary> reveals the popover.
 *   - Clicking the avatar <summary> reveals the menu with Sign out.
 *   - The build SHA chip is no longer rendered.
 */

test.describe("@desktop top-bar status cluster", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("renders Search button, bell, avatar — and each pop-out opens", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";

    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, url);

    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    const topbar = page.getByTestId("app-topbar");
    await expect(topbar).toBeVisible();

    const searchBtn = page.getByTestId("topbar-cmdk");
    const bell = page.getByTestId("topbar-bell");
    const avatar = page.getByTestId("topbar-avatar");

    await expect(searchBtn).toBeVisible();
    // Search button carries the visible "Search" label (the OS-aware
    // ⌘K / Ctrl K kbd chip lives inside as a hint).
    await expect(searchBtn).toContainText(/search/i);
    await expect(bell).toBeVisible();
    await expect(avatar).toBeVisible();

    // The build SHA chip is no longer rendered anywhere in the top bar.
    await expect(topbar.getByTestId("topbar-build")).toHaveCount(0);

    // Clicking the Search button opens the palette dialog.
    await searchBtn.click();
    const dialog = page.getByTestId("cmdk-dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Clicking the bell opens its popover.
    await bell.click();
    await expect(page.getByTestId("topbar-bell-panel")).toBeVisible();

    // Clicking the avatar opens its menu and exposes the Sign out button.
    await avatar.click();
    const userMenu = page.getByTestId("topbar-user-menu");
    await expect(userMenu).toBeVisible();
    await expect(userMenu.getByTestId("topbar-sign-out-button")).toBeVisible();
    // The avatar dropdown is the single sign-out path now, and exposes
    // a "Limitations" entry routing to /app/recovery/injuries.
    await expect(userMenu.getByTestId("topbar-user-limitations")).toBeVisible();
  });
});
