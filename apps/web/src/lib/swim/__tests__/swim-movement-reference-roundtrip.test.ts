import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  MOVEMENT_REFERENCE_FILES, movementReferenceRecordSchema, necessitySql,
  runMovementReferenceRoundTrip, snapshotSql, updateIntegritySql, updateIntegrityRecordSchema,
} from "../../../../scripts/swim-movement-reference-roundtrip";
import { formatAcceptanceSummary } from "../../../../scripts/swim-acceptance-reporting";
import type { PrivateCommand } from "../../../../scripts/swim-auth-privileges";

const root = resolve(__dirname, "../../../../../..");
const readSql = (file: string) => readFileSync(resolve(root, file), "utf8");
const up = readSql(MOVEMENT_REFERENCE_FILES.up);
const down = readSql(MOVEMENT_REFERENCE_FILES.down);
const dbId = "a".repeat(64);
const ids = {
  user: "12345678-1234-4234-8234-123456789abc", movement: "22345678-1234-4234-8234-123456789abc",
  session: "32345678-1234-4234-8234-123456789abc", set: "42345678-1234-4234-8234-123456789abc",
};
const snapshot = (): [boolean, boolean, boolean, string, string, boolean] =>
  [true, true, true, "b".repeat(32), "c".repeat(32), true];
const rejection = () => ["rejected", "23503", "set-logs", true, false, false];
const success = () => ["succeeded", "none", "none", true, true, true];
const ok = { code: 0, signal: null, timedOut: false };
const updateRejection = () => ["rejected", "23503", "set-logs", true, true, true];
const sequence = () => [snapshot(), "", snapshot(), "", snapshot(), rejection(), snapshot(), success(), snapshot(),
  updateRejection(), snapshot()];
function harness(values = sequence()) {
  const command = vi.fn<PrivateCommand>(async () => {
    const next = values.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error("Unexpected command");
    return { text: typeof next === "string" ? next : JSON.stringify(next), result: ok };
  });
  const publish = vi.fn();
  const verifiedSql = vi.fn(readSql);
  const run = () => runMovementReferenceRoundTrip({ command, dbId, publish, verifiedSql });
  return { command, publish, verifiedSql, run };
}
const queries = (h: ReturnType<typeof harness>) => h.command.mock.calls.map(([, args]) => args.at(-1)!);

