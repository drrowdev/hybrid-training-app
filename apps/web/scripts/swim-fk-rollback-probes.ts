import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrivateCommand } from "./swim-auth-privileges";
import { acceptanceAssert as assert, type AcceptanceReporting } from "./swim-acceptance-reporting";

const bootstrapRole = "supabase_admin";
const modes = z.enum(["baseline", "immediate", "deferred"]);
const outcomes = z.enum(["succeeded", "rejected", "setup-failed", "unavailable"]);
const states = z.enum(["none", "23503", "other"]);
const constraints = z.enum(["none", "set-logs", "session-movements", "other"]);
const flagIds = [
  "owner-session", "owner-current", "owner-super", "auth-role-present", "auth-login",
  "auth-not-super", "auth-not-inherit", "auth-create-role", "auth-not-create-db",
  "auth-not-replication", "auth-not-bypass-rls", "fk-count", "fk-identity", "fk-confrelid",
  "fk-conkey", "fk-confkey", "fk-confdeltype", "fk-confupdtype", "fk-confmatchtype",
  "fk-convalidated", "fk-condeferrable", "fk-condeferred", "fk-conislocal",
  "fk-coninhcount", "fk-conparentid", "fixtures-absent",
] as const;
const prerequisitesSchema = z.discriminatedUnion("observed", [
  z.object({ observed: z.literal(false) }).strict(),
  z.object({
    observed: z.literal(true), matched: z.boolean(),
    mismatched: z.array(z.enum(flagIds)).max(flagIds.length).refine((ids) =>
      ids.every((id, index) => index === 0 || flagIds.indexOf(ids[index - 1]!) < flagIds.indexOf(id))),
  }).strict(),
]).refine((r) => !r.observed || !r.matched || r.mismatched.length === 0);
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
  prerequisites: prerequisitesSchema,
}).strict();
type Mode = z.infer<typeof modes>;
type Probe = z.infer<typeof probeRecordSchema>;
type Record = z.infer<typeof rollbackRecordSchema>;
const attemptSchema = z.tuple([outcomes, states, constraints, z.boolean(), z.boolean(), z.boolean()]);
const snapshotSchema = z.tuple([
  z.boolean(), z.boolean(), z.boolean(), z.string().min(1).max(65_536),
  z.string().regex(/^[a-f0-9]{32}$/), z.boolean(), z.array(z.boolean()).length(flagIds.length),
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
const fkProperties = [
  "p_identity", "p_confrelid", "p_conkey", "p_confkey", "p_confdeltype", "p_confupdtype",
  "p_confmatchtype", "p_convalidated", "p_condeferrable", "p_condeferred", "p_conislocal",
  "p_coninhcount", "p_conparentid",
];
const authProperties = [
  "p_auth_login", "p_auth_not_super", "p_auth_not_inherit", "p_auth_create_role",
  "p_auth_not_create_db", "p_auth_not_replication", "p_auth_not_bypass_rls",
];
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
), props AS (
  SELECT
    (${targets.map(([table, name]) => `(conrelid = 'public.${table}'::pg_catalog.regclass AND conname = '${name}')`).join(" OR ")}) AS p_identity,
    confrelid = 'public.movements'::pg_catalog.regclass AS p_confrelid,
    conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute
      WHERE attrelid = conrelid AND attname = 'movement_id' AND NOT attisdropped)]::smallint[] AS p_conkey,
    confkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute
      WHERE attrelid = confrelid AND attname = 'id' AND NOT attisdropped)]::smallint[] AS p_confkey,
    confdeltype = 'r' AS p_confdeltype, confupdtype = 'a' AS p_confupdtype,
    confmatchtype = 's' AS p_confmatchtype, convalidated AS p_convalidated,
    NOT condeferrable AS p_condeferrable, NOT condeferred AS p_condeferred,
    conislocal AS p_conislocal, coninhcount = 0 AS p_coninhcount, conparentid = 0 AS p_conparentid
  FROM targeted
), totals AS (
  SELECT count(*) = 2 AS p_count FROM props
), evidence AS (
  SELECT
    (SELECT p_count AND COALESCE(pg_catalog.bool_and(
      ${fkProperties.join(" AND ")}), false) FROM props) AS shapes,
    (SELECT COALESCE(pg_catalog.jsonb_agg(tuple ORDER BY conrelid, conname), '[]'::jsonb)::text FROM targeted) AS tuples,
    (SELECT pg_catalog.md5(COALESCE(pg_catalog.jsonb_agg(tuple ORDER BY conrelid, conname), '[]'::jsonb)::text)
      FROM movement_fks WHERE oid NOT IN (SELECT oid FROM targeted)) AS others,
    p_count
  FROM totals
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
  // Role names are unique and rol* pins NOT NULL; keep EXISTS for absent rows.
  // FK properties can be NULL: diagnostics must not replace the row-wise conjunction.
  return `BEGIN READ ONLY; ${bounds}
${catalog}, owner_props AS (
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
  shapes, tuples, others, p_fixtures_absent,
  ARRAY[p_owner_session IS FALSE, p_owner_current IS FALSE, p_owner_super IS FALSE,
    p_auth_role_present IS FALSE,
    ${authProperties.map((p) => `(SELECT ${p} FROM auth_props) IS FALSE`).join(",\n    ")},
    p_count IS FALSE,
    ${fkProperties.map((p) => `(SELECT COALESCE(pg_catalog.bool_or(${p} IS FALSE), false) FROM props)`).join(",\n    ")},
    p_fixtures_absent IS FALSE]) FROM evidence CROSS JOIN prerequisites;
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
    IF NOT matched OR session_user <> '${bootstrapRole}' OR current_user <> '${bootstrapRole}' THEN
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
  const record: Record = { diagnosticMode: "rollback-only", qualifying: false, status: "inconclusive", probes: [],
    prerequisites: { observed: false } };
  const sql = async (query: string) => {
    const { text, result } = await command("docker", [
      "exec", dbId, "psql", "-XqAt", "--no-password", "-U", bootstrapRole, "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-c", query,
    ], { capture: true, allowFailure: true, timeout: 15_000 });
    assert(!result.timedOut && result.code === 0 && result.signal === null, "Rollback probe command unavailable");
    assert(text.length <= 131_072, "Rollback probe output invalid");
    try { return JSON.parse(text) as unknown; } catch {
      assert(false, "Rollback probe output invalid");
    }
  };
  try {
    const first = freshFixture();
    // Once only: never replace this with a post-probe observation.
    const parsed = snapshotSchema.safeParse(await sql(snapshotSql(first)));
    assert(parsed.success, "Rollback probe snapshot invalid");
    const original = parsed.data;
    const matched = original[0] && original[1] && original[2] && original[5];
    const prerequisites = prerequisitesSchema.safeParse({
      observed: true, matched, mismatched: flagIds.filter((_, index) => original[6][index]),
    });
    assert(prerequisites.success, "Rollback probe snapshot invalid");
    record.prerequisites = prerequisites.data;
    assert(matched, "Rollback probe prerequisites mismatched");
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
