import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { generateSwimPlan } from "../../engine/src/swimming.ts";
import { poolCourse } from "../../domain/src/swimming.ts";
import { assertOwnershipRefusal, independentProgramFixture } from "./independent-programs-rehearsal.ts";

const json = JSON.stringify;
const hash = (value: unknown) => createHash("sha256").update(json(value)).digest("hex");
type Prescription = { items: { movementId: string; kind: string; sets: number; reps: number }[]; meta?: { editRevision?: string } };
type Saved = { conflict: boolean; prescription: Prescription };
type Swim = { plan: { id: string; revision: number }; workouts: { id: string }[] };

export async function rehearsePrescriptionSafety(database: postgres.Sql, stage: (name: string) => void) {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_JOB, "pool-storage");
  assert.equal(process.platform, "linux");
  assert.equal(database.options.database, "swim_pool_test");
  const stages: string[] = [];
  for (const name of ["0159_prescription_edit_revisions", "0160_atomic_swimming_replacement"]) {
    stage(`safety-${name}-up-down-up`);
    const up = readFileSync(new URL(`../drizzle/${name}.sql`, import.meta.url), "utf8");
    const down = readFileSync(new URL(`../rollbacks/${name}.down.sql`, import.meta.url), "utf8");
    await database.begin((tx) => tx.unsafe(up));
    const connection = await database.reserve();
    try { await connection.unsafe(down); }
    catch (error) { await connection.unsafe("ROLLBACK"); throw error; }
    finally { connection.release(); }
    await database.begin((tx) => tx.unsafe(up));
    stages.push(`safety-${name}-up-down-up`);
  }
  const owner = randomUUID(), foreign = randomUUID();
  const asUser = <T>(id: string | null, work: (tx: postgres.TransactionSql) => Promise<T>) => database.begin(async (tx) => {
    await tx.unsafe(id ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
    await tx`SELECT set_config('request.jwt.claims',${json(id ? { sub: id } : {})},true)`;
    return work(tx);
  });
  const snapshot = (id = owner) => asUser(id, async (tx) =>
    (await tx`SELECT public.training_schedule_snapshot()->>'revision' AS revision`)[0]!.revision as string);
  const commit = async <T>(operation: string, args: unknown) => {
    const revision = await snapshot();
    return asUser(owner, async (tx) => (await tx<{ value: T }[]>`SELECT public.independent_program_schedule_commit(
      ${operation},${json(args)}::jsonb,${revision},${randomUUID()}::uuid,${hash(args)},true) AS value`)[0]!.value);
  };
  try {
    await database`INSERT INTO auth.users(id) VALUES (${owner}),(${foreign})`;
    const [calendar] = await database<{ today: string; weekday: number }[]>`SELECT to_char(current_date,'YYYY-MM-DD') AS today,
      extract(isodow FROM current_date)::int-1 AS weekday`;
    const [movement] = await database`SELECT id FROM public.movements WHERE user_id IS NULL AND pattern<>'cardio' ORDER BY id LIMIT 1`;
    assert.ok(calendar && movement);
    const initial: Prescription = { items: [{ movementId: movement.id, kind: "main", sets: 1, reps: 5 }] };
    const primary = await commit<{ block_id: string }>("primary-create", independentProgramFixture("strength", calendar, initial.items));
    const [planned] = await database`SELECT id FROM public.planned_sessions WHERE block_id=${primary.block_id}::uuid`;
    assert.ok(planned);
    const save = (id: string | null, target: string, row: string, revision: string | null, prescription: Prescription) =>
      asUser(id, async (tx) => (await tx<{ value: Saved }[]>`SELECT public.save_prescription_if_current(
        ${target},${row}::uuid,${revision},${json(prescription)}::jsonb,false) AS value`)[0]!.value);
    stage("DC-K4-two-connections-reject-stale-prescription-without-writing");
    const first = { items: [{ ...initial.items[0]!, reps: 8 }] };
    const second = { items: [{ ...initial.items[0]!, reps: 12 }] };
    const concurrent = await Promise.all([
      save(owner, "planned_sessions", planned.id, "0", first),
      save(owner, "planned_sessions", planned.id, "0", second),
    ]);
    assert.equal(concurrent.filter((result) => !result.conflict).length, 1);
    assert.equal(concurrent.filter((result) => result.conflict).length, 1);
    const winner = concurrent.find((result) => !result.conflict)!;
    assert.match(winner.prescription.meta!.editRevision!, /^[a-f0-9-]{36}$/);
    assert.deepEqual(concurrent.find((result) => result.conflict)!.prescription, winner.prescription);
    const beforeConflict = await snapshot();
    const stale = await save(owner, "planned_sessions", planned.id, "0", second);
    assert.equal(stale.conflict, true);
    assert.equal(await snapshot(), beforeConflict);
    assert.equal((await save(owner, "planned_sessions", planned.id, null, second)).conflict, true);
    await assertOwnershipRefusal(() => save(foreign, "planned_sessions", planned.id, winner.prescription.meta!.editRevision!, second), "42501");
    await assertOwnershipRefusal(() => save(null, "planned_sessions", planned.id, "0", second), "42501");
    const reapplied = await save(owner, "planned_sessions", planned.id, winner.prescription.meta!.editRevision!, second);
    assert.equal(reapplied.conflict, false);
    assert.equal(reapplied.prescription.items[0]!.reps, 12);
    const [session] = await asUser(owner, (tx) => tx`INSERT INTO public.sessions(user_id,title,prescription)
      VALUES(${owner}::uuid,'Synthetic prescription',${json(initial)}::jsonb) RETURNING id`);
    const sessionSave = await save(owner, "sessions", session!.id, "0", first);
    assert.equal(sessionSave.conflict, false);
    assert.equal((await save(owner, "sessions", session!.id, "0", second)).conflict, true);
    await asUser(owner, (tx) => tx`UPDATE public.sessions SET completed_at=now() WHERE id=${session!.id}::uuid`);
    await assertOwnershipRefusal(() => save(owner, "sessions", session!.id, sessionSave.prescription.meta!.editRevision!, second), "42501");
    stages.push("DC-K4-two-connections-reject-stale-prescription-without-writing");

    stage("DC-SW7-DC-SW8-atomic-owner-only-replacement-replay-and-history");
    const setup = { goal: "endurance" as const, experience: "recreational" as const, course: poolCourse(25, 1, "m"),
      knownStrokes: ["freestyle" as const], equipment: [], recentComfortableLengths: 8, sessionBudgetMinutes: 60 };
    const generated = generateSwimPlan({ setup, calibration: null, weeks: [{ weekIndex: 0, startDateISO: calendar.today,
      slots: [{ slotId: "safety", dateISO: calendar.today, intent: "moderate", source: "swim_date" }] }] });
    assert.ok(generated.ok);
    const slot = generated.value.weeks[0]!.slots[0]!;
    assert.ok(slot.kind === "workout");
    const args = { p_started_on: calendar.today, p_ends_on: calendar.today,
      p_definition: { version: 1, setup, generatorVersion: "swim-gen-1" },
      p_state: { version: 1, observations: [], acceptedCalibration: null, decisions: [] },
      p_workouts: [{ scheduled_date: calendar.today, slot: "single", definition: {
        version: 1, original: slot.original, issued: slot.issued, modifications: [], slotId: slot.slotId } }] };
    const swim = await commit<Swim>("swim-create", args);
    const oldWorkouts = await database`SELECT * FROM public.swim_workouts WHERE plan_id=${swim.plan.id}::uuid ORDER BY id`;
    const primaryBefore = await database`SELECT to_jsonb(b) AS row FROM public.training_blocks b WHERE id=${primary.block_id}::uuid`;
    const before = await snapshot();
    const request = randomUUID();
    const replace = (id: string | null, input = args, requestId = request, revision = before) => asUser(id, async (tx) =>
      (await tx<{ value: Swim }[]>`SELECT public.replace_swim_plan_atomically(
        ${swim.plan.id}::uuid,${swim.plan.revision},${json(input)}::jsonb,${revision},
        ${requestId}::uuid,${hash(args)},true) AS value`)[0]!.value);
    await assertOwnershipRefusal(() => replace(foreign, args, randomUUID(), ""), "40001");
    const foreignRevision = await snapshot(foreign);
    await assertOwnershipRefusal(() => replace(foreign, args, randomUUID(), foreignRevision), "42501");
    await assertOwnershipRefusal(() => replace(null), "42501");
    await assert.rejects(() => replace(owner, { ...args, p_workouts: [] }));
    assert.equal(await snapshot(), before);
    const replaced = await replace(owner);
    assert.notEqual(replaced.plan.id, swim.plan.id);
    assert.deepEqual(await replace(owner), replaced);
    await assertOwnershipRefusal(() => replace(owner, { ...args, p_ends_on: "2099-01-01" }), "22023");
    await assertOwnershipRefusal(() => replace(owner, args, randomUUID()), "40001");
    assert.equal((await database`SELECT status FROM public.swim_plans WHERE id=${swim.plan.id}::uuid`)[0]!.status, "finished");
    assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_plans WHERE user_id=${owner}::uuid AND status='active'`)[0]!.n, 1);
    assert.deepEqual(await database`SELECT * FROM public.swim_workouts WHERE plan_id=${swim.plan.id}::uuid ORDER BY id`, oldWorkouts);
    assert.deepEqual(await database`SELECT to_jsonb(b) AS row FROM public.training_blocks b WHERE id=${primary.block_id}::uuid`, primaryBefore);
    stages.push("DC-SW7-DC-SW8-atomic-owner-only-replacement-replay-and-history");

    stage("DC-SW5-DC-SW7-paused-replacement-preserves-completion-and-rehab");
    const protocol = randomUUID();
    await asUser(owner, (tx) => tx`INSERT INTO public.rehab_protocols(id,user_id,name,definition)
      VALUES(${protocol}::uuid,${owner}::uuid,'Replacement history protocol',
      ${json({ items: [{ movementId: movement.id, movementName: "Fixture exercise", sets: 1, reps: 8, targetWeightKg: 2 }], links: [] })}::jsonb)`);
    const attachRevision = await snapshot();
    await asUser(owner, (tx) => tx`SELECT public.set_swim_rehab_bindings(${replaced.plan.id}::uuid,
      ARRAY[${protocol}::uuid],${attachRevision},${randomUUID()}::uuid)`);
    const started = await asUser(owner, async (tx) =>
      (await tx<{ value: { id: string; revision: number; session_id: string } }[]>`SELECT public.swim_start_workout(
        ${replaced.workouts[0]!.id}::uuid,1) AS value`)[0]!.value);
    const actual = { version: 1, snapshot: slot.issued.snapshot, lengths: slot.issued.totalLengths, timeMs: 600000,
      rpe: 5, completion: "completed", provenance: { source: "manual", recordedAt: new Date().toISOString() } };
    await asUser(owner, (tx) => tx`SELECT public.swim_complete_workout(${started.id}::uuid,${started.revision},
      ${json(actual)}::jsonb,${randomUUID()}::uuid,${randomUUID()}::uuid,NULL,false)`);
    const [latest] = await database`SELECT revision FROM public.swim_plans WHERE id=${replaced.plan.id}::uuid`;
    const paused = await asUser(owner, async (tx) =>
      (await tx<{ value: { revision: number } }[]>`SELECT public.swim_set_plan_status(
        ${replaced.plan.id}::uuid,${latest!.revision},'paused') AS value`)[0]!.value);
    const retained = async () => ({
      workouts: await database`SELECT * FROM public.swim_workouts WHERE plan_id=${replaced.plan.id}::uuid ORDER BY id`,
      links: await database`SELECT * FROM public.swim_plan_rehab_bindings WHERE plan_id=${replaced.plan.id}::uuid ORDER BY local_protocol_id`,
      session: await database`SELECT * FROM public.sessions WHERE id=${started.session_id}::uuid`,
      cardio: await database`SELECT * FROM public.cardio_logs WHERE session_id=${started.session_id}::uuid ORDER BY id`,
    });
    const history = await retained();
    assert.equal(history.workouts[0]!.status, "completed");
    assert.equal(history.links.length, 1);
    assert.equal(history.cardio.length, 1);
    const pausedRevision = await snapshot(), pausedRequest = randomUUID();
    const replacePaused = () => asUser(owner, async (tx) =>
      (await tx<{ value: Swim }[]>`SELECT public.replace_swim_plan_atomically(
        ${replaced.plan.id}::uuid,${paused.revision},${json(args)}::jsonb,${pausedRevision},
        ${pausedRequest}::uuid,${hash(args)},true) AS value`)[0]!.value);
    const retries = await Promise.all([replacePaused(), replacePaused()]);
    assert.deepEqual(retries[0], retries[1]);
    assert.notEqual(retries[0]!.plan.id, replaced.plan.id);
    assert.deepEqual(await retained(), history);
    assert.equal((await database`SELECT status FROM public.swim_plans WHERE id=${replaced.plan.id}::uuid`)[0]!.status, "finished");
    assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_plans WHERE user_id=${owner}::uuid AND status='active'`)[0]!.n, 1);
    assert.deepEqual(await database`SELECT to_jsonb(b) AS row FROM public.training_blocks b WHERE id=${primary.block_id}::uuid`, primaryBefore);
    stages.push("DC-SW5-DC-SW7-paused-replacement-preserves-completion-and-rehab");
  } finally {
    await database`DELETE FROM public.program_rehab_bindings WHERE user_id IN (${owner}::uuid,${foreign}::uuid)`;
    await database`DELETE FROM public.swim_plan_rehab_bindings WHERE user_id IN (${owner}::uuid,${foreign}::uuid)`;
    await database`DELETE FROM auth.users WHERE id IN (${owner}::uuid,${foreign}::uuid)`;
  }
  return stages;
}
