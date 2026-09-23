import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Socket } from "node:net";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertOwnershipCatalog, assertOwnershipRefusal, IndependentProgramsAssertion, rehearseIndependentPrograms,
  independentRunningSeed, withIndependentRunningFixture, type OwnershipCatalog,
} from "../../integration-tests/independent-programs-rehearsal";
import { SEED_MOVEMENTS } from "../../seeds/movements";

vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: vi.fn() }));
const up = readFileSync(new URL("../../drizzle/0158_independent_program_ownership.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const down = readFileSync(new URL("../../rollbacks/0158_independent_program_ownership.down.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("DC-R5 independent ownership storage boundary", () => {
  it("uses the canonical running seed rather than assuming schema migrations populated the catalog", () => {
    const seed = independentRunningSeed();
    expect(seed).toBe(SEED_MOVEMENTS.find((movement) => movement.slug === "run-easy-z2"));
    expect(seed).toMatchObject({ userId: null, pattern: "cardio", metadata: { modality: "running" } });
  });
  function runningFixture(present = false, failVerification = false) {
    const seed = independentRunningSeed();
    const original = { id: "00000000-0000-4000-8000-000000000001", pattern: seed.pattern,
      metadata: { ...seed.metadata, retained: "existing metadata" } };
    let rows = present ? [original] : [];
    const calls: string[] = [];
    const database = vi.fn(async (parts: TemplateStringsArray, ...params: unknown[]) => {
      const sql = parts.join("?");
      if (sql.startsWith("DELETE")) {
        calls.push("delete");
        expect(sql).toContain("WHERE id=?::uuid AND user_id IS NULL");
        expect(params).toEqual([rows[0]?.id]);
        rows = [];
        return [];
      }
      calls.push("select");
      if (sql.includes("WHERE id=") && failVerification) return [];
      return rows;
    });
    const values = vi.fn(async (value: ReturnType<typeof independentRunningSeed> & { id: string }) => {
      calls.push("insert");
      expect(value).toEqual({ ...seed, id: expect.any(String) });
      rows = [{ id: value.id, pattern: value.pattern, metadata: { ...value.metadata, retained: "" } }];
    });
    vi.mocked(drizzle).mockReturnValue({ insert: () => ({ values }) } as unknown as ReturnType<typeof drizzle>);
    return { database: database as unknown as postgres.Sql, values, calls, original, rows: () => rows };
  }
  it("seeds a missing canonical run and removes only that inserted row after dependent fixtures", async () => {
    const fixture = runningFixture();
    await withIndependentRunningFixture(fixture.database, async (id) => {
      expect(fixture.rows()[0]?.id).toBe(id);
      fixture.calls.push("dependent-fixtures-cleaned");
    });
    expect(fixture.calls).toEqual(["select", "insert", "select", "dependent-fixtures-cleaned", "delete"]);
    expect(fixture.rows()).toEqual([]);
  });
  it("reuses and preserves a present canonical run without inserting or deleting", async () => {
    const fixture = runningFixture(true);
    await withIndependentRunningFixture(fixture.database, async (id) => { expect(id).toBe(fixture.original.id); });
    expect(fixture.values).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual(["select"]);
    expect(fixture.rows()).toEqual([fixture.original]);
  });
  it("cleans an inserted row when setup verification fails before dependent fixtures start", async () => {
    const fixture = runningFixture(false, true), work = vi.fn();
    await expect(withIndependentRunningFixture(fixture.database, work)).rejects.toMatchObject({ code: "ERR_ASSERTION" });
    expect(work).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual(["select", "insert", "select", "delete"]);
    expect(fixture.rows()).toEqual([]);
  });
  it("cleans an inserted row after a dependent fixture fails", async () => {
    const fixture = runningFixture(), failure = new Error("fixture failed");
    await expect(withIndependentRunningFixture(fixture.database, async () => { throw failure; })).rejects.toBe(failure);
    expect(fixture.calls).toEqual(["select", "insert", "select", "delete"]);
  });
  const catalog: OwnershipCatalog = {
    value: "whole-catalog", functions: "function-body", indexes: "index-body",
    triggers: "trigger-body", constraints: "constraint-body", policies: "policy-body",
  };
  it("accepts exact catalog restoration and fails closed on an unclassified aggregate mismatch", () => {
    expect(() => assertOwnershipCatalog(catalog, catalog)).not.toThrow();
    expect(() => assertOwnershipCatalog({ ...catalog, value: "changed" }, catalog))
      .toThrow(IndependentProgramsAssertion);
    try { assertOwnershipCatalog({ ...catalog, value: "changed" }, catalog); }
    catch (error) {
      expect(error).toMatchObject({ code: "ERR_ASSERTION", diagnostic: { kind: "catalog", categories: ["aggregate"] } });
    }
  });
  it.each(["functions", "indexes", "triggers", "constraints", "policies"] as const)(
    "identifies a changed %s category without exposing catalog contents", (category) => {
      expect.assertions(3);
      try { assertOwnershipCatalog({ ...catalog, value: "changed", [category]: "private-body" }, catalog); }
      catch (error) {
        expect(error).toMatchObject({ code: "ERR_ASSERTION", diagnostic: { kind: "catalog", categories: [category] } });
        expect(JSON.stringify(error)).not.toMatch(/body|whole-catalog|changed/);
        expect(String(error)).not.toMatch(/body|whole-catalog|changed/);
      }
    },
  );
  it("reports every changed catalog category", () => {
    expect.assertions(1);
    try { assertOwnershipCatalog({ ...catalog, value: "changed", functions: "changed", policies: "changed" }, catalog); }
    catch (error) {
      expect(error).toMatchObject({ diagnostic: { kind: "catalog", categories: ["functions", "policies"] } });
    }
  });
  it("accepts only the expected SQL refusal and distinguishes a resolved operation", async () => {
    await expect(assertOwnershipRefusal(async () => { throw { code: "P0001" }; }, "P0001")).resolves.toBeUndefined();
    await expect(assertOwnershipRefusal(async () => undefined, "P0001")).rejects.toMatchObject({
      code: "ERR_ASSERTION", diagnostic: { kind: "refusal", expected: "P0001", actual: "resolved" },
    });
    await expect(assertOwnershipRefusal(async () => { throw { code: "42804", message: "private SQL" }; }, "P0001"))
      .rejects.toMatchObject({ diagnostic: { kind: "refusal", expected: "P0001", actual: "42804" } });
  });
  it("does not project unknown codes, messages, getters or rejected values", async () => {
    const getter = vi.fn(() => "P0001");
    const failures: unknown[] = [
      { code: "private-value", message: "private-error" }, "private-error",
      Object.defineProperty({}, "code", { get: getter }),
    ];
    for (const failure of failures) {
      const error = await assertOwnershipRefusal(async () => { throw failure; }, "P0001").catch((cause: unknown) => cause);
      expect(error).toMatchObject({ diagnostic: { kind: "refusal", expected: "P0001", actual: null } });
      expect(JSON.stringify(error)).not.toContain("private");
      expect(String(error)).not.toContain("private");
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it("keeps the failing caller in the assertion stack instead of the diagnostic helper", async () => {
    const error = await assertOwnershipRefusal(async () => undefined, "P0001").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(IndependentProgramsAssertion);
    expect((error as IndependentProgramsAssertion).stack).toContain("independent-programs-rehearsal.test.ts:");
    expect((error as IndependentProgramsAssertion).stack).not.toMatch(/independent-programs-rehearsal\.ts:\d+/);
  });
  it("does not use the SQL OVERLAPS operator as an unquoted PL/pgSQL variable", () => {
    expect(up).not.toMatch(/\boverlaps\s+jsonb\b/);
    expect(up).toContain("'overlaps',overlap_pairs");
  });
  it("pins every new routine in the unused-down refusal rather than dropping changed code", () => {
    const functions = [...up.matchAll(/CREATE FUNCTION public\.(\w+)\(([\s\S]*?)\)\s*RETURNS[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];
    expect(functions).toHaveLength(13);
    for (const [, name, args, body] of functions) {
      const types = args!.trim().split(",").filter(Boolean).map((arg) => arg.trim().split(/\s+/)[1]).join(",");
      expect(down).toContain(`('${name}(${types})','${createHash("md5").update(body!).digest("hex")}')`);
      expect(down).toContain(`DROP FUNCTION public.${name}(${types});`);
    }
  });
  it("keeps the additional attachment specific and the existing policy boundary unchanged", () => {
    expect(up.match(/CREATE TABLE public\./g)).toHaveLength(1);
    expect(up).toContain("CREATE TABLE public.swim_plan_rehab_bindings");
    expect(up.match(/CREATE POLICY /g)).toHaveLength(1);
    expect(up).not.toMatch(/ALTER TABLE (?:public\.)?(?:swim_workouts|swim_plans) ADD COLUMN/i);
    expect(up).not.toMatch(/UPDATE (?:public\.)?training_blocks SET program_kind/i);
    expect(down).toContain("context ? 'programOwnershipVersion'");
    expect(down).toContain("prescription->'meta' ? 'swimRehab'");
  });
  it("keeps one parent relationship for unambiguous PostgREST joins", () => {
    for (const table of ["planned_sessions", "program_instances"]) {
      expect(up).toContain(`ALTER TABLE public.${table} DROP CONSTRAINT ${table}_block_id_fkey`);
      expect(up).toContain(`ALTER TABLE public.${table} ADD CONSTRAINT ${table}_block_id_fkey`);
      expect(down).toContain(`ALTER TABLE public.${table} ADD CONSTRAINT ${table}_block_id_fkey`);
    }
  });
  it.each(["local", "job", "host", "database"] as const)("refuses %s before any SQL connection", async (mode) => {
    vi.stubEnv("GITHUB_ACTIONS", mode === "local" ? "false" : "true");
    vi.stubEnv("GITHUB_JOB", mode === "job" ? "storage" : "pool-storage");
    const connect = vi.spyOn(Socket.prototype, "connect").mockImplementation(() => { throw new Error("Unexpected database connection"); });
    const sql = postgres({ host: mode === "host" ? "example.invalid" : "127.0.0.1", port: 5432,
      database: mode === "database" ? "postgres" : "swim_pool_test", username: "postgres" });
    try {
      await expect(rehearseIndependentPrograms(sql, vi.fn())).rejects.toMatchObject({ code: "ERR_ASSERTION" });
      expect(connect).not.toHaveBeenCalled();
    } finally { await sql.end(); }
  });
});
