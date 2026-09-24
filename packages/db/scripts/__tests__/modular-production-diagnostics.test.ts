import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { ModularUpdateSqlFailure, projectModularUpdateError } from "../modular-production-update-storage";

const migrations = Array.from({ length: 159 }, (_, index) => ({ sql: [`canonical-${index}`] }));
function failure(query: string, code = "22023") {
  const error: Error = Reflect.construct(postgres.PostgresError, [
    { message: "PrivateSyntheticCanary", code, severity: "ERROR", detail: "PrivateSyntheticDetail" },
  ]);
  Object.defineProperty(error, "query", { value: query });
  return error;
}

describe("DC-SW8 modular update SQL diagnostics contain only bounded positions and SQLSTATE", () => {
  it.each([155, 156, 157, 158])("attributes only an exact canonical statement in migration %s", (index) => {
    const diagnostic = projectModularUpdateError(failure(`canonical-${index}`), migrations);
    expect(diagnostic).toEqual({ sqlstate: "22023", position: { status: "matched", migrationIndex: index, statementIndex: 0 } });
    const error = new ModularUpdateSqlFailure(diagnostic!);
    expect(error.code).toBe("22023");
    expect(JSON.stringify(error)).not.toMatch(/PrivateSynthetic|canonical-|query|detail|cause/);
  });

  it.each(["canonical-154", "SELECT private_guard", " canonical-158"])("leaves guard/older/changed SQL unmatched", (query) => {
    expect(projectModularUpdateError(failure(query), migrations))
      .toEqual({ sqlstate: "22023", position: { status: "unmatched" } });
  });

  it("does not invent an attribution for duplicate statements or non-native exceptions", () => {
    const ambiguous = structuredClone(migrations);
    ambiguous[157]!.sql.push("canonical-158");
    expect(projectModularUpdateError(failure("canonical-158"), ambiguous)?.position).toEqual({ status: "unmatched" });
    expect(projectModularUpdateError(new Error("PrivateSyntheticCanary"), migrations)).toBeUndefined();
    expect(projectModularUpdateError({ code: "22023", name: "PostgresError", severity: "ERROR" }, migrations)).toBeUndefined();
    expect(projectModularUpdateError(new Proxy(failure("canonical-158"), {}), migrations)).toBeUndefined();
    const getter = Object.defineProperty(new Error(), "query", { get() { throw new Error("PrivateSyntheticCanary"); } });
    expect(projectModularUpdateError(getter, migrations)).toBeUndefined();
  });

  it("rejects extra fields, out-of-range positions and arbitrary SQLSTATE text", () => {
    for (const diagnostic of [
      { sqlstate: "private", position: { status: "unmatched" } },
      { sqlstate: "22023", position: { status: "matched", migrationIndex: 154, statementIndex: 0 } },
      { sqlstate: "22023", position: { status: "matched", migrationIndex: 159, statementIndex: 0 } },
      { sqlstate: "22023", position: { status: "matched", migrationIndex: 158, statementIndex: 10000 } },
      { sqlstate: "22023", position: { status: "unmatched", query: "private" } },
      { sqlstate: "22023", position: { status: "unmatched" }, detail: "private" },
    ]) {
      expect(() => Reflect.construct(ModularUpdateSqlFailure, [diagnostic])).toThrow();
    }
  });
});
