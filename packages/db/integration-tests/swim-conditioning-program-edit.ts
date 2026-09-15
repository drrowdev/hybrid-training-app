import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";

type Expected = {
  id: string; planId: string; planRevision: number; workoutRevision: number;
  date: string; status: string; planStatus: string; sessionId: string | null; outcome: { outcome: string | null } | null;
  primary: { id: string; week_index: number; day_index: number; slot: string; planned_at: string | null; notes: string | null; prescription: unknown };
};
type Move = { id: string; plannedSessionId: string; date: string };

export async function exerciseConditioningProgramEdit(
  database: postgres.Sql, owner: string, other: string, blockId: string, planId: string, mark: (stage: string) => void,
) {
  const as = <T>(user: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>) => database.begin(async (tx) => {
    await tx.unsafe(user ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
    await tx`SELECT set_config('request.jwt.claims',${JSON.stringify(user ? { sub: user } : {})},true)`;
    return fn(tx);
  });
  const denied = (fn: () => Promise<unknown>, code: string) => assert.rejects(fn, (error: unknown) => {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === code)) throw error;
    return true;
  });
  const snapshot = () => as(owner, (tx) => tx`SELECT
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.swim_plans p) AS plans,
    (SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM public.swim_workouts w) AS workouts,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.planned_sessions p) AS planned,
    (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.training_blocks b) AS blocks,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.program_instances i) AS instances,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.training_maxes m) AS maxima,
    (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.swim_import_outcomes o) AS outcomes`);
  const expected = async () => Array.from(await as(owner, (tx) => tx<Expected[]>`SELECT
    v.id,v.plan_id AS "planId",v.plan_revision AS "planRevision",v.revision AS "workoutRevision",
    v.status,v.plan_status AS "planStatus",v.scheduled_date::text AS date,
    v.session_id AS "sessionId",v.outcome_metadata AS outcome,
    jsonb_build_object('id',p.id,'week_index',p.week_index,'day_index',p.day_index,
      'slot',p.slot,'planned_at',p.planned_at,'notes',p.notes,'prescription',p.prescription) AS primary
    FROM public.swim_conditioning_sessions v JOIN public.planned_sessions p ON p.id=v.planned_session_id
    WHERE v.block_id=${blockId} ORDER BY v.id`));
  const [saved] = await as(owner, (tx) => tx`SELECT
    jsonb_build_object('weeks',b.weeks,'days_per_week',b.days_per_week,'day_index_overrides',b.day_index_overrides,
      'cardio_source',b.cardio_source,'notes',b.notes) AS block,
    jsonb_build_object('instance',i.instance,'setup_input',i.setup_input,
      'display_name',i.display_name,'customization_version',i.customization_version) AS instance
    FROM public.training_blocks b JOIN public.program_instances i ON i.block_id=b.id
    WHERE b.id=${blockId} AND i.status='active'`);
  assert.ok(saved);
  const call = (state: Expected[], moves: Move[], options: {
    user?: string | null; deletions?: unknown[]; replacement?: unknown;
  } = {}) => as(options.user === undefined ? owner : options.user, (tx) => tx`
    SELECT public.swim_update_conditioning_program(${blockId}::uuid,'[]'::jsonb,
      ${JSON.stringify(options.deletions ?? [])}::text::jsonb,'[]'::jsonb,
      ${JSON.stringify({ ...saved.block, notes: "Edited training days" })}::text::jsonb,'[]'::jsonb,
      ${JSON.stringify(options.replacement ?? saved.instance)}::text::jsonb,
      ${JSON.stringify(state)}::text::jsonb,${JSON.stringify(moves)}::text::jsonb,${randomUUID()}::uuid) AS id`);
  const plusDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const move = (row: Expected, date: string): Move => ({ id: row.id, plannedSessionId: row.primary.id, date });

  mark("conditioning-program-edit-authority");
  assert.equal((await as(owner, (tx) => tx`SELECT public.swim_conditioning_program_edit_ready() AS ready`))[0]!.ready, true);
  let rows = await expected();
  const initial = await snapshot();
  await denied(() => call(rows, [], { user: null }), "42501");
  await denied(() => call(rows, [], { user: other }), "42501");
  await denied(() => as(other, (tx) => tx`SELECT public.swim_lock_conditioning_program(${blockId})`), "42501");
  assert.deepEqual(await snapshot(), initial);
  for (const role of ["anon", "service_role"]) {
    for (const signature of ["swim_lock_conditioning_program(uuid)",
      "swim_update_conditioning_program(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid)"]) {
      assert.equal((await database`SELECT has_function_privilege(${role},${`public.${signature}`},'EXECUTE') AS allowed`)[0]!.allowed, false);
    }
  }
  for (const table of ["swim_plans", "swim_workouts"]) {
    assert.equal((await database`SELECT has_any_column_privilege('authenticated',${`public.${table}`},'UPDATE') AS allowed`)[0]!.allowed, false);
  }
  await denied(() => call(rows.map((row, index) => index ? row : { ...row, workoutRevision: row.workoutRevision + 1 }), []), "40001");
  await denied(() => call(rows, [], { deletions: [{ id: rows[0]!.primary.id }] }), "22023");
  assert.deepEqual(await snapshot(), initial);

  mark("conditioning-program-edit-paused-multi-move");
  await as(owner, (tx) => tx`SELECT public.swim_change_conditioning(${randomUUID()}::uuid,
    ${JSON.stringify({ command: "pause", planId, planRevision: rows[0]!.planRevision })}::text::jsonb)`);
  rows = await expected();
  assert.ok(rows.every((row) => row.planStatus === "paused"));
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  assert.equal(ordered.length, 2);
  const [first, second] = ordered as [Expected, Expected];
  const target = plusDay(second.date);
  const moves = [move(first, second.date), move(second, target)];
  const occupied = randomUUID();
  await as(owner, (tx) => tx`INSERT INTO public.planned_sessions
    (id,user_id,block_id,week_index,day_index,slot,title,role,prescription)
    SELECT ${occupied},user_id,block_id,week_index + CASE WHEN day_index=6 THEN 1 ELSE 0 END,
      (day_index+1)%7,slot,'Other workout',role,prescription
      FROM public.planned_sessions WHERE id=${second.primary.id}`);
  const [deletion] = await as(owner, (tx) => tx`SELECT id,week_index AS "weekIndex",day_index AS "dayIndex",
    slot,role,prescription AS "currentPrescription" FROM public.planned_sessions WHERE id=${occupied}`);
  assert.ok(deletion);
  const before = await snapshot();
  await denied(() => call(rows, moves), "22023");
  assert.deepEqual(await snapshot(), before);
  mark("conditioning-program-edit-late-rollback");
  await denied(() => call(rows, moves, {
    deletions: [deletion], replacement: { ...saved.instance, instance: null },
  }), "23502");
  assert.deepEqual(await snapshot(), before);

  mark("conditioning-program-edit-concurrent-saves");
  const outcomes = await Promise.allSettled([
    call(rows, moves, { deletions: [deletion] }), call(rows, moves, { deletions: [deletion] }),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  const failed = outcomes.find((result) => result.status === "rejected");
  assert.equal(failed?.status === "rejected" && failed.reason.code, "40001");
  const changed = await expected();
  for (const row of changed) {
    const prior = rows.find((value) => value.id === row.id)!;
    assert.equal(row.date, moves.find((value) => value.id === row.id)!.date);
    assert.equal(row.workoutRevision, prior.workoutRevision + 1);
    assert.equal(row.planRevision, prior.planRevision + 2);
    assert.equal(row.planStatus, "paused");
    assert.equal(row.primary.id, prior.primary.id);
    assert.equal(row.primary.notes, prior.primary.notes);
    assert.deepEqual(row.primary.prescription, prior.primary.prescription);
  }
  const after = await snapshot();
  assert.deepEqual(after[0]!.workouts.map((row: Record<string, unknown>) => [row.id, row.definition, row.session_id, row.status]),
    before[0]!.workouts.map((row: Record<string, unknown>) => [row.id, row.definition, row.session_id, row.status]));
  assert.deepEqual(after[0]!.outcomes, before[0]!.outcomes);
  assert.deepEqual(after[0]!.maxima, before[0]!.maxima);
  await denied(() => call(rows, moves, { deletions: [deletion] }), "40001");
  assert.deepEqual(await snapshot(), after);
  await as(owner, (tx) => tx`SELECT public.swim_change_conditioning(${randomUUID()}::uuid,
    ${JSON.stringify({ command: "resume", planId, planRevision: changed[0]!.planRevision })}::text::jsonb)`);

  return async () => {
    mark("conditioning-program-edit-claimed-history");
    const state = await expected();
    const claimed = state.find((row) => row.outcome?.outcome);
    assert.ok(claimed);
    const beforeClaimedEdit = await snapshot();
    const freeDate = plusDay([...state].sort((a, b) => b.date.localeCompare(a.date))[0]!.date);
    await denied(() => call(state, [move(claimed, freeDate)]), "40001");
    assert.deepEqual(await snapshot(), beforeClaimedEdit);
  };
}
