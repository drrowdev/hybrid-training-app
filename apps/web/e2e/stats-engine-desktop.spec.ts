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
 *  - all five sections render
 *  - the decision-trace headline + archetype name appear
 *  - the "Why?" tooltip on a bucket exposes a popover with explanation
 *  - the recent overrides list has at least one row
 */

test.describe("@desktop /app/stats/engine", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("renders all sections + decision trace + bucket why", async ({
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
    // Cache footnote — confirms the page is now backed by
    // region_state_history rather than re-deriving from set_logs.
    await expect(page.getByTestId("stats-engine-regions-footnote")).toContainText(
      /Updated daily at 03:00 UTC/i,
    );

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

    // ── D · Ceiling explainer (DC-C9 · DC-K1 — median of recovered weeks) ─
    await expect(page.getByTestId("stats-engine-ceiling")).toBeVisible();
    await expect(page.getByTestId("stats-engine-ceiling-final")).toContainText(
      /kg/i,
    );
    // The DC-K1 recovered-weeks badge must render with a formula attribute.
    await expect(
      page.getByTestId("stats-engine-ceiling-recovered-badge"),
    ).toBeVisible();
    await expect(page.getByTestId("stats-engine-ceiling")).toHaveAttribute(
      "data-formula",
      /median_of_recovered|cold_start_partial|cold_start_conservative/,
    );

    // ── E · Recent overrides ─────────────────────────────────
    const overrides = page.getByTestId("stats-engine-overrides");
    await expect(overrides).toBeVisible();
    const overrideRows = page.getByTestId("stats-engine-override-row");
    expect(await overrideRows.count()).toBeGreaterThanOrEqual(2);
    // The swap event was seeded with a reason — assert it renders as
    // a quoted note (DC-K4 audit log surfaces user-entered reasons).
    await expect(page.getByTestId("stats-engine-override-note").first()).toContainText(
      /Bar busy/i,
    );
  });

  test("region freshness strip reads from region_state_history cache (PR #41)", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    // Seed region_state so the live-fallback path emits today's value
    // (baseline > 0 makes the region surface even with no set_logs).
    await admin.from("region_state").upsert(
      [
        {
          user_id: freshUser.userId,
          region: "knee",
          atl: 0,
          ctl: 0,
          baseline_tolerance: 5,
          last_load_date: null,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: "user_id,region" },
    );

    // Seed 7 historical snapshots in region_state_history. The page
    // should render them as the prefix of the 14-day strip, with
    // today's live value appended (cron-not-yet-run fallback).
    const today = new Date();
    const rows = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - (7 - i));
      return {
        user_id: freshUser.userId,
        region: "knee",
        snapshot_date: d.toISOString().slice(0, 10),
        freshness_score: 0.5 + i * 0.05,
        context: { sets_7d: i, sets_14d: i, sets_28d: i, last_hit_date: null },
      };
    });
    await admin
      .from("region_state_history")
      .upsert(rows, { onConflict: "user_id,region,snapshot_date" });

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats/engine");
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("stats-engine-regions")).toBeVisible();
    const kneeRow = page
      .getByTestId("stats-engine-region-row")
      .filter({ hasText: /Knees|Quads/ });
    await expect(kneeRow).toBeVisible();
    // Cache footnote present whenever the section is non-empty.
    await expect(page.getByTestId("stats-engine-regions-footnote")).toContainText(
      /Updated daily at 03:00 UTC/i,
    );
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
