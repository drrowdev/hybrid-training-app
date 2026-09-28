import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { assertOwnershipRefusal, independentProgramFixture } from "./independent-programs-rehearsal.ts";

export async function rehearseProgramResume(database: postgres.Sql, stage: (name: string) => void) {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_JOB, "pool-storage");
  assert.equal(process.platform, "linux");
  assert.deepEqual(database.options.host, ["127.0.0.1"]);
  assert.equal(database.options.database, "swim_pool_test");
  const up = readFileSync(new URL("../drizzle/0162_resume_ended_program.sql", import.meta.url), "utf8");
  const down = readFileSync(new URL("../rollbacks/0162_resume_ended_program.down.sql", import.meta.url), "utf8");
  const definition = async () => JSON.stringify(await database`SELECT pg_get_functiondef(oid) AS body,proacl::text,proowner
    FROM pg_proc WHERE oid='public.training_schedule_commit(text,jsonb,text,uuid,text,boolean)'::regprocedure`);
  const guards = async () => JSON.stringify(await database`SELECT jsonb_build_array(
    (SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proacl::text) ORDER BY p.oid::regprocedure::text)
      FROM pg_proc p WHERE p.proname IN ('guard_program_block_identity','guard_program_instance_identity','guard_program_prescription')),
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public')) AS value`);
  const revert = async () => {
    const connection = await database.reserve();
    try { await connection.unsafe(down); }
    catch (error) { await connection.unsafe("ROLLBACK"); throw error; }
    finally { connection.release(); }
  };
  stage("0162-up-down-up-preserves-function-grants-and-0158-guards");
  const original = await definition(), originalGuards = await guards();
  await database.begin((tx) => tx.unsafe(up));
  const installed = await definition();
  await revert();
  assert.equal(await definition(), original);
  await database.begin((tx) => tx.unsafe(up));
  assert.equal(await definition(), installed);
  assert.equal(await guards(), originalGuards);
  const owner = randomUUID(), foreign = randomUUID();
  const asUser = <T>(id: string | null, work: (tx: postgres.TransactionSql) => Promise<T>) => database.begin(async (tx) => {
    await tx.unsafe(id ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
    await tx`SELECT set_config('request.jwt.claims',${JSON.stringify(id ? { sub: id } : {})},true)`;
    return work(tx);
  });
  const snapshot = (id = owner) => asUser(id, async (tx) =>
    (await tx`SELECT public.training_schedule_snapshot()->>'revision' AS revision`)[0]!.revision as string);
  const commit = async (operation: string, args: unknown, options: { user?: string; accept?: boolean; revision?: string; requestId?: string } = {}) => {
    const user = options.user ?? owner, revision = options.revision ?? await snapshot(user);
    return asUser(user, async (tx) => (await tx`SELECT public.independent_program_schedule_commit(
      ${operation},${JSON.stringify(args)}::jsonb,${revision},${options.requestId ?? randomUUID()}::uuid,
      ${createHash("sha256").update(JSON.stringify(args)).digest("hex")},${options.accept ?? false}) AS value`)[0]!.value);
  };
  try {
    await database`INSERT INTO auth.users(id) VALUES(${owner}),(${foreign})`;
    const [calendar] = await database<{ today: string; weekday: number }[]>`SELECT to_char(current_date,'YYYY-MM-DD') AS today,
      extract(isodow FROM current_date)::int-1 AS weekday`;
    const [movement] = await database`SELECT id FROM public.movements WHERE user_id IS NULL AND pattern<>'cardio' ORDER BY id LIMIT 1`;
    assert.ok(calendar && movement);
    const args = independentProgramFixture("strength", calendar, [{ movementId: movement.id, kind: "main", sets: 1, reps: 5 }]);
    const created = await commit("primary-create", args);
    const id = created.block_id as string;
    const retained = JSON.stringify(await database`SELECT * FROM public.planned_sessions WHERE block_id=${id}::uuid ORDER BY id`);
    await commit("primary-end", { id });
    stage("0162-owner-only-deleted-empty-and-same-slot-refusals");
    await assertOwnershipRefusal(() => commit("primary-resume", { id }, { user: foreign }), "22023");
    await assertOwnershipRefusal(() => asUser(null, (tx) => tx`SELECT public.training_schedule_commit(
      'primary-resume',${JSON.stringify({ id })}::jsonb,'none',${randomUUID()}::uuid,${"a".repeat(64)},false)`), "42501");
    await commit("primary-delete", { id });
    await assertOwnershipRefusal(() => commit("primary-resume", { id }), "22023");
    await commit("primary-restore", { id });
    await asUser(owner, (tx) => tx`UPDATE public.planned_sessions SET skipped_at=now() WHERE block_id=${id}::uuid`);
    await assert.rejects(() => commit("primary-resume", { id }), { message: "This program has no workouts left." });
    await asUser(owner, (tx) => tx`UPDATE public.planned_sessions SET skipped_at=NULL WHERE block_id=${id}::uuid`);
    const conflicting = await commit("primary-create", args);
    await assert.rejects(() => commit("primary-resume", { id }), { message: "End Synthetic strength first." });
    await commit("primary-end", { id: conflicting.block_id });
    const peer = await commit("primary-create", { ...args, p_block: { ...args.p_block, program_kind: "hybrid", program_family: "hybrid" },
      p_program_instance: { ...args.p_program_instance, program_family: "hybrid", instance: { version: 1, activity: "hybrid" } } });
    stage("0162-DC-K4-overlap-rollback-explicit-consent-replay-and-retained-workouts");
    const beforeResume = await snapshot();
    await assertOwnershipRefusal(() => commit("primary-resume", { id }), "22023");
    assert.equal(await snapshot(), beforeResume);
    const requestId = randomUUID();
    const result = await commit("primary-resume", { id }, { accept: true, revision: beforeResume, requestId });
    assert.deepEqual(await commit("primary-resume", { id }, { accept: true, revision: beforeResume, requestId }), result);
    const [block] = await database`SELECT status,archived_at,ended_at FROM public.training_blocks WHERE id=${id}::uuid`;
    assert.deepEqual(block, { status: "active", archived_at: null, ended_at: null });
    assert.equal((await database`SELECT status FROM public.program_instances WHERE block_id=${id}::uuid`)[0]!.status, "active");
    assert.equal(JSON.stringify(await database`SELECT * FROM public.planned_sessions WHERE block_id=${id}::uuid ORDER BY id`), retained);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.engine_override_events
      WHERE user_id=${owner}::uuid AND block_id=${id}::uuid AND event_type='manual_resume'`)[0]!.n, 1);
    await assertOwnershipRefusal(() => revert(), "P0001");
    await commit("primary-end", { id });

    stage("0162-legacy-refuses-any-active-typed-slot-and-resumes-without-reclassification");
    const legacy = randomUUID();
    // Reconstruct a pre-0158 row only in the disposable fixture; restore the exact trigger before any action.
    await database.begin(async (tx) => {
      await tx.unsafe("ALTER TABLE public.training_blocks DISABLE TRIGGER training_blocks_program_identity");
      await tx`INSERT INTO public.training_blocks SELECT (jsonb_populate_record(NULL::public.training_blocks,
        to_jsonb(b)||jsonb_build_object('id',${legacy}::text,'program_kind',NULL))).*
        FROM public.training_blocks b WHERE b.id=${id}::uuid`;
      await tx.unsafe("ALTER TABLE public.training_blocks ENABLE TRIGGER training_blocks_program_identity");
      await tx`INSERT INTO public.planned_sessions SELECT (jsonb_populate_record(NULL::public.planned_sessions,
        to_jsonb(p)||jsonb_build_object('id',gen_random_uuid(),'block_id',${legacy}::text))).*
        FROM public.planned_sessions p WHERE p.block_id=${id}::uuid`;
    });
    await assert.rejects(() => commit("primary-resume", { id: legacy }), { message: "End Synthetic strength first." });
    await commit("primary-end", { id: peer.block_id });
    await commit("primary-resume", { id: legacy });
    assert.equal((await database`SELECT program_kind FROM public.training_blocks WHERE id=${legacy}::uuid`)[0]!.program_kind, null);
    assert.equal(await guards(), originalGuards);
    return ["0162-up-down-up-preserves-function-grants-and-0158-guards", "0162-owner-only-deleted-empty-and-same-slot-refusals",
      "0162-DC-K4-overlap-rollback-explicit-consent-replay-and-retained-workouts",
      "0162-legacy-refuses-any-active-typed-slot-and-resumes-without-reclassification"];
  } finally {
    await database`DELETE FROM auth.users WHERE id IN (${owner},${foreign})`;
  }
}
