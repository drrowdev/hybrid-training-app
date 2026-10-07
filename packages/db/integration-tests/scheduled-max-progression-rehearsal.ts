import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { assertOwnershipRefusal, independentProgramFixture } from "./independent-programs-rehearsal.ts";

export async function rehearseScheduledMaxProgression(database: postgres.Sql, stage: (name: string) => void) {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_JOB, "pool-storage");
  assert.equal(process.platform, "linux");
  assert.equal(database.options.database, "swim_pool_test");
  const up = readFileSync(new URL("../drizzle/0161_scheduled_max_progression.sql", import.meta.url), "utf8");
  const down = readFileSync(new URL("../rollbacks/0161_scheduled_max_progression.down.sql", import.meta.url), "utf8");
  const policies = async () => JSON.stringify(await database`SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('training_maxes','tm_suggestions','profiles') ORDER BY tablename,policyname`);
  const before = await policies();
  const constraints = async () => JSON.stringify(await database`SELECT conname,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid IN ('public.training_maxes'::regclass,'public.tm_suggestions'::regclass) ORDER BY conname`);
  const originalConstraints = await constraints();
  const revert = async () => {
    const connection = await database.reserve();
    try { await connection.unsafe(down); }
    catch (error) { await connection.unsafe("ROLLBACK"); throw error; }
    finally { connection.release(); }
  };
  stage("0161-up-down-up-and-unchanged-RLS");
  await database.begin((tx) => tx.unsafe(up));
  await revert();
  assert.equal(await constraints(), originalConstraints);
  assert.equal(await policies(), before);
  await database.begin((tx) => tx.unsafe(up));
  assert.equal(await policies(), before);
  const owner = randomUUID(), foreign = randomUUID();
  const asUser = <T>(id: string | null, work: (tx: postgres.TransactionSql) => Promise<T>) => database.begin(async (tx) => {
    await tx.unsafe(id ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
    await tx`SELECT set_config('request.jwt.claims',${JSON.stringify(id ? { sub: id } : {})},true)`;
    return work(tx);
  });
  const decisions = (ids: string[], accept: boolean, user = owner) => asUser(user, async (tx) =>
    (await tx`SELECT public.decide_max_suggestions(${ids}::uuid[],${accept}) AS count`)[0]!.count);
  const generate = (candidates: unknown[], user = owner) => asUser(user, async (tx) =>
    (await tx`SELECT public.generate_scheduled_max_progression(${JSON.stringify(candidates)}::jsonb) AS count`)[0]!.count);
  try {
    await database`INSERT INTO auth.users(id) VALUES(${owner}),(${foreign})`;
    const [calendar] = await database<{ today: string; weekday: number }[]>`SELECT to_char(current_date,'YYYY-MM-DD') AS today,
      extract(isodow FROM current_date)::int-1 AS weekday`;
    assert.ok(calendar);
    const movements = await database<{ id: string }[]>`SELECT id FROM public.movements WHERE user_id IS NULL
      AND pattern<>'cardio' ORDER BY id LIMIT 6`;
    assert.equal(movements.length, 6);
    const ids = movements.map((movement) => movement.id);
    const items = ids.map((movementId, index) => ({ movementId, kind: "main", sets: 3, reps: 5, percentTm: 80,
      meta: { programLoadBasis: index === 3 ? { version: 1, kind: "working-max", kg: 90 }
        : { version: 1, kind: "one-rm", percent: 100, roundingKg: null } } }));
    const args = independentProgramFixture("strength", calendar, items);
    const revision = await asUser(owner, async (tx) => (await tx`SELECT public.training_schedule_snapshot()->>'revision' AS revision`)[0]!.revision);
    await asUser(owner, (tx) => tx`SELECT public.independent_program_schedule_commit('primary-create',${JSON.stringify(args)}::jsonb,
      ${revision},${randomUUID()}::uuid,${createHash("sha256").update(JSON.stringify(args)).digest("hex")},true)`);
    for (const id of ids.slice(0, 4)) {
      await database`INSERT INTO public.training_maxes(user_id,movement_id,one_rm_kg,updated_at)
        VALUES(${owner}::uuid,${id}::uuid,100,now()-interval '22 days')`;
    }
    const maxes = await database`SELECT movement_id,one_rm_kg,updated_at FROM public.training_maxes WHERE user_id=${owner}::uuid ORDER BY movement_id`;
    const candidates = maxes.map((max) => ({ movementId: max.movement_id, currentOneRmKg: Number(max.one_rm_kg),
      proposedOneRmKg: 101.5, updatedAt: max.updated_at }));
    stage("0161-DC-R6-concurrent-generation-and-absolute-max-exclusion");
    const generated = await Promise.all([generate(candidates), generate(candidates)]);
    assert.equal(generated.reduce((sum, count) => sum + count, 0), 3);
    assert.equal(await generate(candidates), 0);
    const pending = await database`SELECT id,movement_id FROM public.tm_suggestions WHERE user_id=${owner}::uuid AND status='pending' ORDER BY movement_id`;
    assert.equal(pending.length, 3);
    assert.ok(pending.every((row) => row.movement_id !== ids[3]));
    assert.equal((await asUser(foreign, (tx) => tx`SELECT * FROM public.tm_suggestions WHERE user_id=${owner}::uuid`)).length, 0);
    await assertOwnershipRefusal(() => decisions([pending[0]!.id], true, foreign), "42501");
    await assertOwnershipRefusal(() => asUser(null, (tx) => tx`SELECT public.generate_scheduled_max_progression('[]'::jsonb)`), "42501");
    assert.equal(await generate(candidates, foreign), 0);

    stage("0161-single-accept-decline-replay-and-21-day-clock");
    const accepted = pending[0]!, declined = pending[1]!;
    assert.deepEqual((await Promise.all([decisions([accepted.id], true), decisions([accepted.id], true)])).sort(), [0, 1]);
    assert.equal(await decisions([declined.id], false), 1);
    assert.equal(Number((await database`SELECT one_rm_kg FROM public.training_maxes WHERE user_id=${owner}::uuid AND movement_id=${accepted.movement_id}::uuid`)[0]!.one_rm_kg), 101.5);
    assert.equal(Number((await database`SELECT one_rm_kg FROM public.training_maxes WHERE user_id=${owner}::uuid AND movement_id=${declined.movement_id}::uuid`)[0]!.one_rm_kg), 100);
    assert.equal(await generate(candidates), 0);
    await database`UPDATE public.tm_suggestions SET resolved_at=now()-interval '21 days'
      WHERE user_id=${owner}::uuid AND id=${declined.id}::uuid`;
    assert.equal(await generate(candidates), 1);
    await assertOwnershipRefusal(() => revert(), "P0001");

    stage("0161-atomic-bulk-decline-and-bulk-accept");
    const remaining = await database`SELECT id FROM public.tm_suggestions WHERE user_id=${owner}::uuid AND status='pending'`;
    assert.equal(await decisions(remaining.map((row) => row.id), false), 2);
    await database`UPDATE public.tm_suggestions SET resolved_at=now()-interval '22 days'
      WHERE user_id=${owner}::uuid AND status='dismissed'`;
    assert.equal(await generate(candidates), 2);
    const bulk = await database`SELECT id,movement_id FROM public.tm_suggestions WHERE user_id=${owner}::uuid AND status='pending'`;
    assert.equal(await decisions(bulk.map((row) => row.id), true), 2);
    const values = await database`SELECT movement_id,one_rm_kg,source FROM public.training_maxes WHERE user_id=${owner}::uuid`;
    for (const value of values) {
      assert.equal(Number(value.one_rm_kg), value.movement_id === ids[3] ? 100 : 101.5);
      assert.equal(value.source, value.movement_id === ids[3] ? "entered" : "scheduled_progression");
    }

    stage("0161-stale-max-and-atomic-preference");
    await asUser(owner, (tx) => tx`SELECT public.set_scheduled_max_progression(false)`);
    assert.equal(await generate(candidates), 0);
    assert.equal((await database`SELECT intake->>'suggestScheduled1RmIncreases' AS enabled FROM public.profiles WHERE id=${owner}::uuid`)[0]!.enabled, "false");
    assert.equal((await database`SELECT intake->>'suggestScheduled1RmIncreases' AS enabled FROM public.profiles WHERE id=${foreign}::uuid`)[0]!.enabled, null);
    await asUser(owner, (tx) => tx`SELECT public.set_scheduled_max_progression(true)`);
    assert.equal(await generate(candidates), 0);
    assert.equal(await policies(), before);

    stage("0161-derived-precedence-stale-bulk-rollback-and-imperial");
    const [derivedMovement, staleMovement] = ids.slice(4).sort();
    assert.ok(derivedMovement && staleMovement);
    for (const id of [derivedMovement, staleMovement]) {
      await database`INSERT INTO public.training_maxes(user_id,movement_id,one_rm_kg,tm_percent,updated_at)
        VALUES(${owner}::uuid,${id}::uuid,100,90,now()-interval '22 days')`;
    }
    const freshMaxes = await database`SELECT movement_id,one_rm_kg,updated_at FROM public.training_maxes
      WHERE user_id=${owner}::uuid AND movement_id IN (${derivedMovement}::uuid,${staleMovement}::uuid)`;
    const freshCandidates = freshMaxes.map((max) => ({ movementId: max.movement_id, currentOneRmKg: Number(max.one_rm_kg),
      proposedOneRmKg: 101.5, updatedAt: max.updated_at }));
    await database`UPDATE public.profiles SET units='imperial' WHERE id=${owner}::uuid`;
    assert.equal(await generate(freshCandidates), 0);
    await database`UPDATE public.profiles SET units='metric' WHERE id=${owner}::uuid`;
    assert.equal(await generate(freshCandidates), 2);
    const scheduled = await database`SELECT id,movement_id FROM public.tm_suggestions
      WHERE user_id=${owner}::uuid AND status='pending' ORDER BY movement_id`;
    const [session] = await asUser(owner, (tx) => tx`INSERT INTO public.sessions(user_id,title)
      VALUES(${owner}::uuid,'Synthetic source workout') RETURNING id`);
    assert.ok(session);
    const [derived] = await asUser(owner, (tx) => tx`INSERT INTO public.tm_suggestions(
      user_id,movement_id,current_tm_kg,suggested_tm_kg,source,derived_from_session_id,derived_formula)
      VALUES(${owner}::uuid,${derivedMovement}::uuid,90,92.5,'derived_amrap',${session.id}::uuid,'epley') RETURNING id`);
    assert.ok(derived);
    await asUser(owner, (tx) => tx`UPDATE public.planned_sessions SET completed_session_id=${session.id}::uuid
      WHERE user_id=${owner}::uuid`);
    await assertOwnershipRefusal(() => decisions([derived.id], true), "42501");
    assert.equal(Number((await database`SELECT one_rm_kg FROM public.training_maxes
      WHERE user_id=${owner}::uuid AND movement_id=${derivedMovement}::uuid`)[0]!.one_rm_kg), 100);
    await asUser(owner, (tx) => tx`UPDATE public.planned_sessions SET completed_session_id=NULL
      WHERE user_id=${owner}::uuid`);
    await assertOwnershipRefusal(() => decisions([scheduled.find((row) => row.movement_id === derivedMovement)!.id], true), "40001");
    await asUser(owner, (tx) => tx`UPDATE public.training_maxes SET one_rm_kg=200,source='entered'
      WHERE movement_id=${staleMovement}::uuid AND user_id=${owner}::uuid`);
    await assertOwnershipRefusal(() => decisions([derived.id, scheduled.find((row) => row.movement_id === staleMovement)!.id], true), "40001");
    assert.equal(Number((await database`SELECT one_rm_kg FROM public.training_maxes
      WHERE user_id=${owner}::uuid AND movement_id=${derivedMovement}::uuid`)[0]!.one_rm_kg), 100);
    assert.equal((await database`SELECT status FROM public.tm_suggestions WHERE id=${derived.id}::uuid`)[0]!.status, "pending");
    assert.equal(await decisions([derived.id], true), 1);
    assert.equal(Number((await database`SELECT one_rm_kg FROM public.training_maxes
      WHERE user_id=${owner}::uuid AND movement_id=${derivedMovement}::uuid`)[0]!.one_rm_kg), 102.5);
    assert.equal((await database`SELECT status FROM public.tm_suggestions
      WHERE id=${scheduled.find((row) => row.movement_id === derivedMovement)!.id}::uuid`)[0]!.status, "dismissed");
    assert.equal(await generate(freshCandidates), 0);
    stage("0165-authored-test-up-down-up-and-accept");
    const authoredUp = readFileSync(new URL("../drizzle/0165_authored_test_max_suggestions.sql", import.meta.url), "utf8");
    const authoredDown = readFileSync(new URL("../rollbacks/0165_authored_test_max_suggestions.down.sql", import.meta.url), "utf8");
    const decideCatalog = async () => JSON.stringify(await database`SELECT proowner::regrole::text AS owner,prosecdef,proconfig,proacl::text AS acl,
      md5(replace(prosrc,E'\r\n',E'\n')) AS body FROM pg_proc WHERE oid='public.decide_max_suggestions(uuid[],boolean)'::regprocedure`);
    const decideBefore = await decideCatalog();
    await database.begin((tx) => tx.unsafe(authoredUp));
    const decideAfter = await decideCatalog();
    assert.notEqual(decideAfter, decideBefore);
    const authoredConnection = await database.reserve();
    try { await authoredConnection.unsafe(authoredDown); }
    catch (error) { await authoredConnection.unsafe("ROLLBACK"); throw error; }
    finally { authoredConnection.release(); }
    assert.equal(await decideCatalog(), decideBefore);
    await database.begin((tx) => tx.unsafe(authoredUp));
    assert.equal(await decideCatalog(), decideAfter);
    await asUser(owner, (tx) => tx`UPDATE public.planned_sessions SET completed_session_id=${session.id}::uuid WHERE user_id=${owner}::uuid`);
    const authoredSet = (movement: string, index: number, prescribed: unknown) => asUser(owner, async (tx) => (await tx`INSERT INTO public.set_logs(
      session_id,movement_id,set_index,reps,weight_kg,prescribed) VALUES(${session.id}::uuid,${movement}::uuid,${index},3,100,${JSON.stringify(prescribed)}::jsonb)
      RETURNING id`)[0]!.id as string);
    const authoredSuggestion = (setId: string, movement: string) => asUser(owner, async (tx) => (await tx`INSERT INTO public.tm_suggestions(
      user_id,movement_id,current_tm_kg,suggested_tm_kg,source,derived_from_session_id,derived_from_set_log_id,derived_formula)
      VALUES(${owner}::uuid,${movement}::uuid,92.25,94.5,'derived_amrap',${session.id}::uuid,${setId}::uuid,'epley') RETURNING id`)[0]!.id as string);
    const maxOf = async () => Number((await database`SELECT one_rm_kg FROM public.training_maxes
      WHERE user_id=${owner}::uuid AND movement_id=${derivedMovement}::uuid`)[0]!.one_rm_kg);
    const plain = await authoredSet(derivedMovement, 0, { percentTm: 90 });
    const unmarked = await authoredSuggestion(plain, derivedMovement);
    await assertOwnershipRefusal(() => decisions([unmarked], true), "42501");
    await database`UPDATE public.tm_suggestions SET status='dismissed' WHERE id=${unmarked}::uuid`;
    const marked = await authoredSet(derivedMovement, 1, { authoredTest: { after: "updateFromLoggedSet" } });
    const otherSet = await authoredSet(staleMovement, 2, { authoredTest: { after: "updateFromLoggedSet" } });
    const otherMovement = await authoredSuggestion(otherSet, derivedMovement);
    await assertOwnershipRefusal(() => decisions([otherMovement], true), "42501");
    await database`UPDATE public.tm_suggestions SET status='dismissed' WHERE id=${otherMovement}::uuid`;
    const pending = await authoredSuggestion(marked, derivedMovement);
    await assert.rejects(decisions([pending], true, foreign));
    assert.equal(await maxOf(), 102.5);
    assert.equal(await decisions([pending], true), 1);
    assert.equal(await maxOf(), 105);
    await assert.rejects(decisions([pending], true));
    assert.equal(await maxOf(), 105);
    return ["0165-authored-test-up-down-up-owner-isolation-and-replay", "0161-up-down-up-and-unchanged-RLS", "0161-DC-R6-concurrent-generation-and-absolute-max-exclusion",
      "0161-single-accept-decline-replay-and-21-day-clock", "0161-atomic-bulk-decline-and-bulk-accept", "0161-stale-max-and-atomic-preference",
      "0161-derived-precedence-stale-bulk-rollback-and-imperial"];
  } catch (error) {
    if (error instanceof Error) {
      const column = error.message.match(/column "([a-z_][a-z0-9_.]*)" (?:of relation "[a-z_]+")? ?does not exist/i)?.[1];
      const context = "where" in error && typeof error.where === "string"
        ? error.where.match(/function ([a-z_]+\([^)]*\)) line (\d+)/i) : null;
      console.error(JSON.stringify({ scope: "scheduled-max-progression", column,
        routine: context?.[1], line: context ? Number(context[2]) : undefined }));
    }
    throw error;
  } finally {
    await database`DELETE FROM public.tm_suggestions WHERE user_id IN (${owner}::uuid,${foreign}::uuid)`;
    await database`DELETE FROM public.training_maxes WHERE user_id IN (${owner}::uuid,${foreign}::uuid)`;
    await database`DELETE FROM auth.users WHERE id IN (${owner},${foreign})`;
  }
}
