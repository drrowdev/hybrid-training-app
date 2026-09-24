import { describe, expect, it } from "vitest";
import {
  MODULAR_ADDED_CATALOG_KEYS, MODULAR_CHANGED_CONSTRAINTS, MODULAR_CHANGED_FUNCTIONS, MODULAR_REMOVED_INDEXES,
  MODULAR_CATALOG_SQL, requireModularCatalogBaseline, verifyModularCatalog, type ModularCatalog,
} from "../modular-production-catalog";

const row = (key: string) => ({ key, fingerprint: "a".repeat(64), security: key.startsWith("function:") ? "b".repeat(64) : null,
  definition: null as string | null });
function fixture() {
  const before: ModularCatalog = [
    ...MODULAR_CHANGED_FUNCTIONS, ...MODULAR_REMOVED_INDEXES, ...Object.keys(MODULAR_CHANGED_CONSTRAINTS),
    "global", "relation:auth.users", "column:auth.users.id", "function:auth.uid",
    "relation:public.sessions", "column:public.sessions.id", "policy:public.sessions.owner",
    "constraint:public.sessions.sessions_user_id_fkey", "index:public.sessions_pkey", "trigger:public.sessions.existing",
  ].map(row);
  const after = before.filter((item) => !MODULAR_REMOVED_INDEXES.includes(item.key)).map((item) => ({
    ...item,
    fingerprint: MODULAR_CHANGED_FUNCTIONS.includes(item.key) || Object.hasOwn(MODULAR_CHANGED_CONSTRAINTS, item.key)
      ? "c".repeat(64) : item.fingerprint,
    definition: MODULAR_CHANGED_CONSTRAINTS[item.key] ?? null,
  }));
  after.push(...MODULAR_ADDED_CATALOG_KEYS.map(row), row("column:public.swim_import_outcomes.id"));
  return { before, after };
}

describe("DC-SW8 exact modular catalog preserves existing Auth, roles and ACLs", () => {
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

  it("reads catalog metadata only, with bounded results and no account data or password projection", () => {
    expect(MODULAR_CATALOG_SQL).toContain("LIMIT 10001");
    expect(MODULAR_CATALOG_SQL).toContain("pg_auth_members");
    expect(MODULAR_CATALOG_SQL).toContain("pg_default_acl");
    expect(MODULAR_CATALOG_SQL).not.toMatch(/rolpassword|pg_authid|FROM (public|auth)\.|INSERT INTO|UPDATE |DELETE FROM/);
    expect(MODULAR_CATALOG_SQL).toContain("encode(sha256");
  });
});
