import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { movements } from "../src/schema/movements.ts";
import { SEED_MOVEMENTS } from "../seeds/movements.ts";
import {
  authoredProgramDates, compileAuthoredWorkout, poolCourse, resolvePrescribedSnapshot,
  type AuthoredCatalogMovement, type AuthoredProgramDefinition,
} from "../../domain/src/index.ts";
import { tacticalBarbellEngine } from "../../tacticalbarbell/src/program.ts";
import { generateSwimPlan } from "../../engine/src/swimming.ts";
import { inspectModularReferences, requireCompatibleModularReferences } from "../scripts/modular-production-references";
import type { ModularUpdateObserver } from "../scripts/modular-production-update-storage";

type Created = { block_id: string; program_instance_id: string };
type Table = { schema: string; name: string };
type Digest = { table: string; rows: number; sha256: string };
const json = (value: unknown) => JSON.stringify(value);

export function modularHistoricalAssertionLine(error: unknown): number | undefined {
  if (!(error instanceof assert.AssertionError)) return;
  let stack: unknown;
  try { stack = error.stack; } catch { return; }
  if (typeof stack !== "string") return;
  const match = stack.match(/(?:^|\n)\s+at [^\n]*[/\\]modular-production-legacy-graph\.ts:(\d+):\d+\)?(?:\n|$)/);
  const line = Number(match?.[1]);
  if (Number.isInteger(line) && line >= 1 && line <= 9999) return line;
}

export function modularHistoricalMovementSeeds() {
  return ["bench-press-flat", "back-squat-high-bar"].map((slug) => {
    const matches = SEED_MOVEMENTS.filter((seed) => seed.slug === slug);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]!.userId, null);
    return matches[0]!;
  });
}

export function createModularHistoricalCatalog(database: postgres.Sql) {
  const inserted: string[] = [];
  return {
    async prepare() {
      for (const seed of modularHistoricalMovementSeeds()) {
        const existing = await database`SELECT id FROM public.movements WHERE user_id IS NULL AND slug=${seed.slug}`;
        assert.ok(existing.length <= 1);
        if (existing.length === 0) {
          const id = randomUUID();
          inserted.push(id);
          await drizzle(database).insert(movements).values({ ...seed, id });
        }
      }
    },
    async cleanup() {
      for (const id of inserted) await database`DELETE FROM public.movements WHERE id=${id}::uuid AND user_id IS NULL`;
    },
  };
}

export function modularHistoricalInputs(bench: AuthoredCatalogMovement, squat: AuthoredCatalogMovement, today: string) {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const startedOn = new Date(`${today}T00:00:00Z`);
  startedOn.setUTCDate(startedOn.getUTCDate() - 7);
  const definition: AuthoredProgramDefinition = {
    version: 1, activity: "strength", name: "Synthetic historical strength", weeks: 1,
    workouts: [weekday, (weekday + 1) % 7].map((day) => ({
      id: randomUUID(), name: "Historical strength workout", weekday: day,
      parts: [{ id: randomUUID(), kind: "movement", movement: {
        id: randomUUID(), movementId: bench.id, role: "main", sets: 1,
        dose: { kind: "reps", reps: 5 }, weightKg: 20, restSeconds: 0, notes: "",
      } }],
    })),
  };
  const planned = authoredProgramDates(definition, startedOn.toISOString().slice(0, 10)).map(({ workout, weekIndex, dayIndex, ref }) => ({
    week_index: weekIndex, day_index: dayIndex, slot: "single", title: workout.name, role: "strength",
    prescription: { ...compileAuthoredWorkout(workout, [bench]), programRef: ref },
  }));
  const authored = {
    p_block: { program_id: "authored", program_family: "strength", started_on: startedOn.toISOString().slice(0, 10),
      weeks: Math.max(...planned.map((row) => row.week_index)) + 1, days_per_week: 2,
      day_index_overrides: { days: definition.workouts.map((workout) => workout.weekday) },
      cardio_source: "internal", allows_two_a_days: false, accessory_volume: "medium", notes: definition.name },
    p_planned_sessions: planned,
    p_program_instance: { program_id: "authored", program_family: "strength", display_name: definition.name,
      customization_version: 1, instance: definition, setup_input: { version: 1, definition, startedOn: startedOn.toISOString().slice(0, 10) } },
  };
  const ctx = { oneRepMaxes: { bench: 100, squat: 100 }, roundingKg: 2.5 };
  const values = { templateId: "fighter", blocks: 1, cluster: ["bench", "squat"], useTemplateDefaults: false,
    useTrainingMax: true, tmPercent: 0.9 };
  const instance = tacticalBarbellEngine.setup({ values }, ctx);
  const template = {
    p_block: { ...authored.p_block, program_id: tacticalBarbellEngine.meta.id, program_family: tacticalBarbellEngine.meta.family,
      weeks: instance.blockWeeks, day_index_overrides: { days: [0, 3] } },
    p_program_instance: { program_id: tacticalBarbellEngine.meta.id, program_family: tacticalBarbellEngine.meta.family,
      instance, setup_input: { values, weekdays: [0, 3], startedOn: authored.p_block.started_on } },
    p_planned_sessions: tacticalBarbellEngine.timeline(instance).map((spec) => ({
      week_index: Math.floor(spec.index / 2), day_index: spec.index % 2 === 0 ? 0 : 3,
      slot: "single", title: spec.label, role: "strength",
      prescription: { programRef: spec.ref, items: tacticalBarbellEngine.prescribe(instance, spec.ref, ctx).items.flatMap((item) => {
        assert.ok(item.kind === "main" || item.kind === "warmup");
        assert.ok(item.movementId === "bench" || item.movementId === "squat");
        return Array.from({ length: item.sets ?? 1 }, () => ({
          kind: item.kind, movementId: item.movementId === "bench" ? bench.id : squat.id, sets: 1,
          reps: item.reps, targetWeightKg: item.weightKg, notes: item.note,
          meta: { historicalEnginePrescription: item },
        }));
      }) },
    })),
  };
  return { authored, template };
}

