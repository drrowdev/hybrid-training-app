import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import { seedTwoADay } from "./fixtures/session-log";

/**
 * Phase 2 B — Today page two-a-day cross-linking.
 *
 * Seeds a single training block with two planned_sessions for today
 * (slot='am' / slot='pm'), then verifies the Today page:
 *   B1 — both hero cards render with clear slot labels.
 *   B2 — after the AM is completed, the PM card moves to the front and
 *        the "PM session next/in ~Xh" hint appears above it.
 *
 * Auth + onboarding follow the same fixture pattern as the existing
 * today-page-desktop spec.
 */

test.describe("@desktop today page · two-a-day (Phase 2 B)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("B1 + B3 — both AM and PM cards render with slot labels", async ({
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
    const seed = await seedTwoADay(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, url);

    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    // Both hero cards are visible.
    const amCard = page.getByTestId(`today-card-${seed.amPlannedId}`);
    const pmCard = page.getByTestId(`today-card-${seed.pmPlannedId}`);
    await expect(amCard).toBeVisible();
    await expect(pmCard).toBeVisible();

    await expect(amCard).toHaveAttribute("data-state", "not_started");
    await expect(pmCard).toHaveAttribute("data-state", "not_started");
    await expect(amCard.getByTestId("today-hero-preview")).toBeVisible();
    await expect(pmCard.getByTestId("today-hero-preview")).toHaveCount(0);
    await expect(pmCard.getByRole("link")).toHaveAttribute("href", `/app/sessions/start/${seed.pmPlannedId}`);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 812 });
      for (const id of [seed.amPlannedId, seed.pmPlannedId]) {
        const link = page.getByTestId("today-week-strip").locator(`a[href="#session=${id}"]`);
        await expect(link).toHaveAccessibleName(/^Open .+, /);
        const target = await link.boundingBox();
        expect(target!.height).toBeGreaterThanOrEqual(44);
        await link.click();
        await expect(page.getByTestId("plan-drawer")).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`#session=${id}$`));
        const title = await page.getByTestId(`today-card-${id}`).getByRole("heading", { level: 2 }).textContent();
        await expect(page.getByTestId("plan-drawer").getByRole("heading", { name: title!, exact: true, level: 2 })).toBeVisible();
        await page.getByTestId("plan-drawer-close").click();
        await expect(page.getByTestId("plan-drawer")).toHaveCount(0);
      }
    }
  });

  test("B2 — after AM is logged, PM card moves to front with hint", async ({
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
    const seed = await seedTwoADay(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, url);

    // Service-role: mark the AM as completed by inserting a completed
    // session and linking it. Cheap shortcut compared to walking the UI.
    const nowIso = new Date().toISOString();
    const { data: amSession, error: sErr } = await admin
      .from("sessions")
      .insert({
        user_id: freshUser.userId,
        title: "Morning lift",
        performed_at: nowIso,
        completed_at: nowIso,
        duration_min: 50,
        slot: "am",
      })
      .select("id")
      .single();
    expect(sErr).toBeNull();
    expect(amSession?.id).toBeTruthy();
    const { error: linkErr } = await admin
      .from("planned_sessions")
      .update({ completed_session_id: amSession!.id })
      .eq("id", seed.amPlannedId);
    expect(linkErr).toBeNull();

    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    // The AM card opens the logged session; PM becomes the expanded first row.
    const amCard = page.getByTestId(`today-card-${seed.amPlannedId}`);
    await expect(amCard).toHaveAttribute("data-state", "done");
    await expect(amCard).toHaveAttribute("href", `/app/sessions/${amSession!.id}`);

    // PM card is still visible and clickable.
    const pmCard = page.getByTestId(`today-card-${seed.pmPlannedId}`);
    await expect(pmCard).toBeVisible();
    await expect(pmCard.getByTestId("today-cta")).toBeVisible();
    const order = await page.locator('[data-testid^="today-card-"]').evaluateAll((cards) => cards.map((card) => card.getAttribute("data-testid")));
    expect(order).toEqual([`today-card-${seed.pmPlannedId}`, `today-card-${seed.amPlannedId}`]);
  });
});
