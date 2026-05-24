import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";

/**
 * Onboarding wizard — training-experience capture (PR feat/tier-detection).
 *
 * Walks the Profile step of the onboarding wizard, picks the "1-3 years"
 * (intermediate) option, advances past the step, and asserts
 * profiles.training_experience persists as the matching enum value
 * (`1_3y`). Also asserts the three options render with the expected
 * concrete-anchor copy.
 *
 * DC-G1 / DC-G5 surface: the declared experience seeds the user's
 * starting tier. The pure tier-detection helper in `@hta/engine` reads
 * this column via `gatherTierInputs`.
 */

test.describe("@desktop onboarding · training experience", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("Profile step renders the three years-anchor options", async ({
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

    // The three years-anchor options.
    const lt = page.getByTestId("onboarding-experience-lt_1y");
    const mid = page.getByTestId("onboarding-experience-1_3y");
    const gte = page.getByTestId("onboarding-experience-gte_3y");
    await expect(lt).toBeVisible();
    await expect(mid).toBeVisible();
    await expect(gte).toBeVisible();
    await expect(lt).toContainText(/≤ 1 year/);
    await expect(lt).toContainText(/Beginner/i);
    await expect(mid).toContainText(/1[\u2013-]3 years/);
    await expect(mid).toContainText(/Intermediate/i);
    await expect(gte).toContainText(/3\+ years/);
    await expect(gte).toContainText(/Advanced/i);
  });

  test("picking '1-3 years' persists profiles.training_experience = '1_3y'", async ({
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

    // Pick the intermediate (1–3 years) option.
    await page.getByTestId("onboarding-experience-1_3y").click();

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
    expect(data?.training_experience).toBe("1_3y");
  });
});
