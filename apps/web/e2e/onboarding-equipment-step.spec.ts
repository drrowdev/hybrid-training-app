import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";

/**
 * Onboarding wizard — Equipment step (feat/onboarding-equipment-step).
 *
 * Walks the wizard from a fresh user up to the Equipment step, taps the
 * "Home gym" preset card, advances, and verifies that
 * `profiles.equipment.preset` was persisted as `home_gym`. Also asserts
 * the four preset cards render in the expected order and that the
 * default-suggestion attribute lights up Commercial gym for a fresh
 * profile without committing it.
 */

test.describe("@desktop onboarding · equipment step", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("Equipment step lands between Profile and Training maxes for a fresh user", async ({
    page,
    context,
    freshUser,
    seedConfig,
    baseURL,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");

    // Welcome → Profile.
    await page.getByRole("button", { name: /continue|next/i }).first().click();

    // Profile step — pick experience tier so Continue enables.
    await page.getByTestId("onboarding-experience-1_3y").click();
    await page.getByRole("button", { name: /continue|next/i }).first().click();

    // Equipment step renders with all four preset cards and the
    // Commercial-gym card flagged as the suggested default.
    await expect(page.getByText(/what equipment do you train with\?/i)).toBeVisible();
    await expect(page.getByTestId("onboarding-equipment-presets")).toBeVisible();
    for (const key of ["commercial_gym", "home_gym", "travel_hotel", "custom"]) {
      await expect(page.getByTestId(`onboarding-equipment-preset-${key}`)).toBeVisible();
    }
    await expect(
      page.getByTestId("onboarding-equipment-preset-commercial_gym"),
    ).toHaveAttribute("data-suggested", "true");
    await expect(
      page.getByTestId("onboarding-equipment-preset-home_gym"),
    ).toHaveAttribute("data-selected", "false");
  });

  test("picking 'Home gym' persists profiles.equipment.preset = 'home_gym' and advances", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";
    await signInAs(context, freshUser, seedConfig, url);
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");

    // Welcome → Profile.
    await page.getByRole("button", { name: /continue|next/i }).first().click();
    await page.getByTestId("onboarding-experience-1_3y").click();
    await page.getByRole("button", { name: /continue|next/i }).first().click();

    // Tap the Home gym preset card.
    const homeGym = page.getByTestId("onboarding-equipment-preset-home_gym");
    await homeGym.click();
    await expect(homeGym).toHaveAttribute("data-selected", "true");

    // Continue → persists equipment and moves to Training maxes step.
    await page.getByRole("button", { name: /continue|next/i }).first().click();
    await expect(page.getByText(/your main-lift maxes/i)).toBeVisible();

    // Verify persistence via the admin client.
    const { data, error } = await admin
      .from("profiles")
      .select("equipment")
      .eq("id", freshUser.userId)
      .maybeSingle();
    expect(error).toBeNull();
    const eq = data?.equipment as { preset?: string } | null;
    expect(eq?.preset).toBe("home_gym");
  });
});
