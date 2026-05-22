import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import {
  markOnboarded,
  seedRecentBlock,
  seedStrengthTms,
} from "./fixtures/seed-blocks";

/**
 * Desktop "Run it again" happy-path.
 *
 * Pre-condition: a seeded user with at least one completed training
 * block + TMs for the four strength-anchor roles. We insert a single
 * `training_blocks` row directly via the service-role client — the
 * "Run it again" picker only needs the block row to render the card.
 *
 * Auth is injected via cookie (see e2e/fixtures/auth.ts).
 *
 * Previously this spec was scoped down because clicking the recent
 * card invoked createBlock which hit the same snake_case-vs-camelCase
 * bug (PGRST204). Now that the fix is in, we click the card and assert
 * the resulting block + planned_sessions actually landed in the DB.
 */

test.describe("@desktop /plan/new run-it-again", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("user with a completed block can run it again", async ({
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
    // The /plan/new card renders the raw archetype slug today (not the
    // friendlier ARCHETYPE_NAMES lookup) — a separate cosmetic bug, but
    // it means the slug is what the user sees, so that's what we assert.
    await expect(recentCard).toContainText(/strength_anchor/i);
    await expect(recentCard).toContainText(/4 d\/wk/);
    await expect(recentCard).toContainText(/completed/i);

    // The card *is* the run-it-again button — clicking it invokes
    // createBlock and on success navigates to /app/plan.
    await recentCard.click();
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
});
