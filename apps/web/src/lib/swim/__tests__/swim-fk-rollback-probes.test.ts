import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  finishRollbackOnly, probeRecordSchema, probeSql, requireBrowserRoute,
  rollbackRecordSchema, runRollbackProbes, snapshotSql,
} from "../../../../scripts/swim-fk-rollback-probes";
import { AcceptanceReporting, formatAcceptanceSummary } from "../../../../scripts/swim-acceptance-reporting";

const source = readFileSync(new URL("../../../../scripts/swim-fk-rollback-probes.ts", import.meta.url), "utf8");
const dbId = "a".repeat(64);
const ids = {
  user: "12345678-1234-4234-8234-123456789abc", movement: "22345678-1234-4234-8234-123456789abc",
  session: "32345678-1234-4234-8234-123456789abc", set: "42345678-1234-4234-8234-123456789abc",
};
const flags = [
  "owner-session", "owner-current", "owner-super", "auth-role-present", "auth-login",
  "auth-not-super", "auth-not-inherit", "auth-create-role", "auth-not-create-db",
  "auth-not-replication", "auth-not-bypass-rls", "fk-count", "fk-identity", "fk-confrelid",
  "fk-conkey", "fk-confkey", "fk-confdeltype", "fk-confupdtype", "fk-confmatchtype",
  "fk-convalidated", "fk-condeferrable", "fk-condeferred", "fk-conislocal",
  "fk-coninhcount", "fk-conparentid", "fixtures-absent",
] as const;
const snapshot = () => [
  true, true, true, '[{"private":"original-tuples"}]', "b".repeat(32), true, flags.map(() => false),
] as const;
const baseline = ["rejected", "23503", "set-logs", true, false, false];
const success = ["succeeded", "none", "none", true, true, true];
const ok = { code: 0, signal: null, timedOut: false };
function commands(values: unknown[]) {
  return vi.fn(async () => {
    const value = values.shift();
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error("Unexpected command");
    return { text: JSON.stringify(value), result: ok };
  });
}
const sqls = (command: ReturnType<typeof commands>) =>
  (command.mock.calls as unknown as [string, string[]][]).map(([, args]) => args.at(-1)!);