describe("ADR0080 DC-SW8 reversible movement-reference SQL", () => {
  it.each([["up", up], ["down", down]])("guards both exact shapes before any %s mutation under fixed ordered locks", (_, sql) => {
    expect(sql.match(/DO \$migration\$/g)).toHaveLength(1);
    const lock = sql.indexOf("LOCK TABLE public.set_logs, public.session_movements IN ACCESS EXCLUSIVE MODE;");
    expect(lock).toBeGreaterThan(sql.indexOf("SET LOCAL lock_timeout = '5s'"));
    expect(lock).toBeLessThan(sql.indexOf("WITH targets"));
    expect(sql.indexOf("IF matched IS DISTINCT FROM true")).toBeLessThan(sql.indexOf("ALTER TABLE"));
    expect(sql).toContain("count(*) = 2");
    expect(sql).toContain(") IS TRUE), false) INTO matched");
    expect(sql).toContain("SET LOCAL statement_timeout = '30s'");
    expect(sql).toContain("SET LOCAL search_path = pg_catalog");
    expect(sql.match(/DROP CONSTRAINT /g)).toHaveLength(1);
    expect(sql.match(/ADD CONSTRAINT /g)).toHaveLength(1);
    expect(sql).not.toMatch(/COMMIT|statement-breakpoint|NOT VALID|DISABLE TRIGGER|CASCADE|SET NULL|GRANT|SET ROLE|SESSION AUTHORIZATION|DELETE FROM|UPDATE public\./);
    expect(sql).not.toMatch(/EXCEPTION WHEN|session_user|current_user/);
    expect(sql).toContain("ALTER TABLE public.set_logs DROP CONSTRAINT set_logs_movement_id_fkey;");
    expect(sql).toContain("ALTER TABLE public.set_logs ADD CONSTRAINT set_logs_movement_id_fkey");
    expect(sql).not.toContain("ALTER TABLE public.session_movements");
  });
  it("has exact inverse guards and actions without an initially-immediate candidate", () => {
    expect(up).toContain("c.confdeltype = 'r'");
    expect(up).toContain("NOT c.condeferrable AND NOT c.condeferred");
    expect(down).toContain("c.confdeltype = 'a'");
    expect(down).toContain("c.condeferrable AND c.condeferred");
    expect(down).toContain(`OR (c.conrelid = 'public.session_movements'::regclass
        AND c.confdeltype = 'r' AND NOT c.condeferrable AND NOT c.condeferred)`);
    expect(down).toContain("ELSE 'FOREIGN KEY (movement_id) REFERENCES public.movements(id) ON DELETE RESTRICT' END");
    expect(up.match(/ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;/g)).toHaveLength(1);
    expect(down.match(/ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;/g)).toHaveLength(1);
    const normalize = (sql: string) => sql.slice(sql.indexOf("WITH targets"), sql.indexOf("IF matched"))
      .replace(`    AND c.confdeltype = 'r' AND c.confupdtype = 'a' AND c.confmatchtype = 's'
    AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred`,
      `    AND ((c.conrelid = 'public.set_logs'::regclass
        AND c.confdeltype = 'a' AND c.condeferrable AND c.condeferred)
      OR (c.conrelid = 'public.session_movements'::regclass
        AND c.confdeltype = 'r' AND NOT c.condeferrable AND NOT c.condeferred))
    AND c.confupdtype = 'a' AND c.confmatchtype = 's' AND c.convalidated`)
      .replace(/=\n      'FOREIGN KEY \(movement_id\) REFERENCES public.movements\(id\) ON DELETE RESTRICT'/,
        `=\n      CASE WHEN c.conrelid = 'public.set_logs'::regclass
        THEN 'FOREIGN KEY (movement_id) REFERENCES public.movements(id) DEFERRABLE INITIALLY DEFERRED'
        ELSE 'FOREIGN KEY (movement_id) REFERENCES public.movements(id) ON DELETE RESTRICT' END`);
    expect(normalize(up)).toBe(normalize(down));
  });
  it.each(["connamespace", "contypid", "confrelid", "conkey", "confkey", "confdeltype", "confupdtype",
    "confmatchtype", "convalidated", "condeferrable", "condeferred", "conislocal", "coninhcount",
    "conparentid", "connoinherit", "conpfeqop", "conppeqop", "conffeqop", "confdelsetcols",
    "conexclop", "conbin", "conindid", "attnotnull", "atttypid", "atttypmod", "relowner",
    "relkind", "relispartition", "pg_inherits", "pg_get_constraintdef"])("pins semantic property %s in both migration guards and permanent catalog proof", (property) => {
    for (const sql of [up, down, snapshotSql(ids), snapshotSql(ids, false)]) expect(sql).toContain(property);
  });
  it("normalizes only the set_logs OID/modes, retaining the complete session_movements tuple", () => {
    const sql = snapshotSql(ids);
    expect(sql).toContain("tuple - ARRAY['oid','confdeltype','condeferrable','condeferred']");
    expect(sql).toContain(`changed AS (
  SELECT * FROM targeted WHERE conrelid = 'public.set_logs'::pg_catalog.regclass
    AND conname = 'set_logs_movement_id_fkey'
)`);
    expect(sql).toContain("FROM changed) AS semantics");
    expect(sql).toContain("jsonb_agg(tuple ORDER BY oid)");
    expect(sql).toContain("FROM relationships WHERE oid NOT IN (SELECT oid FROM changed)");
    expect(sql).not.toContain("FROM relationships WHERE oid NOT IN (SELECT oid FROM targeted)");
    for (const field of ["pg_attribute", "pg_index", "relacl", "relowner", "relrowsecurity",
      "relforcerowsecurity", "pg_policy", "pg_trigger"]) expect(sql).toContain(field);
    expect(sql).toContain(") IS TRUE AS matched");
    expect(sql).toContain("c.confdeltype = 'a'");
    expect(sql).toContain("c.condeferrable AND c.condeferred");
    expect(sql).not.toContain("pg_stat");
  });
  it.each([true, false])("always requires the unchanged FK's original shape (candidate=%s)", (candidate) => {
    const sql = snapshotSql(ids, candidate);
    const props = sql.slice(sql.indexOf("), props AS"), sql.indexOf(") IS TRUE AS matched"));
    expect(props).toContain(`c.conrelid = 'public.session_movements'::pg_catalog.regclass AND c.conname = 'session_movements_movement_id_fkey'
      AND c.confdeltype = 'r'
      AND NOT c.condeferrable AND NOT c.condeferred
      AND pg_catalog.pg_get_constraintdef(c.oid, false) =
        'FOREIGN KEY (movement_id) REFERENCES public.movements(id) ON DELETE RESTRICT'`);
    expect(props).toContain(`c.conrelid = 'public.set_logs'::pg_catalog.regclass AND c.conname = 'set_logs_movement_id_fkey'
      AND c.confdeltype = '${candidate ? "a" : "r"}'
      AND ${candidate ? "" : "NOT "}c.condeferrable AND ${candidate ? "" : "NOT "}c.condeferred`);
  });
  it("qualifies the catalog column in snapshots and composed DO blocks retaining the matched variable", () => {
    const controls = (["baseline", "candidate"] as const)
      .map((mode) => necessitySql(mode, ids, snapshot(), down));
    const update = updateIntegritySql(ids, snapshot());
    const aggregate = "count(*) = 2 AND COALESCE(bool_and(props.matched), false) FROM props";
    for (const sql of [snapshotSql(ids), snapshotSql(ids, false), ...controls, update]) {
      expect(sql).toContain(aggregate);
      expect(sql).not.toMatch(/bool_and\s*\(\s*matched\s*\)/i);
    }
    const contexts = [
      ...controls.flatMap((sql) => ["guard", "setup"].map((tag) => ({ sql, tag }))),
      { sql: update, tag: "update_integrity" },
    ];
    for (const { sql, tag } of contexts) {
      const block = sql.slice(sql.indexOf(`DO $${tag}$`), sql.indexOf(`END $${tag}$;`));
      expect(block).toContain(`DO $${tag}$\nDECLARE matched boolean;`);
      expect(block).toContain(aggregate);
      expect(block).toContain("INTO matched FROM evidence;");
      expect(block).toContain("IF matched IS DISTINCT FROM true");
    }
  });
  it.each(["baseline", "candidate"] as const)("runs the %s control inside rollback, using exact down SQL only for baseline", (mode) => {
    const sql = necessitySql(mode, ids, snapshot(), down);
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(sql.match(/^ROLLBACK;/gm)).toHaveLength(1);
    expect(sql.endsWith("ROLLBACK;")).toBe(true);
    if (mode === "baseline") expect(sql).toContain(down);
    else expect(sql).not.toMatch(/ALTER TABLE|DROP CONSTRAINT|ADD CONSTRAINT/);
    const setup = sql.slice(sql.indexOf("DO $setup$"));
    expect(setup).not.toMatch(/ALTER TABLE|DROP CONSTRAINT|ADD CONSTRAINT/);
    expect(setup).toContain(`c.conrelid = 'public.set_logs'::pg_catalog.regclass AND c.conname = 'set_logs_movement_id_fkey'
      AND c.confdeltype = '${mode === "baseline" ? "r" : "a"}'`);
    expect(sql).not.toContain("ALTER TABLE public.session_movements");
    for (const table of ["auth.users", "public.movements", "public.sessions", "public.set_logs", "public.session_movements"]) {
      expect(sql).toContain(`INSERT INTO ${table}`);
    }
    expect(new Set(sql.match(/[0-9a-f]{8}-[0-9a-f-]{27}/g))).toEqual(new Set(Object.values(ids)));
    expect(sql).toContain("SET LOCAL SESSION AUTHORIZATION supabase_auth_admin;");
    expect(sql).toContain("session_user = 'supabase_auth_admin' AND current_user = 'supabase_auth_admin'");
    expect(sql).toContain("GET DIAGNOSTICS affected = ROW_COUNT");
    expect(sql).toContain("SET CONSTRAINTS ALL IMMEDIATE;");
    expect(sql.match(/DELETE FROM/g)).toHaveLength(1);
    expect(sql).not.toMatch(/COMMIT|SET (?:LOCAL )?ROLE|DISABLE TRIGGER|NOT VALID|GRANT/);
    expect(sql).toContain("session_user <> 'supabase_admin'");
    expect(sql).toContain("current_user <> 'supabase_admin'");
  });
  it("rejects duplicate fixture IDs, injected modes, and unsafe snapshot values before execution", () => {
    expect(() => snapshotSql({ ...ids, set: ids.user })).toThrow();
    expect(() => snapshotSql({ ...ids, user: "'; DELETE" })).toThrow();
    expect(() => necessitySql("unknown" as never, ids, snapshot(), down)).toThrow();
    const invalid = snapshot(); invalid[3] = "'; DELETE";
    expect(() => necessitySql("baseline", ids, invalid, down)).toThrow();
    expect(() => updateIntegritySql(ids, invalid)).toThrow();
    expect(() => updateIntegritySql({ ...ids, set: ids.user }, snapshot())).toThrow();
  });
  it("checks current candidate and shared fixture before one exact UPDATE with forced checking inside its capture", () => {
    const sql = updateIntegritySql(ids, snapshot());
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(sql.match(/^ROLLBACK;/gm)).toHaveLength(1);
    expect(sql.endsWith("ROLLBACK;")).toBe(true);
    expect(sql).not.toMatch(/ALTER TABLE|DELETE FROM|COMMIT|SESSION AUTHORIZATION|SET ROLE|GRANT|POLICY|DISABLE|NOT VALID/);
    expect(sql.indexOf("SELECT shapes AND semantics")).toBeLessThan(sql.indexOf("INSERT INTO auth.users"));
    expect(sql).toContain(`EXISTS (SELECT 1 FROM public.movements WHERE id = '${ids.set}'::uuid)`);
    expect(sql).toContain(`OR NOT EXISTS (SELECT 1 FROM public.set_logs
        WHERE id = '${ids.set}'::uuid AND session_id = '${ids.session}'::uuid
          AND movement_id = '${ids.movement}'::uuid)`);
    const attempt = sql.slice(sql.indexOf("    BEGIN\n      UPDATE"), sql.indexOf("  PERFORM pg_catalog.set_config"));
    expect(sql.match(/UPDATE public.set_logs/g)).toHaveLength(1);
    expect(sql).not.toContain("UPDATE public.session_movements");
    expect(attempt).toContain(`UPDATE public.set_logs SET movement_id = '${ids.set}'::uuid
        WHERE id = '${ids.set}'::uuid AND session_id = '${ids.session}'::uuid
          AND movement_id = '${ids.movement}'::uuid;`);
    expect(attempt).toContain("GET DIAGNOSTICS affected = ROW_COUNT;\n      row_matched := affected = 1;\n      forced := true;\n      SET CONSTRAINTS ALL IMMEDIATE;");
    expect(attempt.indexOf("SET CONSTRAINTS ALL IMMEDIATE")).toBeLessThan(attempt.indexOf("EXCEPTION WHEN"));
    expect(sql.indexOf("SET CONSTRAINTS ALL IMMEDIATE")).toBeLessThan(sql.indexOf("    BEGIN\n      UPDATE"));
    expect(sql).toContain("ELSE 'setup-failed' END");
    expect(sql).toContain("RETURNED_SQLSTATE, constraint_name = CONSTRAINT_NAME");
    expect(sql).not.toMatch(/SQLERRM|MESSAGE_TEXT|PG_EXCEPTION_DETAIL|PG_EXCEPTION_CONTEXT/);
    expect(new Set(sql.match(/[0-9a-f]{8}-[0-9a-f-]{27}/g))).toEqual(new Set(Object.values(ids)));
    const fixture = (query: string) => query.slice(query.indexOf("INSERT INTO auth.users"),
      query.indexOf("0, 'main', 8, 12.00, 6.0);") + "0, 'main', 8, 12.00, 6.0);".length);
    for (const mode of ["baseline", "candidate"] as const) {
      expect(fixture(necessitySql(mode, ids, snapshot(), down))).toBe(fixture(sql));
    }
  });
});

