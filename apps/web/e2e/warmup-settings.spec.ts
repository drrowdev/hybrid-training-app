import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

/**
 * Warmup-ladder settings desktop spec.
 *
 * Verifies:
 *  - The /app/settings/training page renders the warmup editor.
 *  - Switching to "Quick 2-set" preset updates the preview, save
 *    writes the scheme to profiles.warmup_scheme, and reload keeps
 *    the preset selected.
 *  - A fresh block created AFTER setting Quick 2-set seeds two warmup
 *    items before each main lift in the planned prescription (the
 *    wizard fires createBlock which honours the freshly written
 *    scheme).
 *
 * Existing blocks are forward-only — they are not retroactively
 * patched with warmups, so we drive the wizard end-to-end here.
 */
test.describe("@desktop /app/settings/training · warmup ladder", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("user can pick a preset and new blocks gain warmup items", async ({
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

    await signInAs(context, freshUser, seedConfig, url);
    await page.goto("/app/settings/training");
    await page.waitForLoadState("networkidle");

    // Editor + default preview render.
    await expect(page.getByTestId("warmup-settings-form")).toBeVisible();
    const preset = page.getByTestId("warmup-preset-select");
    await expect(preset).toBeVisible();

    // Switch to Quick 2-set: 50% / 65% × 5 / 3 against an 85% top set
    // resolves to 42.5% × 5 and 55.5% × 3 (rounded to nearest 0.5%).
    await preset.selectOption("quick");
    await expect(page.getByTestId("warmup-preview-0")).toContainText(
      /Warmup 1: 42\.5% TM × 5/i,
    );
    await expect(page.getByTestId("warmup-preview-1")).toContainText(
      /Warmup 2: 55(\.\d+)?% TM × 3/i,
    );

    // Save and verify the DB write.
    await page.getByTestId("warmup-settings-save").click();
    await expect(page.getByTestId("warmup-settings-saved")).toBeVisible({
      timeout: 5_000,
    });

    const { data: profile } = await admin
      .from("profiles")
      .select("warmup_scheme")
      .eq("id", freshUser.userId)
      .maybeSingle();
    const scheme = profile?.warmup_scheme as {
      setCount: number;
      percentLadder: number[];
      repLadder: number[];
    } | null;
    expect(scheme?.setCount).toBe(2);
    expect(scheme?.percentLadder).toEqual([50, 65]);
    expect(scheme?.repLadder).toEqual([5, 3]);

    // Reload and confirm the preset sticks.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("warmup-preset-select")).toHaveValue("quick");

    // Drive the wizard so createBlock fires with the freshly written
    // warmup_scheme and prepends two warmup items before each main lift.
    await page.goto("/app/plan/new");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /build a new block/i }).click();
    await page.getByRole("button", { name: /^4( days)?$/ }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /get stronger/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /skip/i }).first().click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /continue to schedule/i }).click();
    await page.getByRole("button", { name: /start this block/i }).click();
    await page.waitForURL("**/app/plan", { timeout: 15_000 });

    // Inspect any one of the strength planned sessions for the new
    // active block — the first two items must be warmup-kind.
    const { data: blocks } = await admin
      .from("training_blocks")
      .select("id")
      .eq("user_id", freshUser.userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);
    const blockId = blocks?.[0]?.id as string;
    expect(blockId).toBeTruthy();

    const { data: planned } = await admin
      .from("planned_sessions")
      .select("prescription, role")
      .eq("block_id", blockId);
    // At least one strength planned session must lead with two warmups.
    const strengthRows = (planned ?? []).filter((r) => {
      const items = (r.prescription as { items: Array<{ kind: string }> }).items;
      return items.some((i) => i.kind === "main");
    });
    expect(strengthRows.length).toBeGreaterThan(0);
    for (const row of strengthRows) {
      const items = (row.prescription as { items: Array<{ kind: string }> }).items;
      const firstNonWarmup = items.findIndex((i) => i.kind !== "warmup");
      const leadingWarmups = items.slice(
        0,
        firstNonWarmup === -1 ? items.length : firstNonWarmup,
      );
      expect(leadingWarmups.length).toBe(2);
      expect(leadingWarmups.every((i) => i.kind === "warmup")).toBe(true);
    }
  });
});

