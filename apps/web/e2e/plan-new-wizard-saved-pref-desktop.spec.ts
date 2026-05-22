import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

/**
 * Desktop /plan/new wizard — per-archetype saved day pattern.
 *
 * Exercises the new `hta-day-pref-v2` storage layout. The banner copy
 * ("Using your saved Strength Focus 4-day pattern.") should only fire
 * when the current archetype × session-count matches a previously saved
 * slot. We seed localStorage directly via page.addInitScript rather than
 * round-tripping through createBlock — keeping the spec focused on the
 * banner behaviour.
 */

const PREF_KEY = "hta-day-pref-v2";

test.describe("@desktop /plan/new wizard saved-pref banner", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("Strength pref does not apply to a Hybrid 4-day block; reapplies on next Strength block", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");

    // Seed a saved Strength 4-day pattern (Mon/Wed/Fri/Sun = days 0,2,4,6,
    // single-a-day = 4 sessions).
    const seeded = JSON.stringify({
      byArchetype: {
        strength_anchor: {
          "4": { days: [0, 2, 4, 6], twoADay: false },
        },
      },
    });
    await context.addInitScript(
      ([key, value]) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          // ignore — quota / disabled
        }
      },
      [PREF_KEY, seeded] as const,
    );

    // ── Walk Hybrid 4d: banner must NOT appear (different archetype). ────
    await page.goto("/app/plan/new");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /build a new block/i }).click();

    await expect(page.getByRole("heading", { name: /how many days/i })).toBeVisible();
    await page.getByRole("button", { name: /^4( days)?$/ }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Primary = strength, secondary = cardio → concurrent_hybrid (Hybrid Focus)
    await expect(page.getByRole("heading", { name: /choose your first focus/i })).toBeVisible();
    await page.getByRole("button", { name: /get stronger/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    await expect(page.getByRole("heading", { name: /choose your second focus/i })).toBeVisible();
    await page.getByRole("button", { name: /build cardio/i }).first().click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    await page.getByRole("button", { name: /continue to schedule/i }).click();

    // On step 5, the saved-pref banner should NOT be present because
    // the Strength pref does not apply to a Hybrid Focus block.
    await expect(page.getByRole("heading", { name: /lay out your week/i })).toBeVisible();
    await expect(page.getByText(/Using your saved .* pattern/i)).toHaveCount(0);

    // ── Now walk Strength 4d: banner MUST appear with the saved pattern. ──
    await page.goto("/app/plan/new");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /build a new block/i }).click();

    await page.getByRole("button", { name: /^4( days)?$/ }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    await page.getByRole("button", { name: /get stronger/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Skip secondary → strength_anchor.
    await page.getByRole("button", { name: /skip/i }).first().click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    await page.getByRole("button", { name: /continue to schedule/i }).click();

    await expect(page.getByRole("heading", { name: /lay out your week/i })).toBeVisible();
    await expect(
      page.getByText(/Using your saved Strength Focus 4-day pattern/i),
    ).toBeVisible();
  });
});
