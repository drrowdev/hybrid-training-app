import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { generateSwimPlan } from "../../engine/src/swimming.ts";
import { poolCourse } from "../../domain/src/swimming.ts";

const json = (value: unknown) => JSON.stringify(value);
const hash = (value: unknown) => createHash("sha256").update(json(value)).digest("hex");
type Kind = "strength" | "running" | "hybrid";
type Created = { block_id: string; program_instance_id: string };
type Snapshot = { revision: string; entries: { id: string; programId: string | null; state: string }[] };
type Swim = { plan: { id: string }; workouts: { id: string }[] };
const permutations = <T>(values: readonly T[]): T[][] => values.length === 0 ? [[]] :
  values.flatMap((value, index) => permutations(values.filter((_, at) => at !== index)).map((rest) => [value, ...rest]));

/** Only the existing loopback GitHub fixture may execute this storage contract. */
export async function rehearseIndependentPrograms(database: postgres.Sql, stage: (name: string) => void) {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_JOB, "pool-storage");
  assert.equal(process.platform, "linux");
  assert.deepEqual(database.options.host, ["127.0.0.1"]);
  assert.deepEqual(database.options.port, [5432]);
  assert.equal(database.options.database, "swim_pool_test");
  assert.equal((await database`SELECT current_database() AS name`)[0]!.name, "swim_pool_test");
  assert.equal((await database`SELECT count(*)::int AS n FROM auth.users`)[0]!.n, 0);
  const stages: string[] = [];
  const up = readFileSync(new URL("../drizzle/0158_independent_program_ownership.sql", import.meta.url), "utf8");
  const down = readFileSync(new URL("../rollbacks/0158_independent_program_ownership.down.sql", import.meta.url), "utf8");
  const catalog = async () => (await database`SELECT md5(jsonb_build_array(
    (SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proowner,p.proacl::text)
      ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'),
    (SELECT jsonb_agg(jsonb_build_array(c.relname,pg_get_indexdef(i.indexrelid)) ORDER BY c.relname)
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
    (SELECT jsonb_agg(jsonb_build_array(c.relname,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY c.relname,t.tgname)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
    (SELECT jsonb_agg(jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname)
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
    (SELECT jsonb_agg(jsonb_build_array(c.relname,p.polname,p.polcmd,p.polroles::text,pg_get_expr(p.polqual,p.polrelid),
      pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY c.relname,p.polname)
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
    )::text) AS value`)[0]!.value;
  const baseline = await catalog();
  const revert = async () => {
    const connection = await database.reserve();
    try { await connection.unsafe(down); }
    catch (error) { await connection.unsafe("ROLLBACK"); throw error; }
    finally { connection.release(); }
  };
  const denied = (work: () => Promise<unknown>, code: string) => assert.rejects(work, (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === code);
  const asUser = <T>(user: string | null, work: (tx: postgres.TransactionSql) => Promise<T>) => database.begin(async (tx) => {
    await tx.unsafe(user ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
    await tx`SELECT set_config('request.jwt.claims',${json(user ? { sub: user } : {})},true)`;
    return work(tx);
  });
  const snapshot = (user: string) => asUser(user, async (tx) =>
    (await tx<{ value: Snapshot }[]>`SELECT public.training_schedule_snapshot() AS value`)[0]!.value);
  const commit = async <T>(user: string, operation: string, args: unknown, accept = false, revision?: string, requestId = randomUUID(), input = args) => {
    const expected = revision ?? (await snapshot(user)).revision;
    return asUser(user, async (tx) => (await tx<{ value: T }[]>`SELECT public.independent_program_schedule_commit(
      ${operation},${json(args)}::text::jsonb,${expected},${requestId}::uuid,${hash(input)},${accept}) AS value`)[0]!.value);
  };
  stage("ownership-unused-down-up-and-catalog-restoration");
  await database.begin((tx) => tx.unsafe(up));
  const readyDefinition = String((await database`SELECT pg_get_functiondef('public.independent_programs_ready()'::regprocedure) AS body`)[0]!.body);
  const changedDefinition = readyDefinition.replace("SELECT true", "SELECT false");
  assert.notEqual(changedDefinition, readyDefinition);
  await database.unsafe(changedDefinition);
  await denied(revert, "P0001");
  assert.equal((await database`SELECT public.independent_programs_ready() AS value`)[0]!.value, false);
  await database.unsafe(readyDefinition);
  stages.push("ownership-changed-routine-refuses-unused-down");
  await revert();
  assert.equal(await catalog(), baseline);
  stages.push("ownership-unused-down-up-and-catalog-restoration");

  const users: string[] = [];
  const user = async () => {
    const id = randomUUID(); await database`INSERT INTO auth.users(id) VALUES (${id})`; users.push(id); return id;
  };
  const legacyUser = await user(), a = await user(), b = await user();
  const [calendar] = await database<{ today: string; weekday: number }[]>`SELECT to_char(current_date,'YYYY-MM-DD') AS today,
    extract(isodow FROM current_date)::int-1 AS weekday`;
  assert.ok(calendar);
  const [lift] = await database`SELECT id FROM public.movements WHERE user_id IS NULL AND pattern<>'cardio' ORDER BY id LIMIT 1`;
  const [run] = await database`SELECT id FROM public.movements WHERE user_id IS NULL AND pattern='cardio'
    AND metadata->>'modality' IN ('run','running') ORDER BY id LIMIT 1`;
  assert.ok(lift); assert.ok(run);
  const liftItem = { kind: "main", movementId: lift.id, sets: 1, reps: 5, targetWeightKg: 10 };
  const runItem = { kind: "cardio_z2", movementId: run.id, durationMin: 20, meta: { modality: "run" } };
  const args = (kind: Kind, items: unknown[] = kind === "running" ? [runItem] : [liftItem]) => ({
    p_block: { program_kind: kind, program_id: "authored", program_family: kind, started_on: calendar.today, weeks: 1,
      days_per_week: 1, day_index_overrides: { days: [calendar.weekday] }, cardio_source: "internal",
      allows_two_a_days: false, accessory_volume: "medium", notes: `Synthetic ${kind}` },
    p_program_instance: { program_id: "authored", program_family: kind, display_name: `Synthetic ${kind}`,
      customization_version: 1, instance: { version: 1, activity: kind }, setup_input: {} },
    p_planned_sessions: [{ week_index: 0, day_index: calendar.weekday, slot: "single", title: `Synthetic ${kind}`,
      role: kind === "running" ? "cardio" : "strength", session_modality: kind === "running" ? "cardio" : "strength",
      effective_stress_load: 1, prescription: { items } }],
    p_tm_percents: [], p_rehab_bindings: [],
  });
  const legacyArgs = args("strength");
  const legacy = await asUser(legacyUser, async (tx) => (await tx<Created[]>`SELECT * FROM public.deploy_program_instance_atomically(
    ${json(legacyArgs.p_block)}::text::jsonb,${json(legacyArgs.p_planned_sessions)}::text::jsonb,'[]'::jsonb,
    ${json(legacyArgs.p_program_instance)}::text::jsonb)`)[0]!);
  const legacyBefore = await database`SELECT to_jsonb(b) AS row FROM public.training_blocks b WHERE id=${legacy.block_id}::uuid`;
  await database.begin((tx) => tx.unsafe(up));
  let operationsCompleted = false;
  try {
    stage("ownership-no-backfill-legacy-and-old-writer-refusal");
    const legacyAfter = await database`SELECT to_jsonb(b)-'program_kind' AS row FROM public.training_blocks b WHERE id=${legacy.block_id}::uuid`;
    assert.deepEqual(Array.from(legacyAfter), Array.from(legacyBefore));
    await denied(() => commit(legacyUser, "primary-create", args("running"), true), "23514");
    await denied(() => asUser(a, (tx) => tx`SELECT * FROM public.deploy_program_instance_atomically('{}','[]','[]','{}')`), "55000");
    await commit(legacyUser, "primary-end", { id: legacy.block_id });
    await commit(legacyUser, "primary-create", args("running"), true);
    stages.push("ownership-no-backfill-legacy-and-old-writer-refusal");

    const setup = { goal: "endurance" as const, experience: "recreational" as const, course: poolCourse(25, 1, "m"),
      knownStrokes: ["freestyle" as const], equipment: [], recentComfortableLengths: 8, sessionBudgetMinutes: 60 };
    const generated = generateSwimPlan({ setup, calibration: null, weeks: [{ weekIndex: 0, startDateISO: calendar.today,
      slots: [{ slotId: "independent", dateISO: calendar.today, intent: "moderate", source: "swim_date" }] }] });
    assert.ok(generated.ok);
    const slot = generated.value.weeks[0]!.slots[0]!;
    assert.equal(slot.kind, "workout");
    if (slot.kind !== "workout") throw new Error("Expected a synthetic swim workout");
    const swimArgs = { p_started_on: calendar.today, p_ends_on: calendar.today,
      p_definition: { version: 1, setup, generatorVersion: "swim-gen-1" },
      p_state: { version: 1, observations: [], acceptedCalibration: null, decisions: [] },
      p_workouts: [{ scheduled_date: calendar.today, slot: "single", definition: {
        version: 1, original: slot.original, issued: slot.issued, modifications: [], slotId: slot.slotId } }] };
    stage("ownership-all-24-type-creation-orders");
    for (const order of permutations(["strength", "running", "hybrid", "swimming"] as const)) {
      const owner = await user();
      for (const kind of order) await commit(owner, kind === "swimming" ? "swim-create" : "primary-create",
        kind === "swimming" ? swimArgs : args(kind), true);
      assert.equal((await database`SELECT count(*)::int AS n FROM public.training_blocks WHERE user_id=${owner}::uuid AND status='active'`)[0]!.n, 3);
      assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_plans WHERE user_id=${owner}::uuid AND status='active'`)[0]!.n, 1);
      assert.equal((await snapshot(owner)).entries.filter((entry) => entry.state === "scheduled").length, 4);
    }
    stages.push("ownership-all-24-type-creation-orders");

    stage("ownership-exact-target-overlap-stale-replay-and-concurrency");
    const strength = await commit<Created>(a, "primary-create", args("strength"));
    await denied(() => asUser(a, (tx) => tx`SELECT * FROM public.deploy_program_instance_atomically('{}','[]','[]','{}')`), "55000");
    const beforeRunning = await snapshot(a);
    await denied(() => commit(a, "primary-create", args("running"), false, beforeRunning.revision), "22023");
    assert.equal((await snapshot(a)).revision, beforeRunning.revision);
    const requestId = randomUUID();
    const running = await commit<Created>(a, "primary-create", args("running"), true, beforeRunning.revision, requestId);
    assert.deepEqual(await commit(a, "primary-create", args("running"), true, beforeRunning.revision, requestId), running);
    await denied(() => commit(a, "primary-create", args("hybrid"), true, beforeRunning.revision), "40001");
    await denied(() => commit(a, "primary-create", { ...args("running"), p_replace_block_id: strength.block_id }, true), "22023");
    await denied(() => commit(a, "primary-create", { ...args("running"), p_replace_block_id: strength.block_id },
      true, beforeRunning.revision, requestId, args("running")), "22023");
    const concurrentRevision = (await snapshot(a)).revision;
    const concurrent = await Promise.allSettled([commit<Created>(a, "primary-create", args("hybrid"), true, concurrentRevision),
      commit<Created>(a, "primary-create", args("hybrid"), true, concurrentRevision)]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
    const winner = concurrent.find((result) => result.status === "fulfilled");
    assert.ok(winner && winner.status === "fulfilled");
    const hybrid = winner.value;
    const swim = await commit<Swim>(a, "swim-create", swimArgs, true);
    await denied(() => commit(a, "primary-create", args("strength"), true), "23505");
    stages.push("ownership-exact-target-overlap-stale-replay-and-concurrency");

    stage("ownership-direct-writer-parent-and-modality-boundaries");
    await denied(() => asUser(a, (tx) => tx`UPDATE public.training_blocks SET program_kind='hybrid' WHERE id=${running.block_id}::uuid`), "22023");
    await denied(() => asUser(a, (tx) => tx`UPDATE public.program_instances SET block_id=${hybrid.block_id}::uuid WHERE id=${running.program_instance_id}::uuid`), "23514");
    await denied(() => asUser(a, (tx) => tx`UPDATE public.program_instances SET status='archived' WHERE id=${running.program_instance_id}::uuid`), "23514");
    await denied(() => asUser(a, (tx) => tx`UPDATE public.planned_sessions SET prescription=${json({ items: [liftItem] })}::text::jsonb
      WHERE block_id=${running.block_id}::uuid`), "22023");
    await denied(() => asUser(a, (tx) => tx`UPDATE public.planned_sessions SET prescription=${json({ items: [{ ...liftItem, kind: "tendon", meta: { rehab: true } }] })}::text::jsonb
      WHERE block_id=${running.block_id}::uuid`), "22023");
    await denied(() => asUser(a, (tx) => tx`UPDATE public.planned_sessions SET prescription=${json({ items: [runItem] })}::text::jsonb
      WHERE block_id=${strength.block_id}::uuid`), "22023");
    await denied(() => asUser(a, (tx) => tx`DELETE FROM public.program_instances WHERE id=${strength.program_instance_id}::uuid`), "23514");
    await denied(() => asUser(b, (tx) => tx`INSERT INTO public.planned_sessions(user_id,block_id,week_index,day_index,slot,title,role,prescription)
      VALUES(${b}::uuid,${strength.block_id}::uuid,0,0,'single','Other','strength','{"items":[]}')`), "23503");
    stages.push("ownership-direct-writer-parent-and-modality-boundaries");
    stage("ownership-program-owned-load-bases-with-shared-measurement");
    await asUser(a, (tx) => tx`INSERT INTO public.training_maxes(user_id,movement_id,one_rm_kg,tm_percent,source)
      VALUES(${a}::uuid,${lift.id}::uuid,120,90,'entered')`);
    const withBasis = (kg: number) => ({ items: [{ kind: "main", movementId: lift.id, sets: 1, reps: 5, percentTm: 80,
      meta: { programLoadBasis: { version: 1, kind: "working-max", kg } } }] });
    await asUser(a, (tx) => tx`UPDATE public.planned_sessions SET prescription=${json(withBasis(100))}::text::jsonb
      WHERE block_id=${strength.block_id}::uuid`);
    await asUser(a, (tx) => tx`UPDATE public.planned_sessions SET prescription=${json(withBasis(90))}::text::jsonb
      WHERE block_id=${hybrid.block_id}::uuid`);
    await denied(() => asUser(a, (tx) => tx`UPDATE public.planned_sessions SET prescription=${json({ items: [{
      kind: "main", movementId: lift.id, sets: 1, reps: 5, percentTm: 80 }] })}::text::jsonb WHERE block_id=${strength.block_id}::uuid`), "22023");
    await asUser(a, (tx) => tx`UPDATE public.training_maxes SET one_rm_kg=130 WHERE user_id=${a}::uuid AND movement_id=${lift.id}::uuid`);
    const bases = await asUser(a, (tx) => tx`SELECT prescription#>>'{items,0,meta,programLoadBasis,kg}' AS kg
      FROM public.planned_sessions WHERE block_id IN (${strength.block_id}::uuid,${hybrid.block_id}::uuid) ORDER BY kg`);
    assert.deepEqual(bases.map((row) => row.kg), ["100", "90"]);
    await denied(() => asUser(a, (tx) => tx`SELECT public.update_program_instance_atomically(${strength.block_id}::uuid,
      '[]','[]','[]','{}',${json([{ movementId: lift.id, tmPercent: 70 }])}::text::jsonb,'{}')`), "55000");
    stages.push("ownership-program-owned-load-bases-with-shared-measurement");

    stage("ownership-independent-end-trash-restore-completion-and-late-progress");
    const planned = (await snapshot(a)).entries.find((entry) => entry.programId === strength.block_id && entry.state === "scheduled")!;
    const session = await asUser(a, async (tx) => (await tx`SELECT public.start_planned_session_atomically(${planned.id}::uuid) AS id`)[0]!.id);
    assert.equal((await asUser(a, (tx) => tx`SELECT public.complete_program_if_settled(${strength.block_id}::uuid) AS done`))[0]!.done, false);
    await asUser(a, (tx) => tx`UPDATE public.sessions SET completed_at=now() WHERE id=${session}::uuid`);
    const progress = (expected: unknown, next: unknown, sessionId = session) => asUser(a, async (tx) =>
      (await tx`SELECT public.commit_program_progression(${strength.block_id}::uuid,${strength.program_instance_id}::uuid,
        ${sessionId}::uuid,${json(expected)}::text::jsonb,${json(next)}::text::jsonb,'[]') AS value`)[0]!.value);
    assert.equal(await progress({}, { version: 2 }), "stale");
    const originalInstance = args("strength").p_program_instance.instance;
    assert.equal(await progress(originalInstance, { ...originalInstance, logged: 1 }), "applied");
    assert.equal(await progress(originalInstance, { ...originalInstance, logged: 2 }), "replayed");
    assert.equal((await asUser(a, (tx) => tx`SELECT public.complete_program_if_settled(${strength.block_id}::uuid) AS done`))[0]!.done, true);
    const replacement = await commit<Created>(a, "primary-create", args("strength"), true);
    assert.equal(await progress(originalInstance, { ...originalInstance, logged: 3 }, randomUUID()), "inactive");
    assert.deepEqual((await database`SELECT instance FROM public.program_instances WHERE id=${replacement.program_instance_id}::uuid`)[0]!.instance, originalInstance);
    await commit(a, "primary-delete", { id: running.block_id });
    assert.equal((await database`SELECT status FROM public.program_instances WHERE id=${running.program_instance_id}::uuid`)[0]!.status, "archived");
    await commit(a, "primary-restore", { id: running.block_id }, true);
    assert.equal((await database`SELECT status FROM public.program_instances WHERE id=${running.program_instance_id}::uuid`)[0]!.status, "active");
    await commit(a, "primary-end", { id: hybrid.block_id });
    assert.equal((await database`SELECT status FROM public.swim_plans WHERE id=${swim.plan.id}::uuid`)[0]!.status, "active");
    assert.equal((await database`SELECT status FROM public.training_blocks WHERE id=${running.block_id}::uuid`)[0]!.status, "active");
    stages.push("ownership-independent-end-trash-restore-completion-and-late-progress");

    stage("ownership-swim-rehab-owned-attachment-issued-dose-replay-and-restore");
    const protocolId = randomUUID();
    await asUser(a, (tx) => tx`INSERT INTO public.rehab_protocols(id,user_id,name,definition)
      VALUES(${protocolId}::uuid,${a}::uuid,'Shared protocol',${json({ items: [{ movementId: lift.id, movementName: "Fixture exercise", sets: 1, reps: 8 }], links: [] })}::text::jsonb)`);
    const attach = async (owner: string, ids: string[], revision?: string, request = randomUUID()) => {
      const expected = revision ?? (await snapshot(owner)).revision;
      return asUser(owner, (tx) => tx`SELECT public.set_swim_rehab_bindings(${swim.plan.id}::uuid,${ids}::uuid[],${expected},${request}::uuid)`);
    };
    const attachmentRevision = (await snapshot(a)).revision, attachmentRequest = randomUUID();
    await attach(a, [protocolId], attachmentRevision, attachmentRequest);
    await attach(a, [protocolId], attachmentRevision, attachmentRequest);
    assert.equal((await asUser(b, (tx) => tx`SELECT * FROM public.swim_plan_rehab_bindings`)).length, 0);
    await denied(() => asUser(b, (tx) => tx`INSERT INTO public.swim_plan_rehab_bindings(plan_id,local_protocol_id,rehab_protocol_id,user_id)
      VALUES(${swim.plan.id}::uuid,${protocolId},${protocolId}::uuid,${b}::uuid)`), "23503");
    await denied(() => asUser(a, (tx) => tx`DELETE FROM public.rehab_protocols WHERE id=${protocolId}::uuid`), "23503");
    const workout = swim.workouts[0]!;
    const beforeSwim = await database`SELECT to_jsonb(w) AS row FROM public.swim_workouts w WHERE id=${workout.id}::uuid`;
    const prescription = { items: [{ kind: "tendon", movementId: lift.id, movementName: "Fixture exercise", sets: 1, reps: 8,
      meta: { rehab: true, rehabProtocolId: protocolId, rehabProtocolRevision: 1, rehabItemIndex: 0, rehabSetIndex: 0 } }],
      meta: { swimRehab: { version: 1, planId: swim.plan.id, workoutId: workout.id, protocolId, protocolRevision: 1, scheduledDate: calendar.today } } };
    for (const kind of ["strength", "running", "hybrid"] as const) {
      const target = kind === "strength" ? replacement.block_id : kind === "running" ? running.block_id : undefined;
      await commit(a, "primary-create", { ...args(kind, prescription.items.map((item) => ({
        ...item, meta: { ...item.meta, authoredPartId: "attached-protocol" },
      }))), ...(target ? { p_replace_block_id: target } : {}),
      p_rehab_bindings: [{ localProtocolId: protocolId, rehabProtocolId: protocolId }] }, true);
    }
    const start = async (value = prescription, request = randomUUID(), revision?: string) => {
      const expected = revision ?? (await snapshot(a)).revision;
      return asUser(a, async (tx) => (await tx`SELECT public.start_swim_rehab_session(${workout.id}::uuid,${protocolId}::uuid,${expected},
        ${json(value)}::text::jsonb,${request}::uuid) AS id`)[0]!.id);
    };
    await denied(() => start({ ...prescription, items: [{ ...prescription.items[0]!, reps: 9 }] }), "22023");
    const startedRevision = (await snapshot(a)).revision, startRequest = randomUUID();
    const rehabSession = await start(prescription, startRequest, startedRevision);
    assert.equal(await start(prescription, startRequest, startedRevision), rehabSession);
    assert.equal(await start(), rehabSession);
    assert.deepEqual(Array.from(await database`SELECT to_jsonb(w) AS row FROM public.swim_workouts w WHERE id=${workout.id}::uuid`), Array.from(beforeSwim));
    assert.equal((await database`SELECT count(*)::int AS n FROM public.cardio_logs WHERE session_id=${rehabSession}::uuid`)[0]!.n, 0);
    await asUser(a, (tx) => tx`UPDATE public.sessions SET deleted_at=now() WHERE id=${rehabSession}::uuid`);
    await denied(() => start(), "22023");
    await asUser(a, (tx) => tx`UPDATE public.sessions SET deleted_at=NULL WHERE id=${rehabSession}::uuid`);
    assert.equal(await start(), rehabSession);
    await attach(a, []);
    assert.equal(await start(), rehabSession);
    await denied(() => asUser(a, (tx) => tx`UPDATE public.sessions SET prescription='{"items":[]}' WHERE id=${rehabSession}::uuid`), "22023");
    await denied(revert, "P0001");
    stages.push("ownership-swim-rehab-owned-attachment-issued-dose-replay-and-restore");
    stage("ownership-issued-rehab-and-receipts-refuse-down-after-detach");
    await asUser(a, (tx) => tx`DELETE FROM public.sessions WHERE id=${rehabSession}::uuid`);
    await denied(() => start(), "22023");
    await denied(revert, "P0001");
    stages.push("ownership-issued-rehab-and-receipts-refuse-down-after-detach");
    stage("ownership-account-erasure-with-attached-rehab");
    await attach(a, [protocolId]);
    await database`DELETE FROM auth.users WHERE id=${a}::uuid`;
    assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_plan_rehab_bindings WHERE user_id=${a}::uuid`)[0]!.n, 0);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.engine_override_events WHERE user_id=${a}::uuid`)[0]!.n, 0);
    stages.push("ownership-account-erasure-with-attached-rehab");

    stage("ownership-start-receipts-alone-refuse-unused-down");
    const receiptOwner = await user(), receiptProtocol = randomUUID();
    const receiptSwim = await commit<Swim>(receiptOwner, "swim-create", swimArgs);
    await asUser(receiptOwner, (tx) => tx`INSERT INTO public.rehab_protocols(id,user_id,name,definition)
      VALUES(${receiptProtocol}::uuid,${receiptOwner}::uuid,'Receipt protocol',
        ${json({ items: [{ movementId: lift.id, movementName: "Fixture exercise", sets: 1, reps: 8 }], links: [] })}::text::jsonb)`);
    const receiptBindingRevision = (await snapshot(receiptOwner)).revision;
    await asUser(receiptOwner, (tx) => tx`SELECT public.set_swim_rehab_bindings(${receiptSwim.plan.id}::uuid,
      ${[receiptProtocol]}::uuid[],${receiptBindingRevision},${randomUUID()}::uuid)`);
    const receiptPrescription = { ...prescription,
      items: prescription.items.map((item) => ({ ...item, meta: { ...item.meta, rehabProtocolId: receiptProtocol } })),
      meta: { swimRehab: { ...prescription.meta.swimRehab, planId: receiptSwim.plan.id,
        workoutId: receiptSwim.workouts[0]!.id, protocolId: receiptProtocol } } };
    const receiptStartRevision = (await snapshot(receiptOwner)).revision;
    await asUser(receiptOwner, (tx) => tx`SELECT public.start_swim_rehab_session(${receiptSwim.workouts[0]!.id}::uuid,
      ${receiptProtocol}::uuid,${receiptStartRevision},${json(receiptPrescription)}::text::jsonb,${randomUUID()}::uuid)`);
    await asUser(receiptOwner, (tx) => tx`DELETE FROM public.swim_plans WHERE id=${receiptSwim.plan.id}::uuid`);
    await asUser(receiptOwner, (tx) => tx`DELETE FROM public.sessions WHERE user_id=${receiptOwner}::uuid`);
    await asUser(receiptOwner, (tx) => tx`DELETE FROM public.rehab_protocols WHERE id=${receiptProtocol}::uuid`);
    await database`DELETE FROM public.engine_override_events WHERE user_id=${receiptOwner}::uuid
      AND context->>'kind' NOT IN ('swim-rehab-start-v1','swim-rehab-request-v1')`;
    // Other fixture accounts must not provide an independent rollback refusal.
    await database`DELETE FROM public.program_rehab_bindings WHERE user_id=ANY(${users.filter((id) => id !== receiptOwner)}::uuid[])`;
    await database`DELETE FROM auth.users WHERE id=ANY(${users.filter((id) => id !== receiptOwner)}::uuid[])`;
    assert.equal((await database`SELECT count(*)::int AS n FROM public.training_blocks WHERE program_kind IS NOT NULL`)[0]!.n, 0);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_plan_rehab_bindings`)[0]!.n, 0);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.sessions`)[0]!.n, 0);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.engine_override_events`)[0]!.n, 2);
    await denied(revert, "P0001");
    stages.push("ownership-start-receipts-alone-refuse-unused-down");
    operationsCompleted = true;
  } finally {
    if (operationsCompleted) stage("ownership-synthetic-account-cleanup");
    await database`DELETE FROM public.program_rehab_bindings WHERE user_id=ANY(${users}::uuid[])`;
    await database`DELETE FROM public.swim_plan_rehab_bindings WHERE user_id=ANY(${users}::uuid[])`;
    await database`DELETE FROM auth.users WHERE id=ANY(${users}::uuid[])`;
  }
  assert.equal((await database`SELECT count(*)::int AS n FROM auth.users`)[0]!.n, 0);
  await revert();
  assert.equal(await catalog(), baseline);
  await database.begin((tx) => tx.unsafe(up));
  stages.push("ownership-account-cleanup-and-exact-unused-restoration");
  return stages;
}
