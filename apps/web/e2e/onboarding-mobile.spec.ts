import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";

/**
 * Mobile onboarding happy-path.
 *
 * Walks a fresh user through the onboarding wizard on a mobile-sized
 * viewport (375×812 — iPhone SE class) and asserts:
 *   - the /app gate redirects to /onboarding while onboarding is incomplete
 *   - the wizard renders without horizontal scroll at 375px wide
 *
 * SKIPPED for first-pass: the wizard's per-step selectors (Step 2
 * units radio, Step 3 "I don't know yet" repeated button, Training
 * maxes inputs) need a direct read of the current onboarding
 * component tree to be reliable — and several of those steps don't yet
 * expose stable accessible names. Tracked as a follow-up alongside the
 * onboarding selector audit.
 *
 * The skipped block below documents the intended shape so the follow-up
 * can drop the skip and fill in the real selectors. Auth is already
 * wired via cookie injection (see e2e/fixtures/auth.ts).
 */

test.describe("@mobile onboarding", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("fresh user is gated to /onboarding on mobile viewport", async ({
    page,
    context,
    freshUser,
    seedConfig,
    baseURL,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");

    // Gate: /app should redirect to /onboarding for a fresh user
    // (no onboarded_at, no TMs — see lib/onboarding/gate.ts).
    await page.goto("/app");
    await expect(page).toHaveURL(/\/onboarding/);

    // No horizontal scroll at 375px.
    const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(docWidth).toBeLessThanOrEqual(375);
  });

  // TODO(follow-up): walk all onboarding steps and assert landing on
  // /app/program. Blocked on stable accessible names for: Step 2 units
  // toggle, Step 3 "I don't know yet" per-lift buttons, and the
  // bodyweight-assessment sub-pages. Onboarding no longer creates a
  // block — the final "Start training" step hands off to the platform
  // program picker. Add a dedicated `data-testid` pass before unblocking.
  test.skip("fresh user completes onboarding on mobile viewport", async () => {
    // intentionally empty — see TODO above
  });
});
