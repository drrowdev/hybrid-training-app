import postgres from "postgres";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { generateSwimPlan, changeSwimWorkoutPool } from "../../engine/src/swimming.ts";
import { poolCourse, estimateCriticalSwimSpeed, type SwimWorkout } from "../../domain/src/swimming.ts";
import { compileSwimCourseWorkout, editableSwimCourseWorkout } from "../../engine/src/swim-course.ts";
import { SWIM_COURSE_VERSION, type SwimCourseWorkout } from "../../domain/src/swim-course.ts";
import type { SwimDecisionRecord, SwimPlanRow, SwimWorkoutRow, SwimPlanState, SwimPlanDefinition } from "../src/schema/swimming.ts";
import { appendReviewMigrations, inspectReviewLedger, reviewMigrations, ReviewStorageRefusal } from "../scripts/upgrade-swim-review-storage.ts";
import { verifyMigrationDependencyParity } from "../scripts/migrate-with-evidence.ts";
import { appendUntimedMigration, inspectUntimedLedger, untimedReviewMigrations } from "../scripts/untimed-swim-review-storage.ts";
import { rehearseProductionSwimmingUpdate } from "./swim-production-update-rehearsal.ts";
import { POST_UPDATE_CATALOG_SQL, productionPostUpdateInventory } from "../scripts/swim-production-post-update.ts";
import {
  historicalMigrationHashes, productionHistoryInventory, productionSchemaInventory,
  SCHEMA_TABLE_SQL, SCHEMA_FUNCTION_SQL, SCHEMA_SHARED_SQL, SWIM_SCHEMA_TABLES, SWIM_SCHEMA_FUNCTIONS,
} from "../scripts/swim-production-reconciliation.ts";

type PoolRow = Pick<SwimWorkoutRow, "id" | "revision" | "slot"> & {
  scheduled_date: string; definition: SwimWorkoutRow["definition"] & { slotId: string };
};
type Snapshot = { plan: Pick<SwimPlanRow, "id" | "revision" | "definition" | "state">; workouts: PoolRow[] };
type PoolRequest = { state: SwimPlanState; workouts: (Omit<PoolRow, "revision"> & { expected_revision: number })[] };