describe("DC-SW8 composed relationship round trip lifecycle (no database execution)", () => {
  it("executes verified whole down/up files, checks each catalog, then freshly verifies both rolled-back attempts", async () => {
    const h = harness();
    await expect(h.run()).resolves.toMatchObject({ status: "matched", initial: true, down: true, up: true,
      probes: [{ mode: "baseline", outcome: "rejected", constraint: "set-logs", schemaRestored: true },
        { mode: "candidate", outcome: "succeeded", rowCountMatched: true, forcedChecks: true, schemaRestored: true }],
      updateIntegrity: { outcome: "rejected", SQLSTATE: "23503", constraint: "set-logs",
        rowCountMatched: true, forcedChecks: true, schemaRestored: true, fixturesAbsent: true } });
    expect(h.verifiedSql.mock.calls).toEqual([
      [MOVEMENT_REFERENCE_FILES.down], [MOVEMENT_REFERENCE_FILES.up],
      [MOVEMENT_REFERENCE_FILES.down],
    ]);
    const sql = queries(h);
    expect(sql[1]).toBe(down);
    expect(sql[3]).toBe(up);
    expect(sql).toHaveLength(11);
    expect(sql[9]).toContain("UPDATE public.set_logs");
    expect(sql[10]).toContain("BEGIN READ ONLY");
    const fixtureIds = [5, 7, 9].map((index) => new Set(sql[index].match(/[0-9a-f]{8}-[0-9a-f-]{27}/g)));
    expect(fixtureIds.every((set) => set.size === 4)).toBe(true);
    expect(new Set(fixtureIds.flatMap((set) => [...set])).size).toBe(12);
    for (const index of [5, 7]) {
      for (const id of new Set(sql[index].match(/[0-9a-f]{8}-[0-9a-f-]{27}/g))) {
        expect(sql[index + 1]).toContain(id);
      }
    }
    for (const id of new Set(sql[9].match(/[0-9a-f]{8}-[0-9a-f-]{27}/g))) {
      expect(sql[10]).toContain(id);
    }
    expect(sql[2]).toContain("c.confdeltype = 'r'");
    for (const index of [0, 4, 6, 8]) expect(sql[index]).toContain("c.confdeltype = 'a'");
    for (const [executable, args, options] of h.command.mock.calls) {
      expect(executable).toBe("docker");
      expect(args).toEqual(["exec", "-e", "PGOPTIONS=-c statement_timeout=30s -c lock_timeout=5s",
        dbId, "psql", "-XqAt", "--no-password", "-U", "supabase_admin", "-d", "postgres",
        "-v", "ON_ERROR_STOP=1", "-c", expect.any(String)]);
      expect(options).toEqual({ capture: true, allowFailure: true, timeout: 35_000 });
    }
    expect(h.publish).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1, 2, 5])("fails closed on initial prerequisite %i with no DDL", async (index) => {
    const initial = snapshot(); initial[index] = false as never;
    const h = harness([initial]);
    await expect(h.run()).rejects.toThrow();
    expect(h.command).toHaveBeenCalledTimes(1);
  });
  it.each([1, 2, 3, 4])("never retries failed durable stage %i", async (index) => {
    const steps: unknown[] = sequence(); steps[index] = new Error("private details");
    const h = harness(steps as ReturnType<typeof sequence>);
    await expect(h.run()).rejects.toThrow();
    expect(h.command).toHaveBeenCalledTimes(index + 1);
    expect(h.publish.mock.calls[0][0].status).toBe("failed");
  });
  it.each([3, 4])("fails on semantic or other-metadata drift at snapshot slot %i", async (slot) => {
    const changed = snapshot(); changed[slot] = "d".repeat(32);
    const steps = sequence(); steps[4] = changed;
    const h = harness(steps);
    await expect(h.run()).rejects.toThrow("round trip mismatched");
    expect(h.command).toHaveBeenCalledTimes(5);
  });
  it.each([
    ["succeeded", "none", "none", true, true, true],
    ["rejected", "23503", "session-movements", true, false, false],
    ["rejected", "other", "other", true, false, false],
    ["rejected", "23503", "set-logs", false, false, false],
    ["setup-failed", "23503", "set-logs", false, false, false],
    ["unavailable", "other", "other", true, false, false],
  ])("fails closed when the baseline control does not reproduce the set_logs rejection %j", async (...result) => {
    const steps = sequence(); steps[5] = result;
    const h = harness(steps);
    await expect(h.run()).rejects.toThrow("baseline control not proved");
    expect(h.command).toHaveBeenCalledTimes(7);
    expect(h.publish.mock.calls[0][0].probes[0].schemaRestored).toBe(true);
  });
  it.each([
    ["rejected", "23503", "set-logs", true, true, true],
    ["rejected", "23503", "session-movements", true, false, false],
    ["succeeded", "none", "none", false, true, true],
    ["succeeded", "none", "none", true, false, true],
    ["succeeded", "none", "none", true, true, false],
    ["succeeded", "other", "none", true, true, true],
    ["succeeded", "none", "set-logs", true, true, true],
    ["setup-failed", "none", "none", true, true, true],
    ["unavailable", "none", "none", false, false, false],
    ["succeeded", "none", "none", true, true],
  ])("fails closed on rejected or incomplete candidate control %j", async (...result) => {
    const steps = sequence(); steps[7] = result;
    const h = harness(steps);
    await expect(h.run()).rejects.toThrow("candidate control not proved");
    expect(h.command).toHaveBeenCalledTimes(9);
    expect(h.publish.mock.calls[0][0]).toMatchObject({ status: "failed",
      probes: [{ mode: "baseline" }, { mode: "candidate", schemaRestored: true, fixturesAbsent: true }],
      updateIntegrity: { outcome: "not-attempted" } });
  });
  it.each(([5, 7] as const).flatMap((index) =>
    ["disconnect", "invalid", "oversized", "timeout", "nonzero", "signal"].map((kind) => ({ index, kind }))))
  ("freshly verifies restoration after control at $index has $kind", async ({ index, kind }) => {
    const h = harness(sequence().slice(0, index));
    const run = h.run();
    // Preserve all successful calls before this control.
    const normal = h.command.getMockImplementation()!;
    h.command.mockImplementation(async (...args) => {
      const call = h.command.mock.calls.length;
      if (call <= index) return normal(...args);
      if (call === index + 1) {
        if (kind === "disconnect") throw new Error("private URL");
        return { text: kind === "oversized" ? "x".repeat(131_073) : "invalid",
          result: { code: kind === "nonzero" ? 1 : 0, signal: kind === "signal" ? "SIGTERM" : null, timedOut: kind === "timeout" } };
      }
      return { text: JSON.stringify(snapshot()), result: ok };
    });
    await expect(run).rejects.toThrow(`${index === 5 ? "baseline" : "candidate"} control not proved`);
    expect(h.command).toHaveBeenCalledTimes(index + 2);
    expect(queries(h)[index + 1]).toContain("BEGIN READ ONLY");
    expect(formatAcceptanceSummary(h.publish.mock.calls[0][0])).not.toMatch(/private|[a-f0-9]{32}/);
  });
  it.each(([6, 8] as const).flatMap((index) =>
    ([0, 1, 2, 3, 4, 5, "disconnect"] as const).map((slot) => ({ index, slot }))))
  ("fails closed on control restoration $index field $slot without repair DML", async ({ index, slot }) => {
    const steps: unknown[] = sequence();
    if (slot === "disconnect") steps[index] = new Error("private restoration");
    else {
      const changed = snapshot(); changed[slot] = (slot === 3 || slot === 4 ? "d".repeat(32) : false) as never;
      steps[index] = changed;
    }
    const h = harness(steps as ReturnType<typeof sequence>);
    await expect(h.run()).rejects.toThrow("restoration unverified");
    expect(h.command).toHaveBeenCalledTimes(index + 1);
    expect(queries(h).filter((sql) => sql.includes("DELETE FROM"))).toHaveLength(index === 6 ? 1 : 2);
  });
  it("does not consume cached SQL when source verification fails, and publishes only bounded closed evidence", async () => {
    const h = harness();
    h.verifiedSql.mockImplementationOnce(() => { throw new Error("private source path"); });
    await expect(h.run()).rejects.toThrow();
    expect(h.command).toHaveBeenCalledTimes(1);
    const record = h.publish.mock.calls[0][0];
    expect(movementReferenceRecordSchema.safeParse({ ...record, path: "private" }).success).toBe(false);
    expect(formatAcceptanceSummary(record)).not.toMatch(/private|[a-f0-9]{32}/);
    expect(record.updateIntegrity.outcome).toBe("not-attempted");
    expect(updateIntegrityRecordSchema.safeParse(record.updateIntegrity).success).toBe(true);
    expect(movementReferenceRecordSchema.safeParse({ ...record, status: "matched" }).success).toBe(false);
  });
  it.each([
    ["succeeded", "none", "none", true, true, true],
    ["rejected", "23503", "set-logs", true, true, false],
    ["rejected", "23503", "set-logs", true, false, true],
    ["rejected", "23503", "set-logs", false, true, true],
    ["rejected", "23503", "session-movements", true, true, true],
    ["rejected", "other", "set-logs", true, true, true],
    ["setup-failed", "23503", "set-logs", true, true, true],
    ["not-attempted", "none", "none", false, false, false],
  ])("rejects an unproved UPDATE result %j after verifying rollback", async (...result) => {
    const steps = sequence(); steps[9] = result;
    const h = harness(steps);
    await expect(h.run()).rejects.toThrow("UPDATE integrity not proved");
    expect(h.command).toHaveBeenCalledTimes(11);
    expect(h.publish.mock.calls[0][0]).toMatchObject({ status: "failed",
      updateIntegrity: { schemaRestored: true, fixturesAbsent: true } });
  });
  it.each(["disconnect", "invalid", "oversized", "timeout", "nonzero", "signal"])("verifies UPDATE restoration after %s without leaking output", async (kind) => {
    const h = harness(sequence().slice(0, 9));
    const normal = h.command.getMockImplementation()!;
    h.command.mockImplementation(async (...args) => {
      if (h.command.mock.calls.length <= 9) return normal(...args);
      if (h.command.mock.calls.length === 11) return { text: JSON.stringify(snapshot()), result: ok };
      if (kind === "disconnect") throw new Error("private URL");
      return { text: kind === "oversized" ? "x".repeat(131_073) : "private SQL",
        result: { code: kind === "nonzero" ? 1 : 0, signal: kind === "signal" ? "SIGTERM" : null, timedOut: kind === "timeout" } };
    });
    await expect(h.run()).rejects.toThrow("UPDATE integrity not proved");
    expect(h.command).toHaveBeenCalledTimes(11);
    expect(queries(h)[10]).toContain("BEGIN READ ONLY");
    const record = h.publish.mock.calls[0][0];
    expect(record.updateIntegrity.schemaRestored).toBe(true);
    expect(formatAcceptanceSummary(record)).not.toMatch(/private|[a-f0-9]{32}/);
  });
  it.each([0, 1, 2, 3, 4, 5, "disconnect"] as const)("requires fresh UPDATE restoration field %s", async (slot) => {
    const steps: unknown[] = sequence();
    if (slot === "disconnect") steps[10] = new Error("private restoration");
    else {
      const changed = snapshot(); changed[slot] = (slot === 3 || slot === 4 ? "d".repeat(32) : false) as never;
      steps[10] = changed;
    }
    const h = harness(steps as ReturnType<typeof sequence>);
    await expect(h.run()).rejects.toThrow("UPDATE restoration unverified");
    expect(h.command).toHaveBeenCalledTimes(11);
    expect(queries(h).filter((sql) => sql.includes("DELETE FROM"))).toHaveLength(2);
  });
  it("strict matched records require every proof and cannot publish raw UPDATE details", async () => {
    const h = harness(); const record = await h.run();
    for (const field of ["SQLSTATE", "constraint", "outcome"]) {
      expect(updateIntegrityRecordSchema.safeParse({ ...record.updateIntegrity, [field]: "private SQL" }).success).toBe(false);
    }
    expect(updateIntegrityRecordSchema.safeParse({ ...record.updateIntegrity, detail: "private" }).success).toBe(false);
    for (const field of ["roleMatched", "forcedChecks", "rowCountMatched", "schemaRestored", "fixturesAbsent"]) {
      expect(movementReferenceRecordSchema.safeParse({ ...record,
        updateIntegrity: { ...record.updateIntegrity, [field]: false } }).success).toBe(false);
    }
    for (const [index, fields] of [
      [0, ["roleMatched", "schemaRestored", "fixturesAbsent"]],
      [1, ["roleMatched", "forcedChecks", "rowCountMatched", "schemaRestored", "fixturesAbsent"]],
    ] as const) {
      for (const field of fields) {
        const probes = record.probes.map((probe, i) => i === index ? { ...probe, [field]: false } : probe);
        expect(movementReferenceRecordSchema.safeParse({ ...record, probes }).success).toBe(false);
      }
    }
    for (const partial of [{ down: false }, { up: false }, { initial: false }, { probes: [] },
      { probes: [record.probes[0]] }, { probes: [...record.probes, record.probes[1]] },
      { probes: [record.probes[1], record.probes[0]] },
      { probes: [record.probes[0], record.probes[0]] },
      { probes: record.probes.map((p) => ({ ...p, mode: "set-logs-only" })) },
      { probes: record.probes.map((p) => ({ ...p, mode: "session-movements-only" })) },
      { probes: record.probes.map((p) => ({ ...p, detail: "private" })) },
      { probes: [{ ...record.probes[0], outcome: "succeeded" }, record.probes[1]] },
      { probes: [record.probes[0], { ...record.probes[1], outcome: "rejected" }] },
      { updateIntegrity: { ...record.updateIntegrity, outcome: "not-attempted" } }]) {
      expect(movementReferenceRecordSchema.safeParse({ ...record, ...partial }).success).toBe(false);
    }
  });
  it("keeps C3 integrity failures strict and authenticated without changing the twelve identities", () => {
    const source = readSql("apps/web/e2e/swimming-account-mobile.spec.ts");
    const negative = source.slice(source.indexOf("const absentMovement ="), source.indexOf("const controlDeletion ="));
    const loop = negative.slice(negative.indexOf("const rejected ="), negative.indexOf("for (const request"));
    expect(loop.match(/\(\) => linked\.client\.from/g)).toHaveLength(4);
    expect(loop).toContain('from("movements").delete()');
    expect(loop).toContain('from("set_logs").insert(');
    expect(loop).toContain('from("session_movements").insert(');
    expect(loop).toContain('from("set_logs").update(');
    expect(loop).not.toContain('from("session_movements").update(');
    expect(negative).toContain('expect((await request()).error?.code).toBe("23503")');
    expect(negative).toContain("await readCustom(), customBefore");
    expect(negative).not.toMatch(/admin\.from\("(?:set_logs|session_movements)"\)|skip|catch|retry/);
    const owner = negative.slice(negative.indexOf("const ownerUpdate ="));
    expect(owner).toContain('await linked.client.from("session_movements").update({ movement_id: absentMovement })');
    expect(owner).toContain('.eq("user_id", linked.userId).eq("session_id", custom.sessionId).eq("movement_id", custom.movementId)\n      .select("session_id")');
    expect(owner).toContain("expect(ownerUpdate.error === null).toBe(true)");
    expect(owner).toContain("expect(ownerUpdate.data).toEqual([])");
    expect(owner).toContain("isDeepStrictEqual(await readCustom(), customBefore)");
    expect(owner).toContain('.eq("movement_id", absentMovement)');
    expect(owner).toContain("expect(ownerUpdateOrphans.error === null).toBe(true)");
    expect(owner).toContain("expect(ownerUpdateOrphans.data).toEqual([])");
    expect(owner).not.toContain("23503");
    expect(readSql("packages/db/drizzle/0059_session_movements.sql")).not.toMatch(/FOR UPDATE|FOR ALL/);
    expect(readSql("packages/db/drizzle/0063_session_movements_grant_update.sql")).toContain("GRANT UPDATE");
  });
});
