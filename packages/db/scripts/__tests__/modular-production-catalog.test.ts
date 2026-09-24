import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  MODULAR_ADDED_CATALOG_KEYS, MODULAR_CHANGED_CONSTRAINTS, MODULAR_CHANGED_FUNCTIONS, MODULAR_REMOVED_INDEXES,
  MODULAR_CATALOG_SQL, MODULAR_ADDED_SECURITY_SQL, ModularCatalogRefusal,
  requireModularCatalogBaseline, verifyModularCatalog, type ModularCatalog, type ModularCatalogDiagnostic,
} from "../modular-production-catalog";
import { MODULAR_CATALOG_MANIFEST } from "../modular-production-catalog-manifest";
import { MODULAR_RELEASE_MIGRATIONS } from "../modular-production-preflight-guards";

const row = (key: string) => ({ key, fingerprint: "a".repeat(64), security: key.startsWith("function:") ? "b".repeat(64) : null,
  definition: null as string | null });
function fixture() {
  const before: ModularCatalog = [
    ...MODULAR_CHANGED_FUNCTIONS, ...MODULAR_REMOVED_INDEXES, ...Object.keys(MODULAR_CHANGED_CONSTRAINTS),
    "global", "relation:auth.users", "column:auth.users.id", "function:auth.uid",
    "relation:public.sessions", "column:public.sessions.id", "policy:public.sessions.owner",
    "constraint:public.sessions.sessions_user_id_fkey", "index:public.sessions_pkey", "trigger:public.sessions.existing",
  ].map(row);
  const after: ModularCatalog = before.filter((item) => !MODULAR_REMOVED_INDEXES.includes(item.key)).map((item) => ({
    ...item,
    fingerprint: MODULAR_CHANGED_FUNCTIONS.includes(item.key) || Object.hasOwn(MODULAR_CHANGED_CONSTRAINTS, item.key)
      ? "c".repeat(64) : item.fingerprint,
    definition: MODULAR_CHANGED_CONSTRAINTS[item.key] ?? null,
  }));
  after.push(...MODULAR_ADDED_CATALOG_KEYS.map(row));
  return { before, after };
}

