import journal from "../../../packages/db/drizzle/meta/_journal.json";
import { acceptanceAssert as assert } from "./swim-acceptance-errors";

export const ACCEPTANCE_MIGRATIONS = journal.entries.map(({ tag }) => tag);
export const hasModularSchema = ACCEPTANCE_MIGRATIONS.includes("0156_modular_training_schedule");
export const hasOwnershipSchema = ACCEPTANCE_MIGRATIONS.includes("0158_independent_program_ownership");

export function requireAcceptanceMigrationFiles(sourceFiles: readonly string[]) {
  const expected = ACCEPTANCE_MIGRATIONS.map((tag) => `packages/db/drizzle/${tag}.sql`).sort();
  const actual = sourceFiles.filter((file) => /^packages\/db\/drizzle\/[^/]+\.sql$/.test(file)).sort();
  assert(expected.length > 0 && new Set(expected).size === expected.length, "Invalid migration journal");
  assert.deepEqual(actual, expected, "Migration files must match the journal");
  return expected.length;
}
