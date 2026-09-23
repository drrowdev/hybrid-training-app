import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createModularRoundTripProof, modularSchemaRoundTrip, MODULAR_CATALOG_SQL, MODULAR_SCHEMA_FILES,
  OWNERSHIP_CATALOG_SQL, OWNERSHIP_SCHEMA_FILES,
} from "../../../../scripts/modular-schema-roundtrip";
import type { ProcessResult } from "../../../../scripts/swim-acceptance-guards";

const passed: ProcessResult = { code: 0, signal: null, timedOut: false };
const catalogue = { functions: 200, triggers: 30, sha256: "a".repeat(64) };
function setup(ownership = false) {
  const sql = ownership ? OWNERSHIP_CATALOG_SQL : MODULAR_CATALOG_SQL;
  const files = ownership ? OWNERSHIP_SCHEMA_FILES : MODULAR_SCHEMA_FILES;
  const command = vi.fn(async (_executable: string, args: string[], options: unknown) => {
    expect(options).toMatchObject({ capture: true, allowFailure: true });
    return { text: args.at(-1) === sql ? JSON.stringify(catalogue) : "", result: passed };
  });
  const proof = createModularRoundTripProof();
  const verifiedSql = vi.fn((file: string) => file === files.down ? "SYNTHETIC_DOWN" : "SYNTHETIC_UP");
  return { command, dbId: "d".repeat(64), proof, verifiedSql, ownership };
}

