import { test, expect } from "./fixtures/seed";

/**
 * Desktop "Run it again" happy-path.
 *
 * Pre-condition: user has at least one completed block. We seed the
 * block directly via the service-role client rather than walking the
 * full wizard each time. Until the integration-test seed helper lands,
 * the raw insert is best-effort: if it fails (e.g. schema drift) the
 * test skips with a descriptive message instead of failing.
 */

test.describe("@desktop /plan/new run-it-again", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("user with a completed block sees and re-runs it", async ({ page, freshUser, seedConfig }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(seedConfig.supabaseUrl, seedConfig.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const profile = await admin
      .from("profiles")
      .upsert({ user_id: freshUser.userId, onboarding_complete: true, units: "kg" })
      .then((r) => r.error);
    const block = await admin
      .from("blocks")
      .insert({
        user_id: freshUser.userId,
        archetype: "get_stronger",
        days_per_week: 4,
        status: "completed",
      })
      .then((r) => r.error);

    test.skip(
      !!profile || !!block,
      `Seeding completed block failed — wire up the integration-test seed helper (${
        (profile as Error)?.message ?? (block as Error)?.message ?? "schema mismatch"
      })`
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(freshUser.email);
    await page.getByLabel(/password/i).fill(freshUser.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    await page.goto("/app/plan/new");

    const runAgainCard = page.getByText(/run it again/i).first();
    await expect(runAgainCard).toBeVisible();
    await page.getByRole("button", { name: /run again/i }).first().click();

    // Verify the new block landed in /app/plan and shares the archetype.
    await expect(page).toHaveURL(/\/app\/plan(\/|\?|$)/);

    const { data: blocks, error: listErr } = await admin
      .from("blocks")
      .select("id, archetype, days_per_week")
      .eq("user_id", freshUser.userId);
    expect(listErr).toBeNull();
    expect(blocks?.length ?? 0).toBeGreaterThanOrEqual(2);
    const archetypes = (blocks ?? []).map((b) => b.archetype);
    expect(archetypes.filter((a) => a === "get_stronger").length).toBeGreaterThanOrEqual(2);
  });
});