describe("DC-SW8 rollback-only source and SQL contract", () => {
  it.each(["baseline", "immediate", "deferred"] as const)("bounds one %s transaction with all fixture data inside rollback", (mode) => {
    const sql = probeSql(mode, ids, [...snapshot()]);
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(sql.match(/^ROLLBACK;/gm)).toHaveLength(1);
    expect(sql.trim().endsWith("ROLLBACK;")).toBe(true);
    for (const timeout of ["statement_timeout = '5s'", "lock_timeout = '1s'", "idle_in_transaction_session_timeout = '5s'"]) {
      expect(sql).toContain(`SET LOCAL ${timeout}`);
    }
    for (const table of ["auth.users", "public.movements", "public.sessions", "public.set_logs", "public.session_movements"]) {
      expect(sql).toContain(`INSERT INTO ${table}`);
    }
    expect(sql).toContain("ARRAY['lats','mid_back']::public.muscle[]");
    expect(sql).toContain("SELECT 1 FROM public.profiles");
    expect(sql).not.toMatch(/\bCOMMIT\b|DISABLE TRIGGER|NOT VALID|ON DELETE (?:CASCADE|SET NULL)|\bGRANT\b|\bCREATE ROLE\b/i);
    expect(sql).toContain(`DELETE FROM auth.users WHERE id = '${ids.user}'::uuid`);
    expect(sql.match(/DELETE FROM/g)).toHaveLength(1);
  });

  it("changes only the actual two exact FKs, never a combined alteration waterfall", () => {
    expect(probeSql("baseline", ids, [...snapshot()])).not.toContain("ALTER TABLE");
    for (const mode of ["immediate", "deferred"] as const) {
      const sql = probeSql(mode, ids, [...snapshot()]);
      expect(sql.match(/DROP CONSTRAINT/g)).toHaveLength(2);
      expect(sql.match(/ADD CONSTRAINT/g)).toHaveLength(2);
      for (const table of ["set_logs", "session_movements"]) {
        expect(sql).toContain(`ALTER TABLE public.${table} DROP CONSTRAINT ${table}_movement_id_fkey`);
        expect(sql).toContain(`ALTER TABLE public.${table} ADD CONSTRAINT ${table}_movement_id_fkey`);
      }
      expect(sql.match(/REFERENCES public.movements\(id\) MATCH SIMPLE/g)).toHaveLength(2);
      expect(sql.match(/ON UPDATE NO ACTION ON DELETE NO ACTION/g)).toHaveLength(2);
      expect(sql.match(new RegExp(mode === "immediate" ? "NOT DEFERRABLE;" : "DEFERRABLE INITIALLY DEFERRED;", "g"))).toHaveLength(2);
    }
  });

  it("uses the existing role from pg_roles and aligns both identities with local session authorization", () => {
    const catalog = snapshotSql(ids);
    expect(catalog).toContain("FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin'");
    expect(catalog).toContain("rolcanlogin AS p_auth_login, NOT rolsuper AS p_auth_not_super");
    expect(catalog).toContain("WHERE p_auth_login AND p_auth_not_super");
    const sql = probeSql("deferred", ids, [...snapshot()]);
    const dropped = sql.slice(sql.indexOf("SET LOCAL SESSION AUTHORIZATION"));
    expect(dropped).toContain("SET LOCAL SESSION AUTHORIZATION supabase_auth_admin;");
    expect(dropped).toContain("session_user = 'supabase_auth_admin' AND current_user = 'supabase_auth_admin'");
    expect(dropped).not.toMatch(/ALTER TABLE|INSERT INTO|RESET|SET (?:LOCAL )?ROLE|SET SESSION AUTHORIZATION postgres/);
    expect(source).not.toMatch(/pg_stat_activity|pg_locks|request\.jwt|createClient|fetch\(|spawn\(|execFile|from ["']\.\/swim-acceptance["']/);
  });

  it("guards exact names, endpoints, keys, validation and modes and retains full original tuples", () => {
    const sql = snapshotSql(ids);
    for (const field of ["conrelid", "confrelid", "conname", "conkey", "confkey", "confdeltype = 'r'",
      "confupdtype = 'a'", "confmatchtype = 's'", "convalidated", "NOT condeferrable", "NOT condeferred",
      "conislocal", "coninhcount = 0", "conparentid = 0", "count(*) = 2", "pg_catalog.to_jsonb(c)",
      "attname = 'movement_id'", "attname = 'id'", "NOT attisdropped"]) expect(sql).toContain(field);
    expect(sql).toContain("= ANY(c.conkey)");
    expect(sql).toContain("WHERE oid NOT IN (SELECT oid FROM targeted)");
    const candidate = probeSql("immediate", ids, [...snapshot()]);
    expect(candidate).toContain(createHash("md5").update(snapshot()[3]).digest("hex"));
    expect(candidate).toContain(`others = '${snapshot()[4]}'`);
    expect(candidate.indexOf("SELECT shapes AND")).toBeLessThan(candidate.indexOf("ALTER TABLE"));
    expect(source.match(/const original =/g)).toHaveLength(1);
    expect(source).toContain("after[3] === original[3] && after[4] === original[4]");
  });

  it("defines each atomic pin once and reuses properties in the original guards and ordered diagnostics", () => {
    const sql = snapshotSql(ids);
    const compact = sql.replace(/\s+/g, " ");
    const fk = [
      ["identity", "(conrelid = 'public.set_logs'::pg_catalog.regclass AND conname = 'set_logs_movement_id_fkey') OR (conrelid = 'public.session_movements'::pg_catalog.regclass AND conname = 'session_movements_movement_id_fkey')"],
      ["confrelid", "confrelid = 'public.movements'::pg_catalog.regclass"],
      ["conkey", "conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = conrelid AND attname = 'movement_id' AND NOT attisdropped)]::smallint[]"],
      ["confkey", "confkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = confrelid AND attname = 'id' AND NOT attisdropped)]::smallint[]"],
      ["confdeltype", "confdeltype = 'r'"], ["confupdtype", "confupdtype = 'a'"],
      ["confmatchtype", "confmatchtype = 's'"], ["convalidated", "convalidated"],
      ["condeferrable", "NOT condeferrable"], ["condeferred", "NOT condeferred"],
      ["conislocal", "conislocal"], ["coninhcount", "coninhcount = 0"], ["conparentid", "conparentid = 0"],
    ];
    const role = [
      ["auth_login", "rolcanlogin"], ["auth_not_super", "NOT rolsuper"], ["auth_not_inherit", "NOT rolinherit"],
      ["auth_create_role", "rolcreaterole"], ["auth_not_create_db", "NOT rolcreatedb"],
      ["auth_not_replication", "NOT rolreplication"], ["auth_not_bypass_rls", "NOT rolbypassrls"],
    ];
    for (const [name, predicate] of fk) {
      expect(compact.split(`${predicate}${name === "identity" ? ")" : ""} AS p_${name}`)).toHaveLength(2);
      expect(sql.match(new RegExp(`\\bAS p_${name}\\b`, "g"))).toHaveLength(1);
    }
    for (const [name, predicate] of role) {
      expect(compact.split(`${predicate} AS p_${name}`)).toHaveLength(2);
      expect(sql.match(new RegExp(`\\bAS p_${name}\\b`, "g"))).toHaveLength(1);
    }
    expect(compact).toContain(`p_count AND COALESCE(pg_catalog.bool_and( ${fk.map(([p]) => `p_${p}`).join(" AND ")}), false) FROM props`);
    expect(sql.match(/pg_catalog.bool_and\(/g)).toHaveLength(1);
    expect(sql.match(/count\(\*\) = 2/g)).toHaveLength(1);
    expect(compact).toContain("SELECT count(*) = 2 AS p_count FROM props");
    expect(compact).toContain("FROM targeted ), totals AS");
    expect(compact).toContain(`p_auth_role_present AND EXISTS (SELECT 1 FROM auth_props WHERE ${role.map(([p]) => `p_${p}`).join(" AND ")})`);
    expect(compact).toContain("p_owner_session AND p_owner_current AND p_owner_super");
    for (const predicate of [
      "session_user = 'postgres' AS p_owner_session", "current_user = 'postgres' AS p_owner_current",
      "rolsuper AS p_owner_super", "EXISTS (SELECT 1 FROM owner_props WHERE p_owner_super) AS p_owner_super",
      "EXISTS (SELECT 1 FROM auth_props) AS p_auth_role_present",
    ]) expect(compact.split(predicate)).toHaveLength(2);
    const diagnostics = [
      ...["owner_session", "owner_current", "owner_super", "auth_role_present"].map((p) => `p_${p} IS FALSE`),
      ...role.map(([p]) => `(SELECT p_${p} FROM auth_props) IS FALSE`),
      "p_count IS FALSE",
      ...fk.map(([p]) => `(SELECT COALESCE(pg_catalog.bool_or(p_${p} IS FALSE), false) FROM props)`),
      "p_fixtures_absent IS FALSE",
    ];
    expect(diagnostics).toHaveLength(26);
    expect(compact).toContain(`shapes, tuples, others, p_fixtures_absent, ARRAY[${diagnostics.join(", ")}]`);
    expect(sql.match(/AS p_fixtures_absent/g)).toHaveLength(1);
    expect(sql.match(/NOT EXISTS \(SELECT 1 FROM public\.swim_workouts/g)).toHaveLength(1);
    expect(compact).toContain("FROM evidence CROSS JOIN prerequisites");
    expect(source).toContain("const matched = original[0] && original[1] && original[2] && original[5]");
    expect(source).toContain('assert(matched, "Rollback probe prerequisites mismatched")');
  });

  it("forces ALL constraints inside the captured delete attempt in every mode, with exactly one affected row", () => {
    for (const mode of ["baseline", "immediate", "deferred"] as const) {
      const sql = probeSql(mode, ids, [...snapshot()]);
      const attempt = sql.slice(sql.indexOf("DO $attempt$"));
      expect(attempt.match(/SET CONSTRAINTS ALL IMMEDIATE;/g)).toHaveLength(1);
      expect(attempt.indexOf("DELETE FROM")).toBeLessThan(attempt.indexOf("SET CONSTRAINTS ALL IMMEDIATE;"));
      expect(attempt.indexOf("SET CONSTRAINTS ALL IMMEDIATE;")).toBeLessThan(attempt.indexOf("EXCEPTION WHEN"));
      expect(attempt).toContain("GET DIAGNOSTICS affected = ROW_COUNT");
      expect(attempt).toContain("row_matched := affected = 1");
      expect(attempt).toContain("IF NOT row_matched THEN RAISE EXCEPTION");
    }
    expect(source).not.toMatch(/SET CONSTRAINTS (?!ALL)/);
    expect(source).toContain("GET STACKED DIAGNOSTICS state_code = RETURNED_SQLSTATE, constraint_name = CONSTRAINT_NAME");
    expect(source).not.toMatch(/MESSAGE_TEXT|PG_EXCEPTION_(?:DETAIL|HINT|CONTEXT)/);
  });

  it("separates fixture/setup rejection from delete rejection and catches cancellation narrowly", () => {
    const sql = probeSql("immediate", ids, [...snapshot()]);
    const setup = sql.slice(sql.indexOf("DO $setup$"), sql.indexOf("SET LOCAL SESSION AUTHORIZATION"));
    expect(setup).toContain("outcome text := 'setup-failed'");
    expect(setup).toContain("IF state_code IN ('55P03', '57014') THEN outcome := 'unavailable'");
    expect(sql).toContain("IF pg_catalog.current_setting('swim_rollback.ready')::boolean THEN");
    expect(sql.match(/EXCEPTION WHEN SQLSTATE '57014' OR OTHERS THEN/g)).toHaveLength(2);
    expect(sql).not.toContain("CREATE TEMP");
  });

  it("checks all fixture identifiers and reference columns from a read-only owned connection", () => {
    const sql = snapshotSql(ids);
    expect(sql).toMatch(/^BEGIN READ ONLY;/);
    for (const table of ["auth.users", "public.profiles", "public.movements", "public.sessions",
      "public.set_logs", "public.session_movements", "public.cardio_logs", "public.swim_workouts"]) {
      expect(sql).toContain(`NOT EXISTS (SELECT 1 FROM ${table}`);
    }
    for (const id of Object.values(ids)) expect(sql).toContain(id);
    expect(sql).not.toMatch(/INSERT|DELETE|ALTER|COMMIT/);
  });

  it.each(["'; COMMIT; --", "123", ids.user.toUpperCase()])("rejects non-v4 or unsafe identifiers before SQL (%s)", (user) => {
    expect(() => probeSql("baseline", { ...ids, user }, [...snapshot()])).toThrow();
    expect(() => snapshotSql({ ...ids, user })).toThrow();
  });
  it("rejects duplicate fixture UUIDs and invalid container IDs", async () => {
    expect(() => probeSql("baseline", { ...ids, movement: ids.user }, [...snapshot()])).toThrow();
    const command = commands([]);
    await expect(runRollbackProbes(command, "unowned", vi.fn())).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
  });
});

describe("DC-SW8 rollback-only execution and safe projection", () => {
  it.each(["set-logs", "session-movements"])("gates three separate probes on baseline 23503/%s, freshly verifying each rollback", async (constraint) => {
    const command = commands([snapshot(), ["rejected", "23503", constraint, true, false, false],
      snapshot(), success, snapshot(), success, snapshot()]);
    const publish = vi.fn();
    const record = await runRollbackProbes(command, dbId, publish);
    expect(record.status).toBe("measured");
    expect(record.prerequisites).toEqual({ observed: true, matched: true, mismatched: [] });
    expect(record.probes.map((p) => p.mode)).toEqual(["baseline", "immediate", "deferred"]);
    expect(record.probes.every((p) => p.schemaRestored && p.fixturesAbsent)).toBe(true);
    const queries = sqls(command);
    expect(queries).toHaveLength(7);
    expect(queries.map((q) => q.startsWith("BEGIN READ ONLY;"))).toEqual([true, false, true, false, true, false, true]);
    const users = [1, 3, 5].map((i) => /DELETE FROM auth.users WHERE id = '([^']+)'/.exec(queries[i]!)![1]);
    expect(new Set(users).size).toBe(3);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(record);
    for (const call of command.mock.calls as unknown as [string, string[], object][]) {
      expect(call[0]).toBe("docker");
      expect(call[1].slice(0, 10)).toEqual(["exec", dbId, "psql", "-XqAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]);
      expect(call[2]).toEqual({ capture: true, allowFailure: true, timeout: 15_000 });
    }
    expect(formatAcceptanceSummary(record)).not.toMatch(/original-tuples|private|12345678|movement_id_fkey|postgres|auth_admin/);
  });

  it.each([success, ["rejected", "other", "other", true, false, false],
    ["rejected", "23503", "other", true, false, false],
  ])("leaves candidates unexecuted when baseline is inconclusive %#", async (...attempt) => {
    const command = commands([snapshot(), attempt, snapshot()]);
    const record = await runRollbackProbes(command, dbId, vi.fn());
    expect(record.status).toBe("inconclusive");
    expect(record.probes).toHaveLength(1);
    expect(sqls(command).join("")).not.toContain("ALTER TABLE");
  });

  it.each([0, 1, 2, 5])("rejects original prerequisite mismatch at index %i without any fixture/DDL", async (index) => {
    const initial: unknown[] = [...snapshot()]; initial[index] = false;
    const command = commands([initial]);
    const publish = vi.fn();
    await expect(runRollbackProbes(command, dbId, publish)).rejects.toThrow("Rollback probe prerequisites mismatched");
    expect(command).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0]).toMatchObject({ status: "failed", probes: [],
      prerequisites: { observed: true, matched: false, mismatched: [] } });
  });

  it.each(flags.map((id, index) => ({ id, index, gate: index < 3 ? 0 : index < 11 ? 1 : index < 25 ? 2 : 5 })))(
    "publishes only the explicit false $id while preserving its aggregate gate",
    async ({ id, index, gate }) => {
      const initial: unknown[] = [...snapshot()];
      initial[gate] = false;
      (initial[6] as boolean[])[index] = true;
      const command = commands([initial]);
      const publish = vi.fn();
      await expect(runRollbackProbes(command, dbId, publish)).rejects.toThrow("Rollback probe prerequisites mismatched");
      expect(command).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith({
        diagnosticMode: "rollback-only", qualifying: false, status: "failed", probes: [],
        prerequisites: { observed: true, matched: false, mismatched: [id] },
      });
      expect(sqls(command)[0]).toMatch(/^BEGIN READ ONLY;/);
      expect(sqls(command)[0]).not.toMatch(/INSERT|ALTER TABLE/);
      expect(rollbackRecordSchema.safeParse(publish.mock.calls[0]![0]).success).toBe(true);
    },
  );

  it("publishes all observed mismatches once in the fixed vocabulary order without private material", async () => {
    const initial: unknown[] = [...snapshot()];
    for (const gate of [0, 1, 2, 5]) initial[gate] = false;
    initial[3] = JSON.stringify({ catalog: "pg_constraint", oid: 12345, uuid: ids.user, sql: "SELECT private" });
    initial[6] = flags.map(() => true);
    const publish = vi.fn();
    await expect(runRollbackProbes(commands([initial]), dbId, publish)).rejects.toThrow("prerequisites mismatched");
    const record = publish.mock.calls[0]![0];
    expect(record.prerequisites).toEqual({ observed: true, matched: false, mismatched: flags });
    const safe = formatAcceptanceSummary(record);
    for (const raw of [initial[3], snapshot()[4], dbId, ids.user, "pg_constraint", "SELECT private",
      "supabase_auth_admin", "movement_id_fkey"]) expect(safe).not.toContain(raw);
  });

  it.each([
    ["short tuple", snapshot().slice(0, 6)],
    ["long tuple", [...snapshot(), true]],
    ["short flags", [...snapshot().slice(0, 6), flags.slice(1).map(() => false)]],
    ["long flags", [...snapshot().slice(0, 6), [...flags.map(() => false), false]]],
    ["null flag", [...snapshot().slice(0, 6), [null, ...flags.slice(1).map(() => false)]]],
    ["raw tuple", [true, true, true, { private: ids.user }, snapshot()[4], true, flags.map(() => false)]],
    ["forged matched evidence", [...snapshot().slice(0, 6), [true, ...flags.slice(1).map(() => false)]]],
  ])("keeps observed:false and the authored assertion on %s", async (_, initial) => {
    const command = commands([initial]);
    const publish = vi.fn();
    await expect(runRollbackProbes(command, dbId, publish)).rejects.toThrow("Rollback probe snapshot invalid");
    expect(command).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      diagnosticMode: "rollback-only", qualifying: false, status: "failed", probes: [],
      prerequisites: { observed: false },
    });
    expect(rollbackRecordSchema.safeParse(publish.mock.calls[0]![0]).success).toBe(true);
  });

  it.each([
    { text: JSON.stringify(snapshot()), result: { ...ok, code: 1 }, message: "Rollback probe command unavailable" },
    { text: JSON.stringify(snapshot()), result: { ...ok, timedOut: true }, message: "Rollback probe command unavailable" },
    { text: JSON.stringify(snapshot()), result: { ...ok, signal: "SIGTERM" }, message: "Rollback probe command unavailable" },
    { text: "x".repeat(131_073), result: ok, message: "Rollback probe output invalid" },
    { text: `invalid private SQL ${ids.user}`, result: ok, message: "Rollback probe output invalid" },
  ])("publishes observed:false after initial transport failure %#", async ({ text, result, message }) => {
    const command = vi.fn(async () => ({ text, result }));
    const publish = vi.fn();
    await expect(runRollbackProbes(command, dbId, publish)).rejects.toThrow(message);
    expect(command).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      diagnosticMode: "rollback-only", qualifying: false, status: "failed", probes: [],
      prerequisites: { observed: false },
    });
    expect(rollbackRecordSchema.safeParse(publish.mock.calls[0]![0]).success).toBe(true);
    expect(formatAcceptanceSummary(publish.mock.calls)).not.toContain(ids.user);
  });

  it("preserves an initial command exception without publishing its private text", async () => {
    const error = new Error("private connection SQL sentinel");
    const publish = vi.fn();
    await expect(runRollbackProbes(commands([error]), dbId, publish)).rejects.toBe(error);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      diagnosticMode: "rollback-only", qualifying: false, status: "failed", probes: [],
      prerequisites: { observed: false },
    });
    expect(rollbackRecordSchema.safeParse(publish.mock.calls[0]![0]).success).toBe(true);
    expect(formatAcceptanceSummary(publish.mock.calls)).not.toContain(error.message);
  });

  it("strictly validates both evidence variants, ordered unique IDs, and only the forward matched implication", () => {
    const record = { diagnosticMode: "rollback-only", qualifying: false, status: "failed", probes: [] };
    for (const prerequisites of [
      { observed: false }, { observed: true, matched: true, mismatched: [] },
      { observed: true, matched: false, mismatched: [] },
      { observed: true, matched: false, mismatched: flags },
    ]) expect(rollbackRecordSchema.safeParse({ ...record, prerequisites }).success).toBe(true);
    for (const prerequisites of [
      undefined, { observed: false, matched: false }, { observed: false, raw: "private" },
      { observed: true, matched: false, mismatched: [], raw: "private" },
      { observed: true, matched: true, mismatched: ["owner-super"] },
      { observed: true, matched: false, mismatched: ["unknown"] },
      { observed: true, matched: false, mismatched: ["owner-super", "owner-super"] },
      { observed: true, matched: false, mismatched: ["owner-super", "owner-session"] },
      { observed: true, matched: false, mismatched: [...flags, "owner-session"] },
      { observed: true, mismatched: [] }, { observed: true, matched: false }, { observed: "true" },
    ]) expect(rollbackRecordSchema.safeParse({ ...record, prerequisites }).success).toBe(false);
  });

  it.each([
    new Error("private connection URL"), ["setup-failed", "23503", "other", false, false, false],
    ["unavailable", "other", "none", true, false, false], ["succeeded", "none", "none", true, false, true],
    ["succeeded", "none", "none", true, true, false], ["rejected", "23503", "set-logs", false, false, false],
    ["rejected", "23503", "raw-name", true, false, false],
  ])("restores after failure/disconnect/invalid result, aborts without retry or compensating mutation %#", async (attempt) => {
    const command = commands([snapshot(), attempt, snapshot()]);
    const publish = vi.fn();
    await expect(runRollbackProbes(command, dbId, publish)).rejects.toThrow();
    expect(command).toHaveBeenCalledTimes(3);
    expect(sqls(command)[2]).toMatch(/^BEGIN READ ONLY;/);
    expect(publish.mock.calls[0]![0]).toMatchObject({ status: "failed",
      probes: [{ schemaRestored: true, fixturesAbsent: true }] });
    expect(formatAcceptanceSummary(publish.mock.calls)).not.toContain("private connection URL");
  });

  it.each([3, 4, 5, "disconnect"] as const)("aborts on changed tuple/fingerprint/surviving data/unverified restoration (%s)", async (change) => {
    const after: unknown[] = [...snapshot()];
    if (typeof change === "number") after[change] = change === 5 ? false : "c".repeat(32);
    const command = commands([snapshot(), baseline, change === "disconnect" ? new Error("private") : after]);
    const publish = vi.fn();
    await expect(runRollbackProbes(command, dbId, publish)).rejects.toThrow("restoration unverified");
    expect(command).toHaveBeenCalledTimes(3);
    expect(publish.mock.calls[0]![0].status).toBe("failed");
  });

  it("keeps the original snapshot across successful baseline and candidate, detecting candidate drift", async () => {
    const after = [...snapshot()]; after[3] = "altered";
    const command = commands([snapshot(), baseline, snapshot(), success, after]);
    await expect(runRollbackProbes(command, dbId, vi.fn())).rejects.toThrow("restoration unverified");
    expect(command).toHaveBeenCalledTimes(5);
  });

  it("gates remaining probes on candidate lock timeout but retains genuine candidate rejections", async () => {
    const command = commands([snapshot(), baseline, snapshot(), ["unavailable", "other", "none", true, false, false], snapshot()]);
    await expect(runRollbackProbes(command, dbId, vi.fn())).rejects.toThrow();
    expect(command).toHaveBeenCalledTimes(5);
    const rejected = commands([snapshot(), baseline, snapshot(), baseline, snapshot(), baseline, snapshot()]);
    expect((await runRollbackProbes(rejected, dbId, vi.fn())).status).toBe("measured");
  });

  it.each([
    { code: 1, signal: null, timedOut: false },
    { code: 0, signal: null, timedOut: true },
    { code: 0, signal: "SIGTERM", timedOut: false },
  ])("discards valid-looking results on process failure %# and verifies with a fresh command", async (result) => {
    const command = commands([snapshot(), snapshot()]);
    command.mockImplementationOnce(async () => ({ text: JSON.stringify(snapshot()), result: ok }))
      .mockImplementationOnce(async () => ({ text: JSON.stringify(baseline), result: result as typeof ok }));
    await expect(runRollbackProbes(command, dbId, vi.fn())).rejects.toThrow();
    expect(command).toHaveBeenCalledTimes(3);
  });

  it("rejects unknown fields, enum values, raw output and forged successful evidence", () => {
    const good = { mode: "baseline", outcome: "rejected", SQLSTATE: "23503", constraint: "set-logs",
      roleMatched: true, forcedChecks: false, rowCountMatched: false, schemaRestored: true, fixturesAbsent: true };
    expect(probeRecordSchema.safeParse(good).success).toBe(true);
    for (const field of ["mode", "outcome", "SQLSTATE", "constraint"]) {
      expect(probeRecordSchema.safeParse({ ...good, [field]: "raw-private" }).success).toBe(false);
    }
    expect(probeRecordSchema.safeParse({ ...good, message: "raw-private" }).success).toBe(false);
    expect(probeRecordSchema.safeParse({ ...good, outcome: "succeeded" }).success).toBe(false);
    for (const extra of [{ qualifying: true }, { diagnosticMode: "normal" }, { raw: "private" }]) {
      expect(rollbackRecordSchema.safeParse({
        diagnosticMode: "rollback-only", qualifying: false, status: "inconclusive", probes: [good], ...extra,
        prerequisites: { observed: false },
      }).success).toBe(false);
    }
  });
});

describe("rollback-only terminal nonqualification", () => {
  it("rejects combining diagnostic mode with the twelve-case stage", () => {
    expect(() => requireBrowserRoute(true)).toThrow("NON-QUALIFYING");
    expect(() => requireBrowserRoute(false)).not.toThrow();
  });
  it.each(["none", "prerequisite", "probe", "cleanup"])("stops unconditionally preserving %s failure primacy", (failure) => {
    const reporting = new AcceptanceReporting();
    if (failure !== "none") reporting.recordFailure(failure, new Error("private-sentinel"), failure === "cleanup");
    finishRollbackOnly(reporting);
    expect(reporting.failures.primary?.stage).toBe(failure === "none" ? "rollback-only nonqualifying stop" : failure);
    expect(formatAcceptanceSummary(reporting)).toContain("NON-QUALIFYING: rollback-only; twelve-case suite not run");
    expect(formatAcceptanceSummary(reporting)).not.toContain("private-sentinel");
  });
});
