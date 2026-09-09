import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrivateCommand } from "./swim-auth-privileges";
import { acceptanceAssert as assert, type AcceptanceReporting } from "./swim-acceptance-reporting";

const modes = z.enum(["baseline", "immediate", "deferred"]);
const outcomes = z.enum(["succeeded", "rejected", "setup-failed", "unavailable"]);
const states = z.enum(["none", "23503", "other"]);
const constraints = z.enum(["none", "set-logs", "session-movements", "other"]);
export const probeRecordSchema = z.object({
  mode: modes, outcome: outcomes, SQLSTATE: states, constraint: constraints,
  roleMatched: z.boolean(), forcedChecks: z.boolean(), rowCountMatched: z.boolean(),
  schemaRestored: z.boolean(), fixturesAbsent: z.boolean(),
}).strict().refine((r) => r.outcome !== "succeeded" ||
  (r.SQLSTATE === "none" && r.constraint === "none" && r.roleMatched && r.forcedChecks && r.rowCountMatched));
export const rollbackRecordSchema = z.object({
  diagnosticMode: z.literal("rollback-only"), qualifying: z.literal(false),
  status: z.enum(["inconclusive", "measured", "failed"]),
  probes: z.array(probeRecordSchema).max(3),
}).strict();
type Mode = z.infer<typeof modes>;
type Probe = z.infer<typeof probeRecordSchema>;
type Record = z.infer<typeof rollbackRecordSchema>;
const attemptSchema = z.tuple([outcomes, states, constraints, z.boolean(), z.boolean(), z.boolean()]);
const snapshotSchema = z.tuple([
  z.boolean(), z.boolean(), z.boolean(), z.string().min(1).max(65_536),
  z.string().regex(/^[a-f0-9]{32}$/), z.boolean(),
]);
type Snapshot = z.infer<typeof snapshotSchema>;
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const fixtureSchema = z.object({ user: uuid, movement: uuid, session: uuid, set: uuid }).strict()
  .refine((ids) => new Set(Object.values(ids)).size === 4);
type Fixture = z.infer<typeof fixtureSchema>;
const freshFixture = (): Fixture => fixtureSchema.parse({
  user: randomUUID(), movement: randomUUID(), session: randomUUID(), set: randomUUID(),
});
const targets = [
  ["set_logs", "set_logs_movement_id_fkey"],
  ["session_movements", "session_movements_movement_id_fkey"],
] as const;
const bounds = `
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '5s';
SET LOCAL search_path = pg_catalog;`;

// Keep full pg_constraint tuples privately, including OIDs and every mode bit.
// Unknown additional FKs from either target table to movements fail the shape gate.
const catalog = `
WITH movement_fks AS (
  SELECT c.*, pg_catalog.to_jsonb(c) AS tuple FROM pg_catalog.pg_constraint c
  WHERE c.contype = 'f' AND (c.confrelid = 'public.movements'::pg_catalog.regclass
    OR (c.conrelid IN ('public.set_logs'::pg_catalog.regclass, 'public.session_movements'::pg_catalog.regclass)
      AND (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = c.conrelid
        AND attname = 'movement_id' AND NOT attisdropped) = ANY(c.conkey))
    OR c.conname IN ('set_logs_movement_id_fkey', 'session_movements_movement_id_fkey'))
), targeted AS (
  SELECT * FROM movement_fks WHERE
    conrelid IN ('public.set_logs'::pg_catalog.regclass, 'public.session_movements'::pg_catalog.regclass)
    OR conname IN ('set_logs_movement_id_fkey', 'session_movements_movement_id_fkey')
), evidence AS (
  SELECT
    (SELECT count(*) = 2 AND COALESCE(pg_catalog.bool_and(
      (${targets.map(([table, name]) => `(conrelid = 'public.${table}'::pg_catalog.regclass AND conname = '${name}')`).join(" OR ")})
      AND confrelid = 'public.movements'::pg_catalog.regclass
      AND conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute
        WHERE attrelid = conrelid AND attname = 'movement_id' AND NOT attisdropped)]::smallint[]
      AND confkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute
        WHERE attrelid = confrelid AND attname = 'id' AND NOT attisdropped)]::smallint[]
      AND confdeltype = 'r' AND confupdtype = 'a' AND confmatchtype = 's'
      AND convalidated AND NOT condeferrable AND NOT condeferred
      AND conislocal AND coninhcount = 0 AND conparentid = 0), false) FROM targeted) AS shapes,
    (SELECT COALESCE(pg_catalog.jsonb_agg(tuple ORDER BY conrelid, conname), '[]'::jsonb)::text FROM targeted) AS tuples,
    (SELECT pg_catalog.md5(COALESCE(pg_catalog.jsonb_agg(tuple ORDER BY conrelid, conname), '[]'::jsonb)::text)
      FROM movement_fks WHERE oid NOT IN (SELECT oid FROM targeted)) AS others
)`;

