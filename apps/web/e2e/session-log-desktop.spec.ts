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

    test.slow(); // log → finish flow can exceed the 30s default under parallel load

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

    // The skip control moved into the plan's SessionDrawer: click today's
    // session pill in the timeline to open the drawer, then Skip.
    await page.getByTestId(`plan-pill-${seed.todayPlannedId}`).click();
    const skipBtn = page.getByTestId("plan-drawer-skip");
    await expect(skipBtn).toBeVisible({ timeout: 10_000 });
    await skipBtn.click();

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

    // Refresh — the skip persists. The drawer state is preserved across
    // reload (URL-backed), so today's drawer re-opens directly to the now
    // "Un-skip" control (the Skip button is gone).
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("plan-drawer-unskip")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("plan-drawer-skip")).toHaveCount(0);
  });

  test("D: Phase 1 — log a PR set + post-session summary", async ({
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

    test.slow(); // log → finish flow can exceed the 30s default under parallel load

    // 1) Open today's planned session (start redirects straight to the log;
    //    the pre-session interstitial was removed).
    await page.goto(`/app/sessions/start/${seed.todayPlannedId}`);
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;

    // 2) Log the seeded squat's first main set, but bump the weight far above
    //    the saved 1RM (100kg) so the TM-anchored detector fires a Weight PR.
    //    The freestyle "Same as planned" + "This session (N sets)" surface was
    //    retired by the MovementCard accordion → MovementFocusView flow.
    const header = page.getByTestId(`movement-card-header-${seed.todayMovementId}`);
    await expect(header).toBeVisible({ timeout: 15_000 });
    if ((await header.getAttribute("aria-expanded")) === "false") {
      await header.click();
    }
    const weightInput = page.getByRole("textbox", { name: "Weight (kg)", exact: true });
    await expect(weightInput).toBeVisible({ timeout: 15_000 });
    await weightInput.fill("150");
    const logBtn = page.getByTestId("movement-focus-log-button");
    await expect(logBtn).toBeVisible();
    await logBtn.click();
    await page.waitForTimeout(900);

    // Service-role: exactly one main set landed at 150kg × 5 reps.
    const { data: filledSets } = await admin
      .from("set_logs")
      .select("set_index, weight_kg, reps, movement_id, set_kind")
      .eq("session_id", sessionId)
      .order("set_index", { ascending: true });
    expect(filledSets?.length).toBe(1);
    const logged = filledSets![0]!;
    expect(logged.set_kind).toBe("main");
    expect(logged.movement_id).toBe(seed.todayMovementId);
    expect(Number(logged.weight_kg)).toBeCloseTo(150, 1);
    expect(logged.reps).toBe(5);

    // 3) Finish → complete page → submit. Land back on the detail page; the
    //    redesigned PostSessionSummary card renders at the top.
    await finishAndCompleteSession(page, sessionId);

    const summary = page.getByTestId("post-session-summary");
    await expect(summary).toBeVisible();
    // Tonnage = 150 × 5 = 750 kg.
    await expect(page.getByTestId("summary-tonnage")).toContainText(/750/);
    await expect(page.getByTestId("summary-sets")).toContainText(/Sets\s*1$/);
    // The 150kg set beats the saved 100kg 1RM → at least one PR recorded.
    await expect(page.getByTestId("summary-prs")).not.toContainText(/^\s*0\s*$/);

    // 4) Navigating back to the same session shows the same summary at the top
    //    (it's derived from the persisted rows, not transient state).
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await page.goto(`/app/sessions/${sessionId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("post-session-summary")).toBeVisible();

    await assertSessionComplete(admin, sessionId, {
      expectedSetCount: 1,
      plannedSessionId: seed.todayPlannedId,
    });
  });

  test("E: Phase 2 — swap an exercise mid-session records an override event", async ({
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

    test.slow(); // seed + log flow can exceed the 30s default under parallel load

    // Land on the in-progress session for today.
    await page.goto(`/app/sessions/start/${seed.todayPlannedId}`);
    // Pre-session interstitial removed — auto-redirects to the session log.
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;

    // Swap moved into the MovementCard: expand the seeded squat card and open
    // its SwapMovementModal, then pick front squat (a pattern-compatible
    // alternative to the seeded high-bar back squat).
    const header = page.getByTestId(`movement-card-header-${seed.todayMovementId}`);
    await expect(header).toBeVisible({ timeout: 15_000 });
    if ((await header.getAttribute("aria-expanded")) === "false") {
      await header.click();
    }
    await page.getByTestId(`movement-card-swap-${seed.todayMovementId}`).click();
    await expect(page.getByTestId("swap-movement-modal")).toBeVisible({
      timeout: 10_000,
    });
    const frontSquat = page.getByTestId("swap-modal-candidate-front-squat").first();
    await expect(frontSquat).toBeVisible({ timeout: 10_000 });
    await frontSquat.click();

    // The modal closes once the swap commits.
    await expect(page.getByTestId("swap-movement-modal")).toHaveCount(0, {
      timeout: 10_000,
    });

    // Service-role: the swap is captured as an `engine_override_events` row
    // (the audit/analytics surface) recording the original → new movement.
    // `swapActiveMovement` records the override + drives the optimistic card
    // swap; it deliberately does NOT rewrite the stored prescription.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("engine_override_events")
            .select("event_type, original_movement_slug, new_movement_slug")
            .eq("user_id", freshUser.userId)
            .eq("event_type", "swap")
            .order("occurred_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return data?.new_movement_slug ?? null;
        },
        { timeout: 10_000 },
      )
      .toBe("front-squat");

    const { data: override } = await admin
      .from("engine_override_events")
      .select("event_type, original_movement_slug, new_movement_slug")
      .eq("user_id", freshUser.userId)
      .eq("event_type", "swap")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(override?.original_movement_slug).toBe("back-squat-high-bar");
    expect(override?.new_movement_slug).toBe("front-squat");

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

    test.slow(); // seed + Strava match flow can exceed the 30s default under parallel load

    // The session page only mounts StravaAutofillBanner when the user has a
    // Strava connection (`!isComplete && stravaConnected`). Seed one.
    const { error: connErr } = await admin.from("strava_connections").insert({
      user_id: freshUser.userId,
      athlete_id: 9_999_001,
      access_token: "e2e-access-token",
      refresh_token: "e2e-refresh-token",
      expires_at: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
    });
    expect(connErr).toBeNull();

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

    // Strava banner is visible — within window + cardio modality. The banner
    // mounting at all is also the regression guard for the server-component
    // crash fixed alongside this test: the page passed an inline closure as
    // the banner's `syncAction`, which Next refuses to serialise to a Client
    // Component → the whole session page 500'd for any Strava-connected user.
    // It now binds the `syncStravaForSession` server action.
    const banner = page.getByTestId("strava-autofill");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toHaveAttribute("data-state", "match");
    await expect(banner).toContainText(/bike/i);
    await expect(banner).toContainText(/45 min/i);

    // Apply the autofill.
    await banner.getByTestId("strava-autofill-use").click();
    await expect(banner).toHaveAttribute("data-state", "applied", { timeout: 10_000 });

    // `applyStravaAutofill` RE-PARENTS the matched cardio_logs row onto this
    // session rather than copying it (a copy would duplicate the globally
    // unique strava_activity_id). So there is still exactly ONE row for the
    // activity, now living on the in-progress session at block_index 0.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("cardio_logs")
            .select("session_id, block_index, modality, duration_sec, distance_km, avg_hr_bpm, external_source")
            .eq("strava_activity_id", "9999001");
          return data?.length ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBe(1);
    const { data: moved } = await admin
      .from("cardio_logs")
      .select("session_id, block_index, modality, duration_sec, distance_km, avg_hr_bpm, external_source")
      .eq("strava_activity_id", "9999001")
      .maybeSingle();
    expect(moved?.session_id).toBe(sessionId);
    expect(moved?.block_index).toBe(0);
    expect(moved?.modality).toBe("bike");
    expect(moved?.duration_sec).toBe(2700);
    expect(Number(moved?.distance_km)).toBeCloseTo(18.4, 2);
    expect(moved?.avg_hr_bpm).toBe(138);
    expect(moved?.external_source).toBe("strava");

    // The now-empty standalone import session is soft-deleted (retired from
    // history) rather than left as a duplicate empty cardio workout.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("sessions")
            .select("deleted_at")
            .eq("id", stravaSession!.id)
            .maybeSingle();
          return data?.deleted_at != null;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
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

    test.slow(); // log → finish flow can exceed the 30s default under parallel load

    await page.goto(`/app/sessions/start/${seed.todayPlannedId}`);
    // Pre-session interstitial removed — auto-redirects to the session log.
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;

    // The session renders the MovementCard accordion. Before logging, the
    // card is in the "not_started" state and the finish bar is disarmed.
    const card = page.getByTestId(`movement-card-${seed.todayMovementId}`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-state", "not_started");
    await expect(page.getByTestId("finish-stickybar")).toHaveAttribute(
      "data-armed",
      "false",
    );

    // Expand the card and log the prescribed set — the focus view pre-fills
    // the prescribed weight (90 kg TM × 70% week-0 wave = 62.5 kg) and reps
    // (5), so a single tap on the log CTA commits them.
    await logPrescribedSet(page, seed.todayMovementId);

    // The card flips out of "not_started" (logged) and the finish bar arms.
    await expect(card).not.toHaveAttribute("data-state", "not_started");
    await expect(page.getByTestId("finish-stickybar")).toHaveAttribute(
      "data-armed",
      "true",
    );

    // Service-role: the new set_logs row carries the explicit
    // prescription_item_index = 0 link AND the prescription-resolved weight,
    // proving the click → prefill path used the prescribed numbers.
    const { data: linkedSets } = await admin
      .from("set_logs")
      .select("id, prescription_item_index, weight_kg, reps")
      .eq("session_id", sessionId);
    expect(linkedSets?.length).toBe(1);
    expect(linkedSets![0]!.prescription_item_index).toBe(0);
    expect(Number(linkedSets![0]!.weight_kg)).toBeCloseTo(62.5, 1);
    expect(linkedSets![0]!.reps).toBe(5);

    // After logging, the focus-view CTA becomes the edit link for the
    // logged set, wired to the per-set edit route.
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

    test.slow(); // log → finish flow can exceed the 30s default under parallel load

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

    // Log exactly ONE prescribed set via the MovementCard accordion →
    // MovementFocusView flow (the freestyle catalog/"This session (N)"
    // surface was retired by MovementCardList). The seeded prescription has
    // 1 item, so a single log leaves planned sets unlogged but still arms
    // the relaxed finish gate.
    await logPrescribedSet(page, seed.todayMovementId);

    // Finish bar is now armed even though planned sets remain unlogged.
    await expect(stickybar).toHaveAttribute("data-armed", "true");

    // Click finish — lands on the complete page.
    await finishAndCompleteSession(page, sessionId);

    // Back on the detail page the post-session summary renders.
    await expect(page.getByTestId("post-session-summary")).toBeVisible();

    // Service-role: completed_at is set; 1 set landed.
    await assertSessionComplete(admin, sessionId, {
      expectedSetCount: 1,
      plannedSessionId: seed.todayPlannedId,
    });
  });
});
