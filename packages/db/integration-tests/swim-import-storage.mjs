import postgres from "postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const stages = [];
let stage = "guard";
let sql;
let status = "failed";
let failureCode;
try {
  const url = new URL(process.env.SWIM_IMPORT_TEST_DATABASE_URL ?? "");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.match(process.env.TESTED_SHA ?? "", /^[0-9a-f]{40}$/);
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.username, "postgres");
  assert.equal(url.password, "");
  assert.equal(url.pathname, "/swim_import_test");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  sql = postgres(url.toString(), {
    max: 4, connect_timeout: 5, idle_timeout: 5, onnotice: () => {},
    connection: { statement_timeout: "10000", lock_timeout: "5000", log_min_error_statement: "panic", log_min_messages: "panic" },
  });
  const [{ count }] = await sql`SELECT count(*)::int FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','v','m','S')`;
  assert.equal(count, 0);
  stages.push(stage);

  stage = "isolated-auth-fixture";
  await sql.unsafe(`
    CREATE SCHEMA auth;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE swim_writer NOLOGIN NOINHERIT NOBYPASSRLS;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT (NULLIF(current_setting('request.jwt.claims', true),'')::jsonb->>'sub')::uuid
    $$;
  `);
  await sql.unsafe(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, swim_writer;
    GRANT USAGE ON SCHEMA auth TO service_role, swim_writer;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role, swim_writer;
    CREATE FUNCTION public.swim_request_user_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path=pg_catalog AS $$ SELECT auth.uid() $$;
    REVOKE ALL ON FUNCTION public.swim_request_user_id() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.swim_request_user_id() TO swim_writer, service_role;
  `);
  stages.push(stage);
  const up = readFileSync(fileURLToPath(new URL("../drizzle/0150_swim_import_storage.sql", import.meta.url)), "utf8");
  const down = readFileSync(fileURLToPath(new URL("../rollbacks/0150_swim_import_storage.down.sql", import.meta.url)), "utf8");
  const apply = () => sql.begin((tx) => tx.unsafe(up));
  const revert = async () => {
    const connection = await sql.reserve();
    try { await connection.unsafe(down); }
    catch (error) { await connection.unsafe("ROLLBACK"); throw error; }
    finally { connection.release(); }
  };
  const as = (role, user, fn) => sql.begin(async (tx) => {
    assert.ok(["authenticated", "anon", "service_role"].includes(role));
    await tx.unsafe(`SET LOCAL ROLE ${role}`);
    await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify(user ? { sub: user } : {})}, true)`;
    return fn(tx);
  });
  const denied = async (fn, code) => {
    await assert.rejects(fn, (error) => error.code === code);
  };
  const a = randomUUID(), b = randomUUID();
  const keyA = "a".repeat(64), keyB = "b".repeat(64), replacement = "c".repeat(64);
  const observation = {
    version: 1, source: "local_dashboard", activityId: "123", date: "2026-09-12",
    environment: "pool", workoutReference: null, distanceMetres: 900,
    recordedDurationMs: 1200000, durationKind: "unspecified", nativeCourse: null,
    detail: { status: "missing", fetchedAt: null, splits: [] },
  };
  const receive = (key, evidence) => as("service_role", null, async (tx) =>
    (await tx`SELECT public.swim_import_receive(${key}, ${tx.json(evidence)}) AS receipt`)[0].receipt);
  const connect = (user, hash) => as("authenticated", user, async (tx) =>
    (await tx`SELECT public.swim_import_connect(${hash}) AS id`)[0].id);

  stage = "empty-up-down-up";
  await apply();
  await revert();
  await apply();
  stages.push(stage);
  await sql`INSERT INTO auth.users(id) VALUES (${a}), (${b})`;

  stage = "pairing-owner-boundary";
  const connectionA = await connect(a, keyA);
  const connectionB = await connect(b, keyB);
  assert.equal(await connect(a, keyA), connectionA);
  await denied(() => connect(a, replacement), "23505");
  await denied(() => as("anon", null, (tx) => tx`SELECT public.swim_import_connect(${replacement})`), "42501");
  await denied(() => as("authenticated", a, (tx) => tx`SELECT token_hash FROM public.swim_connections`), "42501");
  await denied(() => as("authenticated", a, (tx) => tx`UPDATE public.swim_connections SET revoked_at = now()`), "42501");
  await denied(() => as("authenticated", a, (tx) => tx`INSERT INTO public.swim_connections(user_id,token_hash) VALUES (${b},${replacement})`), "42501");
  await denied(() => as("authenticated", b, (tx) => tx`SELECT public.swim_import_disconnect(${connectionA})`), "42501");
  const visibleConnections = await as("authenticated", a, (tx) => tx`SELECT id FROM public.swim_connections`);
  assert.deepEqual(visibleConnections.map((row) => row.id), [connectionA]);
  stages.push(stage);

  stage = "receive-replay-correction";
  const first = await receive(keyA, observation);
  assert.deepEqual(first, { id: first.id, revision: 1, replayed: false });
  assert.deepEqual(await receive(keyA, observation), { ...first, replayed: true });
  const corrected = { ...observation, distanceMetres: 1000 };
  const second = await receive(keyA, corrected);
  assert.equal(second.revision, 2);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(await receive(keyA, observation), { ...first, replayed: true });
  const otherOwner = await receive(keyB, observation);
  assert.equal(otherOwner.revision, 1);
  assert.notEqual(otherOwner.id, first.id);
  const ownerRows = await as("authenticated", a, (tx) => tx`SELECT user_id, revision, evidence FROM public.swim_imports ORDER BY revision`);
  assert.deepEqual(ownerRows.map((r) => [r.user_id, r.revision, r.evidence.distanceMetres]), [[a, 1, 900], [a, 2, 1000]]);
  await denied(() => as("authenticated", a, (tx) => tx`SELECT public.swim_import_receive(${keyA}, ${tx.json(observation)})`), "42501");
  await denied(() => as("authenticated", a, (tx) => tx`DELETE FROM public.swim_imports`), "42501");
  await denied(() => as("authenticated", a, (tx) => tx`UPDATE public.swim_imports SET revision=100`), "42501");
  await denied(() => as("authenticated", a, (tx) => tx`INSERT INTO public.swim_imports(user_id,connection_id,activity_id,revision,content_hash,evidence)
    VALUES (${a},${connectionA},'987',1,${keyA},${tx.json(observation)})`), "42501");
  stages.push(stage);

  stage = "closed-evidence-contract";
  for (const invalid of [
    null, { ...observation, userId: b }, { ...observation, source: null },
    { ...observation, activityId: 123 }, { ...observation, date: "2026-02-30" },
    { ...observation, recordedDurationMs: -1 }, { ...observation, nativeCourse: { unit: "m" } },
    { ...observation, detail: { ...observation.detail, notes: "synthetic-excluded" } },
  ]) await denied(() => receive(keyA, invalid), "22023");
  await denied(() => receive("d".repeat(64), observation), "42501");
  const split = {
    distanceMetres: 25, elapsedMs: 40000, reportedActiveMs: 35000, activeTimeVerified: false,
    reportedPauseMs: 5000, stroke: "freestyle", strokeKnown: true, activeLengths: 1, workoutStep: null,
  };
  const detailed = { ...observation, detail: { status: "available", fetchedAt: "2026-09-12T12:00:00", splits: [split] } };
  assert.equal((await receive(keyA, detailed)).revision, 3);
  for (const invalid of [
    { ...split, activeTimeVerified: true }, { ...split, stroke: null }, { ...split, heartRate: 160 },
    { ...split, elapsedMs: 40000.5 }, { ...split, activeLengths: 2001 },
  ]) await denied(() => receive(keyA, { ...detailed, detail: { ...detailed.detail, splits: [invalid] } }), "22023");
  for (const fetchedAt of ["2026-02-30T12:00:00", "2026-09-12T24:00:00", "2026-09-12T12:00:60",
    "2026-09-12T12:00:00+24:00", "0000-01-01T12:00:00"]) {
    await denied(() => receive(keyA, { ...detailed, detail: { ...detailed.detail, fetchedAt } }), "22023");
  }
  stages.push(stage);

  stage = "concurrency-and-revocation";
  const next = { ...observation, activityId: "456" };
  const concurrent = await Promise.all([receive(keyA, next), receive(keyA, next), receive(keyA, next)]);
  assert.equal(new Set(concurrent.map((r) => r.id)).size, 1);
  assert.equal(concurrent.filter((r) => !r.replayed).length, 1);
  await as("authenticated", a, (tx) => tx`SELECT public.swim_import_disconnect(${connectionA})`);
  await denied(() => receive(keyA, observation), "42501");
  await connect(a, replacement);
  assert.deepEqual(await receive(replacement, observation), { ...first, replayed: true });
  const history = await as("authenticated", a, (tx) => tx`SELECT id FROM public.swim_imports`);
  assert.equal(history.length, 4);
  stages.push(stage);

  stage = "foreign-key-and-history-down";
  await denied(() => sql.begin(async (tx) => {
    await tx`UPDATE public.swim_imports SET connection_id=${connectionB} WHERE user_id=${a}`;
    await tx.unsafe("SET CONSTRAINTS ALL IMMEDIATE");
  }), "23503");
  await denied(revert, "P0001");
  assert.equal((await sql`SELECT count(*)::int AS count FROM public.swim_imports`)[0].count, 5);
  stages.push(stage);

  stage = "account-deletion-and-empty-down";
  await sql.begin(async (tx) => {
    await tx`DELETE FROM auth.users WHERE id=${a}`;
    await tx.unsafe("SET CONSTRAINTS ALL IMMEDIATE");
  });
  assert.equal((await sql`SELECT count(*)::int AS count FROM public.swim_imports WHERE user_id=${a}`)[0].count, 0);
  assert.equal((await sql`SELECT count(*)::int AS count FROM public.swim_connections WHERE user_id=${a}`)[0].count, 0);
  assert.equal((await sql`SELECT count(*)::int AS count FROM public.swim_imports WHERE user_id=${b}`)[0].count, 1);
  await sql`DELETE FROM auth.users WHERE id=${b}`;
  await revert();
  assert.equal((await sql`SELECT to_regclass('public.swim_imports') AS name`)[0].name, null);
  stages.push(stage);
  status = "passed";
} catch (error) {
  failureCode = ["42501", "23503", "23505", "23514", "22023", "P0001", "42601", "42703", "42883",
    "42P01", "42P07", "42704", "25P02", "57014", "55P03", "40P01"].includes(error?.code)
    ? error.code : error?.code === "ERR_ASSERTION" ? "assertion" : "unexpected";
} finally {
  if (sql) {
    try { await sql.end({ timeout: 5 }); }
    catch { status = "failed"; stage = "connection-cleanup"; failureCode = "cleanup"; }
  }
}
console.log(JSON.stringify({
  scope: "swim-import-storage", sha: /^[0-9a-f]{40}$/.test(process.env.TESTED_SHA ?? "") ? process.env.TESTED_SHA : null,
  status, stages, ...(status === "failed" ? { stage, code: failureCode } : {}),
}));
if (status !== "passed") process.exitCode = 1;
