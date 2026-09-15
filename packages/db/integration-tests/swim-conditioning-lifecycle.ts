import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";

export async function exerciseConditioningLifecycle(
  database: postgres.Sql, owner: string, other: string, planId: string, mark: (stage: string) => void,
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
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.planned_sessions p) AS planned`);
  const read = async () => (await as(owner, (tx) => tx<{
    id: string; revision: number; plan_revision: number; status: string; plan_status: string;
    planned_session_id: string; scheduled_date: string;
  }[]>`SELECT id,revision,plan_revision,status,plan_status,planned_session_id,scheduled_date::text
    FROM public.swim_conditioning_sessions WHERE plan_id=${planId} ORDER BY scheduled_date DESC,id LIMIT 1`))[0]!;
  const changeIn = (tx: postgres.TransactionSql, id: string, input: unknown) =>
    tx`SELECT public.swim_change_conditioning(${id}::uuid,${JSON.stringify(input)}::text::jsonb) AS id`;
  const change = (input: unknown, id = randomUUID(), user: string | null = owner) =>
    as(user, (tx) => changeIn(tx, id, input));
  let work = await read();
  const input = (command: string) => ({ command, planId, planRevision: work.plan_revision });
  const target = (command: string) => ({ ...input(command), workoutId: work.id, workoutRevision: work.revision });
  const original = await snapshot();
  const originalDates = async () => as(owner, (tx) => tx`SELECT
    w.id,w.scheduled_date::text,w.definition->'original' AS original,w.definition->'issued' AS issued,
    p.week_index,p.day_index,p.slot,b.started_on::text,b.weeks,sp.ends_on::text
    FROM public.swim_conditioning_sessions v JOIN public.swim_workouts w ON w.id=v.id
    JOIN public.swim_plans sp ON sp.id=w.plan_id
    JOIN public.planned_sessions p ON p.id=v.planned_session_id JOIN public.training_blocks b ON b.id=p.block_id
    WHERE v.plan_id=${planId} ORDER BY w.id`);

  mark("conditioning-lifecycle-authorization");
  await denied(() => change(input("pause"), randomUUID(), null), "42501");
  await denied(() => change(input("pause"), randomUUID(), other), "42501");
  await denied(() => change({ ...input("pause"), unexpected: true }), "22023");
  assert.deepEqual(await snapshot(), original);
  for (const role of ["anon", "service_role"]) {
    assert.equal((await database`SELECT has_function_privilege(${role},
      'public.swim_change_conditioning(uuid,jsonb)','EXECUTE') AS allowed`)[0]!.allowed, false);
  }

  mark("conditioning-fixed-calendar-pause-resume");
  const dates = await originalDates();
  const pause = input("pause");
  const pauseId = randomUUID();
  const [a, b] = await Promise.all([change(pause, pauseId), change(pause, pauseId)]);
  assert.deepEqual(a, b);
  work = await read();
  assert.equal(work.plan_status, "paused");
  assert.equal(work.plan_revision, pause.planRevision + 1);
  assert.deepEqual(await originalDates(), dates);
  await denied(() => change({ ...pause, command: "finish" }, pauseId), "22023");
  await change(input("resume"));
  work = await read();
  assert.equal(work.plan_status, "active");
  assert.deepEqual(await originalDates(), dates);
  await denied(() => as(owner, (tx) => tx`SELECT public.swim_update_plan(
    ${planId},${work.plan_revision},definition,state - 'conditioningChanges','[]'::jsonb)
    FROM public.swim_plans WHERE id=${planId}`), "P0001");

  mark("conditioning-atomic-date-move");
  const nextDate = new Date(Date.parse(`${work.scheduled_date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const move = { ...target("move"), date: nextDate, reason: "Pool closed", warnings: [] };
  const occupied = randomUUID();
  await as(owner, (tx) => tx`INSERT INTO public.planned_sessions
    (id,user_id,block_id,week_index,day_index,slot,title,role,prescription)
    SELECT ${occupied},user_id,block_id,week_index + CASE WHEN day_index=6 THEN 1 ELSE 0 END,
      (day_index+1)%7,slot,'Other workout',role,prescription FROM public.planned_sessions
      WHERE id=${work.planned_session_id}`);
  const occupiedSnapshot = await snapshot();
  await denied(() => change(move), "22023");
  assert.deepEqual(await snapshot(), occupiedSnapshot);
  await as(owner, (tx) => tx`DELETE FROM public.planned_sessions WHERE id=${occupied}`);
  const beforeMove = await snapshot();
  await denied(() => as(owner, async (tx) => {
    await changeIn(tx, randomUUID(), move);
    await tx`UPDATE public.planned_sessions SET week_index=week_index+100 WHERE id=${work.planned_session_id}`;
  }), "23514");
  assert.deepEqual(await snapshot(), beforeMove);
  await denied(() => change({ ...move, date: "2099-01-01" }), "22023");
  await change(move);
  work = await read();
  assert.equal(work.scheduled_date, nextDate);
  assert.equal(work.revision, move.workoutRevision + 1);
  const movedDates = await originalDates();
  assert.deepEqual(movedDates.map((row) => [row.id,row.original,row.issued,row.started_on,row.weeks,row.ends_on]),
    dates.map((row) => [row.id,row.original,row.issued,row.started_on,row.weeks,row.ends_on]));

  mark("conditioning-skip-race-and-undo");
  const skip = { ...target("skip"), reason: "Cannot swim" };
  const decisions = await Promise.allSettled([change(skip), change(input("pause"))]);
  assert.equal(decisions.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = decisions.find((result) => result.status === "rejected");
  assert.equal(rejected?.status === "rejected" && rejected.reason.code, "40001");
  work = await read();
  if (work.plan_status === "paused") { await change(input("resume")); work = await read(); }
  if (work.status !== "skipped") { await change({ ...target("skip"), reason: "Cannot swim" }); work = await read(); }
  assert.equal((await as(owner, (tx) => tx`SELECT skipped_at FROM public.planned_sessions
    WHERE id=${work.planned_session_id}`))[0]!.skipped_at, null);
  const undo = target("unskip");
  const undoId = randomUUID();
  await change(undo, undoId);
  const afterUndo = await snapshot();
  await change(undo, undoId);
  assert.deepEqual(await snapshot(), afterUndo);
  work = await read();
  assert.equal(work.status, "scheduled");
  assert.deepEqual(await originalDates(), movedDates);
  assert.equal((await as(owner, (tx) => tx`SELECT public.swim_replay_conditioning_change(
    ${planId},${undoId},${JSON.stringify(undo)}::text::jsonb) AS id`))[0]!.id, undoId);
  await denied(() => database`UPDATE public.swim_plans SET state=state - 'conditioningChanges'
    WHERE id=${planId}`, "42501");
}
