/**
 * E2E for /api/cron/region-state-snapshot.
 *
 * Hits the route with the right bearer and asserts:
 *   - response is { ok: true }
 *   - at least one row was upserted for the seeded user
 *
 * Skipped unless CRON_SECRET is set in the env the dev server reads
 * (apps/web/.env.local) — without it the route returns 401 by design.
 */
import { test, expect } from "./fixtures/seed";

test.describe("@desktop /api/cron/region-state-snapshot", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("returns 401 without bearer; succeeds with the right bearer", async ({
    request,
    admin,
    freshUser,
    baseURL,
  }) => {
    const secret = process.env.CRON_SECRET ?? process.env.E2E_CRON_SECRET;
    test.skip(!secret, "CRON_SECRET not configured in test env");
    const url = `${(baseURL ?? "http://localhost:3000").replace(/\/$/, "")}/api/cron/region-state-snapshot`;

    // 1) No bearer → 401.
    const noAuth = await request.get(url);
    expect(noAuth.status()).toBe(401);

    // 2) Seed a region_state row so the cron has something to snapshot
    //    for our user. The cron writes for every user in auth.users,
    //    so we just need to confirm our seeded user's row landed.
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

    // 3) Correct bearer → 200 with rows landed.
    const ok = await request.get(url, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.ok).toBe(true);
    expect(typeof body.snapshot_date).toBe("string");
    expect(body.users_processed).toBeGreaterThan(0);

    const today = new Date().toISOString().slice(0, 10);
    const { data: rows, error } = await admin
      .from("region_state_history")
      .select("region, snapshot_date, freshness_score")
      .eq("user_id", freshUser.userId)
      .eq("snapshot_date", today);
    expect(error).toBeNull();
    expect(rows?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(rows![0].region).toBe("knee");
  });
});