function absent(ids: Fixture) {
  const values = Object.values(fixtureSchema.parse(ids)).map((id) => `'${id}'::uuid`).join(",");
  return [
    ["auth.users", ["id"]], ["public.profiles", ["id"]],
    ["public.movements", ["id", "user_id"]], ["public.sessions", ["id", "user_id"]],
    ["public.set_logs", ["id", "session_id", "movement_id"]],
    ["public.session_movements", ["session_id", "movement_id", "user_id"]],
    ["public.cardio_logs", ["id", "session_id", "movement_id"]],
    ["public.swim_workouts", ["id", "session_id", "user_id"]],
  ].map(([table, columns]) => `NOT EXISTS (SELECT 1 FROM ${table} WHERE ${
    (columns as string[]).map((column) => `${column} = ANY(ARRAY[${values}])`).join(" OR ")})`).join(" AND ");
}

export function snapshotSql(ids: Fixture) {
  return `BEGIN READ ONLY; ${bounds}
${catalog}
SELECT pg_catalog.json_build_array(
  session_user = 'postgres' AND current_user = 'postgres'
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = session_user AND rolsuper),
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin'
    AND rolcanlogin AND NOT rolsuper AND NOT rolinherit AND rolcreaterole
    AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls),
  shapes, tuples, others, ${absent(ids)}) FROM evidence;
ROLLBACK;`;
}

const mapError = `
GET STACKED DIAGNOSTICS state_code = RETURNED_SQLSTATE, constraint_name = CONSTRAINT_NAME;
state_label := CASE WHEN state_code = '23503' THEN '23503' ELSE 'other' END;
constraint_label := CASE constraint_name
  WHEN '' THEN 'none'
  WHEN 'set_logs_movement_id_fkey' THEN 'set-logs'
  WHEN 'session_movements_movement_id_fkey' THEN 'session-movements'
  ELSE 'other' END;`;

export function probeSql(mode: Mode, ids: Fixture, original: Snapshot) {
  modes.parse(mode);
  fixtureSchema.parse(ids);
  snapshotSchema.parse(original);
  assert(original[0] && original[1] && original[2] && original[5], "Rollback probe prerequisites mismatched");
  const tupleHash = createHash("md5").update(original[3]).digest("hex");
  const ddl = mode === "baseline" ? "" : targets.map(([table, name]) => `
ALTER TABLE public.${table} DROP CONSTRAINT ${name};
ALTER TABLE public.${table} ADD CONSTRAINT ${name}
  FOREIGN KEY (movement_id) REFERENCES public.movements(id) MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION ${mode === "immediate"
    ? "NOT DEFERRABLE" : "DEFERRABLE INITIALLY DEFERRED"};`).join("\n");
  return `BEGIN; ${bounds}
DO $setup$
DECLARE matched boolean; state_code text; constraint_name text;
  state_label text := 'none'; constraint_label text := 'none'; outcome text := 'setup-failed';
BEGIN
  PERFORM pg_catalog.set_config('swim_rollback.ready', 'false', true);
  BEGIN
    ${catalog}
    SELECT shapes AND pg_catalog.md5(tuples) = '${tupleHash}' AND others = '${original[4]}'
      INTO matched FROM evidence;
    IF NOT matched OR session_user <> 'postgres' OR current_user <> 'postgres' THEN
      RAISE EXCEPTION USING ERRCODE = '55000';
    END IF;
    ${ddl}
    INSERT INTO auth.users (id, raw_app_meta_data, raw_user_meta_data)
      VALUES ('${ids.user}'::uuid, '{}'::jsonb, '{}'::jsonb);
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '${ids.user}'::uuid) THEN
      RAISE EXCEPTION USING ERRCODE = '55000';
    END IF;
    INSERT INTO public.movements
      (id, user_id, slug, display_name, pattern, primary_region, primary_muscles,
       equipment, is_compound, is_supported, stability)
      VALUES ('${ids.movement}'::uuid, '${ids.user}'::uuid, 'rollback-${ids.movement}',
        'Synthetic row', 'pull', 'shoulder_scapular', ARRAY['lats','mid_back']::public.muscle[],
        'dumbbells-incline-bench', true, true, 'supported');
    INSERT INTO public.sessions (id, user_id, title, slot)
      VALUES ('${ids.session}'::uuid, '${ids.user}'::uuid, 'Synthetic strength', 'single');
    INSERT INTO public.session_movements (session_id, movement_id, user_id, sort_order)
      VALUES ('${ids.session}'::uuid, '${ids.movement}'::uuid, '${ids.user}'::uuid, 0);
    INSERT INTO public.set_logs (id, session_id, movement_id, set_index, set_kind, reps, weight_kg, rpe)
      VALUES ('${ids.set}'::uuid, '${ids.session}'::uuid, '${ids.movement}'::uuid, 0, 'main', 8, 12.00, 6.0);
    PERFORM pg_catalog.set_config('swim_rollback.ready', 'true', true);
  EXCEPTION WHEN SQLSTATE '57014' OR OTHERS THEN
    ${mapError}
    IF state_code IN ('55P03', '57014') THEN outcome := 'unavailable'; END IF;
  END;
  PERFORM pg_catalog.set_config('swim_rollback.result', pg_catalog.json_build_array(
    outcome, state_label, constraint_label, false, false, false)::text, true);
END $setup$;
SET LOCAL SESSION AUTHORIZATION supabase_auth_admin;
DO $attempt$
DECLARE state_code text; constraint_name text; affected bigint := 0;
  state_label text := 'none'; constraint_label text := 'none'; outcome text := 'succeeded';
  role_matched boolean := session_user = 'supabase_auth_admin' AND current_user = 'supabase_auth_admin';
  forced boolean := false; row_matched boolean := false;
BEGIN
  IF pg_catalog.current_setting('swim_rollback.ready')::boolean THEN
    BEGIN
      IF NOT role_matched THEN RAISE EXCEPTION USING ERRCODE = '42501'; END IF;
      DELETE FROM auth.users WHERE id = '${ids.user}'::uuid;
      GET DIAGNOSTICS affected = ROW_COUNT;
      row_matched := affected = 1;
      forced := true;
      SET CONSTRAINTS ALL IMMEDIATE;
      IF NOT row_matched THEN RAISE EXCEPTION USING ERRCODE = '55000'; END IF;
    EXCEPTION WHEN SQLSTATE '57014' OR OTHERS THEN
      ${mapError}
      outcome := CASE WHEN state_code IN ('55P03', '57014') THEN 'unavailable' ELSE 'rejected' END;
    END;
    PERFORM pg_catalog.set_config('swim_rollback.result', pg_catalog.json_build_array(
      outcome, state_label, constraint_label, role_matched, forced, row_matched)::text, true);
  END IF;
END $attempt$;
SELECT pg_catalog.current_setting('swim_rollback.result')::json;
ROLLBACK;`;
}

