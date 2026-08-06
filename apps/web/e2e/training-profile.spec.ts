import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * /app/profile · training profile page.
 *
 * Smoke coverage:
 *  - Sign in, visit /app/profile.
 *  - Identity header shows the display name + email.
 *  - Bodyweight section renders (sparkline-or-empty-state, both are
 *    valid for a fresh user).
 *  - AI-notes editor is visible.
 *  - Inline-edit display name works (Enter to save, value sticks
 *    after reload).
 */
test.describe("@desktop /app/profile · training profile page", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("renders identity / bodyweight / AI notes; inline name edit persists", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    // Pre-seed a display name so the trigger has something to render.
    await admin
      .from("profiles")
      .update({ display_name: "Initial Name" })
      .eq("id", freshUser.userId);

    await signInAs(
      context,
      freshUser,
      seedConfig,
      baseURL ?? "http://localhost:3000",
    );

    await page.goto("/app/profile");
    await page.waitForLoadState("networkidle");

    // Page mounted.
    await expect(page.getByTestId("training-profile-page")).toBeVisible();

    // Identity header — name + email visible.
    const identity = page.getByTestId("profile-identity");
    await expect(identity).toBeVisible();
    await expect(page.getByTestId("display-name-value")).toContainText(
      /initial name/i,
    );
    await expect(page.getByTestId("display-name-email")).toContainText(
      freshUser.email,
    );

    // Bodyweight section — sparkline or empty state (both valid for a
    // fresh user).
    const bw = page.getByTestId("profile-bodyweight");
    await expect(bw).toBeVisible();
    const sparklineCount = await page
      .getByTestId("bodyweight-sparkline")
      .count();
    const emptyCount = await bw.getByTestId("empty-state").count();
    expect(sparklineCount + emptyCount).toBeGreaterThan(0);

    // AI-notes editor is visible.
    await expect(page.getByTestId("profile-training-notes")).toBeVisible();
    await expect(page.getByTestId("training-notes-textarea")).toBeVisible();

    // Inline-edit: click the trigger, type a new name, press Enter.
    await page.getByTestId("display-name-trigger").click();
    const input = page.getByTestId("display-name-input");
    await expect(input).toBeVisible();
    await input.fill("Edited Name");
    await input.press("Enter");

    // After save the rendered value flips.
    await expect(page.getByTestId("display-name-value")).toContainText(
      /edited name/i,
    );

    // Reload — the change persisted.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("display-name-value")).toContainText(
      /edited name/i,
    );

    // Right-rail surfaces render.
    await expect(page.getByTestId("profile-preferences")).toBeVisible();
    await expect(page.getByTestId("profile-tm-summary")).toBeVisible();
    await expect(page.getByTestId("profile-limitations")).toBeVisible();
  });
});
