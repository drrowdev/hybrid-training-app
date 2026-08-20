import { expect, type Page } from "@playwright/test";

/**
 * Shared helpers for the prescription-logging E2E flow.
 *
 * The session UX evolved from a freestyle "search the catalog → fill
 * Weight/Reps → log" flow to a prescription-driven one: a planned session
 * renders a movement queue with one active `MovementFocusView` whose primary
 * CTA (`movement-focus-log-button`) logs the
 * prescribed set with the %TM-resolved weight pre-filled. These helpers encode
 * the current flow so the session-log / program-run specs stay in lockstep with
 * the app (and so a future UX change only needs updating here).
 */

/** Click today's "Start workout" CTA and return the created session id. */
export async function startTodaySession(page: Page): Promise<string> {
  await page.getByRole("link", { name: /start workout/i }).first().click();
  await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, {
    timeout: 30_000,
  });
  return new URL(page.url()).pathname.split("/").pop()!;
}

/**
 * Select the prescribed movement and log its current set
 * via the focus-view CTA. The weight + reps are pre-filled from the
 * prescription (%TM × TM), so no manual entry is needed.
 */
export async function logPrescribedSet(
  page: Page,
  movementId: string,
): Promise<void> {
  const queueItem = page.getByTestId(`focus-strip-queue-${movementId}`);
  await expect(queueItem).toBeVisible({ timeout: 15_000 });
  await queueItem.click();
  const logBtn = page.getByTestId("movement-focus-log-button");
  await expect(logBtn).toBeVisible({ timeout: 15_000 });
  await logBtn.click();
  // Let the background write return its stable set id for immediate inline edits.
  await page.waitForTimeout(900);
}

/**
 * Finish the in-progress session. The Finish bar now completes inline
 * (no /complete interstitial): submitting it stamps `completed_at` and
 * redirects back to the session detail, which renders the summary.
 *
 * While required sets are still outstanding the action lives in the header's
 * ⋯ menu instead of the bottom bar, so open the menu when the bar is absent.
 */
export async function finishAndCompleteSession(
  page: Page,
  sessionId: string,
): Promise<void> {
  const bar = page.getByTestId("finish-stickybar");
  if ((await bar.count()) === 0 || !(await bar.first().isVisible())) {
    await page.getByLabel("More actions").click();
  }
  await bar
    .getByRole("button", { name: /finish session/i })
    .click();
  await page.waitForURL(`**/app/sessions/${sessionId}`, { timeout: 30_000 });
  // Completion is confirmed by the post-session summary card rendering (the
  // in-progress "session in progress" banner was removed as redundant).
  await expect(page.getByTestId("post-session-summary")).toBeVisible({
    timeout: 30_000,
  });
}
