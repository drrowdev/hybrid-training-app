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
const rejection = (constraint = "session-movements") => ["rejected", "23503", constraint, true, false, false];
const ok = { code: 0, signal: null, timedOut: false };
const updateRejection = () => ["rejected", "23503", "session-movements", true, true, true];
const sequence = () => [snapshot(), "", snapshot(), "", snapshot(), rejection(), snapshot(), rejection("set-logs"), snapshot(),
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
    expect(sql.match(/DROP CONSTRAINT /g)).toHaveLength(2);
    expect(sql.match(/ADD CONSTRAINT /g)).toHaveLength(2);
    expect(sql).not.toMatch(/COMMIT|statement-breakpoint|NOT VALID|DISABLE TRIGGER|CASCADE|SET NULL|GRANT|SET ROLE|SESSION AUTHORIZATION|DELETE FROM|UPDATE public\./);
    expect(sql).not.toMatch(/EXCEPTION WHEN|session_user|current_user/);
    for (const table of ["set_logs", "session_movements"]) {
      expect(sql).toContain(`ALTER TABLE public.${table} DROP CONSTRAINT ${table}_movement_id_fkey;`);
      expect(sql).toContain(`ALTER TABLE public.${table} ADD CONSTRAINT ${table}_movement_id_fkey`);
    }
  });
  it("has exact inverse guards and actions without an initially-immediate candidate", () => {
    expect(up).toContain("c.confdeltype = 'r'");
    expect(up).toContain("NOT c.condeferrable AND NOT c.condeferred");
    expect(down).toContain("c.confdeltype = 'a'");
    expect(down).toContain("c.condeferrable AND c.condeferred");
    expect(up.match(/ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;/g)).toHaveLength(2);
    expect(down.match(/ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;/g)).toHaveLength(2);
    const normalize = (sql: string) => sql.slice(sql.indexOf("WITH targets"), sql.indexOf("IF matched"))
      .replace("c.confdeltype = 'r'", "c.confdeltype = 'a'")
      .replace("NOT c.condeferrable AND NOT c.condeferred", "c.condeferrable AND c.condeferred")
      .replace("ON DELETE RESTRICT'", "DEFERRABLE INITIALLY DEFERRED'");
    expect(normalize(up)).toBe(normalize(down));
  });
  it.each(["connamespace", "contypid", "confrelid", "conkey", "confkey", "confdeltype", "confupdtype",
    "confmatchtype", "convalidated", "condeferrable", "condeferred", "conislocal", "coninhcount",
    "conparentid", "connoinherit", "conpfeqop", "conppeqop", "conffeqop", "confdelsetcols",
    "conexclop", "conbin", "conindid", "attnotnull", "atttypid", "atttypmod", "relowner",
    "relkind", "relispartition", "pg_inherits", "pg_get_constraintdef"])("pins semantic property %s in both migration guards and permanent catalog proof", (property) => {
    for (const sql of [up, down, snapshotSql(ids), snapshotSql(ids, false)]) expect(sql).toContain(property);
  });
  it("normalizes only target OIDs/modes while fingerprinting all other relationships and stable metadata", () => {
    const sql = snapshotSql(ids);
    expect(sql).toContain("tuple - ARRAY['oid','confdeltype','condeferrable','condeferred']");
    expect(sql).toContain("FROM relationships WHERE oid NOT IN (SELECT oid FROM targeted)");
    for (const field of ["pg_attribute", "pg_index", "relacl", "relowner", "relrowsecurity",
      "relforcerowsecurity", "pg_policy", "pg_trigger"]) expect(sql).toContain(field);
    expect(sql).toContain(") IS TRUE AS matched");
    expect(sql).toContain("c.confdeltype = 'a'");
    expect(sql).toContain("c.condeferrable AND c.condeferred");
    expect(sql).not.toContain("pg_stat");
  });
  it.each(["set-logs-only", "session-movements-only"] as const)("composes exact down SQL and a single partial candidate for %s inside rollback", (mode) => {
    const sql = necessitySql(mode, ids, snapshot(), down);
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(sql.match(/^ROLLBACK;/gm)).toHaveLength(1);
    expect(sql.endsWith("ROLLBACK;")).toBe(true);
    expect(sql).toContain(down);
    const setup = sql.slice(sql.indexOf("DO $setup$"));
    expect(setup.match(/DROP CONSTRAINT/g)).toHaveLength(1);
    expect(setup).toContain(`ALTER TABLE public.${mode === "set-logs-only" ? "set_logs" : "session_movements"} ADD CONSTRAINT`);
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
    expect(() => necessitySql("set-logs-only", ids, invalid, down)).toThrow();
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
    expect(sql).toContain(`OR NOT EXISTS (SELECT 1 FROM public.session_movements
        WHERE user_id = '${ids.user}'::uuid AND session_id = '${ids.session}'::uuid
          AND movement_id = '${ids.movement}'::uuid)`);
    const attempt = sql.slice(sql.indexOf("    BEGIN\n      UPDATE"), sql.indexOf("  PERFORM pg_catalog.set_config"));
    expect(sql.match(/UPDATE public.session_movements/g)).toHaveLength(1);
    expect(attempt).toContain(`UPDATE public.session_movements SET movement_id = '${ids.set}'::uuid
        WHERE user_id = '${ids.user}'::uuid AND session_id = '${ids.session}'::uuid
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
    for (const mode of ["set-logs-only", "session-movements-only"] as const) {
      expect(fixture(necessitySql(mode, ids, snapshot(), down))).toBe(fixture(sql));
    }
  });
});

describe("DC-SW8 composed relationship round trip lifecycle (no database execution)", () => {
  it("executes verified whole down/up files, checks each catalog, then freshly verifies both rolled-back attempts", async () => {
    const h = harness();
    await expect(h.run()).resolves.toMatchObject({ status: "matched", initial: true, down: true, up: true,
      probes: [{ mode: "set-logs-only", schemaRestored: true }, { mode: "session-movements-only", schemaRestored: true }],
      updateIntegrity: { outcome: "rejected", SQLSTATE: "23503", constraint: "session-movements",
        rowCountMatched: true, forcedChecks: true, schemaRestored: true, fixturesAbsent: true } });
    expect(h.verifiedSql.mock.calls).toEqual([
      [MOVEMENT_REFERENCE_FILES.down], [MOVEMENT_REFERENCE_FILES.up],
      [MOVEMENT_REFERENCE_FILES.down], [MOVEMENT_REFERENCE_FILES.down],
    ]);
    const sql = queries(h);
    expect(sql[1]).toBe(down);
    expect(sql[3]).toBe(up);
    expect(sql).toHaveLength(11);
    expect(sql[9]).toContain("UPDATE public.session_movements");
    expect(sql[10]).toContain("BEGIN READ ONLY");
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
    ["rejected", "23503", "set-logs", true, false, false],
    ["rejected", "other", "other", true, false, false],
    ["rejected", "23503", "session-movements", false, false, false],
    ["setup-failed", "23503", "session-movements", false, false, false],
    ["unavailable", "other", "other", true, false, false],
  ])("fails the two-FK candidate for an unproved necessity result %j", async (...result) => {
    const steps = sequence(); steps[5] = result;
    const h = harness(steps);
    await expect(h.run()).rejects.toThrow("necessity not proved");
    expect(h.command).toHaveBeenCalledTimes(7);
    expect(h.publish.mock.calls[0][0].probes[0].schemaRestored).toBe(true);
  });
  it.each(["disconnect", "invalid", "oversized", "timeout", "nonzero", "signal"])("freshly verifies restoration even after %s", async (kind) => {
    const h = harness(sequence().slice(0, 5));
    const run = h.run();
    // One-shot implementations preserve the first five catalog/DDL calls.
    const normal = h.command.getMockImplementation()!;
    h.command.mockImplementation(async (...args) => {
      const call = h.command.mock.calls.length;
      if (call <= 5) return normal(...args);
      if (call === 6) {
        if (kind === "disconnect") throw new Error("private URL");
        return { text: kind === "oversized" ? "x".repeat(131_073) : "invalid",
          result: { code: kind === "nonzero" ? 1 : 0, signal: kind === "signal" ? "SIGTERM" : null, timedOut: kind === "timeout" } };
      }
      return { text: JSON.stringify(snapshot()), result: ok };
    });
    await expect(run).rejects.toThrow("necessity not proved");
    expect(h.command).toHaveBeenCalledTimes(7);
    expect(queries(h)[6]).toContain("BEGIN READ ONLY");
  });
  it.each([0, 1, 2, 3, 4, 5])("fails closed on restoration field %i without repair DML", async (slot) => {
    const changed = snapshot(); changed[slot] = (slot === 3 || slot === 4 ? "d".repeat(32) : false) as never;
    const steps = sequence(); steps[6] = changed;
    const h = harness(steps);
    await expect(h.run()).rejects.toThrow("restoration unverified");
    expect(h.command).toHaveBeenCalledTimes(7);
    expect(queries(h).filter((sql) => sql.includes("DELETE FROM"))).toHaveLength(1);
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
    ["rejected", "23503", "session-movements", true, true, false],
    ["rejected", "23503", "session-movements", true, false, true],
    ["rejected", "23503", "session-movements", false, true, true],
    ["rejected", "23503", "set-logs", true, true, true],
    ["rejected", "other", "session-movements", true, true, true],
    ["setup-failed", "23503", "session-movements", true, true, true],
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
    for (const partial of [{ down: false }, { up: false }, { initial: false }, { probes: [] },
      { probes: [record.probes[0], record.probes[0]] },
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
