import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

/**
 * Desktop /plan/new wizard with the step-2 "Add power emphasis" toggle ON.
 *
 * Verifies the full path:
 *   1. Wizard accepts the toggle on a power-eligible archetype (Strength Focus).
 *   2. The `training_blocks.power_emphasis` column reads `true` after submit.
 *   3. At least one planned_session prescription contains a power-tagged
 *      accessory (i.e. the picker actually consumed the flag).
 *
 * The power-tagged accessories come from migration
 * `0023_power_movement_tagging.sql` — Olympic / plyometric / ballistic
 * movement slugs already in the seed catalog.
 */

const POWER_SLUGS = [
  "power-clean", "hang-clean", "hang-power-clean", "clean-pull",
  "power-snatch", "hang-snatch", "snatch-pull", "push-press", "push-jerk",
  "box-jump-low", "box-jump-high", "broad-jump", "depth-jump",
  "vertical-jump", "tuck-jump", "pogo-hop", "single-leg-bound",
  "lateral-hop", "hill-bounds",
  "kb-swing-russian", "kb-swing-american",
  "med-ball-slam", "med-ball-chest-pass", "med-ball-rotational-throw",
];

test.describe("@desktop /plan/new wizard — power emphasis", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("toggle ON persists to power_emphasis column and seeds power-tagged accessories", async ({
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
    await page.getByRole("button", { name: /^4( days)?$/ }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 2: focus — strength + flip the power toggle ON.
    await page.getByRole("button", { name: /get stronger/i }).click();
    const powerToggle = page
      .getByRole("button", { pressed: false })
      .filter({ has: page.locator("span.wiz-toggle-knob") })
      .first();
    await expect(powerToggle).toBeVisible();
    await powerToggle.click();
    await expect(
      page
        .getByRole("button", { pressed: true })
        .filter({ has: page.locator("span.wiz-toggle-knob") })
        .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 3: secondary — skip
    await page.getByRole("button", { name: /skip/i }).first().click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 4: review → schedule
    await page.getByRole("button", { name: /continue to schedule/i }).click();

    // Step 5: start
    const startBtn = page.getByRole("button", { name: /start this block/i });
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    await page.waitForURL("**/app/plan", { timeout: 15_000 });

    // ── Assert the column landed as true ──
    const { data: blocks, error: blocksErr } = await admin
      .from("training_blocks")
      .select("id, archetype, power_emphasis")
      .eq("user_id", freshUser.userId)
      .eq("status", "active");
    expect(blocksErr).toBeNull();
    expect(blocks?.length ?? 0).toBe(1);
    const block = blocks![0]!;
    expect(block.archetype).toBe("strength_anchor");
    expect(block.power_emphasis).toBe(true);

    // ── Assert at least one planned_session contains a power-tagged accessory ──
    const { data: planned, error: psErr } = await admin
      .from("planned_sessions")
      .select("prescription")
      .eq("block_id", block.id);
    expect(psErr).toBeNull();
    type Item = { movementSlug?: string; kind?: string };
    type Prescription = { items?: Item[] };
    const allSlugs = (planned ?? [])
      .flatMap((p) => ((p.prescription as Prescription)?.items ?? []) as Item[])
      .map((i) => i.movementSlug ?? "")
      .filter(Boolean);
    const sawPowerSlug = allSlugs.some((s) => POWER_SLUGS.includes(s));
    expect(
      sawPowerSlug,
      `No power-tagged accessory slug in any planned_session prescription. Slugs seen: ${[...new Set(allSlugs)].join(", ")}`,
    ).toBe(true);

    // ── Phase 3 assertions: week 3 (heavy week) main-lift intensity cap + reps rewrite ──
    type Phase3Item = {
      movementSlug?: string;
      kind?: string;
      percentTm?: number;
      reps?: number;
      sets?: number;
    };
    type Phase3Prescription = { items?: Phase3Item[] };
    const { data: week3Sessions, error: w3Err } = await admin
      .from("planned_sessions")
      .select("prescription, role, week_index, day_index")
      .eq("block_id", block.id)
      .eq("week_index", 2); // 0-indexed → week 3 = heavy week for strength_anchor
    expect(w3Err).toBeNull();
    expect((week3Sessions ?? []).length).toBeGreaterThan(0);

    // Find the squat day (role === "squat"). With strength_anchor's
    // week-3 profile (0.75/0.85/0.95 × [5,3,1]), the power transform
    // should cap the top set at 90% TM and rewrite reps to 3.
    const squatDay = (week3Sessions ?? []).find((s) => s.role === "squat");
    expect(squatDay, "Expected a squat planned_session in week 3").toBeTruthy();
    const squatItems = ((squatDay!.prescription as Phase3Prescription)?.items ?? []) as Phase3Item[];
    const mainItems = squatItems.filter((i) => i.kind === "main" && i.percentTm != null);
    expect(mainItems.length).toBeGreaterThan(0);
    for (const m of mainItems) {
      expect(
        m.percentTm! <= 90,
        `Phase 3 cap breached: main set at ${m.percentTm}% TM (expected ≤ 90)`,
      ).toBe(true);
    }
    // Top set (last main item) should now be 3 reps (rewritten from 1 by the > 85% threshold).
    const topMain = [...mainItems].pop()!;
    expect(topMain.percentTm).toBe(90);
    expect(topMain.reps).toBe(3);

    // First prescription item on the squat day should be the PAP/PAPE primer.
    const firstItem = squatItems[0];
    expect(firstItem, "Squat prescription was empty").toBeTruthy();
    expect(firstItem!.kind).toBe("power_potentiation");
    expect(firstItem!.reps ?? 0).toBeGreaterThanOrEqual(3);
    expect(firstItem!.reps ?? 0).toBeLessThanOrEqual(5);
  });

  // ── Wizard UI: power toggle gating + sidebar badge ──
  test("power toggle is hidden on endurance archetype and visible on strength + paints the sidebar badge", async ({
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

    // Step 1 — days
    await page.getByRole("button", { name: /^4( days)?$/ }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 2 — endurance: toggle should NOT be visible.
    await page.getByRole("button", { name: /build cardio/i }).click();
    const togglePresent = await page
      .getByRole("button", { name: /add power emphasis/i })
      .count();
    expect(togglePresent).toBe(0);

    // Re-pick strength — toggle SHOULD be visible.
    await page.getByRole("button", { name: /get stronger/i }).click();
    const powerToggle = page.getByRole("button", { name: /add power emphasis/i });
    await expect(powerToggle).toBeVisible();

    // Sidebar before toggle: no ⚡ Power badge.
    await expect(page.getByTestId("power-emphasis-badge")).toHaveCount(0);

    // Flip the toggle on → badge appears in the sidebar.
    await powerToggle.click();
    const badge = page.getByTestId("power-emphasis-badge");
    await expect(badge).toBeVisible();
    await expect(page.getByTestId("power-emphasis-chip")).toContainText(/power/i);
  });
});
