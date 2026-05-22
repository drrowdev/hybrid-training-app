import { test, expect, type SeededUser } from "./fixtures/multi-user";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import type { BrowserContext, Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Multi-user RLS E2E coverage.
 *
 * Mandated by AGENTS.md > Tests > "Multi-user E2E — at least one test
 * that mutates state from two browser contexts and verifies the
 * server-canonical state. Catches sync-style races that single-user
 * testing misses." Also closes the loop on the engineering rule
 * "RLS on every user-data table … Verified by the multi-user e2e
 * test in apps/web".
 *
 * Three scenarios:
 *   A — RLS isolation on /plan: User A creates a block, User B sees
 *       nothing, User B creates their own, User A still sees only theirs.
 *   B — Concurrent block creation race: both users click "Start this
 *       block" via Promise.all; both must succeed with their own row.
 *   C — Read-after-write isolation on /app/settings/training-maxes:
 *       User A's TM never leaks into User B's view (or vice versa).
 *
 * If any scenario surfaces an RLS leak (e.g. User B's /app/plan
 * renders User A's block), STOP and report it — production-code fixes
 * are out of scope for this PR per project owner direction.
 */

const PLAN_URL_RE = /\/app\/plan(?:\?|$|#)/;

// --- shared walk helpers ------------------------------------------------

/**
 * Drive the /plan/new wizard for one user from Step 1 to Step 5 click.
 * Mirrors the sequence in plan-new-wizard-desktop.spec.ts; kept private
 * to this spec so its assertions can evolve without touching shared
 * fixtures. Returns once `/app/plan` is reached.
 */
async function walkWizardAndStart(page: Page): Promise<void> {
  await page.goto("/app/plan/new");
  // Intentionally no waitForLoadState("networkidle"): Next.js dev keeps an
  // HMR websocket open and emits background RSC prefetches, so networkidle
  // is unreliable and adds multi-second overhead. The next assertion
  // auto-waits for the wizard's first interactive button.
  await page.getByRole("button", { name: /build a new block/i }).click();

  await expect(page.getByRole("heading", { name: /how many days/i })).toBeVisible();
  await page.getByRole("button", { name: /^4( days)?$/ }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();

  await expect(page.getByRole("heading", { name: /choose your first focus/i })).toBeVisible();
  await page.getByRole("button", { name: /get stronger/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();

  await expect(page.getByRole("heading", { name: /choose your second focus/i })).toBeVisible();
  await page.getByRole("button", { name: /skip/i }).first().click();
  await page.getByRole("button", { name: /^continue$/i }).click();

  await page.getByRole("button", { name: /continue to schedule/i }).click();

  const startBtn = page.getByRole("button", { name: /start this block/i });
  await expect(startBtn).toBeVisible();
  await expect(startBtn).toBeEnabled();
  await startBtn.click();
  await page.waitForURL(PLAN_URL_RE, { timeout: 15_000 });
}

/**
 * Same wizard walk but stop one step short of clicking Start — used by
 * the concurrent race to park both contexts on Step 5 before firing
 * both Starts via Promise.all.
 */
async function walkWizardToStep5(page: Page): Promise<void> {
  await page.goto("/app/plan/new");
  // See walkWizardAndStart re: dropping networkidle.
  await page.getByRole("button", { name: /build a new block/i }).click();

  await expect(page.getByRole("heading", { name: /how many days/i })).toBeVisible();
  await page.getByRole("button", { name: /^4( days)?$/ }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();

  await expect(page.getByRole("heading", { name: /choose your first focus/i })).toBeVisible();
  await page.getByRole("button", { name: /get stronger/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();

  await expect(page.getByRole("heading", { name: /choose your second focus/i })).toBeVisible();
  await page.getByRole("button", { name: /skip/i }).first().click();
  await page.getByRole("button", { name: /^continue$/i }).click();

  await page.getByRole("button", { name: /continue to schedule/i }).click();

  const startBtn = page.getByRole("button", { name: /start this block/i });
  await expect(startBtn).toBeVisible();
  await expect(startBtn).toBeEnabled();
}

/** Service-role count of active blocks for a user. */
async function countActiveBlocks(
  admin: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await admin
    .from("training_blocks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw new Error(`countActiveBlocks: ${error.message}`);
  return count ?? 0;
}

/**
 * Prepare a user for /plan/new: profile is onboarded + canonical TMs
 * for the four strength-anchor roles are seeded, and the auth cookie
 * is injected into the supplied context.
 */
async function prepUserForWizard(
  admin: SupabaseClient,
  user: SeededUser,
  context: BrowserContext,
  seedConfig: Parameters<typeof signInAs>[2],
  baseURL: string,
): Promise<void> {
  await markOnboarded(admin, user.userId);
  await seedStrengthTms(admin, user.userId);
  await signInAs(context, user, seedConfig, baseURL);
}

// ------------------------------------------------------------------------

test.describe("@desktop multi-user RLS", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("A: RLS isolation on /app/plan — neither user can see the other's block", async ({
    browser,
    twoUsers,
    seedConfig,
    admin,
    baseURL,
  }) => {
    // Scenario A walks the wizard UI twice (once per user) within a
    // single test. Each walk takes ~10s and under parallel-load
    // (`fullyParallel: true` + multiple workers hammering the Next.js
    // dev server) page transitions slow further as Turbopack contends
    // on route compilation. The default 30s test timeout leaves no
    // headroom; we extend it to 60s rather than mask the work with
    // an arbitrary waitForTimeout. Scenarios B (parallel start) and C
    // (no wizard walk) stay on the default.
    test.setTimeout(60_000);

    const url = baseURL ?? "http://localhost:3000";
    const { userA, userB } = twoUsers;

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      // Prep both users concurrently — independent admin-API calls, no
      // ordering dependency. Saves ~2-4s wall-clock vs. sequential.
      await Promise.all([
        prepUserForWizard(admin, userA, ctxA, seedConfig, url),
        prepUserForWizard(admin, userB, ctxB, seedConfig, url),
      ]);

      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      // 1) User A creates a block via the wizard.
      await walkWizardAndStart(pageA);
      await expect(pageA.getByText(/no active block/i)).toHaveCount(0);

      // Server-canonical assertion: A has exactly 1 active block, B has 0.
      expect(await countActiveBlocks(admin, userA.userId)).toBe(1);
      expect(await countActiveBlocks(admin, userB.userId)).toBe(0);

      // 2) User B opens /app/plan — must see the empty state, not A's block.
      await pageB.goto("/app/plan");
      await expect(pageB.getByText(/no active block/i)).toBeVisible();
      await expect(
        pageB.getByRole("link", { name: /start a block/i }),
      ).toBeVisible();

      // 3) User B walks the wizard for themselves.
      await walkWizardAndStart(pageB);
      await expect(pageB.getByText(/no active block/i)).toHaveCount(0);

      // 4) User A refreshes /app/plan — must STILL see only their own
      //    block, not B's. We assert via the canonical DB state too.
      await pageA.goto("/app/plan");
      await expect(pageA.getByText(/no active block/i)).toHaveCount(0);

      // 5) DB invariants: exactly one active block per user, total = 2,
      //    and the user_ids partition cleanly.
      expect(await countActiveBlocks(admin, userA.userId)).toBe(1);
      expect(await countActiveBlocks(admin, userB.userId)).toBe(1);

      const { data: allBlocks, error: allErr } = await admin
        .from("training_blocks")
        .select("id, user_id, status")
        .in("user_id", [userA.userId, userB.userId])
        .eq("status", "active");
      expect(allErr).toBeNull();
      expect(allBlocks?.length ?? 0).toBe(2);
      const owners = new Set((allBlocks ?? []).map((r) => r.user_id));
      expect(owners.has(userA.userId)).toBe(true);
      expect(owners.has(userB.userId)).toBe(true);
    } finally {
      await ctxA.close().catch(() => {});
      await ctxB.close().catch(() => {});
    }
  });

  test("B: concurrent block creation — both Starts succeed, no row drift", async ({
    browser,
    twoUsers,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";
    const { userA, userB } = twoUsers;

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      await prepUserForWizard(admin, userA, ctxA, seedConfig, url);
      await prepUserForWizard(admin, userB, ctxB, seedConfig, url);

      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      // Park both contexts on Step 5 (Start enabled, not yet clicked).
      await Promise.all([
        walkWizardToStep5(pageA),
        walkWizardToStep5(pageB),
      ]);

      // Fire both Starts as close to simultaneously as Promise.all gets
      // — same event-loop tick, two independent server actions racing.
      const startA = pageA.getByRole("button", { name: /start this block/i });
      const startB = pageB.getByRole("button", { name: /start this block/i });
      await Promise.all([startA.click(), startB.click()]);

      // Both must navigate to /app/plan; neither blocked the other.
      await Promise.all([
        pageA.waitForURL(PLAN_URL_RE, { timeout: 20_000 }),
        pageB.waitForURL(PLAN_URL_RE, { timeout: 20_000 }),
      ]);

      // Server-canonical row count: exactly one active block per user,
      // partitioned correctly by user_id. No leakage, no duplicates.
      expect(await countActiveBlocks(admin, userA.userId)).toBe(1);
      expect(await countActiveBlocks(admin, userB.userId)).toBe(1);

      const { data: rows, error } = await admin
        .from("training_blocks")
        .select("id, user_id")
        .in("user_id", [userA.userId, userB.userId])
        .eq("status", "active");
      expect(error).toBeNull();
      expect(rows?.length ?? 0).toBe(2);

      // Each row's user_id is one of the two we provisioned — never
      // the wrong one, never a stray.
      const idsByUser = new Map<string, string[]>();
      for (const r of rows ?? []) {
        const list = idsByUser.get(r.user_id) ?? [];
        list.push(r.id);
        idsByUser.set(r.user_id, list);
      }
      expect(idsByUser.get(userA.userId)?.length ?? 0).toBe(1);
      expect(idsByUser.get(userB.userId)?.length ?? 0).toBe(1);
      // Block IDs are distinct (no shared row).
      const aId = idsByUser.get(userA.userId)![0];
      const bId = idsByUser.get(userB.userId)![0];
      expect(aId).not.toBe(bId);
    } finally {
      await ctxA.close().catch(() => {});
      await ctxB.close().catch(() => {});
    }
  });

  test("C: read-after-write isolation on /app/settings/training-maxes", async ({
    browser,
    twoUsers,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";
    const { userA, userB } = twoUsers;

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      // Onboard both users so the /app gate doesn't redirect.
      await markOnboarded(admin, userA.userId);
      await markOnboarded(admin, userB.userId);
      await signInAs(ctxA, userA, seedConfig, url);
      await signInAs(ctxB, userB, seedConfig, url);

      // Pick a canonical strength-anchor movement we can target by slug.
      const { data: mv, error: mvErr } = await admin
        .from("movements")
        .select("id, slug")
        .eq("slug", "back-squat-high-bar")
        .is("user_id", null)
        .single();
      expect(mvErr).toBeNull();
      expect(mv?.id).toBeDefined();
      const movementId = mv!.id;

      // 1) Service-role insert User A's TM with a distinctive value.
      const A_KG = "147.5";
      const { error: aIns } = await admin.from("training_maxes").insert({
        user_id: userA.userId,
        movement_id: movementId,
        one_rm_kg: A_KG,
      });
      expect(aIns).toBeNull();

      // 2) User A loads /app/settings/training-maxes — must see 147.5 kg.
      const pageA = await ctxA.newPage();
      await pageA.goto("/app/settings/training-maxes");
      await pageA.waitForLoadState("networkidle");
      await expect(pageA.getByText(/147\.5 kg/)).toBeVisible();

      // 3) User B loads the same page — must NOT see User A's value.
      const pageB = await ctxB.newPage();
      await pageB.goto("/app/settings/training-maxes");
      await pageB.waitForLoadState("networkidle");
      await expect(pageB.getByText(/147\.5 kg/)).toHaveCount(0);
      // And the squat role for User B is in the "needs a TM" state.
      await expect(pageB.getByText(/needs a TM/i).first()).toBeVisible();

      // 4) User B inserts their own TM for the SAME movement, different
      //    value. The unique (user_id, movement_id) constraint means
      //    each user gets exactly one row per movement — but B's row
      //    must never affect A's view.
      const B_KG = "82.5";
      const { error: bIns } = await admin.from("training_maxes").insert({
        user_id: userB.userId,
        movement_id: movementId,
        one_rm_kg: B_KG,
      });
      expect(bIns).toBeNull();

      // 5) User A reloads — must STILL see 147.5 kg, never 82.5 kg.
      await pageA.reload();
      await pageA.waitForLoadState("networkidle");
      await expect(pageA.getByText(/147\.5 kg/)).toBeVisible();
      await expect(pageA.getByText(/82\.5 kg/)).toHaveCount(0);

      // 6) User B reloads — must see 82.5 kg, never 147.5 kg.
      await pageB.reload();
      await pageB.waitForLoadState("networkidle");
      await expect(pageB.getByText(/82\.5 kg/)).toBeVisible();
      await expect(pageB.getByText(/147\.5 kg/)).toHaveCount(0);

      // 7) DB state: exactly two rows on this movement for these users.
      const { data: rows, error: rowsErr } = await admin
        .from("training_maxes")
        .select("user_id, one_rm_kg")
        .eq("movement_id", movementId)
        .in("user_id", [userA.userId, userB.userId]);
      expect(rowsErr).toBeNull();
      expect(rows?.length ?? 0).toBe(2);
      const byUser = new Map(
        (rows ?? []).map((r) => [r.user_id, String(r.one_rm_kg)]),
      );
      // Postgres `numeric` formats like "147.50" — compare as numbers.
      expect(Number(byUser.get(userA.userId))).toBeCloseTo(Number(A_KG), 5);
      expect(Number(byUser.get(userB.userId))).toBeCloseTo(Number(B_KG), 5);
    } finally {
      await ctxA.close().catch(() => {});
      await ctxB.close().catch(() => {});
    }
  });
});
