import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { generateSwimPlan } from "../../engine/src/swimming.ts";
import { poolCourse, estimateCriticalSwimSpeed } from "../../domain/src/swimming.ts";

type Snapshot = { revision: string; entries: { id: string; source: string; programId: string | null; date: string; state: string }[] };
type Created = { block_id: string; program_instance_id: string };
type Swim = { plan: { id: string; revision: number }; workouts: { id: string; revision: number }[] };
const json = (value: unknown) => JSON.stringify(value);
const hash = (value: unknown) => createHash("sha256").update(json(value)).digest("hex");

/** Disposable CI only. Call after historical down/up checks, never on hosted storage. */
export async function rehearseModularSchedule(
  database: postgres.Sql, restoreHistoricalBaseline = false, stage: (name: string) => void = () => {},
): Promise<string[]> {
  stage("modular-disposable-endpoint-guard");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.deepEqual(database.options.host, ["127.0.0.1"]);
  assert.deepEqual(database.options.port, [5432]);
  assert.equal(database.options.database, "swim_pool_test");
  const [{ databaseName }] = await database`SELECT current_database() AS "databaseName"`;
  assert.equal(databaseName, "swim_pool_test");
  const stages: string[] = [];
  if (restoreHistoricalBaseline) {
    stage("modular-historical-baseline-restoration");
    assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_plans`)[0]!.n, 0);
    for (const name of ["0151_swim_pool_changes", "0152_swim_private_courses", "0153_swim_import_matching", "0154_swim_untimed_courses"]) {
      await database.begin((tx) => tx.unsafe(readFileSync(new URL(`../drizzle/${name}.sql`, import.meta.url), "utf8")));
    }
  }
  const up = readFileSync(new URL("../drizzle/0156_modular_training_schedule.sql", import.meta.url), "utf8");
  const down = readFileSync(new URL("../rollbacks/0156_modular_training_schedule.down.sql", import.meta.url), "utf8");
  const inventory = () => database`SELECT p.oid, p.proname, p.proowner, p.prosecdef, p.proconfig, p.proacl::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN ('swim_create_plan','swim_start_workout','swim_set_plan_status','swim_skip_workout',
        'swim_update_plan','swim_resume_plan','swim_complete_workout','swim_edit_result',
        'complete_training_session_with_transition','replace_hyrox_session_actuals',
        'insert_deload_week','remove_deload_week','insert_set_logs_with_bw_progress') ORDER BY p.oid`;
  const baseline = await inventory();
  assert.equal(baseline.length, 13);
  stage("modular-unused-down-up-and-permissions");
  await database.begin((tx) => tx.unsafe(up));
  assert.deepEqual(await inventory(), baseline);
  const revert = async () => {
    const connection = await database.reserve();
    try { await connection.unsafe(down); }
    catch (error) { await connection.unsafe("ROLLBACK"); throw error; }
    finally { connection.release(); }
  };
  await revert();
  assert.deepEqual(await inventory(), baseline);
  await database.begin((tx) => tx.unsafe(up));
  const grants = await database`SELECT r.rolname,
    has_function_privilege(r.oid,'public.training_schedule_commit(text,jsonb,text,uuid,text,boolean)','EXECUTE') AS allowed
    FROM pg_roles r WHERE r.rolname IN ('authenticated','anon') ORDER BY r.rolname`;
  assert.deepEqual(Array.from(grants), [{ rolname: "anon", allowed: false }, { rolname: "authenticated", allowed: true }]);
  stages.push("modular-unused-down-up-and-unchanged-swim-permissions");

  const asUser = <T>(user: string | null, work: (tx: postgres.TransactionSql) => Promise<T>) => database.begin(async (tx) => {
    await tx.unsafe(user ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
    await tx`SELECT set_config('request.jwt.claims', ${json(user ? { sub: user } : {})}, true)`;
    return work(tx);
  });
  const denied = (work: () => Promise<unknown>, code: string) => assert.rejects(work, (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === code);
  const snapshotIn = async (tx: postgres.TransactionSql) =>
    (await tx<{ value: Snapshot }[]>`SELECT public.training_schedule_snapshot() AS value`)[0]!.value;
  const snapshot = (user: string) => asUser(user, snapshotIn);
  const commitIn = async <T>(tx: postgres.TransactionSql, operation: string, args: unknown, revision: string, requestId = randomUUID(), accept = false, input = args): Promise<T> => {
    stage(`modular-${operation}`);
    return (await tx<{ value: T }[]>`SELECT public.training_schedule_commit(${operation},${json(args)}::text::jsonb,${revision},
      ${requestId}::uuid,${hash(input)},${accept}) AS value`)[0]!.value;
  };
  const commit = <T>(user: string, operation: string, args: unknown, revision: string, requestId = randomUUID(), accept = false, input = args) =>
    asUser(user, (tx) => commitIn<T>(tx, operation, args, revision, requestId, accept, input));
  const a = randomUUID(), b = randomUUID();
  stage("modular-synthetic-users");
  await database`INSERT INTO auth.users(id) VALUES (${a}),(${b})`;
  try {
    stage("modular-authored-training-day-boundaries");
    for (const program of ["authored", "hybrid", null]) {
      for (const days of [-1, 0, 8, ...(program === "authored" ? [] : [1])]) {
        await denied(() => asUser(b, async (tx) => tx`
          INSERT INTO public.training_blocks(user_id,program_id,started_on,weeks,days_per_week)
          VALUES (${b}::uuid,${program},current_date,1,${days})`), "23514");
      }
      for (const days of [null, 2, 7, ...(program === "authored" ? [1] : [])]) {
        await asUser(b, async (tx) => {
          const [row] = await tx`INSERT INTO public.training_blocks(user_id,program_id,started_on,weeks,days_per_week)
            VALUES (${b}::uuid,${program},current_date,1,${days}) RETURNING id,days_per_week`;
          assert.equal(row!.days_per_week, days);
          await tx`DELETE FROM public.training_blocks WHERE id=${row!.id}`;
        });
      }
    }
    const [hidden] = await database`INSERT INTO public.training_blocks(user_id,program_id,started_on,weeks,days_per_week,status,deleted_at)
      VALUES (${b}::uuid,'authored',current_date,1,1,'archived',now()) RETURNING id`;
    await denied(revert, "P0001");
    await database`DELETE FROM public.training_blocks WHERE id=${hidden!.id}`;
    stages.push("modular-authored-one-day-boundaries-and-hidden-history-down-refusal");
    const [calendar] = await database<{ today: string; tomorrow: string; weekday: number }[]>`
      SELECT to_char(current_date,'YYYY-MM-DD') AS today, to_char(current_date+1,'YYYY-MM-DD') AS tomorrow,
        extract(isodow FROM current_date)::int-1 AS weekday`;
    assert.ok(calendar);
    const [movement] = await database`SELECT id FROM public.movements WHERE user_id IS NULL AND pattern <> 'cardio' ORDER BY id LIMIT 1`;
    assert.ok(movement);
    const prescription = { items: [{ kind: "main", movementId: movement.id, sets: 1, reps: 5, targetWeightKg: 10,
      bw: { family: "push_h", prescriptionType: "reps" } }] };
    const primary = {
      p_block: { program_id: "authored", program_family: "hybrid", started_on: calendar.today, weeks: 2, days_per_week: 1,
        day_index_overrides: { days: [calendar.weekday] }, cardio_source: "internal", allows_two_a_days: false, accessory_volume: "medium", notes: "Synthetic hybrid" },
      p_planned_sessions: [{ week_index: 0, day_index: calendar.weekday, slot: "single", title: "Synthetic mixed workout",
        role: "strength", prescription, session_modality: "strength", effective_stress_load: 1 }],
      p_tm_percents: [],
      p_program_instance: { program_id: "authored", program_family: "hybrid", display_name: "Synthetic hybrid", customization_version: 1, instance: { version: 1 }, setup_input: {} },
    };
    const initial = await snapshot(a), requestId = randomUUID();
    await denied(() => commit(a, "primary-create", {
      ...primary, p_training_max_drafts: [{ movementId: movement.id, oneRmKg: 0 }],
    }, initial.revision), "22023");
    await denied(() => commit(a, "primary-create", {
      ...primary, p_training_max_drafts: [{ movementId: randomUUID(), oneRmKg: 120 }],
    }, initial.revision), "22023");
    assert.equal((await snapshot(a)).revision, initial.revision);
    const first = await commit<Created>(a, "primary-create", primary, initial.revision, requestId);
    assert.deepEqual(await commit<Created>(a, "primary-create", primary, initial.revision, requestId), first);
    await denied(() => commit(a, "primary-create", { ...primary, changed: true }, initial.revision, requestId), "22023");
    await denied(() => commit(a, "primary-create", primary, initial.revision), "40001");
    const own = await snapshot(a), foreign = await snapshot(b);
    await denied(() => commit(a, "primary-create", primary, own.revision), "22023");
    assert.equal(own.entries.filter((entry) => entry.source === "primary" && entry.state === "scheduled").length, 1);
    assert.equal(foreign.entries.length, 0);
    await denied(() => asUser(null, snapshotIn), "42501");
    const planned = own.entries.find((entry) => entry.state === "scheduled")!;
    await denied(() => commit(b, "primary-move", { id: planned.id, weekIndex: 1, dayIndex: calendar.weekday }, foreign.revision), "P0001");
    await denied(revert, "P0001");
    stages.push("modular-DC-K4-replay-stale-review-and-DC-SW8-isolation");

    const course = poolCourse(50, 1, "m");
    const setup = { goal: "endurance" as const, experience: "recreational" as const, course, knownStrokes: ["freestyle" as const],
      equipment: [], recentComfortableLengths: 8, sessionBudgetMinutes: 60 };
    const calibration = estimateCriticalSwimSpeed({ course, protocol: "css_200_400", stroke: "freestyle", equipment: [], verified: true,
      observedOn: calendar.today, version: "swim-css-1", trials: [{ distance: 200, lengths: 4, timeMs: 200000 }, { distance: 400, lengths: 8, timeMs: 420000 }] });
    assert.ok(calibration.ok);
    const generated = generateSwimPlan({ setup, calibration: calibration.value, weeks: [{ weekIndex: 0, startDateISO: calendar.today,
      slots: [{ slotId: "synthetic", dateISO: calendar.today, intent: "moderate", source: "swim_date" }] }] });
    assert.ok(generated.ok);
    const slot = generated.value.weeks[0]!.slots[0]!;
    assert.equal(slot.kind, "workout");
    if (slot.kind !== "workout") throw new Error("Expected synthetic workout");
    const swimArgs = { p_started_on: calendar.today, p_ends_on: calendar.tomorrow,
      p_definition: { version: 1, setup, generatorVersion: "swim-gen-1" },
      p_state: { version: 1, observations: [calibration.value.observation], acceptedCalibration: calibration.value, decisions: [] },
      p_workouts: [{ scheduled_date: calendar.today, slot: "single", definition: { version: 1, original: slot.original, issued: slot.issued, modifications: [], slotId: "synthetic" } }] };
    await denied(() => commit(a, "swim-create", swimArgs, own.revision), "22023");
    assert.equal((await snapshot(a)).revision, own.revision);
    let swim = await commit<Swim>(a, "swim-create", swimArgs, own.revision, randomUUID(), true);
    const replacement = { ...primary, p_replace_block_id: first.block_id,
      p_training_max_drafts: [{ movementId: movement.id, oneRmKg: 120 }], p_rehab_bindings: [], p_skipped: 0 };
    const together = await snapshot(a);
    await denied(() => commit(a, "primary-create", replacement, together.revision), "22023");
    assert.equal((await snapshot(a)).revision, together.revision);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.training_maxes WHERE user_id=${a}::uuid`)[0]!.n, 0);
    const replaced = await commit<Created>(a, "primary-create", replacement, together.revision, randomUUID(), true);
    const [enteredMax] = await database`SELECT one_rm_kg::float AS value,source FROM public.training_maxes
      WHERE user_id=${a}::uuid AND movement_id=${movement.id}::uuid`;
    assert.deepEqual(enteredMax, { value: 120, source: "entered" });
    assert.ok((await snapshot(a)).entries.some((entry) => entry.programId === swim.plan.id));
    const edited = await commit<Created & { skipped: number; todayLeftAsIs: boolean }>(a, "primary-update", {
      p_block_id: replaced.block_id, p_strength_updates: [], p_deletions: [], p_insertions: [],
      p_block_metadata: { weeks: 2, days_per_week: 1, day_index_overrides: primary.p_block.day_index_overrides,
        cardio_source: "internal", notes: "Synthetic edited hybrid" },
      p_tm_percents: [], p_program_instance: primary.p_program_instance, p_rehab_bindings: [],
      p_skipped: 0, p_today_left_as_is: false,
    }, (await snapshot(a)).revision);
    assert.deepEqual(edited, { ...replaced, skipped: 0, todayLeftAsIs: false });
    stages.push("modular-DC-SW7-bidirectional-explicit-overlap-and-independent-replacement");

    const barrier = () => {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => { release = resolve; });
      return { promise, release };
    };
    const waitForSharedLock = async (name: string) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const [row] = await database`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE application_name=${name} AND wait_event_type='Lock' AND wait_event='advisory'`;
        if (row!.n === 1) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail(`Expected ${name} to wait for the shared advisory lock`);
    };
    const firstLocked = barrier(), releaseFirst = barrier();
    const primaryTransaction = asUser(a, async (tx) => {
      const reviewed = await snapshotIn(tx);
      firstLocked.release();
      await releaseFirst.promise;
      const row = reviewed.entries.find((entry) => entry.source === "primary" && entry.state === "scheduled")!;
      return commitIn(tx, "primary-move", { id: row.id, weekIndex: 1, dayIndex: calendar.weekday }, reviewed.revision);
    });
    await firstLocked.promise;
    const legacySwimming = asUser(a, async (tx) => {
      await tx`SELECT set_config('application_name','modular-legacy-waiter',true)`;
      return (await tx<{ value: Swim["plan"] }[]>`SELECT public.swim_set_plan_status(${swim.plan.id}::uuid,${swim.plan.revision},'paused') AS value`)[0]!.value;
    });
    try { await waitForSharedLock("modular-legacy-waiter"); }
    finally { releaseFirst.release(); }
    const [, paused] = await Promise.all([primaryTransaction, legacySwimming]);
    swim = { ...swim, plan: paused };
    const reviewed = await snapshot(a), swimLocked = barrier(), releaseSwim = barrier();
    const legacyFirst = asUser(a, async (tx) => {
      await tx`SELECT public.swim_set_plan_status(${swim.plan.id}::uuid,${swim.plan.revision},'finished')`;
      swimLocked.release();
      await releaseSwim.promise;
    });
    await swimLocked.promise;
    const stalePrimary = denied(() => asUser(a, async (tx) => {
      await tx`SELECT set_config('application_name','modular-primary-waiter',true)`;
      return commitIn(tx, "primary-create", { ...primary, p_replace_block_id: replaced.block_id }, reviewed.revision);
    }), "40001");
    try { await waitForSharedLock("modular-primary-waiter"); }
    finally { releaseSwim.release(); }
    await Promise.all([legacyFirst, stalePrimary]);
    assert.ok((await snapshot(a)).entries.some((entry) => entry.programId === replaced.block_id));
    assert.deepEqual(await inventory(), baseline);
    stages.push("modular-opposite-order-two-connection-primary-and-legacy-swim-contention");
    await commit(a, "primary-delete", { id: replaced.block_id }, (await snapshot(a)).revision);
    const [trashedActive] = await database`SELECT status,deleted_at FROM public.training_blocks WHERE id=${replaced.block_id}::uuid`;
    assert.equal(trashedActive!.status, "active");
    assert.ok(trashedActive!.deleted_at);
    await commit(a, "primary-restore", { id: replaced.block_id }, (await snapshot(a)).revision);
    const [restoredActive] = await database`SELECT status,deleted_at FROM public.training_blocks WHERE id=${replaced.block_id}::uuid`;
    assert.equal(restoredActive!.status, "active");
    assert.equal(restoredActive!.deleted_at, null);
    const upcoming = (await snapshot(a)).entries.find((entry) => entry.programId === replaced.block_id && entry.state === "scheduled")!;
    await commit(a, "primary-skip", { id: upcoming.id, reason: "Synthetic skip" }, (await snapshot(a)).revision);
    assert.ok(!(await snapshot(a)).entries.some((entry) => entry.id === upcoming.id));
    await commit(a, "primary-unskip", { id: upcoming.id }, (await snapshot(a)).revision);
    assert.ok((await snapshot(a)).entries.some((entry) => entry.id === upcoming.id));
    const start = () => asUser(a, async (tx) => (await tx<{ id: string }[]>`
      SELECT public.start_planned_session_atomically(${upcoming.id}::uuid,now()) AS id`)[0]!.id);
    const started = await Promise.all([start(), start()]);
    assert.equal(started[0], started[1]);
    const [savedSession] = await database`SELECT prescription FROM public.sessions WHERE id=${started[0]}::uuid AND user_id=${a}::uuid`;
    assert.deepEqual(savedSession!.prescription, { ...prescription, meta: { userRescheduled: true } });
    await denied(async () => commit(a, "primary-move", { id: upcoming.id, weekIndex: 0, dayIndex: calendar.weekday }, (await snapshot(a)).revision), "P0001");
    await denied(async () => commit(a, "authored-workout", { blockId: replaced.block_id, updates: [{ id: upcoming.id, title: "Changed", prescription }] },
      (await snapshot(a)).revision), "P0001");
    const contendWithSession = async (name: string, legacy: (tx: postgres.TransactionSql) => Promise<unknown>,
      touchLockedRow: (tx: postgres.TransactionSql) => Promise<unknown> = async (tx) =>
        tx`SELECT public.start_planned_session_atomically(${upcoming.id}::uuid,now())`) => {
      stage(name);
      const locked = barrier(), release = barrier();
      const holder = asUser(a, async (tx) => {
        await snapshotIn(tx);
        locked.release();
        await release.promise;
        await touchLockedRow(tx);
      });
      await locked.promise;
      const waiter = asUser(a, async (tx) => {
        await tx`SELECT set_config('application_name',${name},true)`;
        return legacy(tx);
      });
      try { await waitForSharedLock(name); }
      finally { release.release(); }
      await Promise.all([holder, waiter]);
    };
    await contendWithSession("modular-completion-waiter", async (tx) =>
      tx`SELECT * FROM public.complete_training_session_with_transition(${started[0]}::uuid,NULL,NULL)`);
    await contendWithSession("modular-actuals-waiter", async (tx) =>
      tx`SELECT public.replace_hyrox_session_actuals(${started[0]}::uuid,'[]'::jsonb,'[]'::jsonb,1,NULL,NULL)`);
    await contendWithSession("modular-direct-set-waiter", async (tx) =>
      tx`INSERT INTO public.set_logs(session_id,movement_id,set_index,reps,weight_kg)
        VALUES (${started[0]}::uuid,${movement.id}::uuid,0,5,10)`);
    await contendWithSession("modular-direct-cardio-waiter", async (tx) =>
      tx`INSERT INTO public.cardio_logs(session_id,modality,duration_sec) VALUES (${started[0]}::uuid,'run',60)`);
    const logged = [{ session_id: started[0], movement_id: movement.id, set_index: 1, reps: 5,
      prescription_item_index: 0, client_log_id: randomUUID() }];
    await contendWithSession("modular-bw-batch-waiter", async (tx) =>
      tx`SELECT * FROM public.insert_set_logs_with_bw_progress(${json(logged)}::text::jsonb)`, async (tx) =>
      tx`SELECT pg_advisory_xact_lock(hashtextextended(${"bw-progress:" + a + ":push_h"},0))`);
    await contendWithSession("modular-recovery-waiter", async (tx) =>
      tx`SELECT public.insert_deload_week(${replaced.block_id}::uuid,${a}::uuid,0,
        ${json([{ day_index: calendar.weekday, title: "Synthetic recovery", prescription }])}::text::jsonb)`, async (tx) =>
      tx`SELECT id FROM public.training_blocks WHERE id=${replaced.block_id}::uuid FOR UPDATE`);
    const [loggedCounts] = await database`SELECT
      (SELECT count(*)::int FROM public.set_logs WHERE session_id=${started[0]}::uuid) AS sets,
      (SELECT count(*)::int FROM public.cardio_logs WHERE session_id=${started[0]}::uuid) AS cardio`;
    assert.deepEqual(loggedCounts, { sets: 2, cardio: 1 });
    stages.push("modular-two-connection-shared-completion-and-actuals-lock-order");
    stages.push("modular-two-connection-recovery-bw-batch-and-direct-logger-lock-order");
    const independent = await commit<Swim>(a, "swim-create", swimArgs, (await snapshot(a)).revision, randomUUID(), true);
    await commit(a, "primary-end", { id: replaced.block_id, reason: "Synthetic independent end" }, (await snapshot(a)).revision);
    const [ended] = await database`SELECT status,archived_at,ended_at FROM public.training_blocks WHERE id=${replaced.block_id}::uuid`;
    assert.equal(ended!.status, "archived");
    assert.ok(ended!.ended_at);
    assert.equal(ended!.archived_at.getTime(), ended!.ended_at.getTime());
    const [audit] = await database`SELECT reason,context FROM public.engine_override_events WHERE user_id=${a}::uuid AND block_id=${replaced.block_id}::uuid AND event_type='manual_end'`;
    assert.equal(audit!.reason, "Synthetic independent end");
    assert.equal(audit!.context.weeks, 3);
    assert.ok((await snapshot(a)).entries.some((entry) => entry.programId === independent.plan.id));
    await commit(a, "primary-delete", { id: replaced.block_id }, (await snapshot(a)).revision);
    await commit(a, "primary-restore", { id: replaced.block_id }, (await snapshot(a)).revision);
    const [retained] = await database`SELECT prescription,deleted_at FROM public.sessions WHERE id=${started[0]}::uuid`;
    assert.equal(retained!.deleted_at, null);
    assert.deepEqual(retained!.prescription, savedSession!.prescription);
    stages.push("modular-DC-K4-atomic-start-history-skip-undo-and-DC-SW7-independent-end-trash-restore");

    stage("modular-reviewed-recovery-calendar");
    await commit(a, "swim-status", { p_plan_id: independent.plan.id, p_expected_revision: independent.plan.revision, p_status: "finished" },
      (await snapshot(a)).revision);
    const recoveryBlock = await commit<Created>(a, "primary-create", {
      ...primary, p_planned_sessions: [primary.p_planned_sessions[0], { ...primary.p_planned_sessions[0], week_index: 1 }],
    }, (await snapshot(a)).revision, randomUUID(), true);
    const [recoveryDates] = await database<{ first: string; second: string; end: string }[]>`
      SELECT to_char(current_date+7,'YYYY-MM-DD') AS first, to_char(current_date+14,'YYYY-MM-DD') AS second,
        to_char(current_date+21,'YYYY-MM-DD') AS end`;
    const recoverySwim = await commit<Swim>(a, "swim-create", {
      ...swimArgs, p_ends_on: recoveryDates!.end,
      p_workouts: [recoveryDates!.first, recoveryDates!.second].map((date) => ({ ...swimArgs.p_workouts[0], scheduled_date: date })),
    }, (await snapshot(a)).revision, randomUUID(), true);
    const insertion = { blockId: recoveryBlock.block_id, afterWeek: 0,
      sessions: [{ day_index: (calendar.weekday + 1) % 7, title: "Synthetic reviewed recovery", prescription }] };
    const beforeInsert = await snapshot(a);
    const rejectedInsert = randomUUID();
    await denied(() => commit(a, "primary-insert-deload", insertion, beforeInsert.revision, rejectedInsert), "22023");
    assert.equal((await snapshot(a)).revision, beforeInsert.revision);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.engine_override_events WHERE id=${rejectedInsert}::uuid`)[0]!.n, 0);
    await denied(async () => commit(b, "primary-insert-deload", { ...insertion, p_user_id: a }, (await snapshot(b)).revision), "P0001");
    const insertId = randomUUID();
    const inserted = await commit(a, "primary-insert-deload", insertion, beforeInsert.revision, insertId, true);
    assert.deepEqual(inserted, { deloadWeekIndex: 1, sessions: 1 });
    assert.deepEqual(await commit(a, "primary-insert-deload", insertion, beforeInsert.revision, insertId, true), inserted);
    await denied(() => commit(a, "primary-insert-deload", insertion, beforeInsert.revision, randomUUID(), true), "40001");
    await denied(() => commit(a, "primary-insert-deload", { ...insertion, afterWeek: 1 }, beforeInsert.revision, insertId, true), "22023");
    const beforeRemove = await snapshot(a), removal = { blockId: recoveryBlock.block_id, weekIndex: 1 };
    await denied(() => commit(a, "primary-remove-deload", removal, beforeRemove.revision), "22023");
    assert.equal((await snapshot(a)).revision, beforeRemove.revision);
    await denied(async () => commit(b, "primary-remove-deload", { ...removal, p_user_id: a }, (await snapshot(b)).revision), "P0001");
    const removeId = randomUUID();
    const removed = await commit(a, "primary-remove-deload", removal, beforeRemove.revision, removeId, true);
    assert.deepEqual(removed, { blockId: recoveryBlock.block_id });
    assert.deepEqual(await commit(a, "primary-remove-deload", removal, beforeRemove.revision, removeId, true), removed);
    assert.deepEqual((await snapshot(a)).entries, beforeInsert.entries);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.engine_override_events WHERE id IN (${insertId}::uuid,${removeId}::uuid)`)[0]!.n, 2);
    assert.equal((await database`SELECT weeks FROM public.training_blocks WHERE id=${recoveryBlock.block_id}::uuid`)[0]!.weeks, 2);
    stages.push("modular-DC-K4-recovery-insert-remove-overlap-replay-ownership-and-rollback");

    await commit(a, "primary-insert-deload", insertion, (await snapshot(a)).revision, randomUUID(), true);
    const [recoveryRow] = await database`SELECT id FROM public.planned_sessions
      WHERE block_id=${recoveryBlock.block_id}::uuid AND week_index=1 AND role='deload'`;
    assert.ok(recoveryRow);
    const startLocked = barrier(), releaseStart = barrier();
    const startRecovery = asUser(a, async (tx) => {
      await snapshotIn(tx);
      startLocked.release();
      await releaseStart.promise;
      return (await tx<{ id: string }[]>`SELECT public.start_planned_session_atomically(${recoveryRow.id}::uuid,now()) AS id`)[0]!.id;
    });
    await startLocked.promise;
    const removeAfterStart = denied(() => asUser(a, async (tx) => {
      await tx`SELECT set_config('application_name','modular-remove-history-waiter',true)`;
      return tx`SELECT public.remove_deload_week(${recoveryBlock.block_id}::uuid,${a}::uuid,1)`;
    }), "P0001");
    try { await waitForSharedLock("modular-remove-history-waiter"); }
    finally { releaseStart.release(); }
    const [recoverySession] = await Promise.all([startRecovery, removeAfterStart]);
    assert.equal((await database`SELECT completed_session_id FROM public.planned_sessions WHERE id=${recoveryRow.id}::uuid`)[0]!.completed_session_id, recoverySession);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.sessions WHERE id=${recoverySession}::uuid`)[0]!.n, 1);
    assert.equal((await database`SELECT weeks FROM public.training_blocks WHERE id=${recoveryBlock.block_id}::uuid`)[0]!.weeks, 3);
    await denied(async () => commit(a, "primary-remove-deload", removal, (await snapshot(a)).revision, randomUUID(), true), "P0001");
    assert.deepEqual((await snapshot(a)).entries.filter((entry) => entry.programId === recoverySwim.plan.id),
      beforeInsert.entries.filter((entry) => entry.programId === recoverySwim.plan.id));
    await denied(revert, "P0001");
    assert.deepEqual(await inventory(), baseline);
    stages.push("modular-legacy-recovery-removal-waits-before-new-history-check-and-retains-history");

    stage("modular-template-graph-maxes-rehab-and-recovery");
    const previousTemplate = await commit<Created>(b, "primary-create", primary, (await snapshot(b)).revision);
    await commit<Swim>(b, "swim-create", swimArgs, (await snapshot(b)).revision, randomUUID(), true);
    const protocolId = randomUUID(), foreignProtocolId = randomUUID(), recommendationId = randomUUID();
    const protocol = { version: 1, items: [{ movementId: movement.id, sets: 1, reps: 5 }], links: [] };
    await database`INSERT INTO public.rehab_protocols(id,user_id,name,definition)
      VALUES (${protocolId}::uuid,${b}::uuid,'Synthetic owned rehab',${json(protocol)}::text::jsonb),
        (${foreignProtocolId}::uuid,${a}::uuid,'Synthetic other rehab',${json(protocol)}::text::jsonb)`;
    await database`INSERT INTO public.program_recommendations(id,user_id,block_id,program_instance_id,kind,title,detail)
      VALUES (${recommendationId}::uuid,${b}::uuid,${previousTemplate.block_id}::uuid,
        ${previousTemplate.program_instance_id}::uuid,'deload','Synthetic recovery','Synthetic only')`;
    const template = {
      ...primary, p_replace_block_id: previousTemplate.block_id,
      p_block: { ...primary.p_block, program_id: "tactical-barbell", program_family: "strength", days_per_week: 2,
        day_index_overrides: { days: [calendar.weekday, (calendar.weekday + 2) % 7].sort(), twoADay: false } },
      p_program_instance: { ...primary.p_program_instance, program_id: "tactical-barbell", program_family: "strength" },
      p_planned_sessions: [0, 1].flatMap((week_index) => [calendar.weekday, (calendar.weekday + 2) % 7].map((day_index) => ({
        ...primary.p_planned_sessions[0]!, week_index, day_index,
        role: week_index === 0 ? "deload" : "strength",
        prescription: week_index === 0 ? { ...prescription, insertedRecoveryWeek: true } : prescription,
      }))),
      p_training_max_drafts: [{ movementId: movement.id, oneRmKg: 155 }],
      p_tm_percents: [{ movementId: movement.id, tmPercent: 85 }],
      p_rehab_bindings: [{ localProtocolId: "protocol-1", rehabProtocolId: protocolId }],
      p_accept_recovery: true, p_skipped: 0,
    };
    const templateRevision = (await snapshot(b)).revision;
    const unchangedTemplate = async () => {
      assert.equal((await snapshot(b)).revision, templateRevision);
      assert.equal((await database`SELECT count(*)::int AS n FROM public.training_maxes WHERE user_id=${b}::uuid`)[0]!.n, 0);
      assert.equal((await database`SELECT count(*)::int AS n FROM public.program_rehab_bindings WHERE user_id=${b}::uuid`)[0]!.n, 0);
      const [recommendation] = await database`SELECT status,resolved_at FROM public.program_recommendations WHERE id=${recommendationId}::uuid`;
      assert.deepEqual(recommendation, { status: "pending", resolved_at: null });
    };
    await denied(() => commit(b, "primary-create", template, templateRevision), "22023");
    await unchangedTemplate();
    await denied(() => commit(b, "primary-create", template, "f".repeat(32), randomUUID(), true), "40001");
    await unchangedTemplate();
    await denied(() => commit(b, "primary-create", { ...template,
      p_rehab_bindings: [{ localProtocolId: "protocol-1", rehabProtocolId: foreignProtocolId }],
    }, templateRevision, randomUUID(), true), "42501");
    await unchangedTemplate();
    const templateRequest = randomUUID();
    const acceptedTemplate = await commit<Created>(b, "primary-create", template, templateRevision, templateRequest, true);
    assert.deepEqual(await commit<Created>(b, "primary-create", template, templateRevision, templateRequest, true), acceptedTemplate);
    const [templateMax] = await database`SELECT one_rm_kg::float AS value,tm_percent::float AS percent,source
      FROM public.training_maxes WHERE user_id=${b}::uuid AND movement_id=${movement.id}::uuid`;
    assert.deepEqual(templateMax, { value: 155, percent: 85, source: "entered" });
    const templateRows = await database`SELECT week_index,role,prescription->>'insertedRecoveryWeek' AS recovery
      FROM public.planned_sessions WHERE block_id=${acceptedTemplate.block_id}::uuid ORDER BY week_index,day_index`;
    assert.deepEqual(Array.from(templateRows), [
      { week_index: 0, role: "deload", recovery: "true" }, { week_index: 0, role: "deload", recovery: "true" },
      { week_index: 1, role: "strength", recovery: null }, { week_index: 1, role: "strength", recovery: null },
    ]);
    const bindings = await database`SELECT program_instance_id,local_protocol_id,rehab_protocol_id,user_id
      FROM public.program_rehab_bindings WHERE user_id=${b}::uuid`;
    assert.deepEqual(Array.from(bindings), [{ program_instance_id: acceptedTemplate.program_instance_id,
      local_protocol_id: "protocol-1", rehab_protocol_id: protocolId, user_id: b }]);
    const [acceptedRecommendation] = await database`SELECT status,resolved_at FROM public.program_recommendations WHERE id=${recommendationId}::uuid`;
    assert.equal(acceptedRecommendation!.status, "accepted");
    assert.ok(acceptedRecommendation!.resolved_at);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.training_blocks WHERE user_id=${b}::uuid`)[0]!.n, 2);
    assert.equal((await database`SELECT one_rm_kg::float AS value FROM public.training_maxes
      WHERE user_id=${a}::uuid AND movement_id=${movement.id}::uuid`)[0]!.value, 120);
    stages.push("modular-template-atomic-maxes-rehab-recovery-replay-and-refusal-rollback");
  } finally {
    await database`DELETE FROM public.program_rehab_bindings WHERE user_id IN (${a}::uuid,${b}::uuid)`;
    await database`DELETE FROM auth.users WHERE id IN (${a},${b})`;
  }
  stage("modular-cleaned-unused-schema-restoration");
  await revert();
  assert.deepEqual(await inventory(), baseline);
  await database.begin((tx) => tx.unsafe(up));
  assert.deepEqual(await inventory(), baseline);
  const [patched] = await database`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosrc LIKE '%-- ADR0085 common lock before swimming locks.%'`;
  assert.equal(patched!.n, 8);
  const [sessionPatched] = await database`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosrc LIKE '%-- ADR0085 common lock before session locks.%'`;
  assert.equal(sessionPatched!.n, 4);
  stages.push("modular-synthetic-cleanup-unused-down-and-final-lock-baseline");
  return stages;
}