describe("DC-SW8 exact modular catalog preserves existing Auth, roles and ACLs", () => {
  it("binds the source-derived manifest to all three immutable DDL hashes", () => {
    expect(MODULAR_CATALOG_MANIFEST.migrations).toEqual(MODULAR_RELEASE_MIGRATIONS);
    for (const migration of MODULAR_CATALOG_MANIFEST.migrations) {
      expect(createHash("sha256").update(readFileSync(new URL(`../../drizzle/${migration.tag}.sql`, import.meta.url))).digest("hex"))
        .toBe(migration.hash);
    }
    expect(MODULAR_ADDED_CATALOG_KEYS).toHaveLength(119);
    expect(MODULAR_ADDED_CATALOG_KEYS.filter((key) => key.startsWith("column:"))).toHaveLength(42);
    expect(MODULAR_ADDED_CATALOG_KEYS.filter((key) => key.startsWith("constraint:"))).toHaveLength(19);
    expect(MODULAR_ADDED_CATALOG_KEYS).toContain("constraint:public.swim_import_outcomes.swim_import_outcomes_check");
    expect(MODULAR_ADDED_CATALOG_KEYS).not.toContain("constraint:public.swim_import_outcomes.swim_import_outcomes_metadata_check");
    for (const table of ["training_blocks", "program_instances"]) {
      expect(MODULAR_ADDED_CATALOG_KEYS).toContain(`constraint:public.${table}.${table}_parent_consistency`);
      expect(MODULAR_ADDED_CATALOG_KEYS).toContain(`trigger:public.${table}.${table}_parent_consistency`);
    }
  });

  it("derives both intended definers and their distinct owners/configuration from DDL", () => {
    expect(MODULAR_CATALOG_MANIFEST.functions).toHaveLength(19);
    expect(MODULAR_CATALOG_MANIFEST.functions.filter((item) => item.definer)).toEqual([
      { name: "check_program_parent_consistency", owner: "current_user", definer: true, config: ["search_path=pg_catalog, public"] },
      { name: "swim_confirm_import_outcome", owner: "swim_writer", definer: true,
        config: ["search_path=pg_catalog, public", "row_security=on"] },
    ]);
    expect(MODULAR_ADDED_SECURITY_SQL).toContain("p.prosecdef=expected.definer AND p.proconfig=expected.config");
    expect(MODULAR_ADDED_SECURITY_SQL).toContain("p.proname='check_program_parent_consistency' THEN NOT has_function_privilege");
    expect(MODULAR_CATALOG_SQL).toContain("jsonb_build_object('proargdefaults',pg_get_expr(p.proargdefaults,0))");
  });

  it("accepts only declared additions and the reviewed existing-definition changes", () => {
    const { before, after } = fixture();
    expect(() => verifyModularCatalog(before, after)).not.toThrow();
    expect(MODULAR_CHANGED_FUNCTIONS).toHaveLength(15);
    expect(MODULAR_REMOVED_INDEXES).toHaveLength(2);
    expect(Object.keys(MODULAR_CHANGED_CONSTRAINTS)).toHaveLength(3);
    expect(new Set(MODULAR_ADDED_CATALOG_KEYS).size).toBe(MODULAR_ADDED_CATALOG_KEYS.length);
  });

  it.each(["global", "relation:auth.users", "column:auth.users.id", "function:auth.uid",
    "relation:public.sessions", "column:public.sessions.id", "policy:public.sessions.owner",
    "constraint:public.sessions.sessions_user_id_fkey", "index:public.sessions_pkey", "trigger:public.sessions.existing"])(
    "refuses fingerprint drift in existing %s", (key) => {
      const { before, after } = fixture();
      after.find((item) => item.key === key)!.fingerprint = "f".repeat(64);
      expect(() => verifyModularCatalog(before, after)).toThrow("catalog_existing_changed");
    },
  );

  it.each(MODULAR_CHANGED_FUNCTIONS)("refuses permission/identity changes alongside the approved body edit: %s", (key) => {
    const { before, after } = fixture();
    after.find((item) => item.key === key)!.security = "f".repeat(64);
    expect(() => verifyModularCatalog(before, after)).toThrow("catalog_function_security_changed");
  });

  it.each(Object.keys(MODULAR_CHANGED_CONSTRAINTS))("requires the exact validated replacement for %s", (key) => {
    for (const definition of [null, "FOREIGN KEY (user_id) REFERENCES auth.users(id)"]) {
      const { before, after } = fixture();
      after.find((item) => item.key === key)!.definition = definition;
      expect(() => verifyModularCatalog(before, after)).toThrow("catalog_constraint_changed");
    }
  });

  it("refuses preexisting new objects, missing/extra additions, removed originals and overload ambiguity", () => {
    const { before, after } = fixture();
    expect(() => requireModularCatalogBaseline([...before, row(MODULAR_ADDED_CATALOG_KEYS[0]!)]))
      .toThrow("catalog_baseline");
    expect(() => verifyModularCatalog(before, after.slice(0, -2))).toThrow("catalog_additions_changed");
    expect(() => verifyModularCatalog(before, [...after, row("relation:public.unapproved")])).toThrow("catalog_additions_changed");
    expect(() => verifyModularCatalog(before, after.filter((item) => item.key !== "relation:auth.users")))
      .toThrow("catalog_existing_changed");
    expect(() => requireModularCatalogBaseline([...before, row(MODULAR_CHANGED_FUNCTIONS[0]!)]))
      .toThrow("catalog_baseline");
    expect(() => verifyModularCatalog(before, [...after, row(MODULAR_ADDED_CATALOG_KEYS[0]!)]))
      .toThrow("catalog_additions_changed");
  });

  it("requires every new column exactly once instead of accepting arbitrary columns on added tables", () => {
    const { before, after } = fixture();
    for (const columns of [
      after.filter((item) => item.key !== "column:public.swim_import_outcomes.match_id"),
      [...after, row("column:public.swim_import_outcomes.unapproved")],
      [...after, row("column:public.swim_import_outcomes.match_id")],
    ]) {
      expect(() => verifyModularCatalog(before, columns)).toThrow("catalog_additions_changed");
    }
  });

  it("reports deduplicated missing/unexpected categories without object names or metadata", () => {
    const { before, after } = fixture();
    const drift = after.filter((item) => !item.key.startsWith("constraint:public.swim_import_outcomes."));
    drift.push(row("constraint:public.private_table.private_constraint"), row("constraint:public.private_table.another"),
      row("column:public.swim_import_outcomes.private_column"), row(MODULAR_ADDED_CATALOG_KEYS[0]!));
    try {
      verifyModularCatalog(before, drift);
      expect.fail("Expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ModularCatalogRefusal);
      expect(error).toMatchObject({ code: "catalog_additions_changed", diagnostic: [
        { category: "columns", direction: "unexpected" },
        { category: "constraints", direction: "missing" },
        { category: "constraints", direction: "unexpected" },
      ] });
      expect(JSON.stringify(error)).not.toMatch(/private|public\.|fingerprint|definition|"a{64}"/);
    }
  });

  it.each([
    ["global", "global", "changed"],
    ["function:auth.uid", "functions", "changed"],
    ["relation:auth.users", "relations", "missing"],
    ["policy:public.sessions.owner", "policies", "unexpected"],
  ] as const)("reports retained-catalog drift safely for %s", (key, category, direction) => {
    const { before, after } = fixture();
    const drift = after.filter((item) => direction !== "missing" || item.key !== key);
    if (direction === "unexpected") drift.push(row(key));
    if (direction === "changed") drift.find((item) => item.key === key)!.fingerprint = "d".repeat(64);
    expect(() => verifyModularCatalog(before, drift)).toThrow(ModularCatalogRefusal);
    try { verifyModularCatalog(before, drift); } catch (error) {
      expect(error).toMatchObject({ diagnostic: [{ category, direction }] });
    }
  });

  it("bounds diagnostics to the closed codebook and rejects names, extra fields and invalid directions", () => {
    const categories = ["catalog", "global", "relations", "columns", "functions", "constraints", "indexes", "policies", "triggers"] as const;
    const all: ModularCatalogDiagnostic = categories.flatMap((category) =>
      (["missing", "unexpected", "changed"] as const).map((direction) => ({ category, direction })));
    expect(new ModularCatalogRefusal("catalog_additions_changed", [...all, ...all]).diagnostic).toHaveLength(27);
    for (const raw of [
      [], [{ category: "private_table", direction: "missing" }],
      [{ category: "functions", direction: "private_value" }],
      [{ category: "functions", direction: "missing", name: "private" }],
    ]) {
      expect(() => Reflect.construct(ModularCatalogRefusal, ["catalog_additions_changed", raw])).toThrow();
    }
  });

  it("reads catalog metadata only, with bounded results and no account data or password projection", () => {
    expect(MODULAR_CATALOG_SQL).toContain("LIMIT 10001");
    expect(MODULAR_CATALOG_SQL).toContain("pg_auth_members");
    expect(MODULAR_CATALOG_SQL).toContain("pg_default_acl");
    expect(MODULAR_CATALOG_SQL).not.toMatch(/rolpassword|pg_authid|FROM (public|auth)\.|INSERT INTO|UPDATE |DELETE FROM/);
    expect(MODULAR_CATALOG_SQL).toContain("encode(sha256");
  });
});
