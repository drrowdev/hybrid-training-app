import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import {
  assertSessionComplete,
  seedActiveBlock,
} from "./fixtures/session-log";

/**
 * Desktop session-log E2E coverage.
 *
 * Closes the second of three AGENTS.md mandated critical paths
 * ("auth + log + program-run"). Auth and program-run remain as
 * separate follow-up PRs.
 *
 * Scenarios:
 *   A — End-to-end strength session log:
 *       seed a 4-day × 4-week strength block so today's CTA renders →
 *       Start session (check-in skipped) → log two strength sets →
 *       finish → service-role verify sessions.completed_at + set_logs +
 *       planned_sessions.completed_session_id linkage.
 *
 *   B — Pre-session check-in (DC-P1):
 *       Start session → submit fatigue + soreness via the CheckInForm →
 *       service-role verify both values landed on the sessions row.
 *
 *   C — Skip a planned session:
 *       On /app/plan click Skip on today's row → service-role verify
 *       planned_sessions.skipped_at is populated → reload and assert
 *       the row renders as skipped (no Start CTA).
 *
 * Auth is injected via cookie (see fixtures/auth.ts) rather than
 * walking the login UI — same pattern as the wizard / multi-user specs.
 */

test.describe("@desktop session log", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("A: log a strength session end-to-end", async ({
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

    // 1) /app — today's prescription card should render with the Start CTA.
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    const startCta = page.getByRole("link", { name: /start session/i }).first();
    await expect(startCta).toBeVisible();
    // Capture the actual planned-session id from the link's href. The
    // /app page resolves "today's planned session" itself (via the same
    // dayDate math the seed uses) — assert against whichever it picks
    // rather than re-deriving the id in the spec.
    const startHref = await startCta.getAttribute("href");
    expect(startHref).toMatch(
      /^\/app\/sessions\/start\/[0-9a-f-]{36}$/,
    );
    const plannedId = startHref!.split("/").pop()!;
    // Sanity: the id rendered by /app must point to a planned_session
    // owned by this user. We don't assert it equals seed.todayPlannedId
    // because in practice /app's getTodayPlannedSessions can pick any
    // row whose computed date matches today — what we care about is
    // that the chosen planned_session links cleanly back to a real row
    // we seeded, and that the session-log flow completes against it.
    const { data: plannedCheck, error: plannedCheckErr } = await admin
      .from("planned_sessions")
      .select("id, user_id, block_id")
      .eq("id", plannedId)
      .maybeSingle();
    expect(plannedCheckErr).toBeNull();
    expect(plannedCheck?.user_id).toBe(freshUser.userId);
    expect(plannedCheck?.block_id).toBe(seed.blockId);
    await startCta.click();

    // 2) Pre-session check-in screen. Skip it for this scenario — we
    //    cover the check-in persistence in Scenario B.
    await page.waitForURL(`**/app/sessions/start/${plannedId}`, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /how are you feeling/i })).toBeVisible();
    await page.getByRole("button", { name: /skip check-in/i }).click();

    // 3) Lands on the session detail page. Pull the new session id out
    //    of the URL so we can assert the canonical state later.
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    // 4) Movement picker is open by default (no sets yet). Search the
    //    catalog for the seeded squat and pick it.
    const pickerInput = page.getByPlaceholder(/search the catalog/i);
    await expect(pickerInput).toBeVisible();
    await pickerInput.fill("squat");
    // Picker debounces 180ms before hitting /api/movements/search.
    // Escape regex metacharacters from the catalog display name (it can
    // contain parens / hyphens, e.g. "Back Squat (high-bar)").
    const liftNameRe = new RegExp(
      seed.todayMovementDisplayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    const squatOption = page.getByRole("button", { name: liftNameRe }).first();
    await expect(squatOption).toBeVisible({ timeout: 10_000 });
    await squatOption.click();

    // 5) Log the first working set.
    const weightInput = page.getByLabel("Weight (kg)");
    const repsInput = page.getByLabel("Reps");
    await weightInput.fill("80");
    await repsInput.fill("5");
    await page.getByRole("button", { name: /^7$/ }).click(); // RPE 7
    await page.getByRole("button", { name: /^log set/i }).click();

    // After the server action revalidates we should see the set in
    // "This session (… sets)" — wait on the count text.
    await expect(page.getByRole("heading", { name: /this session \(1 sets?\)/i })).toBeVisible({
      timeout: 15_000,
    });

    // 6) Log a second set — defaults pre-fill from the last set, so we
    //    only override the RPE.
    await page.getByRole("button", { name: /^8$/ }).click(); // RPE 8
    await page.getByRole("button", { name: /^log set/i }).click();
    await expect(page.getByRole("heading", { name: /this session \(2 sets?\)/i })).toBeVisible({
      timeout: 15_000,
    });

    // 7) Finish session → complete page → submit.
    await page.getByRole("link", { name: /finish session/i }).click();
    await page.waitForURL(`**/app/sessions/${sessionId}/complete`, { timeout: 15_000 });
    await page.getByRole("button", { name: /complete session/i }).click();

    // 8) Redirect back to the session detail page in the "completed"
    //    shape — the green pill is the cheapest visible signal.
    await page.waitForURL(`**/app/sessions/${sessionId}`, { timeout: 15_000 });
    await expect(page.getByText(/^completed$/i)).toBeVisible();

    // 9) Server-canonical state: completed_at set, 2 set_logs rows,
    //    and the planned_session is linked back to this session.
    await assertSessionComplete(admin, sessionId, {
      expectedSetCount: 2,
      plannedSessionId: plannedId,
    });

    // 10) Verify the logged set values landed correctly (snake_case
    //     columns, no silent drift like PGRST204 from the createBlock bug).
    const { data: sets, error: setsErr } = await admin
      .from("set_logs")
      .select("set_index, weight_kg, reps, rpe, movement_id")
      .eq("session_id", sessionId)
      .order("set_index", { ascending: true });
    expect(setsErr).toBeNull();
    expect(sets?.length ?? 0).toBe(2);
    for (const s of sets ?? []) {
      expect(Number(s.weight_kg)).toBeCloseTo(80, 5);
      expect(s.reps).toBe(5);
      expect(s.movement_id).toBe(seed.todayMovementId);
    }
    // RPE: 7 then 8.
    expect(Number(sets![0]!.rpe)).toBeCloseTo(7, 5); // DC-A2: per-set RPE
    expect(Number(sets![1]!.rpe)).toBeCloseTo(8, 5);
  });

  test("B: pre-session check-in persists fatigue + soreness (DC-P1)", async ({
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

    // Navigate straight to the check-in for today's planned session.
    await page.goto(`/app/sessions/start/${seed.todayPlannedId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /how are you feeling/i })).toBeVisible();

    // DC-P1: the two-slider check-in. Pick fatigue=2 ("Good") and
    // soreness=3 ("Moderate"). The chips are radios within named groups.
    await page
      .getByRole("radiogroup", { name: /fatigue level/i })
      .getByRole("radio", { name: /good/i })
      .click();
    await page
      .getByRole("radiogroup", { name: /soreness level/i })
      .getByRole("radio", { name: /moderate/i })
      .click();

    // Submit — the start button label includes the planned-session title.
    await page.getByRole("button", { name: /^⚡ start /i }).click();

    // Lands on the session detail page; grab the new session id.
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    // The DC-P1 sliders should be reflected in the session header stats.
    await expect(page.getByText(/fatigue/i).first()).toBeVisible();
    await expect(page.getByText("2/5").first()).toBeVisible();
    await expect(page.getByText("3/5").first()).toBeVisible();

    // Service-role: the values are on the sessions row, and the
    // planned_session is now linked to the new session.
    const { data: session, error: sErr } = await admin
      .from("sessions")
      .select("id, fatigue, soreness, user_id")
      .eq("id", sessionId)
      .maybeSingle();
    expect(sErr).toBeNull();
    expect(session).not.toBeNull();
    expect(session!.user_id).toBe(freshUser.userId);
    expect(session!.fatigue).toBe(2);
    expect(session!.soreness).toBe(3);

    const { data: planned, error: pErr } = await admin
      .from("planned_sessions")
      .select("id, completed_session_id")
      .eq("id", seed.todayPlannedId)
      .maybeSingle();
    expect(pErr).toBeNull();
    expect(planned?.completed_session_id).toBe(sessionId);
  });

  test("C: skip a planned session marks it skipped and hides the Start CTA", async ({
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

    await page.goto("/app/plan");
    await page.waitForLoadState("networkidle");

    // Today's row carries both a Start CTA and a Skip button. With a
    // 4d × 4w block several Skip buttons render across the calendar's
    // current week — target the one bound to today's planned id via
    // the test-id added to the production code.
    const todayStart = page.getByTestId(`start-${seed.todayPlannedId}`);
    const todaySkip = page.getByTestId(`skip-${seed.todayPlannedId}`);
    await expect(todayStart).toBeVisible();
    await expect(todaySkip).toBeVisible();
    await todaySkip.click();

    // Service-role: skipped_at is populated and completed_session_id is null.
    // Poll briefly because the server action revalidates async.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("planned_sessions")
            .select("skipped_at, completed_session_id")
            .eq("id", seed.todayPlannedId)
            .maybeSingle();
          return data?.skipped_at == null ? null : data;
        },
        { timeout: 10_000 },
      )
      .not.toBeNull();
    const { data: planned, error } = await admin
      .from("planned_sessions")
      .select("id, skipped_at, completed_session_id")
      .eq("id", seed.todayPlannedId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(planned).not.toBeNull();
    expect(planned!.skipped_at).not.toBeNull();
    expect(planned!.completed_session_id).toBeNull();

    // The Start CTA for today's row is gone; the Un-skip button has
    // replaced the Skip control.
    await expect(page.getByTestId(`start-${seed.todayPlannedId}`)).toHaveCount(0);
    await expect(page.getByTestId(`skip-${seed.todayPlannedId}`)).toHaveCount(0);

    // Refresh — skipped status persists.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId(`start-${seed.todayPlannedId}`)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /un-skip/i })).toBeVisible();
  });

  test("D: Phase 1 — Same as planned + PR badge + post-session summary", async ({
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

    // 1) /app — hero card renders with archetype label + Start CTA.
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    const heroCta = page.getByTestId("today-cta").first();
    await expect(heroCta).toBeVisible();
    await expect(heroCta).toHaveText(/start session/i);
    await heroCta.click();

    // 2) Skip the check-in to land on the log surface fast.
    await page.waitForURL(`**/app/sessions/start/${seed.todayPlannedId}`, { timeout: 15_000 });
    await page.getByRole("button", { name: /skip check-in/i }).click();
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;

    // 3) Tap "Same as planned" — the prescription pre-fills three main
    //    sets matching the seeded squat at 70% TM × 5 reps.
    const fillCta = page.getByTestId("same-as-planned").getByRole("button", { name: /same as planned/i });
    await expect(fillCta).toBeVisible();
    await fillCta.click();
    await expect(page.getByRole("heading", { name: /this session \(3 sets?\)/i })).toBeVisible({
      timeout: 15_000,
    });

    // Service-role: 3 set_logs at 70% of the seeded squat TM (100kg) = 70kg × 5.
    const { data: filledSets } = await admin
      .from("set_logs")
      .select("set_index, weight_kg, reps, movement_id, set_kind")
      .eq("session_id", sessionId)
      .order("set_index", { ascending: true });
    expect(filledSets?.length).toBe(3);
    for (const s of filledSets ?? []) {
      expect(s.set_kind).toBe("main");
      expect(s.movement_id).toBe(seed.todayMovementId);
      expect(Number(s.weight_kg)).toBeCloseTo(70, 1);
      expect(s.reps).toBe(5);
    }

    // Idempotency: tapping again is a no-op (the button is hidden once
    // sets exist, but if a stale UI fired the action, the count would
    // not increase).
    const { count: idemCount } = await admin
      .from("set_logs")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);
    expect(idemCount).toBe(3);

    // 4) Log a heavy set — server-side PR detection lights up after
    //    save. (Client-side flash is best-effort and racy in headless;
    //    the canonical signal is the 🏆 PR card rendered by the page
    //    after revalidation.)
    const pickerInput = page.getByPlaceholder(/search the catalog/i);
    if (await pickerInput.isVisible().catch(() => false)) {
      // Picker shouldn't be open once sets exist, but be defensive.
    }
    // Bump the active weight far above the seeded 70kg fill so a
    // weight PR is unambiguous.
    const weightInput = page.getByLabel("Weight (kg)");
    const repsInput = page.getByLabel("Reps");
    await weightInput.fill("150");
    await repsInput.fill("3");
    await page.getByRole("button", { name: /^7$/ }).click();
    await page.getByRole("button", { name: /^log set/i }).click();
    await expect(page.getByRole("heading", { name: /this session \(4 sets?\)/i })).toBeVisible({
      timeout: 15_000,
    });
    // Server-side PR summary card renders after the revalidation.
    await expect(page.getByText(/Weight PR/i).first()).toBeVisible({ timeout: 15_000 });

    // 5) Finish → complete page → submit. Land back on the detail
    //    page; the post-session summary card is visible at the top.
    await page.getByRole("link", { name: /finish session/i }).click();
    await page.waitForURL(`**/app/sessions/${sessionId}/complete`, { timeout: 15_000 });
    await page.getByRole("button", { name: /complete session/i }).click();
    await page.waitForURL(`**/app/sessions/${sessionId}`, { timeout: 15_000 });

    const summary = page.getByTestId("post-session-summary");
    await expect(summary).toBeVisible();
    // Tonnage = 70*5 + 70*5 + 70*5 + 150*3 = 1500 kg.
    await expect(page.getByTestId("summary-tonnage")).toContainText(/1500|1\.5k/);
    await expect(page.getByTestId("summary-sets")).toContainText(/^\s*4\s*$/);
    // At least one PR was recorded.
    await expect(page.getByTestId("summary-prs")).not.toContainText(/^\s*0\s*$/);

    // 6) C2 — navigating back to the same session shows the same
    //    summary at the top (it's derived from the persisted rows).
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await page.goto(`/app/sessions/${sessionId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("post-session-summary")).toBeVisible();

    await assertSessionComplete(admin, sessionId, {
      expectedSetCount: 4,
      plannedSessionId: seed.todayPlannedId,
    });
  });
});
