import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { movements } from "../src/schema/movements.ts";
import { SEED_MOVEMENTS } from "../seeds/movements.ts";
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

export const OWNERSHIP_SQLSTATES = [
  "42501", "23503", "23505", "23514", "22023", "P0001", "42601", "42702", "42703", "42804",
  "42883", "42P01", "42P07", "42704", "25P02", "55000", "57014", "55P03", "40P01", "40001",
] as const;
const catalogCategories = ["functions", "indexes", "triggers", "constraints", "policies"] as const;
type OwnershipSqlstate = typeof OWNERSHIP_SQLSTATES[number];
type CatalogCategory = typeof catalogCategories[number];
export type OwnershipCatalog = Record<CatalogCategory | "value", string>;
export type OwnershipAssertionDiagnostic =
  | { kind: "catalog"; categories: (CatalogCategory | "aggregate")[] }
  | { kind: "refusal"; expected: OwnershipSqlstate; actual: OwnershipSqlstate | "resolved" | null };

export class IndependentProgramsAssertion extends assert.AssertionError {
  constructor(readonly diagnostic: OwnershipAssertionDiagnostic) {
    super({
      message: diagnostic.kind === "catalog" ? "Ownership catalog was not restored." : "Ownership refusal did not match.",
      stackStartFn: diagnostic.kind === "catalog" ? assertOwnershipCatalog : assertOwnershipRefusal,
    });
  }
}

export function assertOwnershipCatalog(actual: OwnershipCatalog, expected: OwnershipCatalog): void {
  if (actual.value === expected.value) return;
  const categories = catalogCategories.filter((category) => actual[category] !== expected[category]);
  throw new IndependentProgramsAssertion({ kind: "catalog", categories: categories.length ? categories : ["aggregate"] });
}

export async function assertOwnershipRefusal(work: () => Promise<unknown>, expected: OwnershipSqlstate): Promise<void> {
  try { await work(); }
  catch (error) {
    const value: unknown = typeof error === "object" && error !== null
      ? Object.getOwnPropertyDescriptor(error, "code")?.value : null;
    const actual = OWNERSHIP_SQLSTATES.find((code) => code === value) ?? null;
    if (actual === expected) return;
    throw new IndependentProgramsAssertion({ kind: "refusal", expected, actual });
  }
  throw new IndependentProgramsAssertion({ kind: "refusal", expected, actual: "resolved" });
}

export function independentRunningSeed() {
  const seed = SEED_MOVEMENTS.find((movement) => movement.slug === "run-easy-z2");
  assert.ok(seed);
  assert.equal(seed.userId, null);
  assert.equal(seed.pattern, "cardio");
  assert.equal(seed.metadata?.modality, "running");
  return seed;
}

export async function withIndependentRunningFixture(database: postgres.Sql, work: (id: string) => Promise<void>) {
  const seed = independentRunningSeed();
  let insertedId: string | undefined;
  try {
    const existing = await database`SELECT id,pattern,metadata FROM public.movements
      WHERE user_id IS NULL AND slug=${seed.slug}`;
    assert.ok(existing.length <= 1);
    let run = existing[0];
    if (!run) {
      insertedId = randomUUID();
      await drizzle(database).insert(movements).values({ ...seed, id: insertedId });
      [run] = await database`SELECT id,pattern,metadata FROM public.movements WHERE id=${insertedId}::uuid`;
    }
    assert.ok(run);
    assert.equal(run.pattern, seed.pattern);
    assert.equal(run.metadata?.modality, seed.metadata?.modality);
    await work(run.id);
  } finally {
    if (insertedId) await database`DELETE FROM public.movements WHERE id=${insertedId}::uuid AND user_id IS NULL`;
  }
}

export function independentRehabOwnershipProbes(
  owned: { planId: string; protocolId: string }, foreign: { planId: string; protocolId: string },
) {
  return [
    { planId: foreign.planId, protocolId: owned.protocolId },
    { planId: owned.planId, protocolId: foreign.protocolId },
  ];
}

export function independentProgramFixture(
  kind: Kind, calendar: { today: string; weekday: number }, items: unknown[], programId = "authored",
) {
  const days = programId === "authored" ? [calendar.weekday] : [calendar.weekday, (calendar.weekday + 1) % 7];
  return {
    p_block: { program_kind: kind, program_id: programId, program_family: kind, started_on: calendar.today, weeks: 1,
      days_per_week: days.length, day_index_overrides: { days }, cardio_source: "internal",
      allows_two_a_days: false, accessory_volume: "medium", notes: `Synthetic ${kind}` },
    p_program_instance: { program_id: programId, program_family: kind, display_name: `Synthetic ${kind}`,
      customization_version: 1, instance: { version: 1, activity: kind }, setup_input: {} },
    p_planned_sessions: days.map((day_index) => ({ week_index: 0, day_index, slot: "single", title: `Synthetic ${kind}`,
      role: kind === "running" ? "cardio" : "strength", session_modality: kind === "running" ? "cardio" : "strength",
      effective_stress_load: 1, prescription: { items } })),
    p_tm_percents: [], p_rehab_bindings: [],
  };
}

