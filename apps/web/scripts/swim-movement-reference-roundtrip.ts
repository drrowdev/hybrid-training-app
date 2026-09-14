import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrivateCommand } from "./swim-auth-privileges";
import { acceptanceAssert as assert } from "./swim-acceptance-reporting";

const bootstrapRole = "supabase_admin";
export const MOVEMENT_REFERENCE_FILES = {
  down: "packages/db/rollbacks/0149_defer_custom_movement_references.down.sql",
  up: "packages/db/drizzle/0149_defer_custom_movement_references.sql",
} as const;
const modes = z.enum(["baseline", "candidate"]);
const outcomes = z.enum(["succeeded", "rejected", "setup-failed", "unavailable"]);
const states = z.enum(["none", "23503", "other"]);
const constraints = z.enum(["none", "set-logs", "session-movements", "other"]);
export const probeRecordSchema = z.object({
  mode: modes, outcome: outcomes, SQLSTATE: states, constraint: constraints,
  roleMatched: z.boolean(), forcedChecks: z.boolean(), rowCountMatched: z.boolean(),
  schemaRestored: z.boolean(), fixturesAbsent: z.boolean(),
}).strict().refine((r) => r.outcome !== "succeeded" ||
  (r.SQLSTATE === "none" && r.constraint === "none" && r.roleMatched && r.forcedChecks && r.rowCountMatched));
export const updateIntegrityRecordSchema = z.object({
  outcome: z.enum(["not-attempted", ...outcomes.options]), SQLSTATE: states, constraint: constraints,
  roleMatched: z.boolean(), forcedChecks: z.boolean(), rowCountMatched: z.boolean(),
  schemaRestored: z.boolean(), fixturesAbsent: z.boolean(),
}).strict().refine((r) => r.outcome !== "not-attempted" ||
  (r.SQLSTATE === "none" && r.constraint === "none" && !r.roleMatched && !r.forcedChecks &&
    !r.rowCountMatched && !r.schemaRestored && !r.fixturesAbsent));
type UpdateIntegrity = z.infer<typeof updateIntegrityRecordSchema>;
const updateMatched = (r: UpdateIntegrity) => r.outcome === "rejected" && r.SQLSTATE === "23503" &&
  r.constraint === "set-logs" && r.roleMatched && r.forcedChecks && r.rowCountMatched &&
  r.schemaRestored && r.fixturesAbsent;
const probeMatched = (p: Probe) => p.roleMatched && p.schemaRestored && p.fixturesAbsent &&
  (p.mode === "baseline"
    ? p.outcome === "rejected" && p.SQLSTATE === "23503" && p.constraint === "set-logs"
    : p.outcome === "succeeded" && p.SQLSTATE === "none" && p.constraint === "none" &&
      p.forcedChecks && p.rowCountMatched);
export const movementReferenceRecordSchema = z.object({
  status: z.enum(["running", "matched", "failed"]),
  initial: z.boolean(), down: z.boolean(), up: z.boolean(),
  probes: z.array(probeRecordSchema).max(2),
  updateIntegrity: updateIntegrityRecordSchema,
}).strict().refine((r) => r.status !== "matched" || (r.initial && r.down && r.up &&
  r.probes.length === 2 && r.probes.every((p, index) => p.mode === modes.options[index] &&
    probeMatched(p)) && updateMatched(r.updateIntegrity)));
