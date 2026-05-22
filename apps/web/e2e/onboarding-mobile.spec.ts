import { test, expect } from "./fixtures/seed";

/**
 * Mobile onboarding happy-path.
 *
 * Walks a fresh user through all 5 onboarding steps on a mobile-sized
 * viewport (375x812 — iPhone SE class) and asserts:
 *   - the /app gate redirects to /onboarding while onboarding is incomplete
 *   - each step renders and accepts the canonical default inputs
 *   - after step 5 the user lands on /app
 *   - the page never produces horizontal scroll at 375px wide
 *
 * Skipped automatically when the seed env isn't wired — see
 * `e2e/fixtures/seed.ts`.
 */

test.describe("@mobile onboarding", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("fresh user completes onboarding on mobile viewport", async ({ page, freshUser }) => {
    // Sign in via the app's login page (magic-link is out of scope — the
    // login route exposes an email+password form behind a hidden flag for
    // E2E. If that flag isn't on, this will skip cleanly.)
    await page.goto("/login");
    const passwordField = page.getByLabel(/password/i);
    test.skip(
      !(await passwordField.isVisible().catch(() => false)),
      "Login page does not expose password auth — enable E2E_PASSWORD_AUTH or seed via Supabase admin link"
    );
    await page.getByLabel(/email/i).fill(freshUser.email);
    await passwordField.fill(freshUser.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    // Gate: /app should redirect to /onboarding for a fresh user.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/onboarding/);

    // --- Step 1: Welcome ---
    await page.getByRole("button", { name: /continue/i }).click();

    // --- Step 2: Profile basics ---
    await page.getByLabel(/name/i).fill("E2E Tester");
    await page.getByLabel(/kg|kilograms/i).check().catch(() => {});
    await page.getByLabel(/beginner|new|some experience/i).first().check().catch(() => {});
    await page.getByRole("button", { name: /continue/i }).click();

    // --- Step 3: Training maxes — "I don't know yet" on all 4 lifts ---
    const dontKnow = page.getByRole("button", { name: /don.?t know yet/i });
    const count = await dontKnow.count();
    for (let i = 0; i < count; i++) {
      await dontKnow.nth(i).click();
    }
    await page.getByRole("button", { name: /continue/i }).click();

    // --- Step 4: BlockWizard inline ---
    await page.getByRole("button", { name: /^4( days)?$/ }).click();
    await page.getByRole("button", { name: /get stronger/i }).click();
    await page.getByRole("button", { name: /skip|none/i }).first().click();
    await page.getByRole("button", { name: /continue to schedule/i }).click();
    await expect(page.getByText(/mon|monday/i).first()).toBeVisible();
    await page.getByRole("button", { name: /start this block/i }).click();

    // --- Step 5: Confirmation — default Start (today) ---
    await page.getByRole("button", { name: /^start$/i }).click();

    await expect(page).toHaveURL(/\/app(\/|$)/);

    // No horizontal scroll at 375px.
    const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(docWidth).toBeLessThanOrEqual(375);
  });
});
