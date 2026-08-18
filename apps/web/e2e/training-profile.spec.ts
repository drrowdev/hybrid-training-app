import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * /app/settings/profile · training windows + training notes.
 *
 * These two groups were absorbed from the retired /app/profile page —
 * they are the only UI for `am_window_start` / `pm_window_start` (used
 * by the Today page to place two-a-day sessions) and `ai_notes`. This
 * spec guards the migration.
 *
 * Coverage:
 *  - Both groups render on the Settings > Training profile page.
 *  - Editing a training window auto-saves and survives a reload.
 *  - Training notes save on blur and survive a reload.
 */
test.describe("@desktop /app/settings/profile · windows + notes", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("training windows and notes persist across a reload", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await signInAs(
      context,
      freshUser,
      seedConfig,
      baseURL ?? "http://localhost:3000",
    );

    await page.goto("/app/settings/profile");
    await page.waitForLoadState("networkidle");

    // Back link resolves to the Settings hub.
    const back = page.getByTestId("back-link");
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", "/app/settings");

    // ── Training windows ──────────────────────────────────────────
    const windowsGroup = page.getByTestId("settings-group-training-windows");
    await expect(windowsGroup).toBeVisible();
    await windowsGroup.locator("summary").click();

    const amInput = page.getByTestId("settings-am-window-start");
    await expect(amInput).toBeVisible();
    await amInput.fill("06:30");
    // Time inputs commit on change; wait for the save to land.
    await expect(
      page.getByTestId("autosave-status-settings-am-window-start"),
    ).toHaveAttribute("data-status", "saved");

    // ── Training notes ────────────────────────────────────────────
    const notesGroup = page.getByTestId("settings-group-training-notes");
    await expect(notesGroup).toBeVisible();
    await notesGroup.locator("summary").click();

    const notes = page.getByTestId("training-notes-textarea");
    await expect(notes).toBeVisible();
    await notes.fill("Heavy days go better after a rest day.");
    await notes.blur();
    await expect(page.getByTestId("training-notes-status")).toContainText(
      /saved/i,
    );

    // ── Both persisted ────────────────────────────────────────────
    await page.reload();
    await page.waitForLoadState("networkidle");

    await page
      .getByTestId("settings-group-training-windows")
      .locator("summary")
      .click();
    await expect(page.getByTestId("settings-am-window-start")).toHaveValue(
      "06:30",
    );

    await page
      .getByTestId("settings-group-training-notes")
      .locator("summary")
      .click();
    await expect(page.getByTestId("training-notes-textarea")).toHaveValue(
      /heavy days go better/i,
    );
  });
});
