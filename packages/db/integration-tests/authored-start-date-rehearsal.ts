import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { authoredProgramDates, type AuthoredProgramDefinitionV2 } from "../../domain/src/authored-program.ts";
import { assertOwnershipRefusal, independentProgramFixture } from "./independent-programs-rehearsal.ts";

export async function rehearseAuthoredStartDate(database: postgres.Sql, stage: (name: string) => void) {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_JOB, "pool-storage");
  assert.equal(process.platform, "linux");
  assert.deepEqual(database.options.host, ["127.0.0.1"]);
  assert.equal(database.options.database, "swim_pool_test");
  const up = readFileSync(new URL("../drizzle/0164_authored_program_start_date.sql", import.meta.url), "utf8");
  const down = readFileSync(new URL("../rollbacks/0164_authored_program_start_date.down.sql", import.meta.url), "utf8");
  const catalog = async () => JSON.stringify(await database`SELECT
    (SELECT jsonb_agg(jsonb_build_array(oid::regprocedure::text,pg_get_functiondef(oid),proowner,proacl::text,proconfig,prosecdef)
      ORDER BY oid::regprocedure::text) FROM pg_proc WHERE pronamespace='public'::regnamespace) AS routines,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public') AS policies`);
  const revert = async () => {
    const connection = await database.reserve();
    try { await connection.unsafe(down); }
    catch (error) { await connection.unsafe("ROLLBACK"); throw error; }
    finally { connection.release(); }
  };
  const stages: string[] = [];
  const mark = (name: string) => { stage(name); stages.push(name); };
  mark("0164-function-only-up-down-up-keeps-permissions-and-policies");
  const baseline = await catalog();
  await database.begin((tx) => tx.unsafe(up));
  const installed = await catalog();
  await revert(); assert.equal(await catalog(), baseline);
  await database.begin((tx) => tx.unsafe(up)); assert.equal(await catalog(), installed);
  const owner = randomUUID(), foreign = randomUUID();
  const asUser = <T>(user: string, work: (tx: postgres.TransactionSql) => Promise<T>) => database.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE authenticated");
    await tx`SELECT set_config('request.jwt.claims',${JSON.stringify({ sub: user })},true)`;
    return work(tx);
  });
  const snapshot = (user: string = owner) => asUser(user, async (tx) =>
    (await tx`SELECT public.training_schedule_snapshot() AS value`)[0]!.value as { revision: string; authoredStartDateChanges: true; entries: { id: string; date: string }[] });
  const commitTx = async (tx: postgres.TransactionSql, operation: string, args: unknown, revision: string, requestId: string, accept: boolean) =>
    (await tx`SELECT public.independent_program_schedule_commit(${operation},${JSON.stringify(args)}::jsonb,
      ${revision},${requestId}::uuid,${createHash("sha256").update(JSON.stringify(args)).digest("hex")},${accept}) AS value`)[0]!.value;
  const commit = async (operation: string, args: unknown, options: { user?: string; revision?: string; requestId?: string; accept?: boolean } = {}) => {
    const user = options.user ?? owner, revision = options.revision ?? (await snapshot(user)).revision;
    return asUser(user, (tx) => commitTx(tx, operation, args, revision, options.requestId ?? randomUUID(), options.accept ?? false));
  };
  const graph = async () => JSON.stringify(await database`SELECT
    (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.training_blocks b WHERE user_id IN (${owner}::uuid,${foreign}::uuid)) AS blocks,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.planned_sessions p WHERE user_id IN (${owner}::uuid,${foreign}::uuid)) AS planned,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.program_instances i WHERE user_id IN (${owner}::uuid,${foreign}::uuid)) AS instances,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sessions s WHERE user_id IN (${owner}::uuid,${foreign}::uuid)) AS sessions,
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.engine_override_events e WHERE user_id IN (${owner}::uuid,${foreign}::uuid)) AS receipts`);
  const barrier = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    return { promise, release };
  };
  try {
    await database`INSERT INTO auth.users(id) VALUES(${owner}),(${foreign})`;
    const [calendar] = await database<{ today: string; weekday: number; later: string; next: string }[]>`
      SELECT to_char(current_date,'YYYY-MM-DD') AS today,extract(isodow FROM current_date)::int-1 AS weekday,
        to_char(current_date+14,'YYYY-MM-DD') AS later,to_char(current_date+15,'YYYY-MM-DD') AS next`;
    const [movement] = await database`SELECT id FROM public.movements WHERE user_id IS NULL AND pattern<>'cardio' ORDER BY id LIMIT 1`;
    assert.ok(calendar && movement);
    const definition: AuthoredProgramDefinitionV2 = {
      version: 2, activity: "strength", name: "Synthetic date edit",
      weeks: [{ type: "Build", sets: "3", reps: "5", pct: 75 }, { type: "Deload", sets: "1", reps: "5", pct: 60 }],
      workouts: [calendar.weekday, (calendar.weekday + 1) % 7].map((weekday) => ({
        id: randomUUID(), name: "Synthetic workout", weekday, parts: [],
      })),
    };
    const items = [{ movementId: movement.id, kind: "main", sets: 1, reps: 5 }];
    const fixture = independentProgramFixture("strength", calendar, items);
    const dated = authoredProgramDates(definition, calendar.today);
    const args = {
      ...fixture, p_block: { ...fixture.p_block, weeks: Math.max(...dated.map((row) => row.weekIndex)) + 1, days_per_week: 2 },
      p_program_instance: { ...fixture.p_program_instance, instance: definition,
        setup_input: { definition, startedOn: calendar.today } },
      p_planned_sessions: dated.map((row) => ({
        ...fixture.p_planned_sessions[0]!, week_index: row.weekIndex, day_index: row.dayIndex,
        prescription: { items, programRef: row.ref, meta: { authoredWeekIndex: row.authoredWeekIndex } },
      })),
    };
    const target = await commit("primary-create", args);
    const other = await commit("primary-create", args, { user: foreign });
    const peerArgs = independentProgramFixture("hybrid", { ...calendar, today: calendar.later }, items);
    const peer = await commit("primary-create", peerArgs);
    await asUser(owner, (tx) => tx`UPDATE public.planned_sessions SET notes='Retained note',
      prescription=prescription||'{"userEdited":true}'::jsonb WHERE block_id=${target.block_id}::uuid`);
    const peersBefore = JSON.stringify(await database`SELECT to_jsonb(b) AS block,to_jsonb(i) AS instance
      FROM public.training_blocks b JOIN public.program_instances i ON i.block_id=b.id
      WHERE b.id IN (${other.block_id}::uuid,${peer.block_id}::uuid) ORDER BY b.id`);
    const rows = async () => database<{ id: string; prescription: { programRef: string }; notes: string | null }[]>`
      SELECT id,prescription,notes FROM public.planned_sessions WHERE block_id=${target.block_id}::uuid ORDER BY id`;
    const dateArgs = async (date: string) => {
      const [block] = await database`SELECT started_on::text FROM public.training_blocks WHERE id=${target.block_id}::uuid`;
      const next = authoredProgramDates(definition, date);
      return {
        p_block_id: target.block_id, programKind: "strength", p_strength_updates: [], p_deletions: [], p_insertions: [],
        p_block_metadata: { weeks: Math.max(...next.map((row) => row.weekIndex)) + 1, days_per_week: 2,
          day_index_overrides: fixture.p_block.day_index_overrides, cardio_source: "internal", notes: definition.name,
          started_on: date, authored_start_date_change: { expected_started_on: block!.started_on, updates: (await rows()).map((row) => {
            const fresh = next.find((entry) => entry.ref === row.prescription.programRef)!;
            return { id: row.id, week_index: fresh.weekIndex, day_index: fresh.dayIndex };
          }) } },
        p_tm_percents: [], p_program_instance: { ...args.p_program_instance, setup_input: { definition, startedOn: date } },
      };
    };
    mark("0164-DC-K4-overlap-stale-owner-scope-and-partial-write-rollback");
    assert.equal((await snapshot()).authoredStartDateChanges, true);
    const change = await dateArgs(calendar.later), before = await graph();
    await assertOwnershipRefusal(() => commit("authored-start-date", change), "22023");
    assert.equal(await graph(), before);
    await assertOwnershipRefusal(() => commit("authored-start-date", change, { user: foreign, accept: true }), "P0001");
    await assertOwnershipRefusal(() => commit("authored-start-date", change, { revision: "0".repeat(32), accept: true }), "40001");
    await assertOwnershipRefusal(() => commit("authored-workout", { blockId: target.block_id, programKind: "strength",
      p_block_metadata: change.p_block_metadata, updates: [] }), "22023");
    await assertOwnershipRefusal(() => commit("primary-update", change, { accept: true }), "22023");
    const invalid = structuredClone(change);
    invalid.p_block_metadata.authored_start_date_change.updates[1] = { ...invalid.p_block_metadata.authored_start_date_change.updates[0]!,
      id: invalid.p_block_metadata.authored_start_date_change.updates[1]!.id };
    await assertOwnershipRefusal(() => commit("authored-start-date", invalid, { accept: true }), "23505");
    assert.equal(await graph(), before);

    mark("0164-DC-R5-same-identities-definition-and-canonical-week-dates");
    const retained = await rows(), requestId = randomUUID(), reviewed = (await snapshot()).revision;
    const result = await commit("authored-start-date", change, { accept: true, requestId, revision: reviewed });
    assert.deepEqual(await commit("authored-start-date", change, { accept: true, requestId, revision: reviewed }), result);
    assert.deepEqual(await rows(), retained);
    const [instance] = await database`SELECT instance,setup_input FROM public.program_instances WHERE id=${target.program_instance_id}::uuid`;
    assert.deepEqual(instance!.instance, definition);
    assert.deepEqual(instance!.setup_input, { definition, startedOn: calendar.later });
    const dates = new Map((await snapshot()).entries.map((row) => [row.id, row.date]));
    for (const row of retained) assert.equal(dates.get(row.id), authoredProgramDates(definition, calendar.later)
      .find((entry) => entry.ref === row.prescription.programRef)!.date);
    await commit("authored-start-date", await dateArgs(calendar.next), { accept: true });
    assert.deepEqual(await rows(), retained);
    assert.equal(JSON.stringify(await database`SELECT to_jsonb(b) AS block,to_jsonb(i) AS instance
      FROM public.training_blocks b JOIN public.program_instances i ON i.block_id=b.id
      WHERE b.id IN (${other.block_id}::uuid,${peer.block_id}::uuid) ORDER BY b.id`), peersBefore);
    await assertOwnershipRefusal(() => revert(), "55000");

    mark("0164-unchanged-historical-date-payload-remains-compatible");
    const unchanged = await dateArgs(calendar.next);
    const { started_on: _date, authored_start_date_change: _change, ...metadata } = unchanged.p_block_metadata;
    await commit("primary-update", { ...unchanged, p_block_metadata: metadata }, { accept: true });
    assert.deepEqual(await rows(), retained);

    mark("0164-manually-moved-date-and-notes-survive-atomic-date-change");
    const manualId = retained[retained.length - 1]!.id;
    await asUser(owner, (tx) => tx`UPDATE public.planned_sessions SET week_index=4,day_index=5,
      prescription=jsonb_set(prescription,'{meta,userRescheduled}','true'::jsonb)
      WHERE id=${manualId}::uuid`);
    const manualDate = (await snapshot()).entries.find((row) => row.id === manualId)!.date;
    const manualChange = await dateArgs(calendar.later);
    manualChange.p_block_metadata.weeks = 5;
    const manualUpdate = manualChange.p_block_metadata.authored_start_date_change.updates.find((row) => row.id === manualId)!;
    const nextMonday = new Date(calendar.later + "T00:00:00Z");
    nextMonday.setUTCDate(nextMonday.getUTCDate() - (nextMonday.getUTCDay() + 6) % 7);
    const offset = (Date.parse(manualDate + "T00:00:00Z") - nextMonday.getTime()) / 86400000;
    manualUpdate.week_index = Math.floor(offset / 7); manualUpdate.day_index = offset % 7;
    const manualRows = await rows();
    await commit("authored-start-date", manualChange, { accept: true });
    assert.deepEqual(await rows(), manualRows);
    assert.equal((await snapshot()).entries.find((row) => row.id === manualId)!.date, manualDate);

    mark("0164-start-wins-lock-race-and-incomplete-hidden-workout-denial");
    const staleChange = await dateArgs(calendar.next), staleRevision = (await snapshot()).revision;
    const locked = barrier(), release = barrier();
    const starting = asUser(owner, async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"program-deploy:" + owner},0))`;
      const [started] = await tx`SELECT public.start_planned_session_atomically(${retained[0]!.id}::uuid) AS id`;
      locked.release(); await release.promise; return started!.id as string;
    });
    await Promise.race([locked.promise, starting.then(() => { throw new Error("Start lock barrier was not reached"); })]);
    const deniedSave = assertOwnershipRefusal(() => commit("authored-start-date", staleChange,
      { accept: true, revision: staleRevision }), "40001");
    release.release();
    const [sessionId] = await Promise.all([starting, deniedSave]);
    const underway = await graph();
    await assertOwnershipRefusal(() => commit("authored-start-date", staleChange, { accept: true }), "40001");
    assert.equal(await graph(), underway);
    const [session] = await database`SELECT completed_at FROM public.sessions WHERE id=${sessionId}::uuid`;
    assert.equal(session!.completed_at, null);
    await asUser(owner, (tx) => tx`UPDATE public.sessions SET completed_at=now() WHERE id=${sessionId}::uuid`);
    await assertOwnershipRefusal(() => commit("authored-start-date", staleChange, { accept: true }), "40001");
    await asUser(owner, (tx) => tx`UPDATE public.sessions SET deleted_at=now() WHERE id=${sessionId}::uuid`);
    await assertOwnershipRefusal(() => asUser(owner, (tx) =>
      tx`UPDATE public.planned_sessions SET skipped_at=now() WHERE id=${retained[0]!.id}::uuid`), "23514");
    await assertOwnershipRefusal(() => commit("authored-start-date", staleChange, { accept: true }), "40001");
    assert.equal((await database`SELECT completed_session_id FROM public.planned_sessions WHERE id=${retained[0]!.id}::uuid`)[0]!.completed_session_id, sessionId);

    mark("0164-save-wins-lock-race-starts-the-retained-current-workout");
    const foreignRows = await database<{ id: string; week_index: number; day_index: number }[]>`
      SELECT id,week_index,day_index FROM public.planned_sessions WHERE block_id=${other.block_id}::uuid ORDER BY id`;
    const forward = { ...change, p_block_id: other.block_id, p_block_metadata: {
      ...change.p_block_metadata, authored_start_date_change: { expected_started_on: calendar.today,
        updates: foreignRows.map((row) => ({ id: row.id, week_index: row.week_index, day_index: row.day_index })) },
    } };
    const saveLocked = barrier(), releaseSave = barrier(), foreignRevision = (await snapshot(foreign)).revision;
    const saving = asUser(foreign, async (tx) => {
      await commitTx(tx, "authored-start-date", forward, foreignRevision, randomUUID(), true);
      saveLocked.release(); await releaseSave.promise;
    });
    await Promise.race([saveLocked.promise, saving.then(() => { throw new Error("Save lock barrier was not reached"); })]);
    const startAfterSave = asUser(foreign, async (tx) =>
      (await tx`SELECT public.start_planned_session_atomically(${foreignRows[0]!.id}::uuid) AS id`)[0]!.id);
    releaseSave.release();
    const [, startedId] = await Promise.all([saving, startAfterSave]);
    assert.equal((await database`SELECT completed_session_id FROM public.planned_sessions WHERE id=${foreignRows[0]!.id}::uuid`)[0]!.completed_session_id, startedId);
    assert.equal((await database`SELECT started_on::text FROM public.training_blocks WHERE id=${other.block_id}::uuid`)[0]!.started_on, calendar.later);
    return stages;
  } catch (error) {
    if (error instanceof Error) {
      const sqlstate = "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : undefined;
      const assertionLine = error.stack?.match(/authored-start-date-rehearsal\.ts:(\d+):\d+/)?.[1];
      console.error(JSON.stringify({ scope: "authored-start-date-rehearsal", sqlstate, assertionLine }));
    }
    throw error;
  } finally {
    await database`DELETE FROM auth.users WHERE id IN (${owner},${foreign})`;
  }
}
