/**
 * Normalise CRLF → LF on every drizzle migration SQL file before
 * running `drizzle-kit migrate`.
 *
 * Background:
 *   - On Windows, files written by tools like PowerShell / the IDE / agent
 *     workflows often land on disk with CRLF endings even when the repo's
 *     .gitattributes enforces LF.
 *   - `drizzle-kit migrate` hashes the SQL file BYTE-FOR-BYTE and stamps
 *     the hash into drizzle.__drizzle_migrations.
 *   - The CI prod-drift guard re-hashes the file from the LF-normalised
 *     repo checkout and compares.
 *   - Result: a Windows-applied migration looks "missing" from prod even
 *     when it was applied, because the stored hash is the CRLF variant.
 *
 * This script unconditionally rewrites every drizzle/*.sql file with LF
 * endings before drizzle reads them, so the stored hash always matches
 * what CI will compute. Safe to re-run — it's a no-op on already-LF files.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = "drizzle";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

let fixed = 0;
for (const name of files) {
  const path = join(dir, name);
  const raw = readFileSync(path);
  if (raw.includes(0x0d)) {
    const normalised = raw.toString("utf8").replace(/\r\n/g, "\n");
    writeFileSync(path, normalised);
    fixed += 1;
    console.log(`  ↳ normalised ${name}`);
  }
}
if (fixed === 0) {
  console.log(`✓ all ${files.length} migration files already LF`);
} else {
  console.log(`✓ normalised ${fixed} of ${files.length} migration files to LF`);
}
