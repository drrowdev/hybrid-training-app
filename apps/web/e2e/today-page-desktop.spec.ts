import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import { seedActiveBlock } from "./fixtures/session-log";

/**
 * Phase 1 — Today page hero card desktop coverage.
 *
 * Verifies the upgraded /app surface:
 *   - Hero session card renders with the archetype + week label and the
 *     resolved top-set numbers (weight × reps from prescription + TM).
 *   - "Start session →" CTA links into the check-in flow.
 *   - The "Preview" secondary link goes to /app/plan.
 *
 * Auth + onboarding follow the same fixture pattern as the existing
 * session-log spec — see e2e/README.md for the wider rationale.
 */

test.describe("@desktop today page (Phase 1)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("hero card renders archetype label + top-line numbers + Start CTA", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";

    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    const seed = await seedActiveBlock(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, url);

    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    // The hero card targets the seeded planned session for today.
    const hero = page.getByTestId(`today-card-${seed.todayPlannedId}`);
    await expect(hero).toBeVisible();

    // Archetype name + week label appear in the eyebrow.
    await expect(hero).toContainText(/week\s+\d+/i);

    // Top-line numbers: the seeded waves put week 0 at 70% TM × 5; the
    // hero renders ~mins + "Top set NNkg × 5".
    const topline = page.getByTestId("hero-topline");
    await expect(topline).toBeVisible();
    await expect(topline).toContainText(/Top set/);
    await expect(topline).toContainText(/× 5/);

    // Primary CTA → check-in for the seeded planned session.
    const cta = page.getByTestId("today-cta").first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveText(/start session/i);
    const href = await cta.getAttribute("href");
    expect(href).toBe(`/app/sessions/start/${seed.todayPlannedId}`);

    // Secondary "Preview plan" link points to /app/plan.
    const preview = page.getByRole("link", { name: /^preview plan$/i }).first();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("href", "/app/plan");

    // Clicking Start lands on the check-in page.
    await cta.click();
    await page.waitForURL(`**/app/sessions/start/${seed.todayPlannedId}`, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /how are you feeling/i })).toBeVisible();
  });

  test("rest day shows compact banner with Log freestyle + View plan links", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";

    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    // Seed a 4-day block so today is a training day, then drop today's
    // planned_session so the page renders the rest-day banner.
    const seed = await seedActiveBlock(admin, freshUser.userId);
    await admin.from("planned_sessions").delete().eq("id", seed.todayPlannedId);

    await signInAs(context, freshUser, seedConfig, url);
    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    const rest = page.getByTestId("today-rest");
    await expect(rest).toBeVisible();
    await expect(rest).toContainText(/rest day/i);
    // Next-session preview points at the upcoming planned session.
    await expect(page.getByTestId("rest-tomorrow")).toBeVisible();
    // Single log path on rest day: "Log freestyle" + "View plan" text links.
    await expect(rest.getByRole("link", { name: /log freestyle/i })).toBeVisible();
    await expect(rest.getByRole("link", { name: /view plan/i })).toBeVisible();
    // Removed regressions guarded with toHaveCount(0).
    await expect(rest.locator(".cp-info")).toHaveCount(0);
  });

  test("training-day hero exposes Start session CTA + Preview plan link", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";

    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    const seed = await seedActiveBlock(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, url);

    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    const cta = page.getByTestId("today-cta").first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveText(/start session/i);
    expect(await cta.getAttribute("href")).toBe(`/app/sessions/start/${seed.todayPlannedId}`);

    const preview = page.getByRole("link", { name: /^preview plan$/i }).first();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("href", "/app/plan");
  });

  test("Today regressions — removed surfaces stay removed", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";

    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    await seedActiveBlock(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, url);

    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    // 1) The bodyweight nudge is no longer rendered on Today.
    await expect(page.getByTestId("bw-nudge")).toHaveCount(0);
    // 2) "Up next this week" section is gone — handled by /app/plan.
    await expect(page.getByRole("heading", { name: /up next this week/i })).toHaveCount(0);
    // 3) The HowRecoveredCard / RegionFreshnessCard heading was "How
    //    recovered you are" — gone from Today.
    await expect(page.getByRole("heading", { name: /how recovered you are/i })).toHaveCount(0);
    // 4) The floating injury FAB is gone everywhere on /app.
    await expect(page.locator(".cp-fab")).toHaveCount(0);

    // The new compressed week strip replaces the right-rail WeekDotsCard.
    await expect(page.getByTestId("today-week-strip")).toBeVisible();
  });
});