const stages: string[] = [];
const knownFailures = new Map<string, { migration: number; line: number }>();
let failureLocation: { migration: number; line: number } | undefined;
let stage = "guard", status = "failed", code = "unexpected";
let sql: ReturnType<typeof postgres> | undefined;
try {
  const url = new URL(process.env.SWIM_POOL_TEST_DATABASE_URL ?? "");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.match(process.env.TESTED_SHA ?? "", /^[0-9a-f]{40}$/);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), process.env.TESTED_SHA);
  assert.equal(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(), "");
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.username, "postgres");
  assert.equal(url.password, "");
  assert.equal(url.pathname, "/swim_pool_test");
  assert.equal(url.search + url.hash, "");
  sql = postgres(url.toString(), {
    max: 4, connect_timeout: 5, idle_timeout: 5, onnotice: () => {},
    connection: { statement_timeout: 15000, lock_timeout: 5000, log_min_error_statement: "panic", log_min_messages: "panic" },
  });
  const database = sql;
  const [{ count }] = await database`SELECT count(*)::int FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','v','m','S')`;
  assert.equal(count, 0);
  stages.push(stage);

  stage = "synthetic-auth-and-base-schema";
  await database.unsafe(`
    CREATE SCHEMA auth;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    -- Match hosted function defaults so migrations must narrow every grant.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT (NULLIF(current_setting('request.jwt.claims', true),'')::jsonb->>'sub')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  `);
  const journal: { entries: { idx: number; tag: string; when: number; breakpoints: boolean }[] } = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  assert.equal(journal.entries.length, 155);
  assert.equal(journal.entries[153].tag, "0153_swim_import_matching");
  assert.equal(journal.entries[154].tag, "0154_swim_untimed_courses");
  assert.deepEqual(journal.entries.slice(150).map((entry) => entry.tag), [
    "0150_swim_import_storage", "0151_swim_pool_changes", "0152_swim_private_courses",
    "0153_swim_import_matching", "0154_swim_untimed_courses",
  ]);
  verifyMigrationDependencyParity();
  assert.throws(reviewMigrations, (error) => error instanceof ReviewStorageRefusal && error.code === "migration_source");
  const migrations = untimedReviewMigrations();
  assert.equal(migrations.length, 155);
  // Rehearse the historical 150-to-154 operation without widening its hosted source guard.
  const canonical = migrations.slice(0, 154);
  await database.unsafe(`CREATE SCHEMA drizzle;
    CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint)`);
  for (const [index, migration] of journal.entries.entries()) {
    assert.equal(migration.idx, index);
    assert.equal(migration.when, migrations[index]!.folderMillis);
    if (index > 0) assert.ok(migration.when > journal.entries[index - 1]!.when);
    if (index >= 150) assert.equal(migration.breakpoints, false);
    assert.match(migration.tag, /^\d{4}_[a-z0-9_]+$/);
    stage = `migration-${index}`;
    const source = readFileSync(new URL(`../drizzle/${migration.tag}.sql`, import.meta.url), "utf8");
    for (const match of source.matchAll(/\bRAISE EXCEPTION '((?:''|[^'])*)'/g)) {
      knownFailures.set(match[1].replaceAll("''", "'"), {
        migration: index, line: source.slice(0, match.index).split("\n").length,
      });
    }
    if (index < 150) {
      if (index === 146) {
        stage = "post-update-readonly-probe";
        const inspect = (tx: postgres.TransactionSql) => tx.unsafe(POST_UPDATE_CATALOG_SQL);
        const before = await database.begin(async (tx) => {
          await tx.unsafe("SET TRANSACTION READ ONLY");
          const rows = await inspect(tx);
          const schema = productionSchemaInventory(
            Array.from(await tx.unsafe(SCHEMA_TABLE_SQL, [[...SWIM_SCHEMA_TABLES]])),
            Array.from(await tx.unsafe(SCHEMA_FUNCTION_SQL, [[...SWIM_SCHEMA_FUNCTIONS]])),
            Array.from(await tx.unsafe(SCHEMA_SHARED_SQL)));
          return productionPostUpdateInventory(Array.from(rows), { complete: true, rowsRead: 146, fingerprint: "" }, schema);
        });
        assert.equal(before.schemaRestored, true);
        assert.equal(before.rollbackVerified, false);
        assert.ok(Object.values(before.sharedAttributes!).every((value) => value === true));
        assert.deepEqual(before.sharedAclCounts, { postgres: 1, authenticated: 1, service_role: 1, anon: 1, public: 1, swim_writer: 0, other: 0 });
        await assert.rejects(database.begin(async (tx) => {
          await tx.unsafe("ALTER FUNCTION public.complete_training_session_with_transition(uuid,text,uuid) SET search_path=public,pg_catalog");
          await tx.unsafe("REVOKE EXECUTE ON FUNCTION public.complete_training_session_with_transition(uuid,text,uuid) FROM anon");
          const changed = await inspect(tx);
          assert.equal(changed[0]!.shared_attributes[9], false);
          assert.equal(changed[0]!.shared_acl_counts[3], 0);
          assert.equal(changed[0]!.shared_privileges[3], true);
          throw new Error("synthetic_catalog_probe_rollback");
        }), /synthetic_catalog_probe_rollback/);
        const restored = await database.begin(async (tx) => {
          await tx.unsafe("SET TRANSACTION READ ONLY"); return inspect(tx);
        });
        assert.equal(restored[0]!.shared_attributes[9], true);
        assert.equal(restored[0]!.shared_acl_counts[3], 1);
        stages.push(stage);
        await rehearseProductionSwimmingUpdate(database, (name) => { stage = name; });
        stages.push("production-updater-rehearsal");
        stage = `migration-${index}`;
      }
      await database.begin(async (tx) => {
        await tx.unsafe(source);
        await tx`INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
          VALUES (${canonical[index]!.hash},${canonical[index]!.folderMillis})`;
      });
    }
  }
  stages.push("synthetic-auth-and-base-schema");
  const up = readFileSync(new URL("../drizzle/0151_swim_pool_changes.sql", import.meta.url), "utf8");
  const down = readFileSync(new URL("../rollbacks/0151_swim_pool_changes.down.sql", import.meta.url), "utf8");
  const courseUp = readFileSync(new URL("../drizzle/0152_swim_private_courses.sql", import.meta.url), "utf8");
  const courseDown = readFileSync(new URL("../rollbacks/0152_swim_private_courses.down.sql", import.meta.url), "utf8");
  const matchUp = readFileSync(new URL("../drizzle/0153_swim_import_matching.sql", import.meta.url), "utf8");
  const matchDown = readFileSync(new URL("../rollbacks/0153_swim_import_matching.down.sql", import.meta.url), "utf8");
  const untimedUp = readFileSync(new URL("../drizzle/0154_swim_untimed_courses.sql", import.meta.url), "utf8");
  const untimedDown = readFileSync(new URL("../rollbacks/0154_swim_untimed_courses.down.sql", import.meta.url), "utf8");
  const revertScript = async (source: string) => {
    const connection = await database.reserve();
    try { await connection.unsafe(source); }
    catch (error) { await connection.unsafe("ROLLBACK"); throw error; }
    finally { connection.release(); }
  };
  const revert = () => revertScript(down);
  const revertCourse = () => revertScript(courseDown);
  const revertMatches = () => revertScript(matchDown);
  const revertUntimed = () => revertScript(untimedDown);
  const as = <T,>(user: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    database.begin(async (tx) => {
      await tx.unsafe(user ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
      await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify(user ? { sub: user } : {})}, true)`;
      return fn(tx);
    });
  const denied = async (fn: () => Promise<unknown>, expected: string) =>
    assert.rejects(fn, (error: unknown) => {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== expected) throw error;
      return true;
    });
  const a = randomUUID(), b = randomUUID(), c = randomUUID(), d = randomUUID();
  stage = "owned-plan-fixtures";
  await database`INSERT INTO auth.users(id) VALUES (${a}), (${b}), (${c}), (${d})`;
  const [{ today }] = await database<{ today: string }[]>`SELECT to_char(current_date, 'YYYY-MM-DD') AS today`;
  const long = poolCourse(50, 1, "m"), short = poolCourse(25, 1, "m");
  const setup = {
    goal: "endurance" as const, experience: "recreational" as const, course: long,
    knownStrokes: ["freestyle" as const], equipment: [], recentComfortableLengths: 8, sessionBudgetMinutes: 60,
  };
  const estimate = estimateCriticalSwimSpeed({
    course: long, protocol: "css_200_400", stroke: "freestyle", equipment: [], verified: true,
    observedOn: today, version: "swim-css-1",
    trials: [{ distance: 200, lengths: 4, timeMs: 200_000 }, { distance: 400, lengths: 8, timeMs: 420_000 }],
  });
  assert.equal(estimate.ok, true);
  if (!estimate.ok) throw new Error("Invalid synthetic assessment");
  const generated = generateSwimPlan({
    setup, calibration: estimate.value,
    weeks: [{ weekIndex: 0, startDateISO: today, slots: [
      { slotId: "pool-a", dateISO: today, intent: "moderate", source: "swim_date" },
      { slotId: "pool-b", dateISO: today, intent: "moderate", source: "swim_date" },
    ] }],
  });
  assert.equal(generated.ok, true);
  if (!generated.ok) throw new Error("Invalid synthetic programme");
  const definitions = generated.value.weeks[0]!.slots.map((slot): PoolRow["definition"] => {
    if (slot.kind !== "workout") throw new Error("Expected synthetic workout");
    return { version: 1, original: slot.original, issued: slot.issued, modifications: [], slotId: slot.slotId };
  });
  const definition: SwimPlanDefinition = { version: 1, setup, generatorVersion: "swim-gen-1" };
  const state: SwimPlanState = { version: 1, observations: [estimate.value.observation], acceptedCalibration: estimate.value, decisions: [] };
  // Bind serialized JSON as text so the driver does not encode it twice.
  const create = (user: string) => as(user, async (tx) =>
    (await tx<{ result: Snapshot }[]>`SELECT public.swim_create_plan(${today}::date, ${today}::date, ${JSON.stringify(definition)}::text::jsonb, ${JSON.stringify(state)}::text::jsonb,
      ${JSON.stringify(definitions.map((definition) => ({ scheduled_date: today, slot: "single", definition })))}::text::jsonb) AS result`)[0]!.result);
  let own = await create(a);
  const other = await create(b);

  stage = "existing-data-upgrade-atomicity";
  const legacySnapshot = () => database`SELECT
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.swim_plans p) AS plans,
    (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM public.swim_workouts w) AS workouts,
    (SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM auth.users u) AS users`;
  const legacyBefore = await legacySnapshot();
  let guards = 0;
  await assert.rejects(appendReviewMigrations(database, canonical, async () => {
    if (++guards === 3) throw new Error("synthetic_upgrade_guard");
  }), /synthetic_upgrade_guard/);
  await inspectReviewLedger(database, canonical, 150);
  assert.equal((await database`SELECT to_regprocedure('public.swim_import_storage_ready()') AS name`)[0]!.name, null);
  assert.deepEqual(await legacySnapshot(), legacyBefore);
  await appendReviewMigrations(database, canonical, async () => {});
  await inspectReviewLedger(database, canonical, 154);
  assert.deepEqual(await legacySnapshot(), legacyBefore);
  await assert.rejects(appendReviewMigrations(database, canonical, async () => {}));
  stages.push(stage, "synthetic-auth-and-full-schema");

  stage = "unused-down-and-up";
  await revertMatches();
  assert.equal((await database`SELECT to_regprocedure('public.swim_import_matching_ready()') AS name`)[0]!.name, null);
  await revertCourse();
  assert.equal((await database`SELECT to_regprocedure('public.swim_private_course_ready()') AS name`)[0]!.name, null);
  await revert();
  assert.equal((await database`SELECT to_regprocedure('public.swim_pool_editing_ready()') AS name`)[0]!.name, null);
  await database.begin((tx) => tx.unsafe(up));
  await database.begin((tx) => tx.unsafe(courseUp));
  await database.begin((tx) => tx.unsafe(matchUp));
  stages.push(stage);

  stage = "existing-ownership-and-capability";
  assert.equal((await as(a, (tx) => tx`SELECT public.swim_pool_editing_ready() AS ready`))[0]!.ready, true);
  await denied(() => as(null, (tx) => tx`SELECT public.swim_pool_editing_ready()`), "42501");
  const grants = await database<{ rolname: string; allowed: boolean }[]>`SELECT rolname,
    has_function_privilege(oid, 'public.swim_validate_pool_reissue(jsonb,jsonb)', 'EXECUTE') AS allowed
    FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'swim_writer')`;
  assert.deepEqual(Object.fromEntries(grants.map((row) => [row.rolname, row.allowed])), {
    anon: false, authenticated: false, service_role: false, swim_writer: true,
  });
  const visible = await as(a, (tx) => tx`SELECT id FROM public.swim_workouts`);
  assert.deepEqual(new Set(visible.map((row) => row.id)), new Set(own.workouts.map((row: { id: string }) => row.id)));
  await denied(() => as(a, (tx) => tx`UPDATE public.swim_workouts SET definition=definition`), "42501");
  const identities = await database`SELECT p.proname, r.rolname, r.rolbypassrls, p.prosecdef, p.proconfig
    FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    WHERE p.oid='public.swim_update_plan(uuid,integer,jsonb,jsonb,jsonb)'::regprocedure`;
  assert.equal(identities[0]!.rolname, "swim_writer");
  assert.equal(identities[0]!.rolbypassrls, false);
  assert.equal(identities[0]!.prosecdef, true);
  assert.ok(identities[0]!.proconfig.includes("row_security=on"));
  stages.push(stage);

  const converted = changeSwimWorkoutPool(own.workouts[0].definition.issued, short, estimate.value);
  assert.equal(converted.ok, true);
  if (!converted.ok) throw new Error("Invalid synthetic conversion");
  const request = (snapshot: Snapshot, scope: "plan" | "workout" = "workout"): PoolRequest => {
    const id = randomUUID();
    const decision: SwimDecisionRecord = {
      id, kind: "setup", decision: "accepted", recordedAt: new Date().toISOString(),
      ruleVersion: "swim-pool-1", generatorVersion: "swim-gen-1",
      inputSnapshot: { operation: "pool", scope, course: short, slotId: snapshot.workouts[0].definition.slotId },
    };
    const targets = scope === "plan" ? snapshot.workouts.filter((row) => !row.definition.poolCourse) : [snapshot.workouts[0]];
    return {
      state: { ...snapshot.plan.state, ...(scope === "plan" ? { poolCourse: short } : {}), decisions: [...snapshot.plan.state.decisions, decision] },
      workouts: targets.map((row) => {
        const issued = changeSwimWorkoutPool(row.definition.issued, short, estimate.value);
        if (!issued.ok) throw new Error("Invalid synthetic pool request");
        return {
          id: row.id, expected_revision: row.revision, scheduled_date: row.scheduled_date, slot: row.slot,
          definition: {
            ...row.definition, ...(scope === "workout" ? { poolCourse: short } : {}), issued: issued.value,
            modifications: [...row.definition.modifications, {
              id: randomUUID(), decisionId: id, recordedAt: decision.recordedAt, reason: "Synthetic pool choice.", previous: row.definition.issued,
            }],
          },
        };
      }),
    };
  };
  const update = (user: string, snapshot: Snapshot, change: PoolRequest) => as(user, async (tx) =>
    (await tx<{ result: Snapshot }[]>`SELECT public.swim_update_plan(${snapshot.plan.id}::uuid, ${snapshot.plan.revision},
      ${JSON.stringify(snapshot.plan.definition)}::text::jsonb, ${JSON.stringify(change.state)}::text::jsonb, ${JSON.stringify(change.workouts)}::text::jsonb) AS result`)[0]!.result);

  stage = "atomic-pool-choice-and-history";
  const initial = own, change = request(own);
  await denied(() => update(b, own, change), "P0001");
  const foreign = structuredClone(change);
  foreign.workouts[0].id = other.workouts[0].id;
  await denied(() => update(a, own, foreign), "P0001");
  const outcomes = await Promise.allSettled([update(a, own, change), update(a, own, change)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const collision = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(collision?.status === "rejected");
  assert.equal(collision.reason.code, "40001");
  const success = outcomes.find((outcome) => outcome.status === "fulfilled");
  assert.ok(success?.status === "fulfilled");
  own = success.value;
  assert.equal(own.plan.revision, initial.plan.revision + 1);
  assert.deepEqual(own.plan.definition, initial.plan.definition);
  assert.deepEqual(own.workouts[0].definition.original, initial.workouts[0].definition.original);
  assert.deepEqual(own.workouts[0].definition.modifications[0].previous, initial.workouts[0].definition.issued);
  assert.equal(own.workouts[0].definition.issued.totalLengths, initial.workouts[0].definition.issued.totalLengths * 2);
  assert.deepEqual(own.workouts[1], initial.workouts[1]);
  assert.equal(own.workouts[0].definition.issued.snapshot.calibration, null);
  stages.push(stage);

  stage = "tampering-and-course-calibration";
  const fresh = request(other);
  const editIssued = (change: PoolRequest, transform: (workout: SwimWorkout) => SwimWorkout): PoolRequest => ({
    ...change, workouts: change.workouts.map((row, index) => index ? row : {
      ...row, definition: { ...row.definition, issued: transform(row.definition.issued) },
    }),
  });
  const rounded = editIssued(fresh, (workout) => ({
    ...workout, totalLengths: workout.totalLengths + workout.sections[0]!.rounds * workout.sections[0]!.items[0]!.repeats,
    sections: workout.sections.map((section, index) => index ? section : {
      ...section, items: section.items.map((item, index) => index ? item : { ...item, lengths: item.lengths + 1 }),
    }),
  }));
  await denied(() => update(b, other, rounded), "P0001");
  const wrongCourse = editIssued(fresh, (workout) => ({
    ...workout, snapshot: { ...initial.workouts[0].definition.issued.snapshot, course: short }, estimatedMs: null,
  }));
  await denied(() => update(b, other, wrongCourse), "P0001");
  const unaudited = structuredClone(fresh);
  const unauditedDecision = unaudited.state.decisions.at(-1);
  assert.ok(unauditedDecision);
  unauditedDecision.kind = "progression";
  await denied(() => update(b, other, unaudited), "P0001");
  const rewritten = structuredClone(fresh);
  rewritten.workouts[0].definition.original = converted.value;
  await denied(() => update(b, other, rewritten), "P0001");
  const current = (await as(b, (tx) => tx`SELECT revision FROM public.swim_plans WHERE id=${other.plan.id}`))[0]!;
  assert.equal(current.revision, other.plan.revision);
  stages.push(stage);

  stage = "default-and-history-preserving-down-refusal";
  const defaultChange = request(own, "plan");
  own = await update(a, own, defaultChange);
  assert.deepEqual(own.plan.state.poolCourse, short);
  assert.deepEqual(own.workouts[0].definition.poolCourse, short);
  assert.deepEqual(own.workouts[1].definition.issued.snapshot.course, short);
  await denied(revert, "P0001");
  assert.equal((await as(a, (tx) => tx`SELECT revision FROM public.swim_plans WHERE id=${own.plan.id}`))[0]!.revision, own.plan.revision);
  stages.push(stage);

  stage = "private-course-grants-and-atomic-import";
  assert.equal((await as(c, (tx) => tx`SELECT public.swim_private_course_ready() AS ready`))[0]!.ready, true);
  await denied(() => as(null, (tx) => tx`SELECT public.swim_private_course_ready()`), "42501");
  const courseGrants = await database<{ rolname: string; allowed: boolean }[]>`SELECT rolname,
    has_function_privilege(oid, 'public.swim_validate_private_course_binding(jsonb,jsonb,jsonb,jsonb)', 'EXECUTE') AS allowed
    FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'swim_writer')`;
  assert.deepEqual(Object.fromEntries(courseGrants.map((row) => [row.rolname, row.allowed])), {
    anon: false, authenticated: false, service_role: false, swim_writer: true,
  });
  const source: SwimCourseWorkout = {
    title: "Synthetic practice", reportedDistanceMetres: 350,
    sections: [
      { kind: "warmup", label: "Warm-up", rounds: 1, items: [
        { repeats: 1, distanceMetres: 50, stroke: "freestyle", effort: "easy", equipment: [] },
      ] },
      { kind: "main", label: "Main", rounds: 1, items: [
        { repeats: 5, distanceMetres: 50, stroke: "freestyle", effort: "steady", equipment: [], restSeconds: 20 },
      ] },
      { kind: "cooldown", label: "Cool-down", rounds: 1, items: [
        { repeats: 1, distanceMetres: 50, stroke: "freestyle", effort: "easy", equipment: [] },
      ] },
    ],
  };
  const [{ tomorrow, later }] = await database<{ tomorrow: string; later: string }[]>`SELECT
    to_char(current_date + 1, 'YYYY-MM-DD') AS tomorrow, to_char(current_date + 4, 'YYYY-MM-DD') AS later`;
  const courseDefinition = {
    version: 1 as const, setup: { ...setup, sessionBudgetMinutes: null }, generatorVersion: SWIM_COURSE_VERSION,
    privateCourse: { version: SWIM_COURSE_VERSION, title: "Synthetic course", source: { reference: "Synthetic fixture", edition: "Test" } } satisfies NonNullable<SwimPlanDefinition["privateCourse"]>,
    schedule: { startDate: today, weeks: 2, weekdays: [1, 4] },
  };
  const courseRows = [short, long].map((course, index) => {
    const compiled = compileSwimCourseWorkout(source, course, setup);
    if (!compiled.ok) throw new Error("Invalid synthetic course");
    return {
      scheduled_date: index === 0 ? tomorrow : later, slot: "single" as const,
      definition: {
        version: 1 as const, original: compiled.value.workout, issued: compiled.value.workout, modifications: [],
        courseSource: source, weekIndex: 0, slotId: `course-0-${index}`, intent: "moderate", provisional: false,
        ...(index === 0 ? { poolCourse: course } : {}),
      },
    };
  });
  const courseState: SwimPlanState = {
    version: 1, observations: [], acceptedCalibration: null, decisions: [{
      id: randomUUID(), kind: "setup", decision: "accepted", recordedAt: new Date().toISOString(),
      ruleVersion: SWIM_COURSE_VERSION, generatorVersion: SWIM_COURSE_VERSION,
      inputSnapshot: { operation: "course-import", acceptSetTotals: false,
        workouts: courseRows.map((row) => ({ slotId: row.definition.slotId, course: row.definition.issued.snapshot.course })) },
    }],
  };
  const createCourse = (rows = courseRows, state = courseState, owner = c, planDefinition: SwimPlanDefinition = courseDefinition) => as(owner, async (tx) =>
    (await tx<{ result: Snapshot }[]>`SELECT public.swim_create_plan(${today}::date, (${today}::date + 13),
      ${JSON.stringify(planDefinition)}::text::jsonb, ${JSON.stringify(state)}::text::jsonb,
      ${JSON.stringify(rows)}::text::jsonb) AS result`)[0]!.result);

  stage = "untimed-course-upgrade-and-preservation";
  const legacyRows = courseRows.map((row) => ({
    ...row, definition: { ...row.definition,
      original: { ...row.definition.original, budget: { ...row.definition.original.budget, minutes: 60 } },
      issued: { ...row.definition.issued, budget: { ...row.definition.issued.budget, minutes: 60 } },
    },
  }));
  const legacyCourse = await createCourse(legacyRows, courseState, d, { ...courseDefinition, setup });
  await denied(() => createCourse(), "P0001");
  const beforeUntimed = await legacySnapshot();
  const validatorGrants = () => database`SELECT p.proname,p.proowner,p.proacl,p.prosecdef,p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('swim_validate_plan','swim_validate_prescription') ORDER BY p.proname`;
  const beforeGrants = await validatorGrants();
  let untimedGuards = 0;
  await assert.rejects(appendUntimedMigration(database, migrations, async () => {
    if (++untimedGuards === 2) throw new Error("synthetic_untimed_guard");
  }), /synthetic_untimed_guard/);
  await inspectUntimedLedger(database, migrations, 154);
  assert.equal((await database`SELECT to_regprocedure('public.swim_untimed_course_ready()') AS name`)[0]!.name, null);
  assert.deepEqual(await legacySnapshot(), beforeUntimed);
  assert.deepEqual(await validatorGrants(), beforeGrants);
  await appendUntimedMigration(database, migrations, async () => {});
  await inspectUntimedLedger(database, migrations, 155);
  await assert.rejects(appendUntimedMigration(database, migrations, async () => {}));
  assert.deepEqual(await legacySnapshot(), beforeUntimed);
  assert.deepEqual(await validatorGrants(), beforeGrants);
  assert.equal((await as(c, (tx) => tx`SELECT public.swim_untimed_course_ready() AS ready`))[0]!.ready, true);
  await denied(() => as(null, (tx) => tx`SELECT public.swim_untimed_course_ready()`), "42501");
  await denied(() => database.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE service_role");
    await tx`SELECT public.swim_untimed_course_ready()`;
  }), "42501");
  await revertUntimed();
  assert.equal((await database`SELECT to_regprocedure('public.swim_untimed_course_ready()') AS name`)[0]!.name, null);
  await denied(() => createCourse(), "P0001");
  assert.deepEqual(await legacySnapshot(), beforeUntimed);
  await database.begin((tx) => tx.unsafe(untimedUp));
  assert.deepEqual(await validatorGrants(), beforeGrants);
  assert.equal((await database`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`)[0]!.count, 155);
  const validate = (prescription: unknown, planDefinition: unknown) => database.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE swim_writer");
    await tx`SELECT public.swim_validate_prescription(${JSON.stringify(prescription)}::text::jsonb)`;
    await tx`SELECT public.swim_validate_plan(${JSON.stringify(planDefinition)}::text::jsonb, ${JSON.stringify(courseState)}::text::jsonb)`;
  });
  await validate(courseRows[0]!.definition.issued, courseDefinition);
  for (const invalid of [null, 0, -1, 241, "60", undefined]) {
    await denied(() => validate({
      ...definitions[0]!.issued, budget: { ...definitions[0]!.issued.budget, minutes: invalid },
    }, courseDefinition), "P0001");
  }
  for (const invalid of [0, -1, 241, "60", undefined]) {
    await denied(() => validate({
      ...courseRows[0]!.definition.issued, budget: { ...courseRows[0]!.definition.issued.budget, minutes: invalid },
    }, courseDefinition), "P0001");
  }
  await denied(() => validate(courseRows[0]!.definition.issued, {
    ...definition, setup: { ...setup, sessionBudgetMinutes: null },
  }), "P0001");
  await denied(() => validate(courseRows[0]!.definition.issued, {
    ...courseDefinition, setup: { ...setup, sessionBudgetMinutes: undefined },
  }), "P0001");
  assert.deepEqual(await legacySnapshot(), beforeUntimed);
  assert.equal(legacyCourse.plan.definition.setup.sessionBudgetMinutes, 60);
  const legacyChange = request(legacyCourse, "plan");
  legacyChange.state.decisions.at(-1)!.generatorVersion = SWIM_COURSE_VERSION;
  const legacyChanged = await update(d, legacyCourse, legacyChange);
  assert.deepEqual(legacyChanged.plan.definition, legacyCourse.plan.definition);
  assert.deepEqual(legacyChanged.workouts[1].definition.original, legacyCourse.workouts[1].definition.original);
  assert.deepEqual(legacyChanged.workouts[1].definition.modifications[0].previous, legacyCourse.workouts[1].definition.issued);
  assert.equal(legacyChanged.workouts[1].definition.issued.budget.minutes, 60);
  const downPath = /jsonb_path_exists\(definition, '([^']+)'\)/.exec(untimedDown)?.[1];
  assert.ok(downPath);
  for (const retained of [
    { issued: courseRows[0]!.definition.issued },
    { original: courseRows[0]!.definition.original },
    { modifications: [{ previous: courseRows[0]!.definition.original }] },
  ]) {
    assert.equal((await database`SELECT jsonb_path_exists(${JSON.stringify(retained)}::text::jsonb, ${downPath}::jsonpath) AS blocked`)[0]!.blocked, true);
  }
  stages.push(stage);
  stage = "private-course-grants-and-atomic-import";
  const conflictingTotals = structuredClone(courseRows);
  conflictingTotals[0]!.definition.courseSource = { ...source, reportedDistanceMetres: 999 };
  await denied(() => createCourse(conflictingTotals), "P0001");
  assert.equal((await as(c, (tx) => tx`SELECT count(*)::int AS count FROM public.swim_plans`))[0]!.count, 0);
  const course = await createCourse();
  assert.equal(course.plan.definition.setup.sessionBudgetMinutes, null);
  assert.equal(course.workouts[0].definition.issued.budget.minutes, null);
  await denied(revertUntimed, "P0001");
  assert.equal((await as(c, (tx) => tx`SELECT public.swim_untimed_course_ready() AS ready`))[0]!.ready, true);
  await denied(() => createCourse(), "23505");
  assert.deepEqual(course.workouts[0].definition.original, courseRows[0]!.definition.original);
  assert.deepEqual(course.workouts[1].definition.issued.snapshot.course, long);
  assert.deepEqual((await as(c, (tx) => tx`SELECT id FROM public.swim_plans`)).map((row) => row.id), [course.plan.id]);
  stages.push(stage);

  stage = "readonly-production-inventory-rehearsal";
  const historicalHashes = historicalMigrationHashes((args, input) => execFileSync("git", args, {
    cwd: new URL("../../../", import.meta.url), input, timeout: 15000, maxBuffer: 2 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "test" },
    stdio: ["pipe", "pipe", "ignore"],
  }));
  await database.begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION READ ONLY");
    await tx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const ledger = await tx.unsafe("SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 512");
    const inventory = productionHistoryInventory(Array.from(ledger),
      migrations.map((entry, index) => ({ ...entry, tag: journal.entries[index]!.tag })), historicalHashes);
    assert.equal(inventory.rowsRead, 155);
    assert.equal(inventory.complete, true);
    assert.equal(inventory.productionReady, false);
    assert.ok(inventory.current.every((entry) => entry.canonicalRows === 1 && entry.canonicalTimestampRows === 1));
    const metadata = productionSchemaInventory(
      Array.from(await tx.unsafe(SCHEMA_TABLE_SQL, [[...SWIM_SCHEMA_TABLES]])),
      Array.from(await tx.unsafe(SCHEMA_FUNCTION_SQL, [[...SWIM_SCHEMA_FUNCTIONS]])),
      Array.from(await tx.unsafe(SCHEMA_SHARED_SQL)));
    assert.ok(metadata.tables.every((entry) => entry.present && entry.rls && entry.owner_uuid && entry.policies > 0));
    assert.ok(metadata.functions.every((entry) => entry.definitions === 1));
    assert.equal(metadata.shared.completion_body, "after");
    assert.equal(metadata.shared.swim_result, true);
    assert.equal(metadata.shared.movement_keys?.find((entry) => entry.name === "set_logs_movement_id_fkey")?.deferred, true);
    assert.equal(metadata.compatibilityVerified, false);
  });
  stages.push(stage);

  stage = "private-course-manual-edit-and-isolation";
  const editedSource = editableSwimCourseWorkout(source.title, course.workouts[0].definition.issued);
  const edited = compileSwimCourseWorkout({
    ...editedSource, sections: editedSource.sections.map((section) => section.kind === "main"
      ? { ...section, items: section.items.map((item) => ({ ...item, repeats: 3 })) } : section),
  }, short, setup);
  if (!edited.ok) throw new Error("Invalid synthetic edit");
  const editDecision: SwimDecisionRecord = {
    id: randomUUID(), kind: "progression", decision: "overridden", reason: "Synthetic manual adjustment.",
    recordedAt: new Date().toISOString(), ruleVersion: SWIM_COURSE_VERSION, generatorVersion: SWIM_COURSE_VERSION,
    inputSnapshot: { operation: "course-edit", slotId: course.workouts[0].definition.slotId, issued: edited.value.workout },
  };
  const manual: PoolRequest = {
    state: { ...course.plan.state, decisions: [...course.plan.state.decisions, editDecision] },
    workouts: [{
      id: course.workouts[0].id, expected_revision: course.workouts[0].revision,
      scheduled_date: tomorrow, slot: course.workouts[0].slot,
      definition: { ...course.workouts[0].definition, issued: edited.value.workout, modifications: [{
        id: randomUUID(), decisionId: editDecision.id, recordedAt: editDecision.recordedAt,
        reason: editDecision.reason!, previous: course.workouts[0].definition.issued,
      }] },
    }],
  };
  await denied(() => update(b, course, manual), "P0001");
  const foreignCourse = structuredClone(manual);
  foreignCourse.workouts[0].id = other.workouts[0].id;
  await denied(() => update(c, course, foreignCourse), "P0001");
  const automated = structuredClone(manual);
  automated.state.decisions.at(-1)!.inputSnapshot.operation = "week";
  await denied(() => update(c, course, automated), "P0001");
  const changedSource = structuredClone(manual);
  changedSource.workouts[0].definition.courseSource = { ...source, title: "Replaced" };
  await denied(() => update(c, course, changedSource), "P0001");
  const editedCourse = await update(c, course, manual);
  assert.equal(editedCourse.plan.revision, course.plan.revision + 1);
  assert.deepEqual(editedCourse.workouts[0].definition.original, course.workouts[0].definition.original);
  assert.deepEqual(editedCourse.workouts[0].definition.modifications[0].previous, course.workouts[0].definition.issued);
  assert.deepEqual(editedCourse.workouts[1], course.workouts[1]);
  await denied(() => update(c, course, manual), "40001");
  await denied(revertCourse, "P0001");
  assert.equal((await as(c, (tx) => tx`SELECT revision FROM public.swim_plans WHERE id=${course.plan.id}`))[0]!.revision, editedCourse.plan.revision);
  stages.push(stage);

  stage = "matching-grants-and-owned-recordings";
  assert.equal((await as(c, (tx) => tx`SELECT public.swim_import_matching_ready() AS ready`))[0]!.ready, true);
  const matchGrants = await database`SELECT rolname,
    has_function_privilege(oid,'public.swim_match_import(uuid,uuid,uuid,uuid,integer)','EXECUTE') AS allowed
    FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`;
  assert.deepEqual(Object.fromEntries(matchGrants.map((row) => [row.rolname, row.allowed])), {
    anon: false, authenticated: true, service_role: false,
  });
  const hash = "d".repeat(64);
  await as(c, (tx) => tx`SELECT public.swim_import_connect(${hash})`);
  const evidence = {
    version: 1, source: "local_dashboard", activityId: "10001", date: today, environment: "pool",
    workoutReference: "42", distanceMetres: 300, recordedDurationMs: 300000, durationKind: "unspecified",
    nativeCourse: null, detail: { status: "missing", fetchedAt: null, splits: [] },
  };
  const receive = async (value = evidence) => database.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE service_role");
    return (await tx<{ receipt: { id: string; revision: number } }[]>`SELECT public.swim_import_receive(
      ${hash}, ${JSON.stringify(value)}::text::jsonb) AS receipt`)[0]!.receipt;
  });
  const imported = await receive();
  const work = editedCourse.workouts[0];
  const match = (user: string | null, receipt: string, expected: string | null, target: string | null = work.id,
    revision: number | null = target ? work.revision : null, requestId = randomUUID()) =>
    as(user, async (tx) => (await tx<{ id: string }[]>`SELECT public.swim_match_import(
      ${requestId}::uuid, ${receipt}::uuid, ${target}::uuid, ${expected}::uuid, ${revision}::integer) AS id`)[0]!.id);
  await denied(() => match(null, imported.id, null), "42501");
  await denied(() => match(b, imported.id, null), "42501");
  await denied(() => match(c, imported.id, null, other.workouts[0].id, other.workouts[0].revision), "42501");
  await denied(() => match(c, imported.id, null, work.id, work.revision + 1), "40001");
  await denied(() => as(c, (tx) => tx`INSERT INTO public.swim_import_matches(id) VALUES (${randomUUID()})`), "42501");
  await denied(() => database.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE service_role");
    await tx`SELECT public.swim_match_import(${randomUUID()},${imported.id},${work.id},null,${work.revision})`;
  }), "42501");
  stages.push(stage);

  stage = "explicit-matching-replay-and-no-training-writes";
  const trainingBefore = await database`SELECT id,revision,status,session_id,definition FROM public.swim_workouts ORDER BY id`;
  const sessionsBefore = await database`SELECT count(*)::int AS count FROM public.sessions`;
  const cardioBefore = await database`SELECT count(*)::int AS count FROM public.cardio_logs`;
  const matched = randomUUID();
  assert.equal(await match(c, imported.id, null, work.id, work.revision, matched), matched);
  assert.equal(await match(c, imported.id, null, work.id, work.revision, matched), matched);
  await denied(() => match(c, imported.id, null), "40001");
  await denied(() => match(c, imported.id, null, null, null, matched), "22023");
  assert.equal((await as(b, (tx) => tx`SELECT count(*)::int AS count FROM public.swim_current_import_matches`))[0]!.count, 0);
  const saved = (await as(c, (tx) => tx`SELECT * FROM public.swim_current_import_matches`))[0]!;
  assert.equal(saved.import_id, imported.id);
  assert.deepEqual(saved.metadata.workout.issued, work.definition.issued);
  assert.equal(saved.metadata.workout.revision, work.revision);
  await denied(() => as(c, (tx) => tx`UPDATE public.swim_import_matches SET workout_id=null`), "42501");
  await denied(() => as(c, (tx) => tx`DELETE FROM public.swim_import_matches`), "42501");
  await denied(() => database`INSERT INTO public.swim_import_matches(id,user_id,activity_id,import_id,workout_id,revision,metadata)
    VALUES (${randomUUID()},${c},${evidence.activityId},${imported.id},${other.workouts[0].id},2,'{}'::jsonb)`, "23503");
  await denied(() => database`INSERT INTO public.swim_import_matches(id,user_id,activity_id,import_id,workout_id,revision,metadata)
    VALUES (${randomUUID()},${b},${evidence.activityId},${imported.id},${other.workouts[0].id},1,'{}'::jsonb)`, "23503");
  assert.deepEqual(await database`SELECT id,revision,status,session_id,definition FROM public.swim_workouts ORDER BY id`, trainingBefore);
  assert.deepEqual(await database`SELECT count(*)::int AS count FROM public.sessions`, sessionsBefore);
  assert.deepEqual(await database`SELECT count(*)::int AS count FROM public.cardio_logs`, cardioBefore);
  stages.push(stage);

  stage = "matching-corrections-concurrency-and-undo";
  const corrected = await receive({ ...evidence, distanceMetres: 350 });
  assert.equal((await as(c, (tx) => tx`SELECT import_id FROM public.swim_current_import_matches`))[0]!.import_id, imported.id);
  await denied(() => match(c, imported.id, matched), "40001");
  const races = await Promise.allSettled([match(c, corrected.id, matched), match(c, corrected.id, matched)]);
  assert.equal(races.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = races.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejected.reason.code === "40001");
  const attached = races.find((result) => result.status === "fulfilled");
  assert.ok(attached?.status === "fulfilled");
  const undone = await match(c, corrected.id, attached.value, null, null);
  const currentMatch = (await as(c, (tx) => tx`SELECT * FROM public.swim_current_import_matches`))[0]!;
  assert.equal(currentMatch.id, undone);
  assert.equal(currentMatch.workout_id, null);
  assert.equal((await as(c, (tx) => tx`SELECT count(*)::int AS count FROM public.swim_import_matches`))[0]!.count, 3);
  assert.equal((await as(c, (tx) => tx`SELECT count(*)::int AS count FROM public.swim_current_import_matches WHERE workout_id=${work.id}`))[0]!.count, 0);
  await denied(() => match(c, imported.id, null, work.id, work.revision, matched), "40001");
  const sameReference = await receive({ ...evidence, activityId: "10002" });
  assert.equal((await as(c, (tx) => tx`SELECT count(*)::int AS count FROM public.swim_current_import_matches WHERE activity_id='10002'`))[0]!.count, 0);
  await match(c, sameReference.id, null);
  const water = await receive({ ...evidence, activityId: "10003", environment: "open_water" });
  await denied(() => match(c, water.id, null), "22023");
  await denied(revertMatches, "P0001");
  assert.equal((await as(c, (tx) => tx`SELECT count(*)::int AS count FROM public.swim_imports`))[0]!.count, 4);
  stages.push(stage);

  stage = "synthetic-cleanup-and-unused-down";
  await database`DELETE FROM auth.users WHERE id IN (${a}, ${b}, ${c}, ${d})`;
  assert.equal((await database`SELECT count(*)::int AS count FROM public.swim_import_matches`)[0]!.count, 0);
  assert.equal((await database`SELECT count(*)::int AS count FROM public.swim_plans`)[0]!.count, 0);
  assert.equal((await database`SELECT count(*)::int AS count FROM public.swim_workouts`)[0]!.count, 0);
  await revertUntimed();
  await revertMatches();
  await revertCourse();
  await revert();
  stages.push(stage);
  status = "passed";
} catch (error) {
  if (error instanceof Error) failureLocation = knownFailures.get(error.message);
  const known = ["42501", "23503", "23505", "23514", "22023", "P0001", "42601", "42703", "42883", "42P01", "42P07", "42704", "25P02", "57014", "55P03", "40P01", "40001"];
  code = typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string" ? (known.includes(error.code) ? error.code : error.code === "ERR_ASSERTION" ? "assertion" : "unexpected") : "unexpected";
  if (error instanceof ReviewStorageRefusal) code = error.code;
} finally {
  if (sql) {
    try { await sql.end({ timeout: 5 }); }
    catch { if (status !== "failed") { stage = "connection-cleanup"; code = "cleanup"; } status = "failed"; }
  }
}
console.log(JSON.stringify({
  scope: "swim-pool-storage", sha: /^[0-9a-f]{40}$/.test(process.env.TESTED_SHA ?? "") ? process.env.TESTED_SHA : null,
  status, stages, ...(status === "failed" ? { stage, code, ...(failureLocation ? { failureLocation } : {}) } : {}),
}));
if (status !== "passed" && process.env.GITHUB_ACTIONS === "true") {
  console.log(`::error title=Swimming pool storage::${stage} [${code}]${failureLocation ? ` at migration-${failureLocation.migration}:${failureLocation.line}` : ""}`);
}
if (status !== "passed") process.exitCode = 1;