describe("DC-SW8 modular native schema round trip retains role and routine definitions", () => {
  it("keeps a separate ownership proof covering all constraints, indexes, policies, RLS and ACLs", async () => {
    for (const entry of ["pg_get_functiondef", "aclexplode", "pg_get_triggerdef", "pg_get_constraintdef",
      "k.convalidated", "k.condeferrable", "pg_get_indexdef", "i.indisvalid", "pg_policy",
      "p.polpermissive", "p.polwithcheck", "c.relrowsecurity", "c.relforcerowsecurity", "c.relacl"]) {
      expect(OWNERSHIP_CATALOG_SQL).toContain(entry);
    }
    expect(OWNERSHIP_CATALOG_SQL).not.toContain("k.contype='c'");
    const options = setup(true);
    await modularSchemaRoundTrip({ ...options, phase: "down" });
    await modularSchemaRoundTrip({ ...options, phase: "up" });
    expect(options.proof.restored).toBe(true);
    expect(options.verifiedSql.mock.calls).toEqual([[OWNERSHIP_SCHEMA_FILES.down], [OWNERSHIP_SCHEMA_FILES.up]]);
    expect(options.command.mock.calls.map(([, args]) => args.at(-1)))
      .toEqual([OWNERSHIP_CATALOG_SQL, "SYNTHETIC_DOWN", "SYNTHETIC_UP", OWNERSHIP_CATALOG_SQL]);
  });

  it.each(["down", "up", "catalogue"] as const)("refuses failed ownership %s without a restored proof or retry", async (failure) => {
    const options = setup(true);
    if (failure !== "down") await modularSchemaRoundTrip({ ...options, phase: "down" });
    const original = options.command.getMockImplementation()!;
    options.command.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[1].at(-1) === OWNERSHIP_CATALOG_SQL) {
        return failure === "catalogue" ? { ...result, text: JSON.stringify({ ...catalogue, sha256: "b".repeat(64) }) } : result;
      }
      return failure === "catalogue" ? result : { ...result, result: { ...passed, code: 1 } };
    });
    const phase = failure === "down" ? "down" : "up";
    await expect(modularSchemaRoundTrip({ ...options, phase })).rejects.toThrow();
    expect(options.proof.restored).toBe(false);
    const calls = options.command.mock.calls.length;
    await expect(modularSchemaRoundTrip({ ...options, phase })).rejects.toThrow();
    expect(options.command).toHaveBeenCalledTimes(calls);
  });

  it("DC-K4: final recovery/session lock inventory matches both migration guard lists", () => {
    const dbRoot = resolve(__dirname, "..", "..", "..", "..", "..", "..", "packages", "db");
    const rehearsal = readFileSync(resolve(dbRoot, "integration-tests", "modular-schedule-rehearsal.ts"), "utf8");
    const inventory = rehearsal.match(/const MODULAR_SESSION_LOCK_ROUTINES = \[([\s\S]*?)\] as const;/)?.[1];
    if (!inventory) throw new Error("Missing final lock inventory");
    const expected = [...inventory.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
    for (const [directory, file] of [
      ["drizzle", "0156_modular_training_schedule.sql"],
      ["rollbacks", "0156_modular_training_schedule.down.sql"],
    ] as const) {
      const source = readFileSync(resolve(dbRoot, directory, file), "utf8");
      const names = [...source.matchAll(/\('public\.([a-z_]+)\([^']*\)', '[a-f0-9]{32}', '(?:auth\.uid\(\)|public\.swim_request_user_id\(\))'\)/g)]
        .map((match) => match[1]!).filter((name) => !name.startsWith("swim_")).sort();
      expect(names).toEqual(expected);
    }
    expect(expected).toContain("remove_deload_week");
    expect(rehearsal).toContain("assert.equal(sessionPatched!.n, MODULAR_SESSION_LOCK_ROUTINES.length)");
    expect(rehearsal).toContain("assert.deepEqual(sessionPatched!.names, MODULAR_SESSION_LOCK_ROUTINES)");
  });

  it("DC-K4: fingerprints table CHECK definitions and validation as well as routines", () => {
    expect(MODULAR_CATALOG_SQL).toContain("pg_get_constraintdef(k.oid, false), k.convalidated, k.connoinherit");
    expect(MODULAR_CATALOG_SQL).toContain("WHERE n.nspname='public' AND k.contype='c'");
    expect(MODULAR_CATALOG_SQL).toContain("jsonb_agg(jsonb_build_array(kind,key,value) ORDER BY kind,key)");
  });

  it("brackets historical identity proofs with one unused down and exact catalogue restoration", async () => {
    const options = setup();
    await modularSchemaRoundTrip({ ...options, phase: "down" });
    expect(options.proof).toMatchObject({ down: "completed", up: "not-attempted", restored: false, before: catalogue });
    await modularSchemaRoundTrip({ ...options, phase: "up" });
    expect(options.proof).toMatchObject({ down: "completed", up: "completed", restored: true, after: catalogue });
    expect(options.command.mock.calls.map(([, args]) => args.at(-1)))
      .toEqual([MODULAR_CATALOG_SQL, "SYNTHETIC_DOWN", "SYNTHETIC_UP", MODULAR_CATALOG_SQL]);
    expect(options.verifiedSql.mock.calls).toEqual([[MODULAR_SCHEMA_FILES.down], [MODULAR_SCHEMA_FILES.up]]);
  });

  it.each(["down", "up"] as const)("does not retry failed %s or claim restoration", async (phase) => {
    const options = setup();
    if (phase === "up") await modularSchemaRoundTrip({ ...options, phase: "down" });
    const original = options.command.getMockImplementation()!;
    options.command.mockImplementation(async (...args) => {
      const result = await original(...args);
      return args[1].at(-1) === MODULAR_CATALOG_SQL ? result : { ...result, result: { ...passed, code: 1 } };
    });
    await expect(modularSchemaRoundTrip({ ...options, phase })).rejects.toThrow();
    expect(options.proof[phase]).toBe("aborted"); expect(options.proof.restored).toBe(false);
    const calls = options.command.mock.calls.length;
    await expect(modularSchemaRoundTrip({ ...options, phase })).rejects.toThrow();
    expect(options.command).toHaveBeenCalledTimes(calls);
  });

  it("rejects successful processes that restore different owners, grants, bodies, triggers or CHECKs", async () => {
    const options = setup();
    await modularSchemaRoundTrip({ ...options, phase: "down" });
    options.command.mockImplementation(async (_executable, args) => ({
      text: args.at(-1) === MODULAR_CATALOG_SQL ? JSON.stringify({ ...catalogue, sha256: "b".repeat(64) }) : "",
      result: passed,
    }));
    await expect(modularSchemaRoundTrip({ ...options, phase: "up" })).rejects.toThrow();
    expect(options.proof.up).toBe("completed"); expect(options.proof.restored).toBe(false);
  });

  it("refuses missing down, a foreign container, altered source and malformed catalogue before DDL", async () => {
    for (const mode of ["up-first", "foreign", "source", "catalogue"]) {
      const options = setup();
      if (mode === "source") options.verifiedSql.mockImplementation(() => { throw new Error("Source mismatch"); });
      if (mode === "catalogue") options.command.mockResolvedValue({ text: "{}", result: passed });
      await expect(modularSchemaRoundTrip({
        ...options, phase: mode === "up-first" ? "up" : "down", dbId: mode === "foreign" ? "unknown" : options.dbId,
      })).rejects.toThrow();
      expect(options.proof.down).toBe("not-attempted"); expect(options.proof.up).toBe("not-attempted");
      expect(options.command.mock.calls.every(([, args]) => args.at(-1) === MODULAR_CATALOG_SQL)).toBe(true);
    }
  });
});
