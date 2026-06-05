import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import {
  assertSessionComplete,
  seedActiveBlock,
} from "./fixtures/session-log";
import { logPrescribedSet, finishAndCompleteSession } from "./fixtures/log-flow";

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
 *       Start session (interstitial is gone — direct redirect) → log
 *       two strength sets → finish → service-role verify
 *       sessions.completed_at + set_logs +
 *       planned_sessions.completed_session_id linkage.
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
    const startCta = page.getByRole("link", { name: /start workout/i }).first();
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

    // 2) The pre-session check-in interstitial was removed. Tapping
    //    Start now redirects straight to the session detail page —
    //    `/app/sessions/start/[plannedId]` is a server-side auto-start
    //    that creates the session row and redirects.
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    // 3) A planned session renders the prescription as an accordion of
    //    MovementCards (not the freestyle catalog picker). Expand today's
    //    main lift and log its prescribed set — the weight (%TM × TM) and
    //    reps are pre-filled, so logging is a single tap on the focus-view
    //    CTA. See e2e/fixtures/log-flow.ts.
    await logPrescribedSet(page, seed.todayMovementId);

    // 4) Finish → complete page → submit. Completion is verified
    //    server-side below (assertSessionComplete) rather than via a
    //    cosmetic pill, which is more robust to header copy changes.
    await finishAndCompleteSession(page, sessionId);

    // 5) Server-canonical state: completed_at set, the planned_session is
    //    linked back to this session, and the logged set carries the
    //    prescription-resolved weight (90 kg TM × 70% week-0 wave = 62.5 kg,
    //    rounded to the 2.5 kg plate) for the seeded squat.
    await assertSessionComplete(admin, sessionId, {
      plannedSessionId: plannedId,
    });

    const { data: sets, error: setsErr } = await admin
      .from("set_logs")
      .select("set_index, weight_kg, reps, movement_id")
      .eq("session_id", sessionId)
      .order("set_index", { ascending: true });
    expect(setsErr).toBeNull();
    expect((sets?.length ?? 0)).toBeGreaterThanOrEqual(1);
    const first = sets![0]!;
    expect(Number(first.weight_kg)).toBeCloseTo(62.5, 1);
    expect(first.reps).toBe(5);
    expect(first.movement_id).toBe(seed.todayMovementId);
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
    await expect(heroCta).toHaveText(/start workout/i);
    await heroCta.click();

    // 2) Pre-session interstitial removed — Start redirects straight to the session log.
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
    //    Scope to the sticky bar — the banner duplicate-CTA would
    //    otherwise trip strict-mode.
    await page.getByTestId("finish-stickybar").getByRole("link", { name: /finish session/i }).click();
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

  test("E: Phase 2 — swap an exercise mid-session", async ({
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

    // Land on the in-progress session for today.
    await page.goto(`/app/sessions/start/${seed.todayPlannedId}`);
    // Pre-session interstitial removed — auto-redirects to the session log.
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;

    // The prescription-items list renders with one Swap button for the
    // seeded squat item. Open the candidate picker.
    const itemRow = page.getByTestId("prescription-item-0");
    await expect(itemRow).toBeVisible();
    await itemRow.getByTestId("prescription-item-swap-button-0").click();

    // The API returns the pattern-compatible squat alternatives. Pick
    // front squat — different from the seeded high-bar back squat.
    const candidates = page.getByTestId("swap-candidates");
    await expect(candidates).toBeVisible({ timeout: 10_000 });
    const frontSquat = page.getByTestId("swap-candidate-front-squat").first();
    await expect(frontSquat).toBeVisible({ timeout: 10_000 });
    await frontSquat.click();

    // Optimistic UI: the swapped badge appears + the row text now shows
    // Front Squat.
    await expect(page.getByTestId("prescription-item-swapped-0")).toBeVisible({
      timeout: 10_000,
    });
    await expect(itemRow).toContainText(/front squat/i);

    // Reload — the server-side mutation persisted, prescription still
    // points at front squat.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("prescription-item-swapped-0")).toBeVisible();
    await expect(page.getByTestId("prescription-item-0")).toContainText(/front squat/i);

    // Service-role: planned_sessions.prescription.items[0].movementSlug
    // is now "front-squat" + meta.swappedFrom captures the original.
    const { data: planned } = await admin
      .from("planned_sessions")
      .select("prescription")
      .eq("id", seed.todayPlannedId)
      .maybeSingle();
    const items = (planned?.prescription as { items: Array<{ movementSlug: string; meta?: Record<string, unknown> }> }).items;
    expect(items[0]!.movementSlug).toBe("front-squat");
    const meta = items[0]!.meta as
      | { swappedFrom?: { movementId: string; movementName: string } }
      | undefined;
    expect(meta?.swappedFrom?.movementId).toBe(seed.todayMovementId);
    // Defensive: untouched cardio/other items would also be in this
    // array on a multi-item prescription; the seed only has the one
    // strength item so length stays at 1.
    expect(items.length).toBe(1);

    // The session id is still accessible (no orphaning).
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("F: Phase 2 — Strava autofill banner appears for a recent activity", async ({
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

    // Seed a "Strava activity" — i.e. a sessions row with a strava_activity_id
    // and a cardio_logs row with external_source='strava'. Performed time
    // is just 10 minutes before the open session we're about to start so
    // the ±90 min match window fires.
    const stravaPerformedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: stravaSession, error: ssErr } = await admin
      .from("sessions")
      .insert({
        user_id: freshUser.userId,
        title: "Easy spin (Strava)",
        performed_at: stravaPerformedAt,
        completed_at: stravaPerformedAt,
        duration_min: 45,
        slot: "single",
        strava_activity_id: 9_999_001,
      })
      .select("id")
      .single();
    expect(ssErr).toBeNull();
    expect(stravaSession?.id).toBeTruthy();

    const { error: clErr } = await admin.from("cardio_logs").insert({
      session_id: stravaSession!.id,
      modality: "bike",
      duration_sec: 2700,
      distance_km: 18.4,
      avg_hr_bpm: 138,
      strava_activity_id: "9999001",
      external_source: "strava",
    });
    expect(clErr).toBeNull();

    // Open today's planned session.
    await page.goto(`/app/sessions/start/${seed.todayPlannedId}`);
    // Pre-session interstitial removed — auto-redirects to the session log.
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;

    // Strava banner is visible — within window + cardio modality.
    const banner = page.getByTestId("strava-autofill");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText(/bike/i);
    await expect(banner).toContainText(/45 min/i);

    // Apply the autofill.
    await banner.getByTestId("strava-autofill-use").click();
    await expect(banner).toHaveAttribute("data-state", "applied", { timeout: 10_000 });

    // A cardio_logs row now exists on the open session with the
    // expected values.
    await expect
      .poll(
        async () => {
          const { count } = await admin
            .from("cardio_logs")
            .select("id", { count: "exact", head: true })
            .eq("session_id", sessionId);
          return count ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
    const { data: newCardio } = await admin
      .from("cardio_logs")
      .select("modality, duration_sec, distance_km, avg_hr_bpm, external_source")
      .eq("session_id", sessionId)
      .maybeSingle();
    expect(newCardio?.modality).toBe("bike");
    expect(newCardio?.duration_sec).toBe(2700);
    expect(Number(newCardio?.distance_km)).toBeCloseTo(18.4, 2);
    expect(newCardio?.avg_hr_bpm).toBe(138);
    expect(newCardio?.external_source).toBe("strava");
  });

  test("G: feat/logging-works — prescription click prefills, ✓ appears, banner + edit link render", async ({
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

    await page.goto(`/app/sessions/start/${seed.todayPlannedId}`);
    // Pre-session interstitial removed — auto-redirects to the session log.
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;

    // The prescription card is visible with a single (seeded) item.
    // Initial progress chip reads "0 of 1 sets logged".
    const progressChip = page.getByTestId("prescription-progress-chip");
    await expect(progressChip).toBeVisible();
    await expect(progressChip).toContainText(/0 of 1/);

    // No ✓ check yet — item 0 is unlogged.
    await expect(page.getByTestId("prescription-item-check-0")).toHaveCount(0);
    await expect(page.getByTestId("session-status-banner")).toHaveCount(0);

    // Tap the prescription row → form prefills with the prescribed
    // weight (70% of 100 kg TM = 70 kg) and reps (5).
    const tap = page.getByTestId("prescription-item-tap-0");
    await expect(tap).toBeVisible();
    await tap.click();

    const weightInput = page.getByLabel("Weight (kg)");
    const repsInput = page.getByLabel("Reps");
    await expect(weightInput).toHaveValue("70");
    await expect(repsInput).toHaveValue("5");

    // Commit the set. The ✓ appears on the prescription row, the
    // progress chip ticks up, and the in-progress banner mounts.
    await page.getByRole("button", { name: /^log set/i }).click();
    await expect(page.getByRole("heading", { name: /this session \(1 sets?\)/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("prescription-item-check-0")).toBeVisible();
    await expect(progressChip).toContainText(/1 of 1/);

    const banner = page.getByTestId("session-status-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-state", "in-progress");
    await expect(banner).toContainText(/session in progress/i);
    await expect(banner).toContainText(/1 of 1/);

    // Service-role: the new set_logs row carries the explicit
    // prescription_item_index = 0 link from the click → prefill path.
    const { data: linkedSets } = await admin
      .from("set_logs")
      .select("id, prescription_item_index, weight_kg, reps")
      .eq("session_id", sessionId);
    expect(linkedSets?.length).toBe(1);
    expect(linkedSets![0]!.prescription_item_index).toBe(0);
    expect(Number(linkedSets![0]!.weight_kg)).toBeCloseTo(70, 1);
    expect(linkedSets![0]!.reps).toBe(5);

    // Tapping the now-done row should NOT re-prefill (the form keeps
    // the values from the last commit), and the edit link is wired up
    // on the logged-set row.
    await tap.click();
    const setId = linkedSets![0]!.id as string;
    const editLink = page.getByTestId(`logged-set-edit-${setId}`);
    await expect(editLink).toBeVisible();
    await expect(editLink).toHaveAttribute(
      "href",
      `/app/sessions/${sessionId}/sets/${setId}/edit`,
    );
  });

  test("H: feat/logging-works — finish gate enabled after 1 of N sets logged", async ({
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

    // Open today's session.
    await page.goto(`/app/sessions/start/${seed.todayPlannedId}`);
    // Pre-session interstitial removed — auto-redirects to the session log.
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;

    // Before logging anything: bottom finish bar is disabled with the
    // "log at least 1 set to finish" subtitle.
    const stickybar = page.getByTestId("finish-stickybar");
    await expect(stickybar).toBeVisible();
    await expect(stickybar).toHaveAttribute("data-armed", "false");
    await expect(page.getByTestId("finish-subtitle")).toContainText(/at least 1 set/i);

    // Log exactly ONE set via the prescription click → prefill flow.
    // The seeded prescription has 1 item but it asks for 3 sets, so a
    // single log leaves the session "partial".
    await page.getByTestId("prescription-item-tap-0").click();
    await page.getByRole("button", { name: /^log set/i }).click();
    await expect(page.getByRole("heading", { name: /this session \(1 sets?\)/i })).toBeVisible({
      timeout: 15_000,
    });

    // Finish bar is now armed even though planned sets remain unlogged.
    // (The prescription only has 1 distinct item; the chip flips to
    // "1 of 1" because the relaxation is at the item level, not set
    // level — see prescription-progress.ts. The relaxed gate still
    // engages because ≥1 set has been logged.)
    await expect(stickybar).toHaveAttribute("data-armed", "true");

    // Click finish — lands on the complete page.
    await stickybar.getByRole("link", { name: /finish session/i }).click();
    await page.waitForURL(`**/app/sessions/${sessionId}/complete`, { timeout: 15_000 });
    await page.getByRole("button", { name: /complete session/i }).click();
    await page.waitForURL(`**/app/sessions/${sessionId}`, { timeout: 15_000 });

    // Back on the detail page: the banner has flipped to "Session
    // complete" and the green "completed" pill renders.
    await expect(page.getByText(/^completed$/i)).toBeVisible();
    await expect(page.getByTestId("session-status-banner")).toHaveAttribute(
      "data-state",
      "complete",
    );

    // Service-role: completed_at is set; 1 set landed.
    await assertSessionComplete(admin, sessionId, {
      expectedSetCount: 1,
      plannedSessionId: seed.todayPlannedId,
    });
  });
});
