import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * Time + date format preference desktop spec.
 *
 * Verifies:
 *  - The /app/settings page renders the "Time & date format" card with
 *    two selects (Time, Date) and live examples.
 *  - Switching Time to 12-hour + saving writes `profiles.time_format`
 *    = '12h' and the value persists across reload.
 *  - The Today eyebrow on /app re-renders in the user-selected format
 *    (DMY profile → "SUN 24 MAY" / MDY profile → "SUN MAY 24").
 */
test.describe("@desktop /app/settings · time + date format", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("user can pick a time + date format, it persists, and the Today eyebrow respects it", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";
    await markOnboarded(admin, freshUser.userId);
    // Anchor the user in a Europe timezone so the auto-default is
    // unambiguously 24h + dmy_short — a 12h/mdy pick is then a real
    // override the test can detect.
    await admin
      .from("profiles")
      .update({ timezone: "Europe/Helsinki" })
      .eq("id", freshUser.userId);

    await signInAs(context, freshUser, seedConfig, url);
    await page.goto("/app/settings");
    await page.waitForLoadState("networkidle");

    // Card renders.
    const card = page.getByTestId("settings-datetime-format-form");
    await expect(card).toBeVisible();
    const timeSelect = page.getByTestId("settings-time-format-select");
    const dateSelect = page.getByTestId("settings-date-format-select");
    await expect(timeSelect).toBeVisible();
    await expect(dateSelect).toBeVisible();

    // Default is "auto" — examples reflect the Europe tz defaults.
    await expect(timeSelect).toHaveValue("auto");
    await expect(dateSelect).toHaveValue("auto");
    await expect(page.getByTestId("settings-time-format-example")).toHaveText("17:30");
    await expect(page.getByTestId("settings-date-format-example")).toHaveText(
      "24/05/2026",
    );

    // Pick 12-hour. Live example switches to "5:30 PM".
    await timeSelect.selectOption("12h");
    await expect(page.getByTestId("settings-time-format-example")).toHaveText(
      "5:30 PM",
    );

    // Save + verify the DB write.
    await page.getByTestId("settings-datetime-format-save").click();
    await page.waitForLoadState("networkidle");

    const { data: row1 } = await admin
      .from("profiles")
      .select("time_format, date_format")
      .eq("id", freshUser.userId)
      .maybeSingle();
    expect(row1?.time_format).toBe("12h");
    expect(row1?.date_format).toBeNull();

    // Reload — selection sticks.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("settings-time-format-select")).toHaveValue("12h");

    // Today eyebrow respects the date_format. With auto + Europe, the
    // eyebrow is the DMY weekday-short flavour: e.g. "SUN 24 MAY" /
    // "MON 25 MAY". Assert presence of an upper-case three-letter
    // weekday followed by a 1-2 digit day + upper-case month abbrev.
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    const eyebrowDmy = page.getByTestId("today-eyebrow");
    await expect(eyebrowDmy).toBeVisible();
    await expect(eyebrowDmy).toHaveText(
      /\b(SUN|MON|TUE|WED|THU|FRI|SAT)\s+\d{1,2}\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/,
    );

    // Flip to MDY and reload — eyebrow swaps to MONTH-DAY order.
    await page.goto("/app/settings");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("settings-date-format-select").selectOption("mdy_short");
    await page.getByTestId("settings-datetime-format-save").click();
    await page.waitForLoadState("networkidle");

    const { data: row2 } = await admin
      .from("profiles")
      .select("time_format, date_format")
      .eq("id", freshUser.userId)
      .maybeSingle();
    expect(row2?.date_format).toBe("mdy_short");

    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    const eyebrowMdy = page.getByTestId("today-eyebrow");
    await expect(eyebrowMdy).toHaveText(
      /\b(SUN|MON|TUE|WED|THU|FRI|SAT)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{1,2}\b/,
    );
  });
});
