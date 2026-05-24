import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import { assertSessionComplete } from "./fixtures/session-log";
import {
  assertBlockStatus,
  STRENGTH_ANCHOR_WEEK_PROFILES,
  seedBlockAtWeekDay,
} from "./fixtures/program-run";

/**
 * Desktop program-run E2E coverage.
 *
 * Closes the third of three AGENTS.md mandated critical paths
 * ("auth + log + program-run"). With this spec landed, all three
 * (auth ✓ + log ✓ + program-run ✓) have at least one E2E scenario.
 *
 * Scenarios:
 *   A — Multi-day cursor advancement (week 0):
 *       Seed an active block at (weekIndex=0, dayIndex=today). Verify
 *       /app surfaces today's prescription, click Start, log two sets,
 *       finish, then refresh /app and assert the UI flips to the
 *       "Session logged ✓" state and "Up next this week" shows the
 *       next planned_session by date.
 *
 *   B — Deload week prescription differs:
 *       Seed an active block at (weekIndex=3, dayIndex=today). The
 *       strength_anchor archetype's week 3 is the deload week
 *       (`STRENGTH_ANCHOR.weekProfiles[3].intensityLabel === "Deload"`
 *        in `apps/web/src/lib/planner/archetypes.ts`). Assert today's
 *       card title carries the "(deload)" suffix (matches the suffix
 *       `lib/planner/actions.ts:createBlock` appends at line ~427) AND
 *       the persisted prescription items use the deload intensities
 *       [40, 50, 60]%TM with `strengthVolumeScale=0.5` (3 → 2 items).
 *
 *   C — Manual end → archived:
 *       Seed an active block at week 0 (no prior completions). Click
 *       "End block" on /app/plan and assert the row flips to
 *       `status='archived'`. The archived block then shows up in the
 *       "Run it again" picker on /app/plan/new with the muted "Ended"
 *       badge — NOT the green "Completed" badge.
 *
 *       Manual ends always write 'archived'; that distinguishes "user
 *       abandoned the block" from "the engine finished it for them"
 *       (Scenario E).
 *
 *   D — Multiple active blocks (negative test):
 *       The DB schema has no UNIQUE constraint on (user_id, status='active')
 *       and there's no DC-* requiring single active block. The app-level
 *       invariant is enforced in `createBlock`, which archives any prior
 *       active row before inserting (actions.ts ~line 358). Direct-DB
 *       seeding bypasses that — we insert two active blocks and assert
 *       the observed behavior: `getActiveBlock` (queries.ts) orders by
 *       `started_on DESC LIMIT 1`, so the newer block wins on /app.
 *
 *   E — Auto-complete when the last session lands:
 *       Seed a 4-week block where every planned session except today's
 *       is already linked-and-completed. Drive the start → log → finish
 *       flow end-to-end via UI. Assert the block flips to
 *       `status='completed'` (NOT 'archived') and the badge on the
 *       /app/plan/new "Run it again" card reads "Completed".
 */

