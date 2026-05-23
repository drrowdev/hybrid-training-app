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

    // Secondary "Preview" link points to /app/plan.
    const preview = page.getByRole("link", { name: /^preview$/i }).first();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("href", "/app/plan");

    // Clicking Start lands on the check-in page.
    await cta.click();
    await page.waitForURL(`**/app/sessions/start/${seed.todayPlannedId}`, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /how are you feeling/i })).toBeVisible();
  });

  test("rest day shows the Why? tooltip + tomorrow preview", async ({
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
    // Seed a 4-day block so today is a training day, then BACKDATE the
    // block by one day to push today's planned_session into "tomorrow"
    // territory. Easier: drop today's planned_session row directly so
    // the page renders the rest-day card.
    const seed = await seedActiveBlock(admin, freshUser.userId);
    await admin.from("planned_sessions").delete().eq("id", seed.todayPlannedId);

    await signInAs(context, freshUser, seedConfig, url);
    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    const rest = page.getByTestId("today-rest");
    await expect(rest).toBeVisible();
    await expect(rest).toContainText(/rest day/i);
    // The "Why a rest day?" tooltip lives inside .cp-info — assert the
    // anchor is present.
    await expect(rest.locator(".cp-info").first()).toBeVisible();
    // Tomorrow strip should reference the next planned session.
    await expect(page.getByTestId("rest-tomorrow")).toBeVisible();
  });

  test("Phase 3 A2 — bodyweight nudge appears when no recent entry, disappears after save", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";

    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, url);

    // Fresh user — no wellness rows yet. Nudge should render.
    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    const nudge = page.getByTestId("bw-nudge");
    await expect(nudge).toBeVisible();

    // Fill in a bodyweight and save.
    await page.getByTestId("bw-nudge-input").fill("84.2");
    await page.getByTestId("bw-nudge-save").click();

    // After the action completes the form swaps to the success state
    // (same component instance — no reload).
    await expect(page.getByTestId("bw-nudge-saved")).toBeVisible({ timeout: 10_000 });

    // Service-role verifies the wellness row exists for today.
    const today = new Date().toISOString().slice(0, 10);
    const { data: w } = await admin
      .from("wellness")
      .select("date, bodyweight_kg")
      .eq("user_id", freshUser.userId)
      .eq("date", today)
      .maybeSingle();
    expect(w).not.toBeNull();
    expect(Number(w!.bodyweight_kg)).toBeCloseTo(84.2, 1);

    // Reload — the nudge should now stay hidden (query: bodyweight
    // logged within last 7 days).
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("bw-nudge")).toHaveCount(0);
    await expect(page.getByTestId("bw-nudge-saved")).toHaveCount(0);
  });
});
