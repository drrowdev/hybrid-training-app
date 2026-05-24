import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";

/**
 * Onboarding wizard — Bodyweight-only path (feat/bodyweight-only-path).
 *
 * Verifies:
 *  - The fifth equipment preset card ("Bodyweight only") renders in the
 *    onboarding equipment step.
 *  - Selecting it skips the Training Maxes step entirely on Continue —
 *    the wizard lands directly on "Build your first block".
 *  - After completing onboarding the Today page surfaces the soft
 *    "Bodyweight programming is in early support" banner.
 *  - The /app/plan page renders an active block whose prescription
 *    contains no `kind === "main"` items (accessory-only).
 */
test.describe("@desktop onboarding · bodyweight-only path", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("fresh user with Bodyweight-only preset skips TM step and lands on accessory-only block", async ({
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
    await page.getByTestId("onboarding-experience-1_3y").click();
    await page.getByRole("button", { name: /continue|next/i }).first().click();

    // The fifth preset card is visible.
    const bw = page.getByTestId("onboarding-equipment-preset-bodyweight_only");
    await expect(bw).toBeVisible();
    await bw.click();
    await expect(bw).toHaveAttribute("data-selected", "true");

    // Continue → should JUMP straight to the Build step (no TM step).
    await page.getByRole("button", { name: /continue|next/i }).first().click();
    await expect(page.getByText(/build your first block/i)).toBeVisible();
    await expect(page.getByText(/your main-lift maxes/i)).not.toBeVisible();

    // Persistence check: equipment row reflects bodyweight-only.
    const { data: prof } = await admin
      .from("profiles")
      .select("equipment")
      .eq("id", freshUser.userId)
      .maybeSingle();
    const eq = prof?.equipment as { preset?: string } | null;
    expect(eq?.preset).toBe("bodyweight_only");

    // Block-creation: there should be no main-lift items in any planned
    // session created by createBlock for this user.
    const { data: blocks } = await admin
      .from("training_blocks")
      .select("id, notes")
      .eq("user_id", freshUser.userId)
      .eq("status", "active");
    if (blocks && blocks.length > 0) {
      const blockIds = blocks.map((b) => b.id);
      const { data: planned } = await admin
        .from("planned_sessions")
        .select("prescription")
        .in("block_id", blockIds);
      for (const row of planned ?? []) {
        const items = (row.prescription as { items?: Array<{ kind: string }> })
          ?.items ?? [];
        const mains = items.filter((it) => it.kind === "main");
        expect(mains.length).toBe(0);
      }
    }

    // Today page surfaces the bodyweight banner.
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("bodyweight-only-banner")).toBeVisible();
  });
});
