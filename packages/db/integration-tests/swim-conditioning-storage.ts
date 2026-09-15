import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";

type SwimCreate = {
  started_on: string; ends_on: string; definition: unknown; state: unknown;
  workouts: { scheduled_date: string; slot: string; definition: unknown }[];
};
type Receipt = { block_id: string; program_instance_id: string; swim_plan_id: string; skipped: number };

export async function exerciseSwimConditioning(
  database: postgres.Sql, owner: string, other: string, existing: { id: string; revision: number },
  source: SwimCreate, mark: (stage: string) => void,
) {
  mark("conditioning-fixtures");
  const as = <T>(user: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>) => database.begin(async (tx) => {
    await tx.unsafe(user ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
    await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify(user ? { sub: user } : {})}, true)`;
    return fn(tx);
  });
  const denied = (fn: () => Promise<unknown>, code: string) => assert.rejects(fn, (error: unknown) => {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === code)) throw error;
    return true;
  });
  const monday = new Date(`${source.started_on}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const planned = source.workouts.map((workout) => {
    const days = Math.round((Date.parse(`${workout.scheduled_date}T00:00:00Z`) - monday.getTime()) / 86400000);
    return {
      week_index: Math.floor(days / 7), day_index: days % 7, slot: workout.slot,
      title: "Swimming", role: "cardio", prescription: { items: [{ movementId: "", kind: "cardio_external" }] },
      session_modality: "pure_z2_aerobic", effective_stress_load: 0,
    };
  });
  const choices = [...new Set(planned.map((row) => row.day_index))].map((weekday) => ({ weekday, activity: "swimming" }));
  const block = {
    program_id: "synthetic-conditioning", program_family: "synthetic", started_on: source.started_on,
    weeks: 3, days_per_week: 2, day_index_overrides: null, cardio_source: "external",
    allows_two_a_days: false, accessory_volume: "medium", notes: "Synthetic conditioning programme",
  };
  const instance = {
    program_id: block.program_id, program_family: block.program_family, instance: { version: 1 },
    setup_input: { conditioning: { choices, skipped: 2, benchmarkTmPercent: 100 } }, display_name: null, customization_version: null,
  };
  const attach = { plan_id: existing.id, expected_revision: existing.revision };
  const movementId = randomUUID();
  const newMovementId = randomUUID();
  const requestInput = { programId: block.program_id, conditioning: {
    choices, benchmarks: [{ movementId, oneRmKg: 120 }, { movementId: newMovementId, oneRmKg: 50 }],
  } };
  await database`INSERT INTO public.movements(id,user_id,slug,display_name,pattern,primary_region)
    VALUES (${movementId},${owner},'synthetic-conditioning-tm','Synthetic conditioning TM','squat',
      (SELECT unnest(enum_range(NULL::public.region)) LIMIT 1)),
      (${newMovementId},${owner},'synthetic-conditioning-new-tm','Synthetic new conditioning TM','squat',
      (SELECT unnest(enum_range(NULL::public.region)) LIMIT 1))`;
  await database`INSERT INTO public.training_maxes(user_id,movement_id,one_rm_kg,tm_percent)
    VALUES (${owner},${movementId},100,80)`;
  const maxima = [{ movementId, tmPercent: 90 }, { movementId: newMovementId, tmPercent: 85 }];
  const deploy = (user: string | null, requestId: string, swim: unknown = attach,
    rows = planned, input: unknown = requestInput) => as(user, async (tx) => Array.from(await tx<Receipt[]>`
      SELECT * FROM public.deploy_program_with_swimming(
        ${requestId}::uuid, ${JSON.stringify(input)}::text::jsonb,
        ${JSON.stringify(block)}::text::jsonb, ${JSON.stringify(rows)}::text::jsonb,
        ${JSON.stringify(maxima)}::text::jsonb, ${JSON.stringify(instance)}::text::jsonb, ${JSON.stringify(swim)}::text::jsonb
      )`));
  const primarySnapshot = (user: string) => database`SELECT
    (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.training_blocks b WHERE user_id=${user}) AS blocks,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.planned_sessions p WHERE user_id=${user}) AS planned,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.program_instances i WHERE user_id=${user}) AS instances,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.training_maxes t WHERE user_id=${user}) AS maxima`;
  const old = (await as(owner, async (tx) => Array.from(await tx<{ block_id: string }[]>`
    SELECT * FROM public.deploy_program_instance_atomically(
      ${JSON.stringify(block)}::text::jsonb, ${JSON.stringify(planned)}::text::jsonb,
      '[]'::jsonb, ${JSON.stringify(instance)}::text::jsonb
    )`)))[0]!;
  const before = await primarySnapshot(owner);
  const otherBefore = await primarySnapshot(other);

  mark("conditioning-authority-and-atomic-refusal");
  await denied(() => deploy(null, randomUUID()), "42501");
  await denied(() => deploy(other, randomUUID()), "42501");
  assert.deepEqual(await primarySnapshot(other), otherBefore);
  mark("conditioning-stale-plan-atomic-refusal");
  await denied(() => deploy(owner, randomUUID(), { ...attach, expected_revision: existing.revision + 1 }), "40001");
  mark("conditioning-incomplete-fit-atomic-refusal");
  await denied(() => deploy(owner, randomUUID(), attach, planned.slice(1)), "22023");
  await denied(() => deploy(owner, randomUUID(), attach, planned, {
    ...requestInput, conditioning: { choices, benchmarks: [{ movementId, oneRmKg: 1001 }] },
  }), "22023");
  await denied(() => deploy(owner, randomUUID(), attach, planned, {
    ...requestInput, conditioning: { choices, benchmarks: [{ movementId, oneRmKg: 120 }, { movementId, oneRmKg: 125 }] },
  }), "22023");
  assert.deepEqual(await primarySnapshot(owner), before);
  mark("conditioning-bounded-writer-grants");
  await denied(() => as(owner, (tx) => tx`INSERT INTO public.swim_conditioning_saves(user_id,request_id)
    VALUES (${owner},${randomUUID()})`), "42501");
  const grants = await database`SELECT rolname,
    has_function_privilege(oid,'public.deploy_program_with_swimming(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') AS allowed
    FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`;
  assert.deepEqual(Object.fromEntries(grants.map((row) => [row.rolname, row.allowed])), {
    anon: false, authenticated: true, service_role: false,
  });
  for (const table of ["swim_plans", "swim_workouts"]) {
    const privilege = (await database`SELECT
      has_table_privilege('conditioning_writer',${`public.${table}`},'UPDATE') AS full_update,
      has_column_privilege('conditioning_writer',${`public.${table}`},'revision','UPDATE') AS lock_column,
      has_column_privilege('conditioning_writer',${`public.${table}`},'definition','UPDATE') AS definition_update`)[0]!;
    assert.deepEqual(privilege, { full_update: false, lock_column: true, definition_update: false });
  }

  mark("conditioning-existing-plan-and-replay");
  const requestId = randomUUID();
  const [first, replay] = await Promise.all([deploy(owner, requestId), deploy(owner, requestId)]);
  assert.deepEqual(replay, first);
  assert.equal(first.length, 1);
  const receipt = first[0]!;
  assert.equal(receipt.swim_plan_id, existing.id);
  assert.equal(receipt.skipped, 2);
  assert.equal(Number((await database`SELECT tm_percent FROM public.training_maxes
    WHERE user_id=${owner} AND movement_id=${movementId}`)[0]!.tm_percent), 90);
  const savedMaxima = await database`SELECT movement_id,one_rm_kg,tm_percent,source,derived_from_session_id,
    derived_from_set_log_id,derived_formula,derived_at FROM public.training_maxes
    WHERE user_id=${owner} AND movement_id IN (${movementId},${newMovementId})`;
  assert.equal(savedMaxima.length, 2);
  for (const row of savedMaxima) {
    assert.equal(Number(row.one_rm_kg), row.movement_id === movementId ? 120 : 50);
    assert.equal(Number(row.tm_percent), row.movement_id === movementId ? 90 : 85);
    assert.equal(row.source, "entered");
    assert.ok([row.derived_from_session_id,row.derived_from_set_log_id,row.derived_formula,row.derived_at]
      .every((value) => value === null));
  }
  await database`UPDATE public.training_maxes SET one_rm_kg=145 WHERE user_id=${owner} AND movement_id=${movementId}`;
  assert.deepEqual(await deploy(owner, requestId), first);
  assert.equal(Number((await database`SELECT one_rm_kg FROM public.training_maxes
    WHERE user_id=${owner} AND movement_id=${movementId}`)[0]!.one_rm_kg), 145);
  assert.equal((await database`SELECT status FROM public.training_blocks WHERE id=${old.block_id}`)[0]!.status, "archived");
  assert.equal((await as(owner, (tx) => tx`SELECT count(*)::int AS count FROM public.swim_conditioning_saves`))[0]!.count, 1);
  const linked = await as(owner, (tx) => tx`SELECT planned_session_id,swim_workout_id,metadata FROM public.swim_conditioning_bindings`);
  assert.equal(linked.length, source.workouts.length);
  assert.equal(new Set(linked.map((row) => row.planned_session_id)).size, source.workouts.length);
  assert.equal((await as(other, (tx) => tx`SELECT count(*)::int AS count FROM public.swim_conditioning_bindings`))[0]!.count, 0);
  mark("conditioning-owner-scoped-presentation");
  const presentation = await as(owner, (tx) => tx`SELECT id,planned_session_id,block_status,outcome_match_id
    FROM public.swim_conditioning_sessions ORDER BY id`);
  assert.equal(presentation.length, linked.length);
  assert.deepEqual(presentation.map((row) => row.id), linked.map((row) => row.swim_workout_id).sort());
  assert.ok(presentation.every((row) => row.planned_session_id !== null && row.block_status === "active"));
  assert.equal((await as(other, (tx) => tx`SELECT count(*)::int AS count FROM public.swim_conditioning_sessions`))[0]!.count, 0);
  await denied(() => as(null, (tx) => tx`SELECT * FROM public.swim_conditioning_sessions`), "42501");
  assert.equal((await as(owner, (tx) => tx`SELECT
    has_table_privilege(current_user,'public.swim_conditioning_sessions','INSERT') OR
    has_table_privilege(current_user,'public.swim_conditioning_sessions','UPDATE') OR
    has_table_privilege(current_user,'public.swim_conditioning_sessions','DELETE') AS writes`))[0]!.writes, false);
  await denied(() => deploy(owner, requestId, attach, planned, { ...requestInput, changed: true }), "22023");
  const existingSnapshot = await primarySnapshot(owner);
  await denied(() => deploy(owner, randomUUID()), "40001");
  assert.deepEqual(await primarySnapshot(owner), existingSnapshot);
  await denied(() => as(owner, (tx) => tx`DELETE FROM public.swim_conditioning_bindings`), "42501");
  await denied(() => as(owner, (tx) => tx`UPDATE public.swim_conditioning_saves SET metadata='{}'`), "42501");
  await denied(() => database`INSERT INTO public.swim_conditioning_bindings
    (user_id,planned_session_id,swim_workout_id,block_id,metadata)
    VALUES (${other},null,${randomUUID()},null,
      ${JSON.stringify(linked[0]!.metadata)}::text::jsonb)`, "23503");

  mark("conditioning-shared-identity-and-primary-purge");
  await denied(() => as(owner, (tx) => tx`UPDATE public.planned_sessions
    SET week_index=week_index+10 WHERE id=${linked[0]!.planned_session_id}`), "23514");
  await denied(() => as(owner, (tx) => tx`UPDATE public.planned_sessions
    SET skipped_at=now() WHERE id=${linked[0]!.planned_session_id}`), "23514");
  await denied(() => as(owner, (tx) => tx`DELETE FROM public.planned_sessions
    WHERE id=${linked[0]!.planned_session_id}`), "23514");
  await denied(() => as(owner, (tx) => tx`UPDATE public.planned_sessions
    SET prescription='{"items":[]}' WHERE id=${linked[0]!.planned_session_id}`), "23514");
  await denied(() => database`UPDATE public.swim_conditioning_bindings
    SET metadata=metadata || '{"workoutRevision":null}' WHERE swim_workout_id=${linked[0]!.swim_workout_id}`, "23514");
  await denied(() => database`UPDATE public.swim_conditioning_saves
    SET metadata=metadata - 'skipped' WHERE user_id=${owner} AND request_id=${requestId}`, "23514");
  await as(owner, (tx) => tx`DELETE FROM public.training_blocks WHERE id=${receipt.block_id}`);
  const retained = await as(owner, (tx) => tx`SELECT planned_session_id,block_id,metadata FROM public.swim_conditioning_bindings`);
  assert.equal(retained.length, linked.length);
  assert.ok(retained.every((row) => row.planned_session_id === null && row.block_id === null));
  const retainedView = await as(owner, (tx) => tx`SELECT planned_session_id,block_status FROM public.swim_conditioning_sessions`);
  assert.equal(retainedView.length, linked.length);
  assert.ok(retainedView.every((row) => row.planned_session_id === null && row.block_status === null));
  assert.deepEqual(retained.map((row) => JSON.stringify(row.metadata)).sort(), linked.map((row) => JSON.stringify(row.metadata)).sort());
  await denied(() => deploy(owner, requestId), "22023");

  mark("conditioning-new-course-late-failure-and-cleanup");
  const fresh = randomUUID();
  await database`INSERT INTO auth.users(id) VALUES (${fresh})`;
  try {
    const freshBefore = await primarySnapshot(fresh);
    const freshInput = { ...requestInput, conditioning: { choices, benchmarks: [] } };
    await denied(() => deploy(fresh, randomUUID(), source, planned.slice(1), freshInput), "22023");
    assert.deepEqual(await primarySnapshot(fresh), freshBefore);
    assert.equal((await as(fresh, (tx) => tx`SELECT count(*)::int AS count FROM public.swim_plans`))[0]!.count, 0);
    const created = (await deploy(fresh, randomUUID(), source, planned, freshInput))[0]!;
    assert.notEqual(created.swim_plan_id, existing.id);
    assert.equal((await as(fresh, (tx) => tx`SELECT count(*)::int AS count FROM public.swim_conditioning_bindings`))[0]!.count, source.workouts.length);
    mark("conditioning-current-recording-projection");
    const [work] = await as(fresh, (tx) => tx<{ id: string; revision: number; scheduled_date: string }[]>`
      SELECT id,revision,scheduled_date::text AS scheduled_date
      FROM public.swim_conditioning_sessions ORDER BY scheduled_date,id LIMIT 1`);
    const tokenHash = createHash("sha256").update(randomUUID()).digest("hex");
    await as(fresh, (tx) => tx`SELECT public.swim_import_connect(${tokenHash})`);
    const evidence = {
      version: 1, source: "local_dashboard", activityId: "20001", date: work!.scheduled_date,
      environment: "pool", workoutReference: "42", distanceMetres: 300, recordedDurationMs: 300000,
      durationKind: "unspecified", nativeCourse: null, detail: { status: "missing", fetchedAt: null, splits: [] },
    };
    const receive = (value = evidence) => database.begin(async (tx) => {
      assert.match(value.date, /^\d{4}-\d{2}-\d{2}$/);
      await tx.unsafe("SET LOCAL ROLE service_role");
      assert.equal((await tx`SELECT public.swim_import_evidence_valid(
        ${JSON.stringify(value)}::text::jsonb) AS valid`)[0]!.valid, true);
      return (await tx<{ receipt: { id: string } }[]>`SELECT public.swim_import_receive(
        ${tokenHash},${JSON.stringify(value)}::text::jsonb) AS receipt`)[0]!.receipt;
    });
    const imported = await receive();
    const matchId = randomUUID();
    await as(fresh, (tx) => tx`SELECT public.swim_match_import(
      ${matchId},${imported.id},${work!.id},null,${work!.revision})`);
    const readView = async () => (await as(fresh, (tx) => tx`SELECT outcome_metadata,current_match_id,matched_import_id,
      latest_import_id,matched_workout_revision,revision,recording_date,native_completed_at
      FROM public.swim_conditioning_sessions WHERE id=${work!.id}`))[0]!;
    const beforeOutcomes = await primarySnapshot(fresh);
    const completed = randomUUID();
    await as(fresh, (tx) => tx`SELECT public.swim_confirm_import_outcome(
      ${completed},${work!.id},${matchId},'completed',null,${work!.revision})`);
    const completedView = await readView();
    assert.equal(completedView.outcome_metadata.outcome, "completed");
    assert.equal(completedView.current_match_id, matchId);
    assert.equal(completedView.matched_import_id, imported.id);
    assert.equal(completedView.latest_import_id, imported.id);
    assert.equal(completedView.matched_workout_revision, completedView.revision);
    assert.equal(completedView.native_completed_at, null);
    const partial = randomUUID();
    await as(fresh, (tx) => tx`SELECT public.swim_confirm_import_outcome(
      ${partial},${work!.id},${matchId},'stopped_early',${completed},${work!.revision})`);
    assert.equal((await readView()).outcome_metadata.outcome, "stopped_early");
    const corrected = await receive({ ...evidence, recordedDurationMs: 310000 });
    const correctedView = await readView();
    assert.equal(correctedView.matched_import_id, imported.id);
    assert.equal(correctedView.latest_import_id, corrected.id);
    await as(fresh, (tx) => tx`SELECT public.swim_match_import(
      ${randomUUID()},${corrected.id},null,${matchId},null)`);
    assert.equal((await readView()).current_match_id, null);
    await as(fresh, (tx) => tx`SELECT public.swim_confirm_import_outcome(
      ${randomUUID()},${work!.id},null,null,${partial},null)`);
    assert.equal((await readView()).outcome_metadata.outcome, null);
    assert.deepEqual(await primarySnapshot(fresh), beforeOutcomes);
    assert.equal((await as(fresh, (tx) => tx`SELECT count(*)::int AS count FROM public.sessions`))[0]!.count, 0);
  } finally {
    await database`DELETE FROM auth.users WHERE id=${fresh}`;
  }
  assert.equal((await database`SELECT count(*)::int AS count FROM public.swim_conditioning_saves WHERE user_id=${fresh}`)[0]!.count, 0);
  assert.equal((await database`SELECT count(*)::int AS count FROM public.swim_conditioning_bindings WHERE user_id=${fresh}`)[0]!.count, 0);
  assert.deepEqual(await primarySnapshot(other), otherBefore);
}
