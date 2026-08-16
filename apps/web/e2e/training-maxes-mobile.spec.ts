/**
 * Regression guard: `/app/settings/training-maxes` must fit a phone.
 *
 * The page laid its sections out in an `auto` grid track, which takes its floor
 * from the widest child's min-content width. A lift row (role label + variant
 * `<select>` + Estimate + numeric input) is wider than a phone viewport, so the
 * track — and every sibling stretched to it — ran off-screen: the intro copy was
 * clipped mid-sentence and the 1RM inputs sat past the right edge, unreachable
 * without horizontal scrolling.
 */
import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

test.describe("@mobile /app/settings/training-maxes", () => {
  test("keeps the page and its 1RM inputs inside the viewport", async ({
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

    await page.goto("/app/settings/training-maxes");
    await page.waitForLoadState("networkidle");

    const squatInput = page.getByLabel("Squat 1RM", { exact: true });
    await expect(squatInput).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Every 1RM input has to be reachable without scrolling sideways.
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    for (const input of await page.locator('input[aria-label$="1RM"]').all()) {
      const box = await input.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
    }
  });
});
