import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { seedEngineState } from "./fixtures/seed-engine";

/**
 * Desktop /app/stats/engine — Phase 6 engine page.
 *
 * Pre-condition (seeded via service-role admin client):
 *  - Active Strength Focus block starting today
 *  - One planned session for today titled "Squat day" with Back Squat
 *    as the main item
 *  - region_state rows for `knee` (loaded) + `shoulder_scapular` (fresh)
 *  - One skipped planned session + one movement swap → two override rows
 *
 * The spec asserts:
 *  - all seven sections render
 *  - the decision-trace headline + archetype name appear
 *  - the "Why?" tooltip on a bucket exposes a popover with explanation
 *  - the recent overrides list has at least one row
 *  - the engine internals card surfaces a version string
 */

test.describe("@desktop /app/stats/engine", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("renders all seven sections + decision trace + bucket why", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    const seeded = await seedEngineState(admin, freshUser.userId);

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats/engine");
    await page.waitForLoadState("networkidle");

    // ── Header ────────────────────────────────────────────────
    await expect(page.getByTestId("stats-engine-header")).toBeVisible();
    await expect(page.getByTestId("stats-engine-header")).toContainText(
      /How the planner sees you/i,
    );

    // ── A · Decision trace ────────────────────────────────────
    const trace = page.getByTestId("stats-engine-decision-trace");
    await expect(trace).toBeVisible();
    await expect(page.getByTestId("stats-engine-decision-headline")).toContainText(
      seeded.todayPlannedTitle,
    );
    const reasons = page.getByTestId("stats-engine-decision-reason");
    expect(await reasons.count()).toBeGreaterThanOrEqual(2);
    await expect(trace).toContainText(seeded.archetypeName);

    // ── B · Region freshness ──────────────────────────────────
    const regions = page.getByTestId("stats-engine-regions");
    await expect(regions).toBeVisible();
    const regionRows = page.getByTestId("stats-engine-region-row");
    expect(await regionRows.count()).toBeGreaterThanOrEqual(1);

    // ── C · Bucket pressure + "Why?" tooltip ──────────────────
    const buckets = page.getByTestId("stats-engine-buckets");
    await expect(buckets).toBeVisible();
    const bucketRows = page.getByTestId("stats-engine-bucket-row");
    expect(await bucketRows.count()).toBeGreaterThanOrEqual(1);
    // Click the first "Why?" affordance and assert the explainer pop
    // is part of the DOM (Clawpilot .cp-info pop opens on focus).
    const firstWhy = page.getByTestId("stats-engine-bucket-why").first();
    await firstWhy.focus();
    await expect(
      page.getByTestId("stats-engine-bucket-why-pop").first(),
    ).toContainText(/pressure|EWMA|ceiling|interference|tendon|GRM|MEV/i);

    // ── D · Ceiling explainer ────────────────────────────────
    await expect(page.getByTestId("stats-engine-ceiling")).toBeVisible();
    await expect(page.getByTestId("stats-engine-ceiling-final")).toContainText(
      /hard sessions/i,
    );

    // ── E · User tier ────────────────────────────────────────
    const tier = page.getByTestId("stats-engine-tier");
    await expect(tier).toBeVisible();
    await expect(page.getByTestId("stats-engine-tier-label")).toContainText(
      /Consumer|Intermediate|High-performance/i,
    );

    // ── F · Recent overrides ─────────────────────────────────
    const overrides = page.getByTestId("stats-engine-overrides");
    await expect(overrides).toBeVisible();
    const overrideRows = page.getByTestId("stats-engine-override-row");
    expect(await overrideRows.count()).toBeGreaterThanOrEqual(2);
    // The swap event was seeded with a reason — assert it renders as
    // a quoted note (DC-K4 audit log surfaces user-entered reasons).
    await expect(page.getByTestId("stats-engine-override-note").first()).toContainText(
      /Bar busy/i,
    );

    // ── G · Engine internals ─────────────────────────────────
    await expect(page.getByTestId("stats-engine-internals")).toBeVisible();
    await expect(
      page.getByTestId("stats-engine-internals-version"),
    ).toHaveText(/\d+\.\d+\.\d+/);
  });

  test("empty state for a fresh user with no block", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats/engine");
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("stats-engine-decision-headline")).toContainText(
      /No active block/i,
    );
    await expect(page.getByTestId("stats-engine-regions")).toHaveAttribute(
      "data-empty",
      "true",
    );
    await expect(page.getByTestId("stats-engine-overrides")).toHaveAttribute(
      "data-empty",
      "true",
    );
  });
});