export async function eraseIndependentAccountAsAuthAdmin(database: postgres.Sql, userId: string) {
  return database.begin(async (tx) => {
    assert.deepEqual(Array.from(await tx`SELECT current_user AS actor,session_user AS session_actor`),
      [{ actor: "postgres", session_actor: "postgres" }]);
    assert.equal((await tx`SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='auth.users'::regclass`)[0]!.owner, "postgres");
    // The SQL-only fixture lacks GoTrue. Recreate its restricted Auth-table owner,
    // never grant it application-table access, and roll back the role on failure.
    await tx.unsafe("CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT NOBYPASSRLS");
    await tx.unsafe("GRANT USAGE ON SCHEMA auth TO supabase_auth_admin");
    await tx.unsafe("ALTER TABLE auth.users OWNER TO supabase_auth_admin");
    await tx.unsafe("SET LOCAL SESSION AUTHORIZATION supabase_auth_admin");
    assert.deepEqual(Array.from(await tx`SELECT current_user AS actor,session_user AS session_actor,
      auth.uid() AS request_user,has_table_privilege(current_user,'public.training_blocks','SELECT') AS public_access`),
    [{ actor: "supabase_auth_admin", session_actor: "supabase_auth_admin", request_user: null, public_access: false }]);
    const deleted = await tx`DELETE FROM auth.users WHERE id=${userId}::uuid RETURNING id`;
    assert.deepEqual(Array.from(deleted), [{ id: userId }]);
    await tx.unsafe("SET CONSTRAINTS ALL IMMEDIATE");
    await tx.unsafe("RESET SESSION AUTHORIZATION");
    await tx.unsafe("ALTER TABLE auth.users OWNER TO postgres");
    await tx.unsafe("REVOKE USAGE ON SCHEMA auth FROM supabase_auth_admin");
    await tx.unsafe("DROP ROLE supabase_auth_admin");
  });
}

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
  const catalog = async () => (await database<OwnershipCatalog[]>`SELECT md5(value::text) AS value,
    md5((value->0)::text) AS functions,md5((value->1)::text) AS indexes,
    md5((value->2)::text) AS triggers,md5((value->3)::text) AS constraints,md5((value->4)::text) AS policies
    FROM (SELECT jsonb_build_array(
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
    ) AS value) snapshot`)[0]!;
  const baseline = await catalog();
  const revert = async () => {
    const connection = await database.reserve();
    try { await connection.unsafe(down); }
    catch (error) { await connection.unsafe("ROLLBACK"); throw error; }
    finally { connection.release(); }
  };
  const denied = assertOwnershipRefusal;
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
  const installedCatalog = await catalog();
  for (const table of ["training_seasons", "season_blocks"]) {
    await database.unsafe(`ALTER TABLE public.${table} DISABLE TRIGGER ${table}_schedule_lock`);
    await denied(revert, "P0001");
    await database.unsafe(`ALTER TABLE public.${table} ENABLE TRIGGER ${table}_schedule_lock`);
    assertOwnershipCatalog(await catalog(), installedCatalog);
  }
  stage("ownership-changed-routine-refuses-unused-down");
  const readyDefinition = String((await database`SELECT pg_get_functiondef('public.independent_programs_ready()'::regprocedure) AS body`)[0]!.body);
  const changedDefinition = readyDefinition.replace("SELECT true", "SELECT false");
  assert.notEqual(changedDefinition, readyDefinition);
  await database.unsafe(changedDefinition);
  await denied(revert, "P0001");
  assert.equal((await database`SELECT public.independent_programs_ready() AS value`)[0]!.value, false);
  await database.unsafe(readyDefinition);
  await database.unsafe("ALTER FUNCTION public.check_program_parent_consistency() SECURITY INVOKER");
  await denied(revert, "P0001");
  await database.unsafe("ALTER FUNCTION public.check_program_parent_consistency() SECURITY DEFINER");
  await database.unsafe("GRANT EXECUTE ON FUNCTION public.check_program_parent_consistency() TO authenticated");
  await denied(revert, "P0001");
  await database.unsafe("REVOKE ALL ON FUNCTION public.check_program_parent_consistency() FROM authenticated");
  assertOwnershipCatalog(await catalog(), installedCatalog);
  stages.push("ownership-changed-routine-refuses-unused-down");
  stage("ownership-unused-down-up-and-catalog-restoration");
  await revert();
  assertOwnershipCatalog(await catalog(), baseline);
  stages.push("ownership-unused-down-up-and-catalog-restoration");

  const users: string[] = [];
  let operationsCompleted = false;
  const user = async () => {
    const id = randomUUID(); await database`INSERT INTO auth.users(id) VALUES (${id})`; users.push(id); return id;
  };
  stage("ownership-catalog-fixture");
  await withIndependentRunningFixture(database, async (runningId) => {
  try {
  const legacyUser = await user(), a = await user(), b = await user();
  const [calendar] = await database<{ today: string; weekday: number }[]>`SELECT to_char(current_date,'YYYY-MM-DD') AS today,
    extract(isodow FROM current_date)::int-1 AS weekday`;
  assert.ok(calendar);
  const [lift] = await database`SELECT id FROM public.movements WHERE user_id IS NULL AND pattern<>'cardio' ORDER BY id LIMIT 1`;
  assert.ok(lift);
  const liftItem = { kind: "main", movementId: lift.id, sets: 1, reps: 5, targetWeightKg: 10 };
  const runItem = { kind: "cardio_z2", movementId: runningId, durationMin: 20, meta: { modality: "run" } };
  const args = (kind: Kind, items: unknown[] = kind === "running" ? [runItem] : [liftItem], programId = "authored") =>
    independentProgramFixture(kind, calendar, items, programId);
  const legacyArgs = args("strength");
  const legacy = await asUser(legacyUser, async (tx) => (await tx<Created[]>`SELECT * FROM public.deploy_program_instance_atomically(
    ${json(legacyArgs.p_block)}::text::jsonb,${json(legacyArgs.p_planned_sessions)}::text::jsonb,'[]'::jsonb,
    ${json(legacyArgs.p_program_instance)}::text::jsonb)`)[0]!);
  const legacyBefore = await database`SELECT to_jsonb(b) AS row FROM public.training_blocks b WHERE id=${legacy.block_id}::uuid`;
  const legacyCompletedUser = await user();
  const legacyCompleted = await asUser(legacyCompletedUser, async (tx) => (await tx<Created[]>`SELECT * FROM public.deploy_program_instance_atomically(
    ${json(legacyArgs.p_block)}::text::jsonb,${json(legacyArgs.p_planned_sessions)}::text::jsonb,'[]'::jsonb,
    ${json(legacyArgs.p_program_instance)}::text::jsonb)`)[0]!);
  const legacyCompletedSession = await asUser(legacyCompletedUser, async (tx) => {
    const [planned] = await tx`SELECT id FROM public.planned_sessions WHERE block_id=${legacyCompleted.block_id}::uuid`;
    const [started] = await tx`SELECT public.start_planned_session_atomically(${planned!.id}::uuid) AS id`;
    await tx`UPDATE public.sessions SET completed_at=now() WHERE id=${started!.id}::uuid`;
    return started!.id;
  });
  await database.begin((tx) => tx.unsafe(up));
    stage("ownership-no-backfill-legacy-and-old-writer-refusal");
    const legacyAfter = await database`SELECT to_jsonb(b)-'program_kind' AS row FROM public.training_blocks b WHERE id=${legacy.block_id}::uuid`;
    assert.deepEqual(Array.from(legacyAfter), Array.from(legacyBefore));
    await denied(() => commit(legacyUser, "primary-create", args("running"), true), "23514");
    await denied(() => asUser(a, (tx) => tx`SELECT * FROM public.deploy_program_instance_atomically('{}','[]','[]','{}')`), "55000");
    await commit(legacyUser, "primary-end", { id: legacy.block_id });
    await commit(legacyUser, "primary-create", args("running"), true);
    assert.equal((await asUser(legacyCompletedUser, (tx) => tx`SELECT public.complete_program_if_settled(
      ${legacyCompleted.block_id}::uuid) AS done`))[0]!.done, true);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.engine_override_events
      WHERE user_id=${legacyCompletedUser}::uuid AND context->>'kind'='program-progression-v1'
        AND context->>'sessionId'=${legacyCompletedSession}`)[0]!.n, 0);
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

    const queuedOwner = await user();
    const queuedArgs = args("strength");
    queuedArgs.p_block.allows_two_a_days = true;
    queuedArgs.p_planned_sessions = ["am", "pm"].map((slot) => ({ ...queuedArgs.p_planned_sessions[0]!, slot }));
    const queued = await commit<Created>(queuedOwner, "primary-create", queuedArgs, true);
    const independentRun = await commit<Created>(queuedOwner, "primary-create", args("running"), true);
    const completedIds = await asUser(queuedOwner, async (tx) => {
      const planned = await tx`SELECT id FROM public.planned_sessions WHERE block_id=${queued.block_id}::uuid ORDER BY slot`;
      const ids: string[] = [];
      for (const row of planned) {
        const [started] = await tx`SELECT public.start_planned_session_atomically(${row.id}::uuid) AS id`;
        await tx`UPDATE public.sessions SET completed_at=now() WHERE id=${started!.id}::uuid`;
        ids.push(started!.id);
      }
      return ids;
    });
    assert.equal(completedIds.length, 2);
    const settleQueued = () => asUser(queuedOwner, async (tx) =>
      (await tx`SELECT public.complete_program_if_settled(${queued.block_id}::uuid) AS done`)[0]!.done);
    const progressQueued = (sessionId: string, expected: unknown, next: unknown) => asUser(queuedOwner, async (tx) =>
      (await tx`SELECT public.commit_program_progression(${queued.block_id}::uuid,${queued.program_instance_id}::uuid,
        ${sessionId}::uuid,${json(expected)}::text::jsonb,${json(next)}::text::jsonb,'[]') AS value`)[0]!.value);
    assert.equal(await settleQueued(), false);
    const once = { ...originalInstance, logged: 1 }, twice = { ...originalInstance, logged: 2 };
    assert.equal(await progressQueued(completedIds[0]!, originalInstance, once), "applied");
    assert.equal(await settleQueued(), false);
    assert.equal((await database`SELECT status FROM public.program_instances WHERE id=${queued.program_instance_id}::uuid`)[0]!.status, "active");
    assert.equal(await progressQueued(completedIds[1]!, once, twice), "applied");
    assert.equal(await progressQueued(completedIds[1]!, once, twice), "replayed");
    assert.equal(await settleQueued(), true);
    assert.equal(await settleQueued(), false);
    assert.deepEqual((await database`SELECT instance FROM public.program_instances WHERE id=${queued.program_instance_id}::uuid`)[0]!.instance, twice);
    const pending = await commit<Created>(queuedOwner, "primary-create", args("strength"), true);
    const pendingSession = await asUser(queuedOwner, async (tx) => {
      const [planned] = await tx`SELECT id FROM public.planned_sessions WHERE block_id=${pending.block_id}::uuid`;
      const [started] = await tx`SELECT public.start_planned_session_atomically(${planned!.id}::uuid) AS id`;
      await tx`UPDATE public.sessions SET completed_at=now() WHERE id=${started!.id}::uuid`;
      assert.equal((await tx`SELECT public.complete_program_if_settled(${pending.block_id}::uuid) AS done`)[0]!.done, false);
      return started!.id;
    });
    await asUser(queuedOwner, (tx) => tx`INSERT INTO public.engine_override_events(id,user_id,event_type,context)
      VALUES(md5('program-progression:'||${queuedOwner}::text||':'||${pending.program_instance_id}::text||':'||${pendingSession}::text)::uuid,
        ${queuedOwner}::uuid,'custom',${json({ kind: "program-progression-v1", blockId: pending.block_id,
          instanceId: randomUUID(), sessionId: pendingSession })}::text::jsonb)`);
    assert.equal((await asUser(queuedOwner, (tx) => tx`SELECT public.complete_program_if_settled(${pending.block_id}::uuid) AS done`))[0]!.done, false);
    await denied(() => asUser(queuedOwner, (tx) => tx`SELECT public.commit_program_progression(
      ${pending.block_id}::uuid,${pending.program_instance_id}::uuid,${pendingSession}::uuid,
      ${json(originalInstance)}::text::jsonb,${json(originalInstance)}::text::jsonb,'[]')`), "22023");
    await commit(queuedOwner, "primary-end", { id: pending.block_id });
    const afterPending = await commit<Created>(queuedOwner, "primary-create", args("strength"), true);
    assert.equal((await database`SELECT status FROM public.training_blocks WHERE id=${pending.block_id}::uuid`)[0]!.status, "archived");
    assert.equal((await database`SELECT status FROM public.training_blocks WHERE id=${independentRun.block_id}::uuid`)[0]!.status, "active");
    assert.deepEqual((await database`SELECT instance FROM public.program_instances WHERE id=${afterPending.program_instance_id}::uuid`)[0]!.instance, originalInstance);

    const adviceOwner = await user();
    const adviceProgram = await commit<Created>(adviceOwner, "primary-create", args("hybrid"));
    const adviceRun = await commit<Created>(adviceOwner, "primary-create", args("running"), true);
    const adviceSwim = await commit<Swim>(adviceOwner, "swim-create", swimArgs, true);
    await asUser(adviceOwner, async (tx) => {
      const [planned] = await tx`SELECT id FROM public.planned_sessions WHERE block_id=${adviceProgram.block_id}::uuid`;
      const [started] = await tx`SELECT public.start_planned_session_atomically(${planned!.id}::uuid) AS id`;
      await tx`UPDATE public.sessions SET completed_at=now() WHERE id=${started!.id}::uuid`;
      const recommendations = [
        { kind: "next-block", occurrenceKey: "final", title: "Next phase", detail: "Review the next phase.",
          data: { programId: "authored", nextPhaseId: "synthetic-next-phase" } },
        ...["final", "earlier"].map((occurrenceKey) => ({
          kind: "deload", occurrenceKey, title: "Recovery week", detail: "Review a recovery week.", data: null,
        })),
      ];
      assert.equal((await tx`SELECT public.commit_program_progression(${adviceProgram.block_id}::uuid,
        ${adviceProgram.program_instance_id}::uuid,${started!.id}::uuid,${json(args("hybrid").p_program_instance.instance)}::text::jsonb,
        ${json(args("hybrid").p_program_instance.instance)}::text::jsonb,${json(recommendations)}::text::jsonb) AS result`)[0]!.result, "applied");
      assert.equal((await tx`SELECT public.complete_program_if_settled(${adviceProgram.block_id}::uuid) AS done`)[0]!.done, true);
    });
    const adviceRows = () => asUser(adviceOwner, (tx) => tx`SELECT to_jsonb(r) AS value FROM public.program_recommendations r
      WHERE user_id=${adviceOwner}::uuid AND block_id=${adviceProgram.block_id}::uuid ORDER BY kind,occurrence_key`);
    const pendingAdvice = await adviceRows();
    assert.equal(pendingAdvice.length, 3);
    assert.ok(pendingAdvice.every((row) => row.value.status === "pending"));
    const nextAdvice = pendingAdvice.find((row) => row.value.kind === "next-block")!.value;
    const recoveryAdvice = pendingAdvice.find((row) => row.value.kind === "deload" && row.value.occurrence_key === "final")!.value;
    const adviceSnapshot = (row: Record<string, unknown>) => ({
      id: row.id, block_id: row.block_id, program_instance_id: row.program_instance_id,
      kind: row.kind, data: row.data, occurrence_key: row.occurrence_key, program_kind: "hybrid",
    });
    const continuation = { ...args("hybrid"), p_recommendation: adviceSnapshot(nextAdvice),
      p_program_instance: { ...args("hybrid").p_program_instance, setup_input: { values: { phaseId: "synthetic-next-phase" } } } };
    const abandonedReview = await snapshot(adviceOwner);
    assert.deepEqual(Array.from(await adviceRows()), Array.from(pendingAdvice));
    await denied(() => commit(b, "primary-create", continuation, true), "40001");
    await denied(() => commit(adviceOwner, "primary-create", { ...continuation,
      p_recommendation: { ...continuation.p_recommendation, occurrence_key: "changed" } }, true), "40001");
    await denied(() => commit(adviceOwner, "primary-create", { ...continuation,
      p_program_instance: { ...continuation.p_program_instance, setup_input: { values: { phaseId: "another-phase" } } } }, true), "22023");
    await denied(() => commit(adviceOwner, "primary-create", { ...args("strength"),
      p_recommendation: continuation.p_recommendation }, true), "22023");
    const failedRequest = randomUUID();
    await denied(() => commit(adviceOwner, "primary-create", continuation, false, abandonedReview.revision, failedRequest), "22023");
    assert.equal((await snapshot(adviceOwner)).revision, abandonedReview.revision);
    assert.deepEqual(Array.from(await adviceRows()), Array.from(pendingAdvice));
    assert.equal((await asUser(adviceOwner, (tx) => tx`SELECT count(*)::int AS n FROM public.engine_override_events
      WHERE id=${failedRequest}::uuid`))[0]!.n, 0);
    const nextRequest = randomUUID();
    const continued = await commit<Created>(adviceOwner, "primary-create", continuation, true, abandonedReview.revision, nextRequest);
    const acceptedAdvice = await adviceRows();
    assert.equal(acceptedAdvice.find((row) => row.value.id === nextAdvice.id)!.value.status, "accepted");
    assert.equal(acceptedAdvice.filter((row) => row.value.status === "pending").length, 2);
    assert.deepEqual(await commit(adviceOwner, "primary-create", continuation, true, abandonedReview.revision, nextRequest), continued);
    assert.deepEqual(Array.from(await adviceRows()), Array.from(acceptedAdvice));
    await denied(() => commit(adviceOwner, "primary-create", { ...continuation,
      p_recommendation: adviceSnapshot(recoveryAdvice) }, true, abandonedReview.revision, nextRequest, continuation), "22023");
    await denied(() => commit(adviceOwner, "primary-create", { ...continuation, p_replace_block_id: continued.block_id }, true), "40001");
    const decliningRecovery = { ...args("hybrid"), p_recommendation: adviceSnapshot(recoveryAdvice),
      p_accept_recovery: false, p_replace_block_id: continued.block_id };
    const declinedRequest = randomUUID();
    const declined = await commit<Created>(adviceOwner, "primary-create", decliningRecovery, true, undefined, declinedRequest);
    assert.equal((await adviceRows()).find((row) => row.value.id === recoveryAdvice.id)!.value.status, "pending");
    assert.equal((await asUser(adviceOwner, (tx) => tx`SELECT context->>'recommendationAccepted' AS accepted
      FROM public.engine_override_events WHERE id=${declinedRequest}::uuid`))[0]!.accepted, "false");
    await denied(() => commit(adviceOwner, "primary-create", { ...decliningRecovery,
      p_replace_block_id: declined.block_id, p_accept_recovery: true }, true), "22023");
    const recoveryArgs = { ...decliningRecovery, p_replace_block_id: declined.block_id, p_accept_recovery: true,
      p_block: { ...args("hybrid").p_block, weeks: 2 },
      p_planned_sessions: [
        { ...args("hybrid").p_planned_sessions[0]!, role: "deload", prescription: { items: [liftItem], insertedRecoveryWeek: true } },
        { ...args("hybrid").p_planned_sessions[0]!, week_index: 1 },
      ] };
    const recoveryRevision = (await snapshot(adviceOwner)).revision, recoveryRequest = randomUUID();
    const recovered = await commit<Created>(adviceOwner, "primary-create", recoveryArgs, true, recoveryRevision, recoveryRequest);
    assert.deepEqual(await commit(adviceOwner, "primary-create", recoveryArgs, true, recoveryRevision, recoveryRequest), recovered);
    const finalAdvice = await adviceRows();
    assert.equal(finalAdvice.find((row) => row.value.id === recoveryAdvice.id)!.value.status, "accepted");
    assert.equal(finalAdvice.find((row) => row.value.occurrence_key === "earlier")!.value.status, "pending");
    assert.equal((await asUser(adviceOwner, (tx) => tx`SELECT status FROM public.training_blocks WHERE id=${adviceRun.block_id}::uuid`))[0]!.status, "active");
    assert.equal((await asUser(adviceOwner, (tx) => tx`SELECT status FROM public.swim_plans WHERE id=${adviceSwim.plan.id}::uuid`))[0]!.status, "active");

    const seasonOwner = await user();
    const seasonStrength = await commit<Created>(seasonOwner, "primary-create", args("strength"));
    const seasonRun = await commit<Created>(seasonOwner, "primary-create", args("running"), true);
    const seasonSwim = await commit<Swim>(seasonOwner, "swim-create", swimArgs, true);
    const seasonId = randomUUID(), previousSlot = randomUUID(), nextSlot = randomUUID(), lastSlot = randomUUID();
    await asUser(seasonOwner, async (tx) => {
      await tx`INSERT INTO public.training_seasons(id,user_id,name,status,goal_type)
        VALUES(${seasonId}::uuid,${seasonOwner}::uuid,'Synthetic roadmap','active','theme')`;
      await tx`INSERT INTO public.season_blocks(id,season_id,user_id,position,program_id,template_ref,emphasis,status,block_id)
        VALUES(${previousSlot}::uuid,${seasonId}::uuid,${seasonOwner}::uuid,0,'authored',NULL,'base','active',${seasonStrength.block_id}::uuid),
          (${nextSlot}::uuid,${seasonId}::uuid,${seasonOwner}::uuid,1,'hybrid',NULL,'strength_bias','planned',NULL),
          (${lastSlot}::uuid,${seasonId}::uuid,${seasonOwner}::uuid,2,'green-protocol','velocity','base','planned',NULL)`;
    });
    const seasonRows = () => asUser(seasonOwner, (tx) => tx`SELECT to_jsonb(s) AS value FROM public.season_blocks s
      WHERE season_id=${seasonId}::uuid AND user_id=${seasonOwner}::uuid ORDER BY position`);
    const seasonOrigin = async (id = nextSlot) => ({
      id, season: (await asUser(seasonOwner, (tx) => tx`SELECT id,goal_type,
        to_char(target_date,'YYYY-MM-DD') AS target_date,target_event_id FROM public.training_seasons WHERE id=${seasonId}::uuid`))[0]!,
      blocks: (await seasonRows()).map(({ value: s }) => ({ id: s.id, position: s.position, program_id: s.program_id,
        template_ref: s.template_ref, emphasis: s.emphasis, intent_note: s.intent_note,
        planned_weeks: s.planned_weeks, status: s.status, block_id: s.block_id })),
    });
    const plannedSeason = await seasonRows();
    const hybridBase = args("hybrid", [liftItem], "hybrid");
    const hybridSetup = { ...hybridBase,
      p_program_instance: { ...hybridBase.p_program_instance,
        setup_input: { values: { seasonBias: "strength" } } }, p_season_origin: await seasonOrigin() };
    await denied(() => commit(seasonOwner, "primary-create", hybridSetup, true), "22023");
    await denied(() => commit(b, "primary-create", hybridSetup, true), "40001");
    assert.deepEqual(Array.from(await seasonRows()), Array.from(plannedSeason));
    // An unrelated start does not advance the roadmap or touch its predecessor.
    const separate = await commit<Created>(seasonOwner, "primary-create", args("hybrid"), true);
    assert.deepEqual(Array.from(await seasonRows()), Array.from(plannedSeason));
    assert.equal((await asUser(seasonOwner, (tx) => tx`SELECT status FROM public.training_blocks
      WHERE id=${seasonStrength.block_id}::uuid`))[0]!.status, "active");
    await commit(seasonOwner, "primary-end", { id: separate.block_id });
    await commit(seasonOwner, "primary-end", { id: seasonStrength.block_id });
    const seasonRevision = (await snapshot(seasonOwner)).revision;
    await asUser(seasonOwner, (tx) => tx`UPDATE public.training_seasons SET target_date='2027-02-01' WHERE id=${seasonId}::uuid`);
    await denied(() => commit(seasonOwner, "primary-create", hybridSetup, true, seasonRevision), "40001");
    hybridSetup.p_season_origin = await seasonOrigin();
    await asUser(seasonOwner, (tx) => tx`UPDATE public.season_blocks SET intent_note='Changed' WHERE id=${nextSlot}::uuid`);
    await denied(() => commit(seasonOwner, "primary-create", hybridSetup, true), "40001");
    hybridSetup.p_season_origin = await seasonOrigin();
    await denied(() => commit(seasonOwner, "primary-create", { ...hybridSetup,
      p_program_instance: { ...hybridSetup.p_program_instance, setup_input: { values: { seasonBias: "endurance" } } } }, true), "40001");
    await denied(() => commit(seasonOwner, "primary-create", { ...hybridSetup,
      p_block: { ...hybridSetup.p_block, program_id: "another-program" } }, true), "22023");
    await denied(async () => commit(seasonOwner, "primary-create", { ...hybridSetup,
      p_season_origin: await seasonOrigin(lastSlot) }, true), "40001");
    const seasonBeforeFailure = await seasonRows(), failedSeasonRequest = randomUUID();
    await denied(() => commit(seasonOwner, "primary-create", hybridSetup, false, undefined, failedSeasonRequest), "22023");
    assert.deepEqual(Array.from(await seasonRows()), Array.from(seasonBeforeFailure));
    assert.equal((await asUser(seasonOwner, (tx) => tx`SELECT count(*)::int AS n FROM public.engine_override_events
      WHERE id=${failedSeasonRequest}::uuid`))[0]!.n, 0);
    const linkedRevision = (await snapshot(seasonOwner)).revision, seasonRequest = randomUUID();
    const linked = await commit<Created>(seasonOwner, "primary-create", hybridSetup, true, linkedRevision, seasonRequest);
    const linkedRows = await seasonRows();
    assert.equal(linkedRows[0]!.value.status, "done");
    assert.equal(linkedRows[0]!.value.block_id, seasonStrength.block_id);
    assert.equal(linkedRows[1]!.value.status, "active");
    assert.equal(linkedRows[1]!.value.block_id, linked.block_id);
    assert.equal(linkedRows[2]!.value.status, "planned");
    assert.deepEqual(await commit(seasonOwner, "primary-create", hybridSetup, true, linkedRevision, seasonRequest), linked);
    assert.deepEqual(Array.from(await seasonRows()), Array.from(linkedRows));
    await denied(async () => commit(seasonOwner, "primary-create", { ...hybridSetup, p_season_origin: await seasonOrigin(lastSlot) },
      true, linkedRevision, seasonRequest, hybridSetup), "22023");
    await denied(() => commit(seasonOwner, "primary-create", { ...hybridSetup, p_replace_block_id: linked.block_id }, true), "40001");
    const phaseBase = args("hybrid", [liftItem], "green-protocol");
    const phase = { ...phaseBase, p_replace_block_id: linked.block_id, p_season_origin: await seasonOrigin(lastSlot),
      p_program_instance: { ...phaseBase.p_program_instance,
        setup_input: { values: { phaseId: "velocity" } } } };
    await denied(() => commit(seasonOwner, "primary-create", { ...phase,
      p_program_instance: { ...phase.p_program_instance, setup_input: { values: { templateId: "velocity" } } } }, true), "22023");
    const finalSeasonProgram = await commit<Created>(seasonOwner, "primary-create", phase, true);
    const finalSeasonRows = await seasonRows();
    assert.equal(finalSeasonRows[1]!.value.status, "done");
    assert.equal(finalSeasonRows[2]!.value.block_id, finalSeasonProgram.block_id);
    assert.equal((await asUser(seasonOwner, (tx) => tx`SELECT status FROM public.training_blocks
      WHERE id=${linked.block_id}::uuid`))[0]!.status, "archived");
    assert.equal((await asUser(seasonOwner, (tx) => tx`SELECT status FROM public.training_blocks
      WHERE id=${seasonRun.block_id}::uuid`))[0]!.status, "active");
    assert.equal((await asUser(seasonOwner, (tx) => tx`SELECT status FROM public.swim_plans
      WHERE id=${seasonSwim.plan.id}::uuid`))[0]!.status, "active");
    assert.equal((await asUser(b, (tx) => tx`SELECT count(*)::int AS n FROM public.season_blocks
      WHERE season_id=${seasonId}::uuid`))[0]!.n, 0);
    stages.push("ownership-independent-end-trash-restore-completion-and-late-progress");

    stage("ownership-swim-rehab-owned-attachment-issued-dose-replay-and-restore");
    const protocolId = randomUUID();
    await asUser(a, (tx) => tx`INSERT INTO public.rehab_protocols(id,user_id,name,definition)
      VALUES(${protocolId}::uuid,${a}::uuid,'Shared protocol',${json({ items: [{ movementId: lift.id, movementName: "Fixture exercise", sets: 1, reps: 8, targetWeightKg: 2 }], links: [] })}::text::jsonb)`);
    const attach = async (owner: string, ids: string[], revision?: string, request = randomUUID()) => {
      const expected = revision ?? (await snapshot(owner)).revision;
      return asUser(owner, (tx) => tx`SELECT public.set_swim_rehab_bindings(${swim.plan.id}::uuid,${ids}::uuid[],${expected},${request}::uuid)`);
    };
    const attachmentRevision = (await snapshot(a)).revision, attachmentRequest = randomUUID();
    await attach(a, [protocolId], attachmentRevision, attachmentRequest);
    await attach(a, [protocolId], attachmentRevision, attachmentRequest);
    assert.equal((await asUser(b, (tx) => tx`SELECT * FROM public.swim_plan_rehab_bindings`)).length, 0);
    const otherSwim = await commit<Swim>(b, "swim-create", swimArgs), otherProtocolId = randomUUID();
    await asUser(b, (tx) => tx`INSERT INTO public.rehab_protocols(id,user_id,name,definition)
      VALUES(${otherProtocolId}::uuid,${b}::uuid,'Other protocol',
        ${json({ items: [{ movementId: lift.id, movementName: "Fixture exercise", sets: 1, reps: 8 }], links: [] })}::text::jsonb)`);
    const originalBindings = await asUser(a, (tx) => tx`SELECT to_jsonb(r) AS row FROM public.swim_plan_rehab_bindings r`);
    for (const probe of independentRehabOwnershipProbes(
      { planId: otherSwim.plan.id, protocolId: otherProtocolId }, { planId: swim.plan.id, protocolId },
    )) {
      await denied(() => asUser(b, (tx) => tx`INSERT INTO public.swim_plan_rehab_bindings(plan_id,local_protocol_id,rehab_protocol_id,user_id)
        VALUES(${probe.planId}::uuid,${randomUUID()},${probe.protocolId}::uuid,${b}::uuid)`), "23503");
    }
    assert.equal((await asUser(b, (tx) => tx`SELECT * FROM public.swim_plan_rehab_bindings`)).length, 0);
    assert.deepEqual(Array.from(await asUser(a, (tx) => tx`SELECT to_jsonb(r) AS row FROM public.swim_plan_rehab_bindings r`)),
      Array.from(originalBindings));
    await denied(() => asUser(a, (tx) => tx`DELETE FROM public.rehab_protocols WHERE id=${protocolId}::uuid`), "23503");
    const workout = swim.workouts[0]!;
    const beforeSwim = await database`SELECT to_jsonb(w) AS row FROM public.swim_workouts w WHERE id=${workout.id}::uuid`;
    const prescription = { items: [{ kind: "tendon", movementId: lift.id, movementName: "Fixture exercise", sets: 1, reps: 8, targetWeightKg: 2,
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
    const rehabSet = { session_id: rehabSession, movement_id: lift.id, set_kind: "tendon", weight_kg: 2, reps: 8,
      prescription_item_index: 0, client_log_id: randomUUID(), target_weight_kg: 2, target_reps: 8 };
    const logRehab = () => asUser(a, (tx) => tx`SELECT * FROM public.insert_set_log_with_bw_progress(${json(rehabSet)}::text::jsonb)`);
    const loggedRehab = (await logRehab())[0]!;
    assert.equal(loggedRehab.inserted, true);
    assert.deepEqual(Array.from(await logRehab()), [{ id: loggedRehab.id, inserted: false }]);
    const readRehabSets = () => asUser(a, (tx) => tx`SELECT weight_kg::float8 AS kg,target_weight_kg::float8 AS target,reps,target_reps
      FROM public.set_logs WHERE session_id=${rehabSession}::uuid ORDER BY id`);
    assert.deepEqual(Array.from(await readRehabSets()), [{ kg: 2, target: 2, reps: 8, target_reps: 8 }]);
    assert.equal((await asUser(b, (tx) => tx`SELECT id FROM public.set_logs WHERE session_id=${rehabSession}::uuid`)).length, 0);
    assert.deepEqual(Array.from(await database`SELECT to_jsonb(w) AS row FROM public.swim_workouts w WHERE id=${workout.id}::uuid`), Array.from(beforeSwim));
    assert.equal((await database`SELECT count(*)::int AS n FROM public.cardio_logs WHERE session_id=${rehabSession}::uuid`)[0]!.n, 0);
    await asUser(a, (tx) => tx`UPDATE public.sessions SET deleted_at=now() WHERE id=${rehabSession}::uuid`);
    await denied(() => start(), "22023");
    await asUser(a, (tx) => tx`UPDATE public.sessions SET deleted_at=NULL WHERE id=${rehabSession}::uuid`);
    assert.equal(await start(), rehabSession);
    await attach(a, []);
    assert.equal(await start(), rehabSession);
    assert.deepEqual(Array.from(await readRehabSets()), [{ kg: 2, target: 2, reps: 8, target_reps: 8 }]);
    assert.deepEqual((await asUser(a, (tx) => tx`SELECT prescription FROM public.sessions WHERE id=${rehabSession}::uuid`))[0]!.prescription,
      prescription);
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
    // Prove necessity against the old security mode before expanding the graph.
    await database.unsafe("ALTER FUNCTION public.check_program_parent_consistency() SECURITY INVOKER");
    try { await denied(() => eraseIndependentAccountAsAuthAdmin(database, a), "42501"); }
    finally { await database.unsafe("ALTER FUNCTION public.check_program_parent_consistency() SECURITY DEFINER"); }
    const issuedProtocolId = randomUUID();
    await asUser(a, (tx) => tx`INSERT INTO public.rehab_protocols(id,user_id,name,definition)
      SELECT ${issuedProtocolId}::uuid,user_id,'Issued erasure protocol',definition
      FROM public.rehab_protocols WHERE id=${protocolId}::uuid AND user_id=${a}::uuid`);
    await attach(a, [protocolId, issuedProtocolId]);
    const issuedPrescription = { ...prescription,
      items: prescription.items.map((item) => ({ ...item, meta: { ...item.meta, rehabProtocolId: issuedProtocolId } })),
      meta: { swimRehab: { ...prescription.meta.swimRehab, protocolId: issuedProtocolId } } };
    const issuedRevision = (await snapshot(a)).revision;
    const issuedSession = (await asUser(a, (tx) => tx`SELECT public.start_swim_rehab_session(${workout.id}::uuid,
      ${issuedProtocolId}::uuid,${issuedRevision},${json(issuedPrescription)}::text::jsonb,${randomUUID()}::uuid) AS id`))[0]!.id;
    await asUser(a, (tx) => tx`INSERT INTO public.set_logs(session_id,movement_id,set_index,reps,weight_kg)
      VALUES(${issuedSession}::uuid,${lift.id}::uuid,1,8,2)`);
    assert.deepEqual(Array.from(await asUser(a, (tx) => tx`SELECT DISTINCT b.program_kind AS kind
      FROM public.program_rehab_bindings r JOIN public.program_instances i ON i.id=r.program_instance_id
      JOIN public.training_blocks b ON b.id=i.block_id
      WHERE r.user_id=${a}::uuid AND r.rehab_protocol_id=${protocolId}::uuid ORDER BY kind`)),
    [{ kind: "hybrid" }, { kind: "running" }, { kind: "strength" }]);
    await asUser(a, (tx) => tx`INSERT INTO public.set_logs(session_id,movement_id,set_index,reps,weight_kg)
      VALUES(${session}::uuid,${lift.id}::uuid,1,5,10)`);
    await asUser(a, (tx) => tx`INSERT INTO public.cardio_logs(session_id,movement_id,modality,duration_sec)
      VALUES(${session}::uuid,${runningId}::uuid,'run',60)`);
    const peers = await database`SELECT jsonb_build_array(
      (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.training_blocks b WHERE user_id=${b}::uuid),
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.swim_plans p WHERE user_id=${b}::uuid),
      (SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM public.swim_workouts w WHERE user_id=${b}::uuid),
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.rehab_protocols r WHERE user_id=${b}::uuid)) AS value`;
    const erased = [a, legacyUser, legacyCompletedUser, seasonOwner, adviceOwner];
    const ownedTables = ["training_blocks", "program_instances", "planned_sessions", "sessions", "training_maxes",
      "program_recommendations", "rehab_protocols", "program_rehab_bindings", "swim_plan_rehab_bindings",
      "swim_plans", "swim_workouts", "training_seasons", "season_blocks", "engine_override_events"];
    for (const table of ownedTables) {
      assert.ok((await database`SELECT count(*)::int AS n FROM ${database(table)} WHERE user_id=ANY(${erased}::uuid[])`)[0]!.n > 0,
        `Erasure fixture must populate ${table}`);
    }
    assert.equal((await database`SELECT count(*)::int AS n FROM public.sessions
      WHERE user_id=${a}::uuid AND id=${issuedSession}::uuid AND prescription#>>'{meta,swimRehab,protocolId}'=${issuedProtocolId}`)[0]!.n, 1);
    const sessionIds = (await database`SELECT id FROM public.sessions WHERE user_id=ANY(${erased}::uuid[])`).map((row) => row.id);
    for (const table of ["set_logs", "cardio_logs"]) {
      assert.ok((await database`SELECT count(*)::int AS n FROM ${database(table)} WHERE session_id=ANY(${sessionIds}::uuid[])`)[0]!.n > 0,
        `Erasure fixture must populate ${table}`);
    }
    for (const owner of erased) await eraseIndependentAccountAsAuthAdmin(database, owner);
    for (const table of ownedTables) {
      assert.equal((await database`SELECT count(*)::int AS n FROM ${database(table)} WHERE user_id=ANY(${erased}::uuid[])`)[0]!.n, 0);
    }
    for (const table of ["set_logs", "cardio_logs"]) {
      assert.equal((await database`SELECT count(*)::int AS n FROM ${database(table)} WHERE session_id=ANY(${sessionIds}::uuid[])`)[0]!.n, 0);
    }
    assert.deepEqual(Array.from(await database`SELECT jsonb_build_array(
      (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.training_blocks b WHERE user_id=${b}::uuid),
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.swim_plans p WHERE user_id=${b}::uuid),
      (SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM public.swim_workouts w WHERE user_id=${b}::uuid),
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.rehab_protocols r WHERE user_id=${b}::uuid)) AS value`), Array.from(peers));
    assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_plan_rehab_bindings WHERE user_id=${a}::uuid`)[0]!.n, 0);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.engine_override_events WHERE user_id=${a}::uuid`)[0]!.n, 0);
    stages.push("ownership-account-erasure-with-attached-rehab");

    stage("ownership-start-receipts-alone-refuse-unused-down");
    const receiptOwner = await user(), receiptProtocol = randomUUID();
    const receiptSwim = await commit<Swim>(receiptOwner, "swim-create", swimArgs);
    await asUser(receiptOwner, (tx) => tx`INSERT INTO public.rehab_protocols(id,user_id,name,definition)
      VALUES(${receiptProtocol}::uuid,${receiptOwner}::uuid,'Receipt protocol',
        ${json({ items: [{ movementId: lift.id, movementName: "Fixture exercise", sets: 1, reps: 8, targetWeightKg: 2 }], links: [] })}::text::jsonb)`);
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
    await denied(() => asUser(receiptOwner, (tx) => tx`DELETE FROM public.swim_plans WHERE id=${receiptSwim.plan.id}::uuid`), "42501");
    // Synthetic purge by the fixture controller, not an application-user delete path.
    const purgedPlans = await database`DELETE FROM public.swim_plans
      WHERE id=${receiptSwim.plan.id}::uuid AND user_id=${receiptOwner}::uuid RETURNING id`;
    assert.deepEqual(Array.from(purgedPlans), [{ id: receiptSwim.plan.id }]);
    await asUser(receiptOwner, (tx) => tx`DELETE FROM public.sessions WHERE user_id=${receiptOwner}::uuid`);
    await asUser(receiptOwner, (tx) => tx`DELETE FROM public.rehab_protocols WHERE id=${receiptProtocol}::uuid`);
    await database`DELETE FROM public.engine_override_events WHERE user_id=${receiptOwner}::uuid
      AND context->>'kind' NOT IN ('swim-rehab-start-v1','swim-rehab-request-v1')`;
    // Other fixture accounts must not provide an independent rollback refusal.
    await database`DELETE FROM public.program_rehab_bindings WHERE user_id=ANY(${users.filter((id) => id !== receiptOwner)}::uuid[])`;
    await database`DELETE FROM auth.users WHERE id=ANY(${users.filter((id) => id !== receiptOwner)}::uuid[])`;
    assert.equal((await database`SELECT count(*)::int AS n FROM public.training_blocks WHERE program_kind IS NOT NULL`)[0]!.n, 0);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.program_instances`)[0]!.n, 0);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.planned_sessions`)[0]!.n, 0);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_plans`)[0]!.n, 0);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_workouts`)[0]!.n, 0);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_plan_rehab_bindings`)[0]!.n, 0);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.sessions`)[0]!.n, 0);
    assert.equal((await database`SELECT count(*)::int AS n FROM public.engine_override_events`)[0]!.n, 2);
    assert.deepEqual(Array.from(await database`SELECT context->>'kind' AS kind,count(*)::int AS n
      FROM public.engine_override_events GROUP BY context->>'kind' ORDER BY kind`), [
      { kind: "swim-rehab-request-v1", n: 1 }, { kind: "swim-rehab-start-v1", n: 1 },
    ]);
    await denied(revert, "P0001");
    stages.push("ownership-start-receipts-alone-refuse-unused-down");
    operationsCompleted = true;
  } finally {
    if (operationsCompleted) stage("ownership-synthetic-account-cleanup");
    await database`DELETE FROM public.program_rehab_bindings WHERE user_id=ANY(${users}::uuid[])`;
    if ((await database`SELECT to_regclass('public.swim_plan_rehab_bindings') IS NOT NULL AS present`)[0]!.present) {
      await database`DELETE FROM public.swim_plan_rehab_bindings WHERE user_id=ANY(${users}::uuid[])`;
    }
    await database`DELETE FROM auth.users WHERE id=ANY(${users}::uuid[])`;
  }
  });
  assert.equal((await database`SELECT count(*)::int AS n FROM auth.users`)[0]!.n, 0);
  await revert();
  assertOwnershipCatalog(await catalog(), baseline);
  await database.begin((tx) => tx.unsafe(up));
  stages.push("ownership-account-cleanup-and-exact-unused-restoration");
  return stages;
}