export function modularHistoricalSwimInputs(today: string, tomorrow: string) {
  const setup = { goal: "endurance" as const, experience: "recreational" as const, course: poolCourse(25, 1, "m"),
    knownStrokes: ["freestyle" as const], equipment: [], recentComfortableLengths: 8, sessionBudgetMinutes: 60 };
  const generated = generateSwimPlan({ setup, calibration: null, weeks: [{ weekIndex: 0, startDateISO: today,
    slots: [today, tomorrow].map((dateISO, index) => ({
      slotId: `historical-${index}`, dateISO, intent: "moderate" as const, source: "swim_date" as const,
    })) }] });
  assert.ok(generated.ok);
  const workouts = generated.value.weeks[0]!.slots.map((slot, index) => {
    assert.equal(slot.kind, "workout");
    if (slot.kind !== "workout") throw new Error("Expected a historical swim workout");
    return { scheduled_date: index === 0 ? today : tomorrow, slot: "single",
      definition: { version: 1, original: slot.original, issued: slot.issued, modifications: [], slotId: slot.slotId } };
  });
  return { setup, workouts };
}

/** Historical paths only; no production connections or post-0155 writer is used. */
export function createModularHistoricalGraph(database: postgres.Sql) {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_JOB, "pool-storage");
  assert.equal(process.platform, "linux");
  assert.deepEqual(database.options.host, ["127.0.0.1"]);
  assert.deepEqual(database.options.port, [5432]);
  assert.equal(database.options.database, "swim_pool_test");
  const owners = [randomUUID(), randomUUID()];
  const movementFixture = createModularHistoricalCatalog(database);
  let tables: Table[] = [], original: Digest[] | undefined, prepared: Digest[] | undefined;
  let legacy: Created | undefined, orphan: Created | undefined, template: Created | undefined;
  const asOwner = <T>(owner: string, work: (tx: postgres.TransactionSql) => Promise<T>) => database.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE authenticated");
    await tx`SELECT set_config('request.jwt.claims',${json({ sub: owner })},true)`;
    return work(tx);
  });
  const snapshot = async (): Promise<Digest[]> => {
    assert.ok(tables.length > 0);
    const result: Digest[] = [];
    for (const table of tables) {
      assert.match(table.schema, /^(public|auth)$/);
      assert.match(table.name, /^[a-z_][a-z0-9_]*$/);
      const value = table.name === "training_blocks" ? "(to_jsonb(r)-'program_kind')" : "to_jsonb(r)";
      const [row] = await database.unsafe<{ rows: number; sha256: string }[]>(
        `SELECT count(*)::int AS rows,encode(sha256(convert_to(COALESCE(string_agg(${value}::text,E'\\n' ORDER BY ${value}::text),''),'UTF8')),'hex') AS sha256
         FROM "${table.schema}"."${table.name}" r`);
      assert.ok(row);
      result.push({ table: `${table.schema}.${table.name}`, ...row });
    }
    return result;
  };
  const unchanged = async () => { assert.ok(prepared); assert.deepEqual(await snapshot(), prepared); };
  return {
    async prepare() {
      assert.equal(original, undefined);
      assert.equal((await database`SELECT count(*)::int AS n FROM auth.users`)[0]!.n, 0);
      tables = Array.from(await database<Table[]>`SELECT n.nspname AS schema,c.relname AS name FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p')
        ORDER BY n.nspname,c.relname LIMIT 257`);
      assert.ok(tables.length > 0 && tables.length <= 256);
      original = await snapshot();
      await movementFixture.prepare();
      await database`INSERT INTO auth.users(id) VALUES (${owners[0]!}),(${owners[1]!})`;
      const catalog = await database<{ id: string; slug: string; display_name: string; pattern: string }[]>`
        SELECT id,slug,display_name,pattern FROM public.movements WHERE user_id IS NULL
        AND slug IN ('bench-press-flat','back-squat-high-bar') ORDER BY slug`;
      assert.equal(catalog.length, 2);
      const movement = (slug: string): AuthoredCatalogMovement => {
        const row = catalog.find((item) => item.slug === slug); assert.ok(row);
        return { ...row, displayName: row.display_name };
      };
      const bench = movement("bench-press-flat"), squat = movement("back-squat-high-bar");
      const [calendar] = await database<{ today: string; tomorrow: string }[]>`
        SELECT to_char(current_date,'YYYY-MM-DD') AS today,to_char(current_date+1,'YYYY-MM-DD') AS tomorrow`;
      assert.ok(calendar);
      const input = modularHistoricalInputs(bench, squat, calendar.today);
      const deploy = (owner: string, args: typeof input.authored | typeof input.template) => asOwner(owner, async (tx) => {
        const rows = await tx<Created[]>`SELECT * FROM public.deploy_program_instance_atomically(
          ${json(args.p_block)}::text::jsonb,${json(args.p_planned_sessions)}::text::jsonb,'[]'::jsonb,
          ${json(args.p_program_instance)}::text::jsonb)`;
        assert.equal(rows.length, 1); return rows[0]!;
      });
      template = await deploy(owners[0]!, input.template);
      legacy = await deploy(owners[0]!, input.authored);
      orphan = await deploy(owners[1]!, input.authored);
      await asOwner(owners[1]!, (tx) => tx`DELETE FROM public.training_blocks WHERE id=${orphan!.block_id}::uuid RETURNING id`);
      const planned = await asOwner(owners[0]!, (tx) => tx<{ id: string }[]>`SELECT id FROM public.planned_sessions
        WHERE block_id=${legacy!.block_id}::uuid ORDER BY week_index,day_index`);
      assert.equal(planned.length, 2);
      for (const [index, work] of planned.entries()) {
        await asOwner(owners[0]!, async (tx) => {
          // The equivalent owner INSERT/link path predates the 0156 start RPC.
          const [started] = await tx<{ id: string }[]>`INSERT INTO public.sessions(user_id,title,slot,planned_at,prescription)
            SELECT user_id,title,slot,planned_at,prescription FROM public.planned_sessions WHERE id=${work.id}::uuid RETURNING id`;
          assert.ok(started);
          await tx`UPDATE public.planned_sessions SET completed_session_id=${started.id}::uuid WHERE id=${work.id}::uuid`;
          const prescribed = resolvePrescribedSnapshot(input.authored.p_planned_sessions[0]!.prescription.items[0]!);
          await tx`SELECT public.insert_set_log_with_bw_progress(${json({
            session_id: started.id, movement_id: bench.id, set_index: 1, set_kind: "main", weight_kg: 20, reps: 5,
            prescription_item_index: 0, client_log_id: randomUUID(), skipped: false,
            target_weight_kg: prescribed.targetWeightKg, target_reps: prescribed.targetReps, prescribed: prescribed.prescribed,
          })}::text::jsonb)`;
          if (index === 0) {
            const [completed] = await tx`SELECT * FROM public.complete_training_session_with_transition(
              ${started.id}::uuid,NULL,${randomUUID()}::uuid)`;
            assert.equal(completed!.transitioned, true);
          }
        });
      }
      for (const owner of owners) {
        await asOwner(owner, async (tx) => {
          const protocol = randomUUID(), season = randomUUID();
          await tx`INSERT INTO public.rehab_protocols(id,user_id,name,definition) VALUES
            (${protocol}::uuid,${owner}::uuid,'Historical rehab',${json({
              items: [{ movementId: bench.id, movementName: bench.displayName, sets: 1, reps: 5 }], links: [],
            })}::text::jsonb)`;
          await tx`INSERT INTO public.program_rehab_bindings(program_instance_id,local_protocol_id,rehab_protocol_id,user_id)
            VALUES (${owner === owners[0] ? template!.program_instance_id : orphan!.program_instance_id}::uuid,
              'protocol-1',${protocol}::uuid,${owner}::uuid)`;
          await tx`INSERT INTO public.training_seasons(id,user_id,name,status,goal_type)
            VALUES (${season}::uuid,${owner}::uuid,'Historical season','active','theme')`;
          await tx`INSERT INTO public.season_blocks(id,season_id,user_id,position,program_id,emphasis,status,block_id)
            VALUES (${randomUUID()}::uuid,${season}::uuid,${owner}::uuid,0,'authored','base',
              ${owner === owners[0] ? "active" : "planned"},${owner === owners[0] ? legacy!.block_id : null}::uuid)`;
        });
        const { setup, workouts } = modularHistoricalSwimInputs(calendar.today, calendar.tomorrow);
        const swim = await asOwner(owner, async (tx) => (await tx<{ value: { workouts: { id: string; revision: number }[] } }[]>`
          SELECT public.swim_create_plan(${calendar.today}::date,${calendar.tomorrow}::date,
            ${json({ version: 1, setup, generatorVersion: "swim-gen-1" })}::text::jsonb,
            ${json({ version: 1, observations: [], acceptedCalibration: null, decisions: [] })}::text::jsonb,
            ${json(workouts)}::text::jsonb) AS value`)[0]!.value);
        assert.equal(swim.workouts.length, 2);
        const tokenHash = createHash("sha256").update(randomUUID()).digest("hex");
        await asOwner(owner, (tx) => tx`SELECT public.swim_import_connect(${tokenHash})`);
        const receipt = await database.begin(async (tx) => {
          await tx.unsafe("SET LOCAL ROLE service_role");
          return (await tx<{ value: { id: string } }[]>`SELECT public.swim_import_receive(${tokenHash},${json({
            version: 1, source: "local_dashboard", activityId: "10001", date: calendar.today, environment: "pool",
            workoutReference: "42", distanceMetres: 300, recordedDurationMs: 300000, durationKind: "unspecified",
            nativeCourse: null, detail: { status: "missing", fetchedAt: null, splits: [] },
          })}::text::jsonb) AS value`)[0]!.value;
        });
        await asOwner(owner, (tx) => tx`SELECT public.swim_match_import(${randomUUID()}::uuid,${receipt.id}::uuid,
          ${swim.workouts[0]!.id}::uuid,NULL,${swim.workouts[0]!.revision}::integer)`);
      }
      assert.deepEqual(Array.from(await database`SELECT completed_at IS NOT NULL AS completed,count(*)::int AS n
        FROM public.sessions WHERE user_id=${owners[0]!}::uuid GROUP BY completed ORDER BY completed`),
      [{ completed: false, n: 1 }, { completed: true, n: 1 }]);
      assert.equal((await database`SELECT count(*)::int AS n FROM public.set_logs`)[0]!.n, 2);
      assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_import_matches`)[0]!.n, 2);
      assert.equal((await database`SELECT status::text FROM public.training_blocks WHERE id=${template.block_id}::uuid`)[0]!.status, "archived");
      prepared = await snapshot();
    },
    unchanged,
    async verifyReferencePreflight() {
      assert.ok(legacy && orphan);
      requireCompatibleModularReferences(await inspectModularReferences(database));
      const rollback = new Error("synthetic_owned_reference_rollback");
      await assert.rejects(database.begin(async (tx) => {
        await tx`UPDATE public.program_instances SET block_id=${legacy!.block_id}::uuid
          WHERE id=${orphan!.program_instance_id}::uuid`;
        await tx`INSERT INTO public.planned_sessions(id,user_id,block_id,week_index,day_index,slot,title,role,prescription)
          SELECT ${randomUUID()}::uuid,${owners[1]!}::uuid,block_id,week_index,day_index,'pm',title,role,prescription
          FROM public.planned_sessions WHERE block_id=${legacy!.block_id}::uuid ORDER BY week_index,day_index LIMIT 1`;
        const violations = await inspectModularReferences(tx);
        assert.deepEqual(violations, {
          program_instances_block_id_fkey: 1, planned_sessions_block_id_fkey: 1,
          swim_import_outcomes_owned_workout_fk: 0, swim_import_outcomes_owned_match_fk: 0,
          swim_plan_rehab_bindings_owned_plan_fk: 0, swim_plan_rehab_bindings_owned_protocol_fk: 0,
        });
        assert.throws(() => requireCompatibleModularReferences(violations), /owned_reference_conflict/);
        throw rollback;
      }), (error: unknown) => error === rollback);
      await unchanged();
    },
    async verifyUpgrade(substep: ModularUpdateObserver = () => {}) {
      substep("graph_hash");
      await unchanged();
      substep("graph_state");
      requireCompatibleModularReferences(await inspectModularReferences(database));
      assert.ok(legacy && orphan && template);
      assert.deepEqual(Array.from(await database`SELECT program_kind,status::text FROM public.training_blocks WHERE id=${legacy.block_id}::uuid`),
        [{ program_kind: null, status: "active" }]);
      assert.deepEqual(Array.from(await database`SELECT block_id,status FROM public.program_instances WHERE id=${orphan.program_instance_id}::uuid`),
        [{ block_id: null, status: "active" }]);
      assert.equal((await database`SELECT count(*)::int AS n FROM public.training_blocks WHERE program_kind IS NOT NULL`)[0]!.n, 0);
      assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_import_outcomes`)[0]!.n, 0);
      assert.equal((await database`SELECT count(*)::int AS n FROM public.swim_plan_rehab_bindings`)[0]!.n, 0);
      substep("isolation");
      for (const owner of owners) {
        const peer = owners.find((id) => id !== owner)!;
        for (const table of ["training_blocks", "program_instances", "sessions", "swim_plans", "swim_workouts",
          "swim_imports", "swim_import_matches", "rehab_protocols", "program_rehab_bindings", "training_seasons", "season_blocks"]) {
          const keys = table === "program_rehab_bindings" ? "program_instance_id,local_protocol_id" : "id";
          const expected = await database.unsafe(`SELECT ${keys} FROM public.${table} WHERE user_id=$1::uuid ORDER BY ${keys}`, [owner]);
          const visible = await asOwner(owner, (tx) => tx.unsafe(`SELECT ${keys} FROM public.${table} ORDER BY ${keys}`));
          assert.deepEqual(Array.from(visible), Array.from(expected));
        }
        const expectedSets = await database`SELECT l.id FROM public.set_logs l JOIN public.sessions s ON s.id=l.session_id
          WHERE s.user_id=${owner}::uuid ORDER BY l.id`;
        const visibleSets = await asOwner(owner, (tx) => tx`SELECT id FROM public.set_logs ORDER BY id`);
        assert.deepEqual(Array.from(visibleSets), Array.from(expectedSets));
        const changed = await asOwner(owner, (tx) => tx`UPDATE public.program_instances SET display_name='Denied cross-owner edit'
          WHERE user_id=${peer}::uuid RETURNING id`);
        assert.equal(changed.length, 0);
      }
      substep("graph_hash");
      await unchanged();
    },
    async cleanup() {
      if (!original) return;
      await database`DELETE FROM public.program_rehab_bindings WHERE user_id=ANY(${owners}::uuid[])`;
      await database`DELETE FROM auth.users WHERE id=ANY(${owners}::uuid[])`;
      await movementFixture.cleanup();
      assert.deepEqual(await snapshot(), original);
    },
  };
}