type Mode = z.infer<typeof modes>;
type Probe = z.infer<typeof probeRecordSchema>;
type Record = z.infer<typeof movementReferenceRecordSchema>;
const attemptSchema = z.tuple([outcomes, states, constraints, z.boolean(), z.boolean(), z.boolean()]);
const snapshotSchema = z.tuple([
  z.boolean(), z.boolean(), z.boolean(), z.string().regex(/^[a-f0-9]{32}$/),
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
const authProperties = [
  "p_auth_login", "p_auth_not_super", "p_auth_not_inherit", "p_auth_create_role",
  "p_auth_not_create_db", "p_auth_not_replication", "p_auth_not_bypass_rls",
];
const bounds = `
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '5s';
SET LOCAL search_path = pg_catalog;`;

// Only the set_logs FK OID and its three deliberately changed mode bits are normalized.
// All other relationships retain their full tuples, including their OIDs.
function catalog(candidate: boolean) {
  return `
WITH relationships AS (
  SELECT c.*, pg_catalog.to_jsonb(c) AS tuple FROM pg_catalog.pg_constraint c
), targeted AS (
  SELECT * FROM relationships c WHERE
    (c.contype = 'f' AND c.conrelid IN ('public.set_logs'::pg_catalog.regclass, 'public.session_movements'::pg_catalog.regclass)
      AND (c.confrelid = 'public.movements'::pg_catalog.regclass OR
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = c.conrelid
          AND attname = 'movement_id' AND NOT attisdropped) = ANY(c.conkey)))
    OR c.conname IN ('set_logs_movement_id_fkey', 'session_movements_movement_id_fkey')
), props AS (
  SELECT (
    (${targets.map(([table, name]) => {
      const deferred = candidate && table === "set_logs";
      return `(c.conrelid = 'public.${table}'::pg_catalog.regclass AND c.conname = '${name}'
      AND c.confdeltype = '${deferred ? "a" : "r"}'
      AND ${deferred ? "" : "NOT "}c.condeferrable AND ${deferred ? "" : "NOT "}c.condeferred
      AND pg_catalog.pg_get_constraintdef(c.oid, false) =
        'FOREIGN KEY (movement_id) REFERENCES public.movements(id) ${deferred ? "DEFERRABLE INITIALLY DEFERRED" : "ON DELETE RESTRICT"}')`;
    }).join(" OR ")})
    AND c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND c.contypid = 0
    AND c.confrelid = 'public.movements'::pg_catalog.regclass
    AND c.conkey = ARRAY[a.attnum] AND c.confkey = ARRAY[b.attnum]
    AND a.atttypid = 'uuid'::regtype AND b.atttypid = 'uuid'::regtype
    AND a.atttypmod = -1 AND b.atttypmod = -1 AND a.attnotnull AND b.attnotnull
    AND c.confupdtype = 'a' AND c.confmatchtype = 's' AND c.convalidated
    AND c.conislocal AND c.coninhcount = 0 AND c.conparentid = 0 AND c.connoinherit
    AND c.conpfeqop = ARRAY['=(uuid,uuid)'::regoperator::oid]
    AND c.conppeqop = c.conpfeqop AND c.conffeqop = c.conpfeqop
    AND c.confdelsetcols IS NULL AND c.conexclop IS NULL AND c.conbin IS NULL
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid = c.conindid
      AND i.indrelid = c.confrelid AND i.indisprimary AND i.indisvalid AND i.indisunique
      AND i.indkey::smallint[] @> c.confkey AND i.indnkeyatts = 1)
    AND t.relowner = 'postgres'::regrole AND m.relowner = 'postgres'::regrole
    AND t.relkind = 'r' AND m.relkind = 'r' AND NOT t.relispartition AND NOT m.relispartition
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits
      WHERE inhrelid IN (t.oid, m.oid) OR inhparent IN (t.oid, m.oid))
  ) IS TRUE AS matched
  FROM targeted c
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'movement_id' AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attribute b ON b.attrelid = c.confrelid AND b.attname = 'id' AND NOT b.attisdropped
  LEFT JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
  LEFT JOIN pg_catalog.pg_class m ON m.oid = c.confrelid
), metadata AS (
  SELECT jsonb_build_array(
    (SELECT jsonb_agg(jsonb_build_array(oid, relname, relnamespace, relowner, relacl,
        relkind, relam, relpersistence, relrowsecurity, relforcerowsecurity, reloptions) ORDER BY oid)
      FROM pg_catalog.pg_class WHERE oid IN
        ('public.set_logs'::regclass, 'public.session_movements'::regclass, 'public.movements'::regclass)),
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY attrelid, attnum) FROM pg_catalog.pg_attribute a
      WHERE attrelid IN ('public.set_logs'::regclass, 'public.session_movements'::regclass, 'public.movements'::regclass)),
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY indexrelid) FROM pg_catalog.pg_index i
      WHERE indrelid IN ('public.set_logs'::regclass, 'public.session_movements'::regclass, 'public.movements'::regclass)),
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_catalog.pg_policy p),
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) FROM pg_catalog.pg_trigger t WHERE NOT tgisinternal)
  ) AS value
), changed AS (
  SELECT * FROM targeted WHERE conrelid = 'public.set_logs'::pg_catalog.regclass
    AND conname = 'set_logs_movement_id_fkey'
), evidence AS (
  SELECT (SELECT count(*) = 2 AND COALESCE(bool_and(props.matched), false) FROM props) AS shapes,
    (SELECT md5(COALESCE(jsonb_agg(tuple - ARRAY['oid','confdeltype','condeferrable','condeferred']
      ORDER BY conrelid, conname), '[]'::jsonb)::text) FROM changed) AS semantics,
    md5(jsonb_build_array(
      (SELECT COALESCE(jsonb_agg(tuple ORDER BY oid), '[]'::jsonb)
        FROM relationships WHERE oid NOT IN (SELECT oid FROM changed)), value)::text) AS others
  FROM metadata
)`;
}

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

export function snapshotSql(ids: Fixture, candidate = true) {
  return `BEGIN READ ONLY; ${bounds}
LOCK TABLE public.set_logs, public.session_movements IN ACCESS SHARE MODE;
${catalog(candidate)}, owner_props AS (
  SELECT rolsuper AS p_owner_super FROM pg_catalog.pg_roles WHERE rolname = session_user
), auth_props AS (
  SELECT rolcanlogin AS p_auth_login, NOT rolsuper AS p_auth_not_super,
    NOT rolinherit AS p_auth_not_inherit, rolcreaterole AS p_auth_create_role,
    NOT rolcreatedb AS p_auth_not_create_db, NOT rolreplication AS p_auth_not_replication,
    NOT rolbypassrls AS p_auth_not_bypass_rls
  FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin'
), prerequisites AS (
  SELECT session_user = '${bootstrapRole}' AS p_owner_session, current_user = '${bootstrapRole}' AS p_owner_current,
    EXISTS (SELECT 1 FROM owner_props WHERE p_owner_super) AS p_owner_super,
    EXISTS (SELECT 1 FROM auth_props) AS p_auth_role_present,
    ${absent(ids)} AS p_fixtures_absent
)
SELECT pg_catalog.json_build_array(
  p_owner_session AND p_owner_current AND p_owner_super,
  p_auth_role_present AND EXISTS (SELECT 1 FROM auth_props WHERE ${authProperties.join(" AND ")}),
  shapes, semantics, others, p_fixtures_absent) FROM evidence CROSS JOIN prerequisites;
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

function fixtureSql(ids: Fixture) {
  fixtureSchema.parse(ids);
  return `
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
      VALUES ('${ids.set}'::uuid, '${ids.session}'::uuid, '${ids.movement}'::uuid, 0, 'main', 8, 12.00, 6.0);`;
}

export function necessitySql(mode: Mode, ids: Fixture, original: Snapshot, downSql: string) {
  modes.parse(mode);
  fixtureSchema.parse(ids);
  snapshotSchema.parse(original);
  assert(original[0] && original[1] && original[2] && original[5], "Movement reference prerequisites mismatched");
  return `BEGIN; ${bounds}
LOCK TABLE public.set_logs, public.session_movements IN ACCESS EXCLUSIVE MODE;
DO $guard$
DECLARE matched boolean;
BEGIN
  ${catalog(true)}
  SELECT shapes AND semantics = '${original[3]}' AND others = '${original[4]}'
    AND ${absent(ids)} INTO matched FROM evidence;
  IF matched IS DISTINCT FROM true OR session_user <> '${bootstrapRole}' OR current_user <> '${bootstrapRole}' THEN
    RAISE EXCEPTION USING ERRCODE = '55000';
  END IF;
END $guard$;
${mode === "baseline" ? downSql : ""}
${bounds}
DO $setup$
DECLARE matched boolean; state_code text; constraint_name text;
  state_label text := 'none'; constraint_label text := 'none'; outcome text := 'setup-failed';
BEGIN
  PERFORM pg_catalog.set_config('swim_rollback.ready', 'false', true);
  BEGIN
    ${catalog(mode === "candidate")}
    SELECT shapes AND semantics = '${original[3]}' AND others = '${original[4]}'
      INTO matched FROM evidence;
    IF matched IS DISTINCT FROM true OR session_user <> '${bootstrapRole}' OR current_user <> '${bootstrapRole}' THEN
      RAISE EXCEPTION USING ERRCODE = '55000';
    END IF;
    ${fixtureSql(ids)}
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

export function updateIntegritySql(ids: Fixture, original: Snapshot) {
  fixtureSchema.parse(ids);
  snapshotSchema.parse(original);
  assert(original[0] && original[1] && original[2] && original[5], "Movement reference prerequisites mismatched");
  return `BEGIN; ${bounds}
LOCK TABLE public.set_logs, public.session_movements IN ACCESS EXCLUSIVE MODE;
DO $update_integrity$
DECLARE matched boolean; state_code text; constraint_name text; affected bigint := 0;
  state_label text := 'none'; constraint_label text := 'none'; outcome text := 'setup-failed';
  role_matched boolean := session_user = '${bootstrapRole}' AND current_user = '${bootstrapRole}';
  forced boolean := false; row_matched boolean := false;
BEGIN
  BEGIN
    ${catalog(true)}
    SELECT shapes AND semantics = '${original[3]}' AND others = '${original[4]}'
      AND ${absent(ids)} INTO matched FROM evidence;
    IF matched IS DISTINCT FROM true OR NOT role_matched THEN
      RAISE EXCEPTION USING ERRCODE = '55000';
    END IF;
    ${fixtureSql(ids)}
    IF EXISTS (SELECT 1 FROM public.movements WHERE id = '${ids.set}'::uuid)
      OR NOT EXISTS (SELECT 1 FROM public.set_logs
        WHERE id = '${ids.set}'::uuid AND session_id = '${ids.session}'::uuid
          AND movement_id = '${ids.movement}'::uuid) THEN
      RAISE EXCEPTION USING ERRCODE = '55000';
    END IF;
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    BEGIN
      UPDATE public.set_logs SET movement_id = '${ids.set}'::uuid
        WHERE id = '${ids.set}'::uuid AND session_id = '${ids.session}'::uuid
          AND movement_id = '${ids.movement}'::uuid;
      GET DIAGNOSTICS affected = ROW_COUNT;
      row_matched := affected = 1;
      forced := true;
      SET CONSTRAINTS ALL IMMEDIATE;
      outcome := 'succeeded';
    EXCEPTION WHEN SQLSTATE '57014' OR OTHERS THEN
      ${mapError}
      outcome := CASE WHEN state_code IN ('55P03', '57014') THEN 'unavailable' ELSE 'rejected' END;
    END;
  EXCEPTION WHEN SQLSTATE '57014' OR OTHERS THEN
    ${mapError}
    outcome := CASE WHEN state_code IN ('55P03', '57014') THEN 'unavailable' ELSE 'setup-failed' END;
  END;
  PERFORM pg_catalog.set_config('swim_update.result', pg_catalog.json_build_array(
    outcome, state_label, constraint_label, role_matched, forced, row_matched)::text, true);
END $update_integrity$;
SELECT pg_catalog.current_setting('swim_update.result')::json;
ROLLBACK;`;
}

export async function runMovementReferenceRoundTrip(options: {
  command: PrivateCommand; dbId: string; publish: (record: Record) => void;
  verifiedSql: (file: typeof MOVEMENT_REFERENCE_FILES[keyof typeof MOVEMENT_REFERENCE_FILES]) => string;
}): Promise<Record> {
  const { command, dbId, publish, verifiedSql } = options;
  assert(/^[a-f0-9]{64}$/.test(dbId), "Movement reference container invalid");
  const record: Record = { status: "running", initial: false, down: false, up: false, probes: [],
    updateIntegrity: { outcome: "not-attempted", SQLSTATE: "none", constraint: "none",
      roleMatched: false, forcedChecks: false, rowCountMatched: false, schemaRestored: false, fixturesAbsent: false } };
  const sql = async (query: string, ddl = false) => {
    const { text, result } = await command("docker", [
      "exec", "-e", "PGOPTIONS=-c statement_timeout=30s -c lock_timeout=5s", dbId,
      "psql", "-XqAt", "--no-password", "-U", bootstrapRole, "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-c", query,
    ], { capture: true, allowFailure: true, timeout: 35_000 });
    assert(!result.timedOut && result.code === 0 && result.signal === null, "Movement reference command unavailable");
    assert(text.length <= 131_072, "Movement reference output invalid");
    if (ddl) {
      assert(text.trim() === "", "Movement reference DDL output invalid");
      return;
    }
    try { return JSON.parse(text) as unknown; } catch {
      assert(false, "Movement reference output invalid");
    }
  };
  try {
    const first = freshFixture();
    const original = snapshotSchema.parse(await sql(snapshotSql(first)));
    record.initial = original[0] && original[1] && original[2] && original[5];
    assert(record.initial, "Movement reference prerequisites mismatched");
    const matches = (after: Snapshot) => after[0] && after[1] && after[2] && after[5] &&
      after[3] === original[3] && after[4] === original[4];
    for (const direction of ["down", "up"] as const) {
      await sql(verifiedSql(MOVEMENT_REFERENCE_FILES[direction]), true);
      record[direction] = matches(snapshotSchema.parse(await sql(snapshotSql(first, direction === "up"))));
      assert(record[direction], "Movement reference round trip mismatched");
    }
    for (const mode of modes.options) {
      const ids = freshFixture();
      const probe: Probe = { mode, outcome: "unavailable", SQLSTATE: "none", constraint: "none",
        roleMatched: false, forcedChecks: false, rowCountMatched: false, schemaRestored: false, fixturesAbsent: false };
      record.probes.push(probe);
      try {
        const [outcome, SQLSTATE, constraint, roleMatched, forcedChecks, rowCountMatched] =
          attemptSchema.parse(await sql(necessitySql(mode, ids, original,
            mode === "baseline" ? verifiedSql(MOVEMENT_REFERENCE_FILES.down) : "")));
        Object.assign(probe, { outcome, SQLSTATE, constraint, roleMatched, forcedChecks, rowCountMatched });
        probeRecordSchema.parse(probe);
      } catch {
        Object.assign(probe, { outcome: "unavailable", SQLSTATE: "none", constraint: "none",
          roleMatched: false, forcedChecks: false, rowCountMatched: false });
      } finally {
        // A fresh owned connection is mandatory even after timeout, disconnect or invalid output.
        try {
          const after = snapshotSchema.parse(await sql(snapshotSql(ids)));
          probe.schemaRestored = matches(after);
          probe.fixturesAbsent = after[5];
        } catch { /* Unverified restoration fails closed; no repair mutations. */ }
      }
      assert(probe.schemaRestored && probe.fixturesAbsent, "Movement reference restoration unverified");
      assert(probeMatched(probe), `Movement reference ${mode} control not proved`);
    }
    const ids = freshFixture();
    const update = record.updateIntegrity;
    update.outcome = "unavailable";
    try {
      const [outcome, SQLSTATE, constraint, roleMatched, forcedChecks, rowCountMatched] =
        attemptSchema.parse(await sql(updateIntegritySql(ids, original)));
      Object.assign(update, { outcome, SQLSTATE, constraint, roleMatched, forcedChecks, rowCountMatched });
    } catch {
      Object.assign(update, { outcome: "unavailable", SQLSTATE: "none", constraint: "none",
        roleMatched: false, forcedChecks: false, rowCountMatched: false });
    } finally {
      try {
        const after = snapshotSchema.parse(await sql(snapshotSql(ids)));
        update.schemaRestored = matches(after);
        update.fixturesAbsent = after[5];
      } catch { /* Unverified restoration fails closed; no repair mutations. */ }
    }
    assert(update.schemaRestored && update.fixturesAbsent, "Movement reference UPDATE restoration unverified");
    assert(updateMatched(update), "Movement reference UPDATE integrity not proved");
    record.status = "matched";
  } catch (error) {
    record.status = "failed";
    throw error;
  } finally {
    publish(movementReferenceRecordSchema.parse(record));
  }
  return record;
}
