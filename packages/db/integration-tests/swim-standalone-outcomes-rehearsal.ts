import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { generateSwimPlan } from "../../engine/src/swimming.ts";
import { poolCourse } from "../../domain/src/swimming.ts";

type Created = { plan: { id: string; revision: number }; workouts: { id: string; revision: number }[] };
type Receipt = { id: string; revision: number };
const json = (value: unknown) => JSON.stringify(value);

/** Uses the already-owned fresh migration fixture; all synthetic rows roll back. */
export async function rehearseStandaloneSwimOutcomes(
  database: postgres.Sql, down: string, stage: (name: string) => void,
): Promise<string[]> {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.platform, "linux");
  assert.deepEqual(database.options.host, ["127.0.0.1"]);
  assert.deepEqual(database.options.port, [5432]);
  assert.equal(database.options.database, "swim_migration_runner_fresh");
  assert.equal(database.options.max, 1);
  const [context] = await database`SELECT current_database() AS name, current_user AS actor`;
  assert.deepEqual({ ...context }, { name: "swim_migration_runner_fresh", actor: "postgres" });
  assert.equal((await database`SELECT count(*)::int AS n FROM auth.users`)[0]!.n, 0);
  assert.match(down, /^BEGIN;\r?\n/);
  assert.match(down, /\r?\nCOMMIT;\r?\n?$/);
  const downBody = down.replace(/^BEGIN;\r?\n/, "").replace(/\r?\nCOMMIT;\r?\n?$/, "");
  const stages: string[] = [];
  const rolledBack = new Error("standalone_outcome_fixture_rollback");
  const ledger = () => database`SELECT id,hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id`;
  const beforeLedger = await ledger();
  await assert.rejects(database.begin(async (tx) => {
    await tx.unsafe("SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s'");
    const asUser = <T>(user: string | null, work: (scoped: postgres.TransactionSql) => Promise<T>) =>
      tx.savepoint(async (scoped) => {
        await scoped.unsafe(user ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
        await scoped`SELECT set_config('request.jwt.claims',${json(user ? { sub: user } : {})},true)`;
        const value = await work(scoped);
        await scoped.unsafe("SET LOCAL ROLE postgres");
        await scoped`SELECT set_config('request.jwt.claims','{}',true)`;
        return value;
      });
    const denied = (work: () => Promise<unknown>, code: string) => assert.rejects(work, (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === code);
    const a = randomUUID(), b = randomUUID();
    stage("standalone-outcome-synthetic-fixtures");
    await tx`INSERT INTO auth.users(id) VALUES (${a}),(${b})`;
    const [dates] = await tx<{ today: string; recorded: string }[]>`SELECT
      to_char(current_date,'YYYY-MM-DD') AS today,to_char(current_date-1,'YYYY-MM-DD') AS recorded`;
    assert.ok(dates);
    const setup = {
      goal: "endurance" as const, experience: "recreational" as const, course: poolCourse(25, 1, "m"),
      knownStrokes: ["freestyle" as const], equipment: [], recentComfortableLengths: 8, sessionBudgetMinutes: 60,
    };
    const generated = generateSwimPlan({ setup, calibration: null,
      weeks: [{ weekIndex: 0, startDateISO: dates.today, slots: [
        { slotId: "outcome-a", dateISO: dates.today, intent: "moderate", source: "swim_date" },
        { slotId: "outcome-b", dateISO: dates.today, intent: "moderate", source: "swim_date" },
      ] }] });
    assert.ok(generated.ok);
    const workouts = generated.value.weeks[0]!.slots.map((slot) => {
      assert.equal(slot.kind, "workout");
      if (slot.kind !== "workout") throw new Error("Expected generated fixture workout");
      return { scheduled_date: dates.today, slot: "single", definition: {
        version: 1, original: slot.original, issued: slot.issued, modifications: [], slotId: slot.slotId,
      } };
    });
    const create = (user: string) => asUser(user, async (scoped) =>
      (await scoped<{ value: Created }[]>`SELECT public.swim_create_plan(
        ${dates.today}::date,${dates.today}::date,
        ${json({ version: 1, setup, generatorVersion: "swim-gen-1" })}::text::jsonb,
        ${json({ version: 1, observations: [], acceptedCalibration: null, decisions: [] })}::text::jsonb,
        ${json(workouts)}::text::jsonb) AS value`)[0]!.value);
    const own = await create(a), other = await create(b);
    const work = own.workouts[0]!, second = own.workouts[1]!;
    const tokenHash = "d".repeat(64);
    await asUser(a, (scoped) => scoped`SELECT public.swim_import_connect(${tokenHash})`);
    const evidence = {
      version: 1, source: "local_dashboard", activityId: "10001", date: dates.recorded, environment: "pool",
      workoutReference: null, distanceMetres: 300, recordedDurationMs: 300000, durationKind: "unspecified",
      nativeCourse: null, detail: { status: "missing", fetchedAt: null, splits: [] },
    };
    const receive = (distanceMetres = 300) => tx.savepoint(async (scoped) => {
      await scoped.unsafe("SET LOCAL ROLE service_role");
      const [row] = await scoped<{ value: Receipt }[]>`SELECT public.swim_import_receive(
        ${tokenHash},${json({ ...evidence, distanceMetres })}::text::jsonb) AS value`;
      await scoped.unsafe("SET LOCAL ROLE postgres");
      return row!.value;
    });
    const imported = await receive();
    const match = (receipt: string, expected: string | null, target = work) => asUser(a, async (scoped) =>
      (await scoped<{ id: string }[]>`SELECT public.swim_match_import(${randomUUID()}::uuid,
        ${receipt}::uuid,${target.id}::uuid,${expected}::uuid,${target.revision}) AS id`)[0]!.id);
    const matched = await match(imported.id, null);
    const confirm = (user: string | null, outcome: "completed" | "stopped_early" | null, expected: string | null,
      request: string = randomUUID(), matchId: string | null = outcome === null ? null : matched, target = work) =>
      asUser(user, async (scoped) => (await scoped<{ id: string }[]>`SELECT public.swim_confirm_import_outcome(
        ${request}::uuid,${target.id}::uuid,${matchId}::uuid,${outcome}::text,${expected}::uuid,
        ${outcome === null ? null : target.revision}::integer) AS id`)[0]!.id);
    const activity = (user: string) => asUser(user, (scoped) =>
      scoped`SELECT * FROM public.swim_import_outcome_activity ORDER BY id`);
    const workActivity = async () => {
      const rows = await activity(a);
      assert.equal(rows.length, own.workouts.length);
      const row = rows.find((value) => value.id === work.id);
      assert.ok(row);
      return row;
    };
    const trainingSnapshot = () => tx`SELECT
      (SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM public.swim_workouts w) AS workouts,
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sessions s) AS sessions,
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cardio_logs c) AS cardio`;
    const trainingBefore = await trainingSnapshot();

    stage("standalone-outcome-view-owner-isolation-and-unconfirmed");
    assert.equal((await tx`SELECT count(*)::int AS n FROM public.training_blocks`)[0]!.n, 0);
    assert.deepEqual(new Set((await activity(b)).map((row) => row.id)), new Set(other.workouts.map((row) => row.id)));
    const unconfirmed = await workActivity();
    assert.equal(unconfirmed.outcome_id, null);
    assert.equal(unconfirmed.session_id, null);
    assert.equal(unconfirmed.native_completed_at, null);
    assert.equal(unconfirmed.plan_status, "active");
    assert.equal(unconfirmed.status, "scheduled");
    await denied(() => asUser(null, (scoped) => scoped`SELECT * FROM public.swim_import_outcome_activity`), "42501");
    await denied(() => confirm(b, "completed", null), "42501");
    await denied(() => confirm(null, "completed", null), "42501");
    await denied(() => asUser(a, (scoped) => scoped`INSERT INTO public.swim_import_outcomes(id)
      VALUES (${randomUUID()})`), "42501");
    stages.push("standalone-outcome-view-owner-isolation-and-unconfirmed");

    stage("standalone-outcome-confirm-replay-and-dates");
    const confirmed = randomUUID();
    assert.equal(await confirm(a, "completed", null, confirmed), confirmed);
    assert.equal(await confirm(a, "completed", null, confirmed), confirmed);
    await denied(() => confirm(a, "stopped_early", null, confirmed), "22023");
    await denied(() => confirm(a, "completed", null), "40001");
    const completed = await workActivity();
    assert.equal(completed.outcome_id, confirmed);
    assert.equal(completed.outcome_metadata.outcome, "completed");
    assert.equal(completed.current_match_id, matched);
    assert.equal(completed.claim_import_id, imported.id);
    assert.equal(completed.matched_import_id, imported.id);
    assert.equal(completed.latest_import_id, imported.id);
    assert.equal(completed.recording_date, dates.recorded);
    assert.equal(completed.claim_recording_date, dates.recorded);
    assert.equal((await tx`SELECT scheduled_date::text AS date FROM public.swim_workouts WHERE id=${work.id}`)[0]!.date,
      dates.today);
    assert.equal(completed.session_id, null);
    const stopped = await confirm(a, "stopped_early", confirmed);
    assert.equal((await workActivity()).outcome_metadata.outcome, "stopped_early");
    assert.deepEqual(await trainingSnapshot(), trainingBefore);
    stages.push("standalone-outcome-confirm-replay-and-dates");

    stage("standalone-outcome-correction-rematch-and-removal");
    const corrected = await receive(350);
    const stale = await workActivity();
    assert.equal(stale.matched_import_id, imported.id);
    assert.equal(stale.latest_import_id, corrected.id);
    assert.equal(stale.claim_import_id, imported.id);
    await denied(() => confirm(a, "completed", stopped), "40001");
    const rematched = await match(corrected.id, matched, second);
    const detached = await workActivity();
    assert.equal(detached.current_match_id, null);
    assert.equal(detached.claim_import_id, imported.id);
    assert.equal(detached.claim_recording_date, dates.recorded);
    await denied(() => confirm(a, "completed", stopped), "40001");
    const removed = await confirm(a, null, stopped);
    assert.equal(await confirm(a, null, stopped, removed), removed);
    assert.equal((await workActivity()).outcome_match_id, null);
    assert.equal((await workActivity()).outcome_metadata.outcome, null);
    const secondOutcome = await confirm(a, "completed", null, randomUUID(), rematched, second);
    assert.equal((await activity(a)).find((row) => row.id === second.id)!.outcome_id, secondOutcome);
    assert.deepEqual(await trainingSnapshot(), trainingBefore);
    stages.push("standalone-outcome-correction-rematch-and-removal");

    stage("standalone-outcome-ended-plan-retains-claim");
    await asUser(a, (scoped) => scoped`SELECT public.swim_set_plan_status(
      ${own.plan.id}::uuid,${own.plan.revision},'finished')`);
    assert.equal((await activity(a)).find((row) => row.id === second.id)!.outcome_id, secondOutcome);
    assert.ok((await activity(a)).every((row) => row.plan_status === "finished"));
    assert.deepEqual(await trainingSnapshot(), trainingBefore);
    stages.push("standalone-outcome-ended-plan-retains-claim");

    stage("standalone-outcome-history-down-refusal-and-account-cascade");
    await denied(() => tx.savepoint((scoped) => scoped.unsafe(downBody)), "P0001");
    assert.equal((await workActivity()).outcome_id, removed);
    await tx`DELETE FROM auth.users WHERE id=${a}`;
    assert.equal((await tx`SELECT count(*)::int AS n FROM public.swim_import_outcomes WHERE user_id=${a}`)[0]!.n, 0);
    assert.equal((await tx`SELECT count(*)::int AS n FROM public.swim_import_matches WHERE user_id=${a}`)[0]!.n, 0);
    assert.equal((await tx`SELECT count(*)::int AS n FROM public.swim_imports WHERE user_id=${a}`)[0]!.n, 0);
    assert.deepEqual(new Set((await activity(b)).map((row) => row.id)), new Set(other.workouts.map((row) => row.id)));
    await tx.unsafe("SET CONSTRAINTS ALL IMMEDIATE");
    stages.push("standalone-outcome-history-down-refusal-and-account-cascade");
    throw rolledBack;
  }), (error: unknown) => error === rolledBack);
  assert.equal((await database`SELECT count(*)::int AS n FROM auth.users`)[0]!.n, 0);
  assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_import_outcomes`)[0]!.n, 0);
  assert.deepEqual(await ledger(), beforeLedger);
  return [...stages, "standalone-outcome-fixtures-rolled-back"];
}
