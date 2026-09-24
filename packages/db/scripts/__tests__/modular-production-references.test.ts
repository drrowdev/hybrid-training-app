import postgres from "postgres";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as references from "../modular-production-references";
import { appendModularProduction } from "../modular-production-update-storage";
import { MODULAR_CATALOG_MANIFEST } from "../modular-production-catalog-manifest";
import { MODULAR_CHANGED_CONSTRAINTS } from "../modular-production-catalog";

const zero = references.compositeFkViolationsSchema.parse(Object.fromEntries(references.MODULAR_REFERENCE_QUERIES.map(({ key }) => [key, 0])));
afterEach(() => { vi.restoreAllMocks(); });

describe("DC-SW8 count-only ownership compatibility gates", () => {
  it("covers exactly all six added/replaced composite FKs with closed integer counts", () => {
    const constraints = [...MODULAR_CATALOG_MANIFEST.keys, ...Object.keys(MODULAR_CHANGED_CONSTRAINTS)]
      .filter((key) => key.startsWith("constraint:") && /_(fk|fkey)$/.test(key))
      .filter((key) => !key.endsWith("_user_id_fkey")).map((key) => key.split(".").at(-1)).sort();
    expect(Object.keys(zero).sort()).toEqual(constraints);
    expect(Object.keys(zero)).toHaveLength(6);
    expect(() => references.requireCompatibleModularReferences(zero)).not.toThrow();
    const key = "program_instances_block_id_fkey";
    for (const bad of [-1, 0.1, 2147483648, "0", true, false, null, undefined]) {
      expect(references.compositeFkViolationsSchema.safeParse({ ...zero, [key]: bad }).success).toBe(false);
    }
    expect(references.compositeFkViolationsSchema.safeParse({ ...zero, private: 0 }).success).toBe(false);
    expect(references.MODULAR_REFERENCE_VISIBILITY_SQL).toContain("row_security_active");
    for (const query of references.MODULAR_REFERENCE_QUERIES) {
      expect(query.sql).toContain("SELECT count(*)::int AS violations");
      expect(query.sql).toContain("c.user_id IS NOT NULL");
      expect(query.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|GRANT|RETURNING)\b/i);
    }
  });

  it.each(references.MODULAR_REFERENCE_QUERIES.map(({ key }) => key))(
    "refuses %s before opening the updater transaction or connecting", async (key) => {
      const inspect = vi.spyOn(references, "inspectModularReferences").mockResolvedValue({ ...zero, [key]: 1 });
      const sql = postgres();
      const begin = vi.spyOn(sql, "begin").mockImplementation(() => { throw new Error("Unexpected transaction"); });
      const connect = vi.spyOn(Socket.prototype, "connect").mockImplementation(() => { throw new Error("Unexpected connection"); });
      const progress = { attemptedMigrations: 0, stagedMigrations: 0, commitAttempted: false, commitConfirmed: false };
      try {
        await expect(appendModularProduction(sql, [], async () => {}, progress)).rejects.toMatchObject({ code: "owned_reference_conflict" });
        expect(inspect).toHaveBeenCalledTimes(1);
        expect(inspect).toHaveBeenCalledWith(sql);
        expect(begin).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
        expect(progress).toEqual({ attemptedMigrations: 0, stagedMigrations: 0, commitAttempted: false, commitConfirmed: false });
      } finally { await sql.end(); }
    },
  );
});
