import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * Platform program picker — end-to-end deploy of 5/3/1 (cutover validation).
 *
 * Proves the platform loop works against a real user: seed the four canonical
 * strength 1RMs, sign in, open /app/program, deploy 5/3/1, and verify the
 * deploy actually wrote a platform block (archetype NULL, program_id set) with
 * materialised planned_sessions and an active program_instance — then confirm
 * the user is routed to Today.
 *
 * Slugs chosen so each anchors a 5/3/1 engine key via its StrengthRole
 * (squat / horizontal_press / deadlift / vertical_press → squat/bench/deadlift/press).
 */

const STRENGTH_TMS: { slug: string; oneRmKg: number }[] = [
  { slug: "back-squat-high-bar", oneRmKg: 165 },
  { slug: "bench-press-flat", oneRmKg: 118 },
  { slug: "conventional-deadlift", oneRmKg: 212 },
  { slug: "ohp-standing", oneRmKg: 71 },
];

test.describe("@desktop /app/program · deploy 5/3/1", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("picker deploys a 5/3/1 platform block end-to-end", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    // Seed the four canonical strength 1RMs so the engine can prescribe.
    for (const tm of STRENGTH_TMS) {
      const { data: mv } = await admin
        .from("movements")
        .select("id")
        .eq("slug", tm.slug)
        .is("user_id", null)
        .maybeSingle();
      expect(mv, `catalog must have ${tm.slug}`).toBeTruthy();
      const { error } = await admin.from("training_maxes").upsert(
        {
          user_id: freshUser.userId,
          movement_id: mv!.id,
          one_rm_kg: tm.oneRmKg,
          source: "entered",
        },
        { onConflict: "user_id,movement_id" },
      );
      expect(error).toBeNull();
    }

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/program");
    await page.waitForLoadState("networkidle");

    // The 5/3/1 program card should be present + enabled.
    await expect(page.getByRole("heading", { name: "Start a program" })).toBeVisible();
    await page.getByTestId("program-card-wendler-531").click();

    // Advance through the 4-step wizard: Program → Loadout → Benchmarks → Schedule.
    const next = page.getByRole("button", { name: "Continue" });
    await next.click();
    await next.click();
    await next.click();

    // Deploy from the final (Schedule) step.
    const deploy = page.getByRole("button", { name: /Deploy program/ });
    await expect(deploy).toBeEnabled();
    await deploy.click();

    // On success the picker routes to Today.
    await page.waitForURL("**/app", { timeout: 15_000 });

    // Verify the write landed: an active platform block for this user.
    const { data: block, error: blockErr } = await admin
      .from("training_blocks")
      .select("id, archetype, program_id, program_family, status, weeks")
      .eq("user_id", freshUser.userId)
      .eq("status", "active")
      .maybeSingle();
    expect(blockErr).toBeNull();
    expect(block, "an active block must exist").toBeTruthy();
    expect(block!.archetype).toBeNull();
    expect(block!.program_id).toBe("wendler-531");
    expect(block!.program_family).toBe("531");
    expect(block!.weeks).toBe(11);

    // Materialised planned_sessions exist for the block.
    const { count: psCount } = await admin
      .from("planned_sessions")
      .select("id", { count: "exact", head: true })
      .eq("block_id", block!.id);
    expect(psCount, "planned_sessions materialised").toBe(44);

    // An active program_instance links to the block.
    const { data: pi } = await admin
      .from("program_instances")
      .select("id, program_id, status, block_id")
      .eq("user_id", freshUser.userId)
      .eq("status", "active")
      .maybeSingle();
    expect(pi, "active program_instance must exist").toBeTruthy();
    expect(pi!.program_id).toBe("wendler-531");
    expect(pi!.block_id).toBe(block!.id);

    // tm_percent seeded on training_maxes (Option A alignment) — ~85% of 1RM.
    const { data: tmRows } = await admin
      .from("training_maxes")
      .select("tm_percent")
      .eq("user_id", freshUser.userId)
      .not("tm_percent", "is", null);
    expect(tmRows && tmRows.length).toBeGreaterThan(0);
    for (const r of tmRows!) {
      const pct = Number(r.tm_percent);
      expect(pct).toBeGreaterThan(80);
      expect(pct).toBeLessThan(90);
    }
  });

  test("picker deploys a Tactical Barbell (Operator) platform block", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    for (const tm of STRENGTH_TMS) {
      const { data: mv } = await admin
        .from("movements")
        .select("id")
        .eq("slug", tm.slug)
        .is("user_id", null)
        .maybeSingle();
      expect(mv, `catalog must have ${tm.slug}`).toBeTruthy();
      const { error } = await admin.from("training_maxes").upsert(
        { user_id: freshUser.userId, movement_id: mv!.id, one_rm_kg: tm.oneRmKg, source: "entered" },
        { onConflict: "user_id,movement_id" },
      );
      expect(error).toBeNull();
    }

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/program");
    await page.waitForLoadState("networkidle");

    // Select the Tactical Barbell card (defaults to Operator → 3 days auto-picked).
    await page.getByTestId("program-card-tactical-barbell").click();

    // Advance through the 4-step wizard to the Schedule step.
    const next = page.getByRole("button", { name: "Continue" });
    await next.click();
    await next.click();
    await next.click();

    const deploy = page.getByRole("button", { name: /Deploy program/ });
    await expect(deploy).toBeEnabled();
    await deploy.click();
    await page.waitForURL("**/app", { timeout: 15_000 });

    const { data: block } = await admin
      .from("training_blocks")
      .select("id, archetype, program_id, program_family, status, weeks")
      .eq("user_id", freshUser.userId)
      .eq("status", "active")
      .maybeSingle();
    expect(block, "an active block must exist").toBeTruthy();
    expect(block!.archetype).toBeNull();
    expect(block!.program_id).toBe("tactical-barbell");
    expect(block!.program_family).toBe("tactical-barbell");
    expect(block!.weeks).toBe(6); // Operator block = 6 weeks

    // Operator default cluster trains 3 lifts × 3 sessions/week × 6 weeks = 18.
    const { count: psCount } = await admin
      .from("planned_sessions")
      .select("id", { count: "exact", head: true })
      .eq("block_id", block!.id);
    expect(psCount).toBe(18);

    const { data: pi } = await admin
      .from("program_instances")
      .select("program_id, status, block_id")
      .eq("user_id", freshUser.userId)
      .eq("status", "active")
      .maybeSingle();
    expect(pi, "active program_instance must exist").toBeTruthy();
    expect(pi!.program_id).toBe("tactical-barbell");
    expect(pi!.block_id).toBe(block!.id);
  });

  test("picker deploys TB Zulu with a custom A/B split cluster", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    for (const tm of STRENGTH_TMS) {
      const { data: mv } = await admin
        .from("movements")
        .select("id")
        .eq("slug", tm.slug)
        .is("user_id", null)
        .maybeSingle();
      const { error } = await admin.from("training_maxes").upsert(
        { user_id: freshUser.userId, movement_id: mv!.id, one_rm_kg: tm.oneRmKg, source: "entered" },
        { onConflict: "user_id,movement_id" },
      );
      expect(error).toBeNull();
    }

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/program");
    await page.waitForLoadState("networkidle");

    await page.getByTestId("program-card-tactical-barbell").click();

    // Loadout step: switch the template to Zulu (split A/B, 4 sessions/week). The
    // picker resets the cluster to Zulu's default split and the weekly grid to 4
    // strength days.
    const next = page.getByRole("button", { name: "Continue" });
    await next.click(); // Program → Loadout
    await page.getByTestId("loadout-opt-zulu").click();
    await next.click(); // Loadout → Benchmarks
    await next.click(); // Benchmarks → Schedule

    const deploy = page.getByRole("button", { name: /Deploy program/ });
    await expect(deploy).toBeEnabled();
    await deploy.click();
    await page.waitForURL("**/app", { timeout: 15_000 });

    const { data: block } = await admin
      .from("training_blocks")
      .select("id, program_id, weeks")
      .eq("user_id", freshUser.userId)
      .eq("status", "active")
      .maybeSingle();
    expect(block!.program_id).toBe("tactical-barbell");
    expect(block!.weeks).toBe(6);

    // Zulu = 6 weeks × 4 sessions/week = 24 planned sessions.
    const { count: psCount } = await admin
      .from("planned_sessions")
      .select("id", { count: "exact", head: true })
      .eq("block_id", block!.id);
    expect(psCount).toBe(24);

    // The instance cluster carries the A/B split.
    const { data: pi } = await admin
      .from("program_instances")
      .select("instance")
      .eq("user_id", freshUser.userId)
      .eq("status", "active")
      .maybeSingle();
    const cluster = (pi!.instance as { cluster?: { split?: string }[] }).cluster ?? [];
    expect(cluster.length).toBe(4);
    expect(cluster.some((c) => c.split === "A")).toBe(true);
    expect(cluster.some((c) => c.split === "B")).toBe(true);
  });

  test("picker deploys a Hybrid (native) platform block end-to-end", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    // Seed the four canonical strength 1RMs so Hybrid can prescribe %TM work.
    for (const tm of STRENGTH_TMS) {
      const { data: mv } = await admin
        .from("movements")
        .select("id")
        .eq("slug", tm.slug)
        .is("user_id", null)
        .maybeSingle();
      expect(mv, `catalog must have ${tm.slug}`).toBeTruthy();
      const { error } = await admin.from("training_maxes").upsert(
        { user_id: freshUser.userId, movement_id: mv!.id, one_rm_kg: tm.oneRmKg, source: "entered" },
        { onConflict: "user_id,movement_id" },
      );
      expect(error).toBeNull();
    }

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/program");
    await page.waitForLoadState("networkidle");

    // Select the Hybrid card. Hybrid is the balanced concurrent generator; like
    // 5/3/1 and TB the user picks training weekdays on the shared Schedule step
    // (pre-filled with a 4-day spread by default), and that count drives days/week.
    await page.getByTestId("program-card-hybrid").click();

    // Advance Program -> Loadout (focus muscles, optional) -> Benchmarks ->
    // Schedule (weekday picker, 4 days pre-selected) and deploy as-is.
    const next = page.getByRole("button", { name: "Continue" });
    await next.click();
    await next.click();
    await next.click();

    const deploy = page.getByRole("button", { name: /Deploy program/ });
    await expect(deploy).toBeEnabled();
    await deploy.click();
    await page.waitForURL("**/app", { timeout: 15_000 });

    // Verify the write landed: an active native platform block (archetype NULL).
    const { data: block, error: blockErr } = await admin
      .from("training_blocks")
      .select("id, archetype, program_id, program_family, status, weeks, days_per_week")
      .eq("user_id", freshUser.userId)
      .eq("status", "active")
      .maybeSingle();
    expect(blockErr).toBeNull();
    expect(block, "an active block must exist").toBeTruthy();
    expect(block!.archetype).toBeNull();
    expect(block!.program_id).toBe("hybrid");
    expect(block!.program_family).toBe("hybrid");
    expect(Number(block!.weeks)).toBeGreaterThan(0);
    expect(Number(block!.days_per_week)).toBe(4);

    // Materialised planned_sessions exist for the block.
    const { count: psCount } = await admin
      .from("planned_sessions")
      .select("id", { count: "exact", head: true })
      .eq("block_id", block!.id);
    expect(psCount, "planned_sessions materialised").toBeGreaterThan(0);

    // An active program_instance links to the block; Hybrid always runs the
    // balanced concurrent engine.
    const { data: pi } = await admin
      .from("program_instances")
      .select("program_id, program_family, status, block_id, instance")
      .eq("user_id", freshUser.userId)
      .eq("status", "active")
      .maybeSingle();
    expect(pi, "active program_instance must exist").toBeTruthy();
    expect(pi!.program_id).toBe("hybrid");
    expect(pi!.block_id).toBe(block!.id);
    expect((pi!.instance as { archetypeId?: string }).archetypeId).toBe("concurrent_hybrid");

    // Hybrid does NOT seed training_maxes.tm_percent (it renders off real TMs).
    const { data: tmRows } = await admin
      .from("training_maxes")
      .select("tm_percent")
      .eq("user_id", freshUser.userId)
      .not("tm_percent", "is", null);
    expect(tmRows && tmRows.length).toBe(0);
  });
});
