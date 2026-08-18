import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * /app/settings/profile · the three settings absorbed from /app/profile.
 *
 * `/app/profile` had no inbound link anywhere in the app but was the only
 * UI for the display name, `ai_notes`, and the `am_window_start` /
 * `pm_window_start` two-a-day windows the Today page reads to place a
 * morning versus an evening session. The route is retired; this spec
 * guards the migration of all three.
 *
 * Coverage:
 *  - All three cards render on Settings > Training profile.
 *  - Each edit auto-saves and survives a reload.
 *  - The windows write both ends of the two-hour span.
 *  - The retired route is gone.
 */
test.describe("@desktop /app/settings/profile · absorbed settings", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("display name, windows and notes persist across a reload", async ({
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

    // ── Display name ──────────────────────────────────────────────
    await expect(page.getByTestId("settings-card-identity")).toBeVisible();
    const name = page.getByTestId("settings-display-name-input");
    await name.fill("Edited Name");
    await name.blur();
    await expect(
      page.getByTestId("autosave-status-settings-display-name-input"),
    ).toHaveAttribute("data-status", "saved");

    // ── Training windows ──────────────────────────────────────────
    await expect(
      page.getByTestId("settings-card-training-windows"),
    ).toBeVisible();
    await page.getByTestId("settings-am-window-start").fill("06:30");
    // Time inputs commit on change, with no debounce.
    await expect(
      page.getByTestId("autosave-status-settings-am-window-start"),
    ).toHaveAttribute("data-status", "saved");

    // ── Training notes ────────────────────────────────────────────
    await expect(
      page.getByTestId("settings-card-training-notes"),
    ).toBeVisible();
    const notes = page.getByTestId("training-notes-textarea");
    await notes.fill("Heavy days go better after a rest day.");
    await notes.blur();
    await expect(page.getByTestId("training-notes-status")).toContainText(
      /saved/i,
    );

    // ── All three persisted ───────────────────────────────────────
    await page.reload();
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("settings-display-name-input")).toHaveValue(
      "Edited Name",
    );
    await expect(page.getByTestId("settings-am-window-start")).toHaveValue(
      "06:30",
    );
    await expect(page.getByTestId("training-notes-textarea")).toHaveValue(
      /heavy days go better/i,
    );

    // DB: the window wrote both ends of the two-hour span.
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name, am_window_start, am_window_end, ai_notes")
      .eq("id", freshUser.userId)
      .maybeSingle();
    expect(profile?.display_name).toBe("Edited Name");
    expect(String(profile?.am_window_start)).toMatch(/^06:30/);
    expect(String(profile?.am_window_end)).toMatch(/^08:30/);
    expect(String(profile?.ai_notes)).toMatch(/heavy days go better/i);

    // The retired route is gone.
    const gone = await page.goto("/app/profile");
    expect(gone?.status()).toBe(404);
  });
});
