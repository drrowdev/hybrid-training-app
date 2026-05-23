import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import {
  markOnboarded,
  seedRecentBlock,
  seedStrengthTms,
} from "./fixtures/seed-blocks";

/**
 * Desktop "Run it again" preview-then-act flow.
 *
 * Pre-condition: a seeded user with at least one completed training
 * block + TMs for the four strength-anchor roles. We insert a single
 * `training_blocks` row directly via the service-role client — the
 * "Run it again" picker only needs the block row to render the card.
 *
 * Auth is injected via cookie (see e2e/fixtures/auth.ts).
 *
 * As of this PR the card click no longer immediately creates a block —
 * it expands an inline preview panel with "Start this block" /
 * "Customize first" CTAs. We exercise both paths.
 */

test.describe("@desktop /plan/new run-it-again", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("user with a completed block can preview then start a clone", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    const seededBlockId = await seedRecentBlock(admin, freshUser.userId, {
      archetype: "strength_anchor",
      daysPerWeek: 4,
      status: "completed",
    });
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");

    await page.goto("/app/plan/new");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: /run it again/i })).toBeVisible();
    const recentCard = page.locator(".pn-recent-card").first();
    await expect(recentCard).toBeVisible();
    // Display name resolves to the human "Strength Focus", not the
    // internal slug (Issue 1).
    await expect(recentCard).toContainText(/strength focus/i);
    await expect(recentCard).not.toContainText("strength_anchor");
    await expect(recentCard).toContainText(/4 d\/wk/);
    await expect(recentCard).toContainText(/completed/i);

    // Clicking the card now expands an inline preview — no block created yet.
    await recentCard.click();
    const preview = page.getByTestId("pn-recent-preview");
    await expect(preview).toBeVisible();

    // Pre-click: the DB still has exactly the one seeded block.
    const { data: pre } = await admin
      .from("training_blocks")
      .select("id")
      .eq("user_id", freshUser.userId);
    expect(pre?.length ?? 0).toBe(1);

    // Start this block → 1-click clone, then redirect to /app/plan.
    await page.getByTestId("pn-preview-start").click();
    await page.waitForURL("**/app/plan", { timeout: 15_000 });

    // The new block is active and the seeded block stays completed.
    const { data: blocks, error: blocksErr } = await admin
      .from("training_blocks")
      .select("id, archetype, status, days_per_week, weeks, created_at")
      .eq("user_id", freshUser.userId)
      .order("created_at", { ascending: false });
    expect(blocksErr).toBeNull();
    expect(blocks?.length ?? 0).toBeGreaterThanOrEqual(2);
    const active = blocks!.find((b) => b.status === "active");
    expect(active).toBeDefined();
    expect(active!.id).not.toBe(seededBlockId);
    expect(active!.archetype).toBe("strength_anchor");
    expect(active!.days_per_week).toBe(4);

    // The planned_sessions for the new block landed with snake_case
    // columns (the PGRST204 regression check).
    const { data: planned, error: psErr } = await admin
      .from("planned_sessions")
      .select("id, week_index, day_index, block_id, user_id")
      .eq("block_id", active!.id);
    expect(psErr).toBeNull();
    expect(planned?.length ?? 0).toBe(active!.weeks * 4);
    for (const row of planned ?? []) {
      expect(row.user_id).toBe(freshUser.userId);
      expect(row.block_id).toBe(active!.id);
    }
  });

  test("'Customize first' opens the wizard pre-filled with the source block", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    await seedRecentBlock(admin, freshUser.userId, {
      archetype: "strength_anchor",
      daysPerWeek: 4,
      status: "completed",
    });
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");

    await page.goto("/app/plan/new");
    await page.waitForLoadState("networkidle");

    const recentCard = page.locator(".pn-recent-card").first();
    await recentCard.click();
    await expect(page.getByTestId("pn-recent-preview")).toBeVisible();

    // Customize first → jumps into the wizard. The strength_anchor
    // pre-fill seeds goal=strength + secondary=skip and skips to step 4
    // so the user lands on the review screen with the source block's
    // shape pre-populated.
    await page.getByTestId("pn-preview-customize").click();

    // Wizard footer primary becomes "Continue to schedule" on step 4 /
    // "Start this block" on step 5 — either confirms we're past step 1.
    await expect(page.locator(".wiz-footer-primary")).toBeVisible();
    const primaryLabel = await page.locator(".wiz-footer-primary").innerText();
    expect(primaryLabel.toLowerCase()).toMatch(/schedule|start this block/);

    // No block was created during the customize flow.
    const { data: blocks } = await admin
      .from("training_blocks")
      .select("id")
      .eq("user_id", freshUser.userId);
    expect(blocks?.length ?? 0).toBe(1);
  });
});
