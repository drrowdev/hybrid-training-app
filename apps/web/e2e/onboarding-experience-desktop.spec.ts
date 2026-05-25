import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";

/**
 * Onboarding wizard — training-experience capture.
 *
 * Walks the Profile step of the onboarding wizard, picks the
 * "Intermediate" (2 – 5 years) option, advances past the step, and
 * asserts profiles.training_experience persists as the matching enum
 * value (`intermediate_2y_5y`). Also asserts the five options render
 * with the expected copy.
 *
 * DC-G1 / DC-G5 surface: the declared experience seeds the user's
 * starting tier. The pure tier-detection helper in `@hta/engine` reads
 * this column via `gatherTierInputs` and projects the 5-tier declared
 * scale onto the 3-tier engine model.
 */

test.describe("@desktop onboarding · training experience", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("Profile step renders the five years-anchor options", async ({
    page,
    context,
    freshUser,
    seedConfig,
    baseURL,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");

    // Advance Welcome → Profile.
    await page.getByRole("button", { name: /next|continue/i }).first().click();

    await expect(page.getByText(/how long have you been training consistently/i)).toBeVisible();

    // The five years-anchor options.
    const beginner = page.getByTestId("onboarding-experience-beginner_lt_6m");
    const novice = page.getByTestId("onboarding-experience-novice_6m_2y");
    const intermediate = page.getByTestId("onboarding-experience-intermediate_2y_5y");
    const advanced = page.getByTestId("onboarding-experience-advanced_5y_10y");
    const highlyAdvanced = page.getByTestId(
      "onboarding-experience-highly_advanced_10y_plus",
    );
    await expect(beginner).toBeVisible();
    await expect(novice).toBeVisible();
    await expect(intermediate).toBeVisible();
    await expect(advanced).toBeVisible();
    await expect(highlyAdvanced).toBeVisible();
    await expect(beginner).toContainText(/Beginner/i);
    await expect(beginner).toContainText(/<6 months/i);
    await expect(novice).toContainText(/Novice/i);
    await expect(intermediate).toContainText(/Intermediate/i);
    await expect(intermediate).toContainText(/2 . 5 years/i);
    await expect(advanced).toContainText(/Advanced/i);
    await expect(highlyAdvanced).toContainText(/Highly advanced/i);
    await expect(highlyAdvanced).toContainText(/10\+ years/);
  });

  test("picking 'Intermediate' persists profiles.training_experience = 'intermediate_2y_5y'", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");

    // Welcome → Profile
    await page.getByRole("button", { name: /next|continue/i }).first().click();
    await expect(
      page.getByText(/how long have you been training consistently/i),
    ).toBeVisible();

    // Pick the Intermediate (2 – 5 years) option.
    await page.getByTestId("onboarding-experience-intermediate_2y_5y").click();

    // Advance to Equipment — fires the saveProfileAction.
    await page.getByRole("button", { name: /next|continue/i }).first().click();
    await expect(page.getByText(/what equipment do you train with\?/i)).toBeVisible();
    // Tap a preset and advance through the new Equipment step.
    await page.getByTestId("onboarding-equipment-preset-commercial_gym").click();
    await page.getByRole("button", { name: /next|continue/i }).first().click();
    // Wait for the Training maxes step to render.
    await expect(page.getByText(/training max/i).first()).toBeVisible();

    // Persisted column matches the DB enum value.
    const { data, error } = await admin
      .from("profiles")
      .select("training_experience")
      .eq("id", freshUser.userId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.training_experience).toBe("intermediate_2y_5y");
  });
});