export async function runRollbackProbes(
  command: PrivateCommand, dbId: string, publish: (record: Record) => void,
): Promise<Record> {
  assert(/^[a-f0-9]{64}$/.test(dbId), "Rollback probe container invalid");
  const record: Record = { diagnosticMode: "rollback-only", qualifying: false, status: "inconclusive", probes: [] };
  const sql = async (query: string) => {
    const { text, result } = await command("docker", [
      "exec", dbId, "psql", "-XqAt", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-c", query,
    ], { capture: true, allowFailure: true, timeout: 15_000 });
    assert(!result.timedOut && result.code === 0 && result.signal === null, "Rollback probe command unavailable");
    assert(text.length <= 131_072, "Rollback probe output invalid");
    return JSON.parse(text) as unknown;
  };
  try {
    const first = freshFixture();
    // Once only: never replace this with a post-probe observation.
    const original = snapshotSchema.parse(await sql(snapshotSql(first)));
    assert(original[0] && original[1] && original[2] && original[5], "Rollback probe prerequisites mismatched");
    for (const mode of modes.options) {
      const ids = mode === "baseline" ? first : freshFixture();
      const probe: Probe = { mode, outcome: "unavailable", SQLSTATE: "none", constraint: "none",
        roleMatched: false, forcedChecks: false, rowCountMatched: false, schemaRestored: false, fixturesAbsent: false };
      record.probes.push(probe);
      try {
        const [outcome, SQLSTATE, constraint, roleMatched, forcedChecks, rowCountMatched] =
          attemptSchema.parse(await sql(probeSql(mode, ids, original)));
        Object.assign(probe, { outcome, SQLSTATE, constraint, roleMatched, forcedChecks, rowCountMatched });
        probeRecordSchema.parse(probe);
      } catch {
        Object.assign(probe, { outcome: "unavailable", SQLSTATE: "none", constraint: "none",
          roleMatched: false, forcedChecks: false, rowCountMatched: false });
      } finally {
        // A fresh owned connection is mandatory even after timeout, disconnect or invalid output.
        try {
          const after = snapshotSchema.parse(await sql(snapshotSql(ids)));
          probe.schemaRestored = after[0] && after[1] && after[2] &&
            after[3] === original[3] && after[4] === original[4];
          probe.fixturesAbsent = after[5];
        } catch { /* Unverified restoration fails closed; no repair mutations. */ }
      }
      assert(probe.schemaRestored && probe.fixturesAbsent, "Rollback probe restoration unverified");
      assert(probe.outcome !== "unavailable" && probe.outcome !== "setup-failed", "Rollback probe unavailable or setup failed");
      assert(probe.roleMatched, "Rollback probe role mismatched");
      if (mode === "baseline" && !(probe.outcome === "rejected" && probe.SQLSTATE === "23503" &&
        (probe.constraint === "set-logs" || probe.constraint === "session-movements"))) break;
      if (mode === "deferred") record.status = "measured";
    }
  } catch (error) {
    record.status = "failed";
    throw error;
  } finally {
    publish(rollbackRecordSchema.parse(record));
  }
  return record;
}

export function requireBrowserRoute(rollbackOnly: boolean) {
  assert(!rollbackOnly, "NON-QUALIFYING: rollback-only; twelve-case suite not run");
}

export function finishRollbackOnly(reporting: AcceptanceReporting) {
  reporting.failures.primary ??= reporting.failures.cleanup[0] ?? null;
  try { requireBrowserRoute(true); } catch (error) {
    reporting.recordFailure("rollback-only nonqualifying stop", error);
  }
}
