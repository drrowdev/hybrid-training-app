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
const TB3_TMS = [
  ...STRENGTH_TMS,
  // A weighted pull-up max is a SYSTEM load — bodyweight plus belt. 118 kg for
  // the 82 kg lifter seeded below is a +36 kg pull-up.
  { slug: "weighted-pull-up", oneRmKg: 118 },
  { slug: "bb-row-overhand", oneRmKg: 100 },
];
/** Bodyweight the system-load percentages above are resolved against. */
const TB3_BODYWEIGHT_KG = 82;

/**
 * A weighted pull-up's load is its percentage of the system max MINUS
 * bodyweight, so the engine can only resolve one for a lifter who has recorded
 * theirs.
 */
async function seedBodyweight(
  admin: { from: (table: string) => { update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => PromiseLike<{ error: { message: string } | null }> } } },
  userId: string,
) {
  const { error } = await admin
    .from("profiles")
    .update({ bodyweight_kg: TB3_BODYWEIGHT_KG })
    .eq("id", userId);
  if (error) throw new Error(`seed bodyweight: ${error.message}`);
}

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
    await seedBodyweight(admin, freshUser.userId);

    for (const tm of TB3_TMS) {
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

  test("picker deploys the fixed TB3 Zulu A/B loadout", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await seedBodyweight(admin, freshUser.userId);
    for (const tm of TB3_TMS) {
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

  test("picker starts TB3 Activation at Armor with the correct mixed schedule", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    test.slow();
    await markOnboarded(admin, freshUser.userId);
    for (const tm of [
      ...STRENGTH_TMS,
      { slug: "bb-row-overhand", oneRmKg: 100 },
      { slug: "rack-pull", oneRmKg: 200 },
    ]) {
      const { data: movement } = await admin
        .from("movements")
        .select("id")
        .eq("slug", tm.slug)
        .is("user_id", null)
        .maybeSingle();
      expect(movement, `catalog must have ${tm.slug}`).toBeTruthy();
      const { error } = await admin.from("training_maxes").upsert(
        {
          user_id: freshUser.userId,
          movement_id: movement!.id,
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

    await page.getByTestId("program-card-tactical-barbell").click();
    const next = page.getByRole("button", { name: "Continue" });
    await next.click();
    await page.getByTestId("loadout-opt-activation").click();
    await expect(
      page.getByTestId("activation-armor-supplementals"),
    ).toBeVisible();
    await page
      .getByTestId("activation-armorSupplementalA-reverse-hyper")
      .click();
    await page
      .getByTestId("activation-armorSupplementalB-inverted-row")
      .click();
    await next.click();
    await expect(page.getByRole("heading", { name: "Starting maxes" })).toBeVisible();
    await next.click();
    const startPoint = page.getByRole("combobox").filter({ has: page.locator("option") });
    await expect(startPoint).toContainText("Armor");
    await startPoint.selectOption({ label: "Armor" });
    await expect(
      page.getByText("Starting Armor: 4 strength, 2 cardio and 1 rest day."),
    ).toBeVisible();
    await expect(page.getByText("4 strength · 2 cardio · 1 rest")).toBeVisible();
    await expect(
      page.getByText(/requires a 1-rep max for Reverse Hyperextension/),
    ).toBeVisible();

    const deploy = page.getByRole("button", { name: /Deploy program/ });
    await expect(deploy).toBeDisabled();
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByLabel("Reverse Hyperextension 1-rep max").fill("80");
    await next.click();
    await expect(
      page.getByText(/requires a 1-rep max for Reverse Hyperextension/),
    ).toHaveCount(0);
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
    expect(block!.weeks).toBe(20);

    const { data: sessions } = await admin
      .from("planned_sessions")
      .select("id, week_index, day_index, role, prescription")
      .eq("block_id", block!.id);
    expect(sessions).toHaveLength(86);
    expect(
      sessions!.filter(
        (session) => session.week_index === 0 && session.role === "strength",
      ),
    ).toHaveLength(4);
    expect(
      sessions!.filter(
        (session) => session.week_index === 0 && session.role === "cardio",
      ),
    ).toHaveLength(2);
    expect(
      sessions!.filter((session) => session.week_index === 9).every(
        (session) => session.role === "deload",
      ),
    ).toBe(true);
    expect(
      sessions!.filter((session) => session.week_index === 16).map(
        (session) => session.day_index,
      ).sort((a, b) => a - b),
    ).toEqual([0, 1, 3, 5]);
    const cardio = sessions!.find(
      (session) => session.week_index === 0 && session.role === "cardio",
    );
    const cardioItems = (
      cardio!.prescription as {
        items: Array<{ kind?: string; durationMin?: number }>;
      }
    ).items;
    expect(cardioItems).toEqual([
      expect.objectContaining({ kind: "cardio_external", durationMin: 60 }),
    ]);

    // Pure prescribed cardio is one-tap complete. Reproduce the reported
    // failure with an existing manually logged cardio row: Mark done must
    // finish the session, retain that granular log, and never show the
    // strength-only "Log at least 1 set" gate.
    await page.goto(`/app/sessions/start/${cardio!.id}`);
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });
    const cardioSessionId = page.url().split("/").at(-1)!;
    const { error: manualCardioError } = await admin
      .from("cardio_logs")
      .insert({
        session_id: cardioSessionId,
        block_index: 0,
        modality: "other",
        duration_sec: 51 * 60,
      });
    expect(manualCardioError).toBeNull();
    await expect(page.getByTestId("finish-stickybar")).toHaveCount(0);
    await expect(page.getByTestId("cardio-log-form")).toHaveCount(0);
    await page
      .getByTestId("cardio-external-mark-complete-0")
      .click();
    await page.waitForURL("**/app", { timeout: 30_000 });

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("sessions")
          .select("completed_at, duration_min")
          .eq("id", cardioSessionId)
          .maybeSingle();
        return data ?? null;
      })
      .toEqual(
        expect.objectContaining({
          completed_at: expect.any(String),
          duration_min: 51,
        }),
      );
    const { data: retainedCardioLogs } = await admin
      .from("cardio_logs")
      .select("duration_sec")
      .eq("session_id", cardioSessionId);
    expect(retainedCardioLogs).toEqual([{ duration_sec: 51 * 60 }]);

    const freshCardio = sessions!.find(
      (session) =>
        session.week_index === 0 &&
        session.role === "cardio" &&
        session.id !== cardio!.id,
    )!;
    await page.goto(`/app/sessions/start/${freshCardio.id}`);
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });
    const freshCardioSessionId = page.url().split("/").at(-1)!;
    await expect(page.getByTestId("finish-stickybar")).toHaveCount(0);
    await page
      .getByTestId("cardio-external-mark-complete-0")
      .click();
    await page.waitForURL("**/app", { timeout: 30_000 });
    const { data: targetDurationLog } = await admin
      .from("cardio_logs")
      .select("duration_sec")
      .eq("session_id", freshCardioSessionId)
      .single();
    expect(targetDurationLog?.duration_sec).toBe(60 * 60);
    const { data: targetDurationSession } = await admin
      .from("sessions")
      .select("completed_at, duration_min")
      .eq("id", freshCardioSessionId)
      .single();
    expect(targetDurationSession).toMatchObject({
      completed_at: expect.any(String),
      duration_min: 60,
    });

    type StoredItem = {
      movementSlug?: string;
      movementName?: string;
      kind: string;
      reps?: number;
      percentTm?: number;
      optional?: boolean;
      setRange?: { min: number; max: number };
      repRange?: { min: number; max: number };
      circuit?: {
        id: string;
        name: string;
        position: number;
        size: number;
        rounds: number;
      };
    };
    const strengthItems = (
      session: NonNullable<typeof sessions>[number],
      slug: string,
      kind: string,
    ) => ((session.prescription as { items: StoredItem[] }).items ?? []).filter(
      (item) => item.movementSlug === slug && item.kind === kind,
    );
    const armorA1 = sessions!.find(
      (session) => session.week_index === 0 && session.day_index === 0,
    )!;
    const armorB1 = sessions!.find(
      (session) => session.week_index === 0 && session.day_index === 1,
    )!;

    expect(strengthItems(armorA1, "rack-pull", "main")).toHaveLength(4);
    const reverseHyper = strengthItems(armorA1, "reverse-hyper", "back_off");
    expect(reverseHyper).toHaveLength(5);
    expect(reverseHyper[0]).toMatchObject({
      percentTm: 65,
      setRange: { min: 3, max: 5 },
      repRange: { min: 8, max: 10 },
    });
    for (const slug of ["hanging-leg-raise", "hanging-knee-raise", "toes-to-bar"]) {
      const triadItems = strengthItems(armorA1, slug, "accessory");
      expect(triadItems).toHaveLength(3);
      expect(triadItems.every((item) => item.reps === 5)).toBe(true);
      expect(
        triadItems.every(
          (item) =>
            item.circuit?.id === "tb-ab-triad" &&
            item.circuit.name === "AB Triad" &&
            item.circuit.rounds === 3,
        ),
      ).toBe(true);
    }
    expect(strengthItems(armorB1, "bench-press-flat", "main")).toHaveLength(4);
    expect(strengthItems(armorB1, "bb-row-overhand", "main")).toHaveLength(4);
    expect(strengthItems(armorB1, "weighted-pull-up", "main")).toHaveLength(0);
    expect(strengthItems(armorB1, "inverted-row", "back_off")).toHaveLength(5);
    expect(strengthItems(armorB1, "ohp-standing", "back_off")).toHaveLength(5);

    await page.goto("/app/plan");
    await page.getByTestId("plan-phase-0").locator(":scope > summary").click();
    await page
      .getByTestId("plan-timeline-week-0")
      .locator(":scope > summary")
      .click();
    await page.getByText("Armor B1 · 70%", { exact: true }).first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    const optionalRows = drawer.locator('.set-row[data-optional="true"]');
    await expect(optionalRows).toHaveCount(4);
    await expect(optionalRows.first().locator(".optional-marker")).toHaveText(
      "· optional",
    );
    await expect(optionalRows.first().locator(".n")).toContainText(
      /4 · optional/,
    );
    await expect(optionalRows.first().locator(".v")).not.toContainText(
      "optional",
    );
    await page.setViewportSize({ width: 360, height: 800 });
    const movementBox = await optionalRows
      .first()
      .locator(":scope > span:nth-child(2)")
      .boundingBox();
    const valueBox = await optionalRows.first().locator(".v").boundingBox();
    expect(movementBox).toBeTruthy();
    expect(valueBox).toBeTruthy();
    expect(movementBox!.x + movementBox!.width).toBeLessThanOrEqual(
      valueBox!.x,
    );
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.goto(`/app/sessions/start/${armorA1.id}`);
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByTestId("focus-strip-logger")).toBeVisible();
    await page
      .getByRole("button", { name: /Reverse Hyperextension 0\/5/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Reverse Hyperextension" }),
    ).toBeVisible();
    await expect(page.getByText("3–5×8–10 @ 65% 1RM")).toBeVisible();
    await page.getByRole("button", { name: /Hanging Leg Raise 0\/3/ }).click();
    const circuitCue = page.getByTestId("focus-strip-circuit-cue");
    await expect(circuitCue).toContainText("AB Triad");
    await expect(circuitCue).toContainText("Round 1 of 3");
    await expect(circuitCue).toContainText(
      "Hanging Leg Raise → Hanging Knee Raise → Toes-to-Bar",
    );

    await page.getByTestId("movement-focus-log-button").click();
    await expect(
      page.getByRole("heading", { name: "Hanging Knee Raise" }),
    ).toBeVisible();
    await page.getByTestId("movement-focus-log-button").click();
    await expect(
      page.getByRole("heading", { name: "Toes-to-Bar" }),
    ).toBeVisible();
    await page.getByTestId("movement-focus-log-button").click();
    await expect(
      page.getByRole("heading", { name: "Hanging Leg Raise" }),
    ).toBeVisible();
    await expect(circuitCue).toContainText("Round 2 of 3");

    const loggedSessionId = page.url().split("/").at(-1)!;
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("set_logs")
          .select("movement:movements(slug)")
          .eq("session_id", loggedSessionId);
        return (data ?? [])
          .map((row) => {
            const movement = Array.isArray(row.movement)
              ? row.movement[0]
              : row.movement;
            return movement?.slug;
          })
          .filter(Boolean)
          .sort();
      })
      .toEqual([
        "hanging-knee-raise",
        "hanging-leg-raise",
        "toes-to-bar",
      ]);
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