test.describe("@desktop program run", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("A: multi-day cursor advancement (week 0 → log → refresh)", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    test.slow(); // logs two sets + completes — runs near the 30s default under parallel load
    const url = baseURL ?? "http://localhost:3000";

    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    const seed = await seedBlockAtWeekDay(admin, freshUser.userId, {
      weekIndex: 0,
    });
    await signInAs(context, freshUser, seedConfig, url);

    // 1) /app — today's card resolves to the (week 0, today's weekday) row.
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    const todayCard = page.getByTestId(`today-card-${seed.todayPlannedId}`);
    await expect(todayCard).toBeVisible();
    const startCta = todayCard.getByRole("link", { name: /start session/i });
    await expect(startCta).toBeVisible();
    const startHref = await startCta.getAttribute("href");
    expect(startHref).toBe(`/app/sessions/start/${seed.todayPlannedId}`);

    // 2) Drive through the start → check-in skip → log-two-sets → finish flow.
    await startCta.click();
    await page.waitForURL(`**/app/sessions/start/${seed.todayPlannedId}`, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /how are you feeling/i })).toBeVisible();
    await page.getByRole("button", { name: /skip check-in/i }).click();

    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 30_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const pickerInput = page.getByPlaceholder(/search the catalog/i);
    await expect(pickerInput).toBeVisible();
    await pickerInput.fill(seed.todayMovementDisplayName.split(" ")[0]!);
    const liftNameRe = new RegExp(
      seed.todayMovementDisplayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    const liftOption = page.getByRole("button", { name: liftNameRe }).first();
    await expect(liftOption).toBeVisible({ timeout: 10_000 });
    await liftOption.click();

    await page.getByLabel("Weight (kg)").fill("80");
    await page.getByLabel("Reps").fill("5");
    await page.getByRole("button", { name: /^7$/ }).click();
    await page.getByRole("button", { name: /^log set/i }).click();
    await expect(
      page.getByRole("heading", { name: /this session \(1 sets?\)/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /^7$/ }).click();
    await page.getByRole("button", { name: /^log set/i }).click();
    await expect(
      page.getByRole("heading", { name: /this session \(2 sets?\)/i }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("finish-stickybar").getByRole("link", { name: /finish session/i }).click();
    await page.waitForURL(`**/app/sessions/${sessionId}/complete`, { timeout: 30_000 });
    await page.getByRole("button", { name: /complete session/i }).click();
    await page.waitForURL(`**/app/sessions/${sessionId}`, { timeout: 30_000 });

    // 3) Service-role verify the cursor advanced on the right row.
    await assertSessionComplete(admin, sessionId, {
      expectedSetCount: 2,
      plannedSessionId: seed.todayPlannedId,
    });

    // 4) Refresh /app. The today-card test-id for today's row is gone
    //    (it transitions into the "completedToday" / "Session logged"
    //    branch of TodaySessionCard). The dedicated "Up next this week"
    //    section was removed from Today in feat/today-v3-simplify —
    //    /app/plan owns that surface now.
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId(`today-card-${seed.todayPlannedId}`)).toHaveCount(0);
    await expect(page.getByTestId("today-logged")).toBeVisible();
    await expect(page.getByText(/session logged/i)).toBeVisible();

    // Regression guard: the old "Up next this week" heading must NOT
    // come back on Today — that surface lives on /app/plan now.
    await expect(
      page.getByRole("heading", { name: /up next this week/i }),
    ).toHaveCount(0);
  });

  test("B: deload week prescription differs (week 3 of strength_anchor)", async ({
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
    const seed = await seedBlockAtWeekDay(admin, freshUser.userId, {
      weekIndex: 3,
    });
    await signInAs(context, freshUser, seedConfig, url);

    // 1) /app — today's card title carries the "(deload)" suffix that
    //    production's `createBlock` appends for strength days during a
    //    Deload-labelled week (apps/web/src/lib/planner/actions.ts).
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    const todayCard = page.getByTestId(`today-card-${seed.todayPlannedId}`);
    await expect(todayCard).toBeVisible();
    await expect(todayCard).toContainText(/\(deload\)/i);

    // 2) Service-role: the persisted prescription for THIS row matches
    //    the strength_anchor deload profile. Week 3 intensities are
    //    [0.40, 0.50, 0.60] with strengthVolumeScale=0.5 — so the 3-item
    //    set is halved to 2 items (Math.round(3 * 0.5) = 2).
    const deload = STRENGTH_ANCHOR_WEEK_PROFILES[3];
    expect(deload.intensityLabel).toBe("Deload");

    const { data: todayPlanned, error: pErr } = await admin
      .from("planned_sessions")
      .select("title, prescription, week_index, day_index")
      .eq("id", seed.todayPlannedId)
      .maybeSingle();
    expect(pErr).toBeNull();
    expect(todayPlanned).not.toBeNull();
    expect(todayPlanned!.week_index).toBe(3);
    expect((todayPlanned!.title as string)).toMatch(/\(deload\)$/);

    type PItem = { kind: string; percentTm?: number; reps?: number; intensityLabel?: string };
    const items = (todayPlanned!.prescription as { items: PItem[] }).items;
    // 3 setIntensities * 0.5 volume scale → 2 retained items.
    expect(items.length).toBe(2);
    expect(items[0]!.percentTm).toBe(Math.round(deload.setIntensities[0]! * 100));
    expect(items[1]!.percentTm).toBe(Math.round(deload.setIntensities[1]! * 100));
    expect(items[0]!.reps).toBe(deload.setReps as number);
    // The deload values must be strictly lighter than week 0 top set.
    const wk0Top = Math.round(
      STRENGTH_ANCHOR_WEEK_PROFILES[0].setIntensities.at(-1)! * 100,
    );
    for (const it of items) {
      expect(it.percentTm).toBeLessThan(wk0Top);
    }

    // 3) /app/plan also surfaces the deload nav-pill for week 4 (1-indexed)
    //    and the day card carries the (deload) suffix in the title.
    await page.goto(`/app/plan?week=3`);
    await page.waitForLoadState("networkidle");
    // The week tabs render "Week 4 · deload".
    await expect(
      page.getByRole("link", { name: /week 4/i }).filter({ hasText: /deload/i }),
    ).toBeVisible();
    // The card for today's deload session is visible and titled (deload).
    await expect(page.getByTestId(`start-${seed.todayPlannedId}`)).toBeVisible();
  });

  test("C: manual End block → archived (not auto-completed)", async ({
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
    // Fresh block — no completions. The point of this scenario is the
    // manual path (button click → 'archived'), not auto-complete.
    const seed = await seedBlockAtWeekDay(admin, freshUser.userId, {
      weekIndex: 0,
    });
    await signInAs(context, freshUser, seedConfig, url);

    // 1) Sanity: block is active with un-touched plan.
    await assertBlockStatus(admin, seed.blockId, "active");

    // 2) Manual archival via the End block button on /app/plan.
    await page.goto("/app/plan");
    await page.waitForLoadState("networkidle");
    const endBtn = page.getByTestId("end-block-button");
    await expect(endBtn).toBeVisible();
    await endBtn.click();

    // The endBlock action revalidates /app and /app/plan; after the
    // server action settles the active block is gone.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("training_blocks")
            .select("status")
            .eq("id", seed.blockId)
            .maybeSingle();
          return data?.status ?? null;
        },
        { timeout: 10_000 },
      )
      .toBe("archived");
    await assertBlockStatus(admin, seed.blockId, "archived");

    // 2b) Lifecycle timestamps (migration 0025): manual end populates
    //     ended_at AND archived_at, but never completed_at.
    {
      const { data } = await admin
        .from("training_blocks")
        .select("ended_at, archived_at, completed_at")
        .eq("id", seed.blockId)
        .maybeSingle();
      expect(data?.ended_at).toBeTruthy();
      expect(data?.archived_at).toBeTruthy();
      expect(data?.completed_at).toBeNull();
    }

    // 3) The archived block shows up in the "Run it again" picker with
    //    the muted "Ended" badge — NOT the green "Completed" badge.
    await page.goto("/app/plan/new");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /run it again/i })).toBeVisible();
    const recentCard = page.locator(".pn-recent-card").first();
    await expect(recentCard).toBeVisible();
    await expect(recentCard).toContainText(/strength_anchor/i);
    const badge = recentCard.getByTestId("block-status-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("data-status", "archived");
    await expect(badge).toContainText(/ended/i);
  });

  test("D: two active blocks — newest started_on wins on /app (no DB constraint)", async ({
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

    // First block: started a week ago (weekIndex=1 → started_on = today - 1*7 - day).
    const older = await seedBlockAtWeekDay(admin, freshUser.userId, {
      weekIndex: 1,
    });
    // Second block: started today (weekIndex=0 → started_on = today - day).
    const newer = await seedBlockAtWeekDay(admin, freshUser.userId, {
      weekIndex: 0,
    });

    // Sanity: both rows are active. Schema does NOT enforce uniqueness.
    const { data: actives, error: aErr } = await admin
      .from("training_blocks")
      .select("id, status, started_on")
      .eq("user_id", freshUser.userId)
      .eq("status", "active");
    expect(aErr).toBeNull();
    expect(actives?.length).toBe(2);
    expect(new Date(newer.startedOn).getTime()).toBeGreaterThanOrEqual(
      new Date(older.startedOn).getTime(),
    );

    // Observed behavior: getActiveBlock orders by started_on DESC LIMIT 1
    // (queries.ts), so /app surfaces the NEWER block's today row.
    await signInAs(context, freshUser, seedConfig, url);
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId(`today-card-${newer.todayPlannedId}`)).toBeVisible();
    await expect(page.getByTestId(`today-card-${older.todayPlannedId}`)).toHaveCount(0);
  });

  test("E: auto-complete block when last session lands → 'completed'", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    test.slow(); // logs the last session end-to-end — near the 30s default
    const url = baseURL ?? "http://localhost:3000";

    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    // Seed a block where every planned_session except today's row
    // is already linked to a completed session. Today is the LAST
    // remaining planned_session in the block.
    const seed = await seedBlockAtWeekDay(admin, freshUser.userId, {
      weekIndex: 3,
      completeAllExceptLast: true,
    });
    await signInAs(context, freshUser, seedConfig, url);

    // 1) Sanity: block is active and exactly one planned row remains.
    await assertBlockStatus(admin, seed.blockId, "active");
    const { count: remaining } = await admin
      .from("planned_sessions")
      .select("id", { count: "exact", head: true })
      .eq("block_id", seed.blockId)
      .is("completed_session_id", null);
    expect(remaining).toBe(1);

    // 2) Drive the last session through the start → log → finish flow.
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    const todayCard = page.getByTestId(`today-card-${seed.todayPlannedId}`);
    await expect(todayCard).toBeVisible();
    await todayCard.getByRole("link", { name: /start session/i }).click();
    await page.waitForURL(`**/app/sessions/start/${seed.todayPlannedId}`, { timeout: 30_000 });
    await page.getByRole("button", { name: /skip check-in/i }).click();
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 30_000 });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const pickerInput = page.getByPlaceholder(/search the catalog/i);
    await pickerInput.fill(seed.todayMovementDisplayName.split(" ")[0]!);
    const liftNameRe = new RegExp(
      seed.todayMovementDisplayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    await page.getByRole("button", { name: liftNameRe }).first().click();
    await page.getByLabel("Weight (kg)").fill("60");
    await page.getByLabel("Reps").fill("5");
    await page.getByRole("button", { name: /^6$/ }).click();
    await page.getByRole("button", { name: /^log set/i }).click();
    await expect(
      page.getByRole("heading", { name: /this session \(1 sets?\)/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("finish-stickybar").getByRole("link", { name: /finish session/i }).click();
    await page.waitForURL(`**/app/sessions/${sessionId}/complete`, { timeout: 30_000 });
    await page.getByRole("button", { name: /complete session/i }).click();
    await page.waitForURL(`**/app/sessions/${sessionId}`, { timeout: 30_000 });

    await assertSessionComplete(admin, sessionId, {
      expectedSetCount: 1,
      plannedSessionId: seed.todayPlannedId,
    });

    // 3) Service-role assertion: the block auto-flipped to 'completed'
    //    (NOT 'archived' — manual end is the only path to 'archived').
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("training_blocks")
            .select("status")
            .eq("id", seed.blockId)
            .maybeSingle();
          return data?.status ?? null;
        },
        { timeout: 10_000 },
      )
      .toBe("completed");
    await assertBlockStatus(admin, seed.blockId, "completed");

    // 3b) Lifecycle timestamps (migration 0025): auto-complete populates
    //     ended_at AND completed_at, but never archived_at.
    {
      const { data } = await admin
        .from("training_blocks")
        .select("ended_at, completed_at, archived_at")
        .eq("id", seed.blockId)
        .maybeSingle();
      expect(data?.ended_at).toBeTruthy();
      expect(data?.completed_at).toBeTruthy();
      expect(data?.archived_at).toBeNull();
    }

    // 4) /app/plan/new — "Run it again" card shows the green Completed
    //    badge, distinguished from the muted Ended badge.
    await page.goto("/app/plan/new");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /run it again/i })).toBeVisible();
    const recentCard = page.locator(".pn-recent-card").first();
    await expect(recentCard).toBeVisible();
    const badge = recentCard.getByTestId("block-status-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("data-status", "completed");
    await expect(badge).toContainText(/completed/i);
  });
});
