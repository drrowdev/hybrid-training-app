import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

/**
 * Desktop /plan/new wizard happy-path.
 *
 * Pre-condition: a fresh user with onboarded_at set + TMs for the four
 * strength-anchor roles, so the wizard's TM-gating allows the user to
 * click "Start this block" on step 5.
 *
 * Auth is injected via cookie (see e2e/fixtures/auth.ts) rather than
 * walking the login UI — the password input has no label and exercising
 * the login form isn't what this spec is for.
 *
 * Previously this spec was scoped down to "Start button enabled" because
 * clicking Start hit a snake_case-vs-camelCase bug in createBlock
 * (PGRST204 — see fix/createblock-snake-case). The fix is in, so this
 * spec now exercises the full path: click Start → redirect to /app/plan
 * → assert the training_blocks + planned_sessions rows landed in the DB.
 */

test.describe("@desktop /plan/new wizard", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("seeded user can build a new block via the wizard", async ({
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

    await page.goto("/app/plan/new");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /build a new block/i }).click();

    // Step 1: days
    await expect(page.getByRole("heading", { name: /how many days/i })).toBeVisible();
    await page.getByRole("button", { name: /^4( days)?$/ }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 2: focus
    await expect(page.getByRole("heading", { name: /choose your first focus/i })).toBeVisible();
    await page.getByRole("button", { name: /get stronger/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 3: secondary — skip
    await expect(page.getByRole("heading", { name: /choose your second focus/i })).toBeVisible();
    await page.getByRole("button", { name: /skip/i }).first().click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 4: review → schedule
    await page.getByRole("button", { name: /continue to schedule/i }).click();

    // Step 5: click Start. The wizard fires createBlock and on success
    // navigates to /app/plan via router.push.
    const startBtn = page.getByRole("button", { name: /start this block/i });
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    await page.waitForURL("**/app/plan", { timeout: 15_000 });

    // The training_blocks row was created and is active.
    const { data: blocks, error: blocksErr } = await admin
      .from("training_blocks")
      .select("id, archetype, status, days_per_week, weeks")
      .eq("user_id", freshUser.userId)
      .eq("status", "active");
    expect(blocksErr).toBeNull();
    expect(blocks?.length ?? 0).toBe(1);
    const block = blocks![0]!;
    expect(block.archetype).toBe("strength_anchor");
    expect(block.days_per_week).toBe(4);
    const weeks = block.weeks;

    // The planned_sessions rows were inserted. The strength_anchor
    // archetype produces one row per (week × training-day), no rest
    // days. For a 4d block that's days_per_week * weeks rows.
    const { data: planned, error: psErr } = await admin
      .from("planned_sessions")
      .select("id, week_index, day_index, block_id, user_id")
      .eq("block_id", block.id);
    expect(psErr).toBeNull();
    expect(planned?.length ?? 0).toBe(weeks * 4);

    // Every row carries the snake_case columns populated correctly —
    // i.e. PGRST204 didn't silently mangle the insert.
    for (const row of planned ?? []) {
      expect(row.user_id).toBe(freshUser.userId);
      expect(row.block_id).toBe(block.id);
      expect(typeof row.week_index).toBe("number");
      expect(typeof row.day_index).toBe("number");
    }
  });
});
