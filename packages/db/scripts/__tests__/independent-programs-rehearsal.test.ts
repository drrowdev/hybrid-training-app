import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Socket } from "node:net";
import postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rehearseIndependentPrograms } from "../../integration-tests/independent-programs-rehearsal";

const up = readFileSync(new URL("../../drizzle/0158_independent_program_ownership.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const down = readFileSync(new URL("../../rollbacks/0158_independent_program_ownership.down.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("DC-R5 independent ownership storage boundary", () => {
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
