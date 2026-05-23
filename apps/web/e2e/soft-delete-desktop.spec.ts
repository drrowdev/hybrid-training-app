import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import { seedActiveBlock } from "./fixtures/session-log";

/**
 * Soft-delete + undo banner + Trash page — desktop coverage.
 *
 * Two scenarios:
 *
 *   A — Session soft-delete + Undo + Trash + Permanent delete:
 *       seed a session, soft-delete from the sessions list, assert the
 *       undo banner appears, click Undo, assert the session is back in
 *       the list. Then delete again, navigate to /app/settings/trash,
 *       click Recover to restore. Finally soft-delete one more time,
 *       open the type-to-confirm modal, type the date, click Delete,
 *       and verify the row is hard-deleted via service-role.
 *
 *   B — Block soft-delete via /app/plan/history → undo banner:
 *       seed an active block (which auto-archives any prior active
 *       block via createBlock), open the kebab menu on the block card,
 *       click Delete this block, verify the undo banner pops, assert
 *       the block is filtered out of the history list, and that
 *       service-role sees `deleted_at` populated.
 *
 * Auth is injected via cookie (same pattern as session-log-desktop).
 */

test.describe("@desktop soft-delete + undo + trash", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("A: session — delete → undo → re-delete → recover → permanently delete", async ({
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

    // Seed a standalone, completed session — independent of any block.
    // Performed_at is fixed so the type-to-confirm token is predictable.
    const performedAt = "2026-04-22T10:00:00Z";
    const { data: inserted, error: insertErr } = await admin
      .from("sessions")
      .insert({
        user_id: freshUser.userId,
        title: "Trash test session",
        performed_at: performedAt,
        completed_at: performedAt,
      })
      .select("id")
      .single();
    expect(insertErr).toBeNull();
    const sessionId = inserted!.id as string;

    // 1) /app/sessions list shows the row.
    await page.goto("/app/sessions");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("link", { name: /trash test session/i })).toBeVisible();

    // 2) Click the trash button — soft-delete fires, undo banner pops.
    const deleteBtn = page.getByTestId("delete-session-button").first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    const banner = page.getByTestId("undo-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toHaveAttribute("data-kind", "session");
    await expect(banner).toHaveAttribute("data-id", sessionId);

    // Service-role: deleted_at is populated, row not removed.
    let { data: afterDelete } = await admin
      .from("sessions")
      .select("id, deleted_at")
      .eq("id", sessionId)
      .maybeSingle();
    expect(afterDelete?.deleted_at).not.toBeNull();

    // List no longer shows the row (filtered by deleted_at IS NULL).
    await expect(page.getByRole("link", { name: /trash test session/i })).toHaveCount(0);

    // 3) Click Undo — restore fires, banner dismisses, row returns.
    await page.getByTestId("undo-banner-undo").click();
    await expect(banner).toBeHidden({ timeout: 5_000 });
    await expect(page.getByRole("link", { name: /trash test session/i })).toBeVisible({
      timeout: 10_000,
    });
    ({ data: afterDelete } = await admin
      .from("sessions")
      .select("deleted_at")
      .eq("id", sessionId)
      .maybeSingle());
    expect(afterDelete?.deleted_at).toBeNull();

    // 4) Delete again, then go to the Trash page.
    await page.getByTestId("delete-session-button").first().click();
    await expect(page.getByTestId("undo-banner")).toBeVisible();
    await page.goto("/app/settings/trash");
    await page.waitForLoadState("networkidle");
    const trashRow = page.getByTestId("trash-item").filter({ hasText: /trash test session/i }).first();
    await expect(trashRow).toBeVisible();

    // 5) Recover from Trash.
    await trashRow.getByTestId("recover-button").click();
    await expect(trashRow).toBeHidden({ timeout: 10_000 });
    ({ data: afterDelete } = await admin
      .from("sessions")
      .select("deleted_at")
      .eq("id", sessionId)
      .maybeSingle());
    expect(afterDelete?.deleted_at).toBeNull();

    // 6) Delete one final time, then permanently delete via Trash modal.
    await page.goto("/app/sessions");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("delete-session-button").first().click();
    await page.goto("/app/settings/trash");
    await page.waitForLoadState("networkidle");
    const trashRow2 = page
      .getByTestId("trash-item")
      .filter({ hasText: /trash test session/i })
      .first();
    await expect(trashRow2).toBeVisible();
    await trashRow2.getByTestId("permanent-delete-trigger").click();
    const modal = page.getByTestId("confirm-delete-modal");
    await expect(modal).toBeVisible();

    // Confirm button is disabled until the date is typed.
    const confirmBtn = page.getByTestId("confirm-delete-confirm");
    await expect(confirmBtn).toBeDisabled();
    // performed_at slice (YYYY-MM-DD).
    await page.getByTestId("confirm-delete-input").fill("2026-04-22");
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Service-role: row is gone.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("sessions")
            .select("id")
            .eq("id", sessionId)
            .maybeSingle();
          return data;
        },
        { timeout: 10_000 },
      )
      .toBeNull();
  });

  test("B: block — delete from history pops undo banner and filters list", async ({
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

    await page.goto("/app/plan/history");
    await page.waitForLoadState("networkidle");

    const blockRow = page
      .getByTestId("block-history-row")
      .filter({ has: page.locator(`[data-block-id="${seed.blockId}"]`) })
      .first();
    // The first kebab in the list belongs to the most-recent block — the
    // one we just seeded (createBlock orders by started_on DESC).
    await page.getByTestId("block-actions-trigger").first().click();
    await page.getByTestId("delete-block-menu-item").first().click();

    const banner = page.getByTestId("undo-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toHaveAttribute("data-kind", "block");
    await expect(banner).toHaveAttribute("data-id", seed.blockId);

    // Service-role: deleted_at populated; row not removed.
    const { data: afterDelete } = await admin
      .from("training_blocks")
      .select("id, deleted_at")
      .eq("id", seed.blockId)
      .maybeSingle();
    expect(afterDelete?.deleted_at).not.toBeNull();

    // History list filters it out.
    await expect(blockRow).toHaveCount(0);

    // Trash page shows the block, recover puts it back.
    await page.goto("/app/settings/trash");
    await page.waitForLoadState("networkidle");
    const trashBlock = page
      .getByTestId("trash-item")
      .filter({ hasText: /strength focus/i })
      .first();
    await expect(trashBlock).toBeVisible();
    await trashBlock.getByTestId("recover-button").click();
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("training_blocks")
            .select("deleted_at")
            .eq("id", seed.blockId)
            .maybeSingle();
          return data?.deleted_at;
        },
        { timeout: 10_000 },
      )
      .toBeNull();
  });
});
