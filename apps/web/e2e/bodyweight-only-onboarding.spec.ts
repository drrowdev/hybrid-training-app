import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";

/**
 * Onboarding wizard — Bodyweight-only path.
 *
 * Verifies (ADR 0046 Phase 2 — clean handoff to picker):
 *  - The "Bodyweight only" equipment preset card renders in the
 *    onboarding equipment step.
 *  - Selecting it swaps the Training Maxes step for the bodyweight
 *    assessment (no "your main-lift maxes" copy) — the bw-routing
 *    intent is preserved.
 *  - Onboarding no longer creates a block. After the bodyweight
 *    assessment + Connect Strava, the final "Start training" step
 *    marks onboarding complete and hands the user off to the platform
 *    program picker at /app/program — with NO training_blocks row
 *    created during onboarding.
 */
test.describe("@desktop onboarding · bodyweight-only path", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("fresh user with Bodyweight-only preset reaches the program picker without a block", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";
    await signInAs(context, freshUser, seedConfig, url);
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");

    // Welcome → Profile.
    await page.getByRole("button", { name: /continue|next/i }).first().click();
    await page.getByTestId("onboarding-experience-novice_6m_2y").click();
    await page.getByRole("button", { name: /continue|next/i }).first().click();

    // The Bodyweight-only preset card is visible.
    const bw = page.getByTestId("onboarding-equipment-preset-bodyweight_only");
    await expect(bw).toBeVisible();
    await bw.click();
    await expect(bw).toHaveAttribute("data-selected", "true");

    // Continue → bodyweight assessment renders in place of the TM step.
    await page.getByRole("button", { name: /continue|next/i }).first().click();
    await expect(page.getByTestId("bw-assessment-step")).toBeVisible();
    await expect(page.getByText(/your main-lift maxes/i)).not.toBeVisible();

    // Persistence check: equipment row reflects bodyweight-only.
    const { data: prof } = await admin
      .from("profiles")
      .select("equipment")
      .eq("id", freshUser.userId)
      .maybeSingle();
    const eq = prof?.equipment as { preset?: string } | null;
    expect(eq?.preset).toBe("bodyweight_only");

    // Walk the 3-page bodyweight assessment (rep tests → skill chips →
    // hinge acknowledgement → submit). The same "next" button advances
    // each page; the third click submits and fires onComplete.
    await page.getByTestId("bw-assessment-next").click();
    await page.getByTestId("bw-assessment-next").click();
    await page.getByTestId("bw-assessment-next").click();

    // Connect Strava → Start training (final step).
    await expect(
      page.getByRole("button", { name: /continue|next/i }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: /continue|next/i }).first().click();

    // Final step: hand off to the platform program picker.
    const choose = page.getByRole("button", { name: /choose your program/i });
    await expect(choose).toBeVisible();
    await choose.click();

    // Lands on /app/program; onboarding is marked complete.
    await expect(page).toHaveURL(/\/app\/program/);
    const { data: done } = await admin
      .from("profiles")
      .select("onboarded_at")
      .eq("id", freshUser.userId)
      .maybeSingle();
    expect(done?.onboarded_at).toBeTruthy();

    // Onboarding must NOT have created a block — that now happens only
    // when the user deploys a program from /app/program.
    const { data: blocks } = await admin
      .from("training_blocks")
      .select("id")
      .eq("user_id", freshUser.userId);
    expect(blocks ?? []).toHaveLength(0);
  });
});
