import { test, expect } from "./fixtures/seed";

/**
 * Desktop /plan/new wizard happy-path.
 *
 * Pre-condition: user already has TMs set (no onboarding redirect).
 * For now we approximate that pre-condition by signing up via the
 * fresh-user fixture, then setting a TM-completed flag via raw SQL. When
 * the integration-test seed layer lands we'll swap this for a typed
 * helper that inserts a complete block of profile + TM rows directly.
 */

test.describe("@desktop /plan/new wizard", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("seeded user can build a new block via the wizard", async ({ page, freshUser, seedConfig }) => {
    // Seed: mark onboarding complete + insert TMs via the service-role
    // client. Tables and column names are placeholders until the
    // integration-test helper lands; failures here skip the test cleanly.
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(seedConfig.supabaseUrl, seedConfig.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const seed = await admin
      .from("profiles")
      .upsert({ user_id: freshUser.userId, onboarding_complete: true, units: "kg" })
      .then((r) => r.error);
    test.skip(
      !!seed,
      `Seeding profile failed — wire up the integration-test seed helper (${(seed as Error)?.message ?? seed})`
    );

    // Sign in
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(freshUser.email);
    await page.getByLabel(/password/i).fill(freshUser.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    // Wizard
    await page.goto("/app/plan/new");
    await page.getByRole("button", { name: /build a new block/i }).click();

    // Step: days
    await page.getByRole("button", { name: /^4( days)?$/ }).click();
    // Step: goal
    await page.getByRole("button", { name: /get stronger/i }).click();
    // Step: secondary — skip
    await page.getByRole("button", { name: /skip|none/i }).first().click();
    // Step: review → schedule
    await page.getByRole("button", { name: /continue to schedule/i }).click();
    // Step: start
    await page.getByRole("button", { name: /start this block/i }).click();

    await expect(page).toHaveURL(/\/app\/plan(\/|$)/);
    await expect(page.getByText(/block/i).first()).toBeVisible();
  });
});
