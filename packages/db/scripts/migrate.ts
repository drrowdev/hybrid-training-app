import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishMigrationResult, runNormalMigration } from "./migrate-with-evidence";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNormalMigration().then((result) => {
    publishMigrationResult(result);
    process.exit(result.exitCode);
  }, () => {
    console.error("Migration entry aborted");
    process.exit(1);
  });
}
