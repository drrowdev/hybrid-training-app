import postgres from "postgres";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { generateSwimPlan, changeSwimWorkoutPool } from "../../engine/src/swimming.ts";
import { poolCourse, estimateCriticalSwimSpeed, type SwimWorkout } from "../../domain/src/swimming.ts";
import type { SwimDecisionRecord, SwimPlanRow, SwimWorkoutRow, SwimPlanState, SwimPlanDefinition } from "../src/schema/swimming.ts";

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

  stage = "synthetic-auth-and-full-schema";
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
  const journal: { entries: { idx: number; tag: string }[] } = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  assert.equal(journal.entries.length, 152);
  assert.equal(journal.entries[151].tag, "0151_swim_pool_changes");
  for (const [index, migration] of journal.entries.entries()) {
    assert.equal(migration.idx, index);
    assert.match(migration.tag, /^\d{4}_[a-z0-9_]+$/);
    stage = `migration-${index}`;
    const source = readFileSync(new URL(`../drizzle/${migration.tag}.sql`, import.meta.url), "utf8");
    for (const match of source.matchAll(/\bRAISE EXCEPTION '((?:''|[^'])*)'/g)) {
      knownFailures.set(match[1].replaceAll("''", "'"), {
        migration: index, line: source.slice(0, match.index).split("\n").length,
      });
    }
    await database.begin((tx) => tx.unsafe(source));
  }
  stages.push("synthetic-auth-and-full-schema");
  const up = readFileSync(new URL("../drizzle/0151_swim_pool_changes.sql", import.meta.url), "utf8");
  const down = readFileSync(new URL("../rollbacks/0151_swim_pool_changes.down.sql", import.meta.url), "utf8");
  const revert = async () => {
    const connection = await database.reserve();
    try { await connection.unsafe(down); }
    catch (error) { await connection.unsafe("ROLLBACK"); throw error; }
    finally { connection.release(); }
  };
  stage = "unused-down-and-up";
  await revert();
  assert.equal((await database`SELECT to_regprocedure('public.swim_pool_editing_ready()') AS name`)[0]!.name, null);
  await database.begin((tx) => tx.unsafe(up));
  stages.push(stage);

  const as = <T,>(user: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    database.begin(async (tx) => {
      await tx.unsafe(user ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
      await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify(user ? { sub: user } : {})}, true)`;
      return fn(tx);
    });
  const denied = async (fn: () => Promise<unknown>, expected: string) =>
    assert.rejects(fn, (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === expected);
  const a = randomUUID(), b = randomUUID();
  stage = "owned-plan-fixtures";
  await database`INSERT INTO auth.users(id) VALUES (${a}), (${b})`;
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

  stage = "synthetic-cleanup-and-unused-down";
  await database`DELETE FROM auth.users WHERE id IN (${a}, ${b})`;
  assert.equal((await database`SELECT count(*)::int AS count FROM public.swim_plans`)[0]!.count, 0);
  assert.equal((await database`SELECT count(*)::int AS count FROM public.swim_workouts`)[0]!.count, 0);
  await revert();
  stages.push(stage);
  status = "passed";
} catch (error) {
  if (error instanceof Error) failureLocation = knownFailures.get(error.message);
  const known = ["42501", "23503", "23505", "23514", "22023", "P0001", "42601", "42703", "42883", "42P01", "42P07", "42704", "25P02", "57014", "55P03", "40P01", "40001"];
  code = typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string" ? (known.includes(error.code) ? error.code : error.code === "ERR_ASSERTION" ? "assertion" : "unexpected") : "unexpected";
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
