import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

/**
 * Top-bar status cluster — desktop coverage.
 *
 * Verifies that the right-side cluster renders the ⌘K hint, the
 * notifications bell, and the user-initials avatar after a fresh
 * sign-in to /app, and that each pop-out behaves:
 *   - Clicking the ⌘K hint opens the quick-jump palette dialog.
 *   - Clicking the bell <summary> reveals the popover.
 *   - Clicking the avatar <summary> reveals the menu with Sign out.
 */

test.describe("@desktop top-bar status cluster", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("renders ⌘K hint, bell, avatar — and each pop-out opens", async ({
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

    const cmdKHint = page.getByTestId("topbar-cmdk");
    const bell = page.getByTestId("topbar-bell");
    const avatar = page.getByTestId("topbar-avatar");

    await expect(cmdKHint).toBeVisible();
    await expect(bell).toBeVisible();
    await expect(avatar).toBeVisible();

    // Clicking the ⌘K hint opens the palette dialog.
    await cmdKHint.click();
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
  });
});
