import { expect, type Page } from "@playwright/test";

/**
 * Shared helpers for the prescription-logging E2E flow.
 *
 * The session UX evolved from a freestyle "search the catalog → fill
 * Weight/Reps → log" flow to a prescription-driven one: a planned session
 * renders an accordion of `MovementCard`s, each expanding to a
 * `MovementFocusView` whose primary CTA (`movement-focus-log-button`) logs the
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
 * Expand the prescribed movement card (if collapsed) and log its current set
 * via the focus-view CTA. The weight + reps are pre-filled from the
 * prescription (%TM × TM), so no manual entry is needed.
 */
export async function logPrescribedSet(
  page: Page,
  movementId: string,
): Promise<void> {
  const header = page.getByTestId(`movement-card-header-${movementId}`);
  await expect(header).toBeVisible({ timeout: 15_000 });
  if ((await header.getAttribute("aria-expanded")) === "false") {
    await header.click();
  }
  const logBtn = page.getByTestId("movement-focus-log-button");
  await expect(logBtn).toBeVisible({ timeout: 15_000 });
  await logBtn.click();
  // The button briefly shows "Logging…" then the server action revalidates.
  await page.waitForTimeout(900);
}

/**
 * Finish the in-progress session. The Finish bar now completes inline
 * (no /complete interstitial): submitting it stamps `completed_at` and
 * redirects back to the session detail, which renders the summary.
 */
export async function finishAndCompleteSession(
  page: Page,
  sessionId: string,
): Promise<void> {
  await page
    .getByTestId("finish-stickybar")
    .getByRole("button", { name: /finish session/i })
    .click();
  await page.waitForURL(`**/app/sessions/${sessionId}`, { timeout: 30_000 });
  // Completion is confirmed by the status banner flipping to "complete".
  await expect(page.getByTestId("session-status-banner")).toHaveAttribute(
    "data-state",
    "complete",
    { timeout: 30_000 },
  );
}
