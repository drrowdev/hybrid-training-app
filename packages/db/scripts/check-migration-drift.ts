/**
 * Migration drift guard.
 *
 * Cross-checks `packages/db/drizzle/meta/_journal.json` against the rows
 * in the live `drizzle.__drizzle_migrations` table by SHA-256 of each
 * .sql file's contents. Fails loudly if any expected migration is
 * missing from the DB.
 *
 * Used by:
 *   - The `db:check` npm script (run locally before commits).
 *   - CI (a new job that boots against the configured DATABASE_URL).
 *
 * Why it exists: the migrator silent-skip bug. The migrator regularly
 * reports "applied successfully" but does not actually apply
 * migrations. This script makes that drift visible immediately rather
 * than at runtime via "permission denied for table X" or "relation
 * does not exist".
 *
 * Hash algorithm: SHA-256 hex digest of the .sql file's contents with
 * CRLF normalized to LF. This matches the algorithm used by
 * `scripts/sync-migrations-tracking.ts` (and the migrator itself
 * computes hashes the same way against the canonical LF form on
 * disk). See note at the top of this module's main() for the rare
 * CRLF-checkout edge case.
 *
 * Read-only: the script never writes to the DB.
 *
 * Modes:
 *   - Full: when DATABASE_URL is set, connects and compares against
 *     the live tracking table. This is the dev / pre-push mode.
 *   - Offline: when DATABASE_URL is unset, validates only that every
 *     `_journal.json` entry has a corresponding `.sql` file on disk
 *     and the hash computes cleanly. CI uses this mode because the
 *     repo currently has no shared dev-DB secret. Most of the value
 *     comes from the local pre-push check anyway.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface JournalEntry {
  idx: number;
  tag: string;
}

export interface JournalFile {
  entries: JournalEntry[];
}

export interface DbMigrationRow {
  hash: string;
  created_at: number | string | null;
}

export interface ExpectedMigration {
  tag: string;
  idx: number;
  hash: string;
  hashLfNormalized: string;
  sqlPath: string;
}

export interface CheckResult {
  ok: boolean;
  exitCode: 0 | 1;
  mode: "full" | "offline";
  expected: ExpectedMigration[];
  missing: ExpectedMigration[];
  unknownDbHashes: string[];
  missingSqlFiles: { tag: string; sqlPath: string }[];
  messages: string[];
}

export interface CheckIO {
  readJournal(): JournalFile;
  /**
   * Returns the raw bytes of the .sql file, or null if it doesn't
   * exist. Buffer is preferred over string so the hash matches the
   * migrator's algorithm even on a CRLF checkout.
   */
  readSqlFile(sqlPath: string): Buffer | string | null;
  resolveSqlPath(tag: string): string;
  loadDbHashes?: () => Promise<DbMigrationRow[]>;
  logger?: (line: string) => void;
}

/**
 * SHA-256 hex of the raw file bytes — this matches the algorithm the
 * migrator uses to populate `drizzle.__drizzle_migrations.hash`.
 *
 * Note on line endings: the migrator hashes the file exactly as it
 * exists on disk, so a CRLF checkout (typical on Windows) yields a
 * different hash than the same file with LF endings (typical on
 * Linux / CI). That's why this guard also computes an LF-normalized
 * variant and treats a match on either as "present" (see
 * `hashSqlContentsLfNormalized`). The two hashes are equal for files
 * that already have LF endings on disk.
 */
export function hashSqlContents(contents: Buffer | string): string {
  const buf = typeof contents === "string" ? Buffer.from(contents, "utf8") : contents;
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * SHA-256 of the file contents with CRLF normalized to LF. Used as a
 * fallback when the raw-bytes hash doesn't match a DB row — handles
 * the case where the file was applied from a different-line-ending
 * checkout than the current one.
 */
export function hashSqlContentsLfNormalized(contents: Buffer | string): string {
  const text =
    typeof contents === "string" ? contents : contents.toString("utf8");
  const normalized = text.replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export async function runDriftCheck(io: CheckIO): Promise<CheckResult> {
  const log = io.logger ?? ((line: string) => console.log(line));
  const messages: string[] = [];
  const journal = io.readJournal();

  // 1. Build the expected set from the journal + .sql files on disk.
  const expected: ExpectedMigration[] = [];
  const missingSqlFiles: { tag: string; sqlPath: string }[] = [];

  for (const entry of journal.entries) {
    const sqlPath = io.resolveSqlPath(entry.tag);
    const contents = io.readSqlFile(sqlPath);
    if (contents === null) {
      missingSqlFiles.push({ tag: entry.tag, sqlPath });
      const line = `✗ ${entry.tag} MISSING .sql file at ${sqlPath}`;
      messages.push(line);
      log(line);
      continue;
    }
    expected.push({
      tag: entry.tag,
      idx: entry.idx,
      hash: hashSqlContents(contents),
      hashLfNormalized: hashSqlContentsLfNormalized(contents),
      sqlPath,
    });
  }

  // Fail fast if the journal references a non-existent .sql file —
  // that's a repo-level corruption that no DB check can resolve.
  if (missingSqlFiles.length > 0) {
    const summary = `\nFAIL: ${missingSqlFiles.length} journal entr${
      missingSqlFiles.length === 1 ? "y" : "ies"
    } reference a .sql file that doesn't exist on disk.`;
    messages.push(summary);
    log(summary);
    return {
      ok: false,
      exitCode: 1,
      mode: io.loadDbHashes ? "full" : "offline",
      expected,
      missing: [],
      unknownDbHashes: [],
      missingSqlFiles,
      messages,
    };
  }

  // 2. Offline mode (no DB): file-shape check only.
  if (!io.loadDbHashes) {
    const okLine = `\n✓ Offline mode: ${expected.length} journal entries resolved to .sql files and hashed cleanly.`;
    messages.push(okLine);
    log(okLine);
    return {
      ok: true,
      exitCode: 0,
      mode: "offline",
      expected,
      missing: [],
      unknownDbHashes: [],
      missingSqlFiles: [],
      messages,
    };
  }

  // 3. Full mode: load the live tracking table and diff.
  const dbRows = await io.loadDbHashes();
  const dbHashSet = new Set(dbRows.map((r) => r.hash));
  // Match on either the raw-bytes hash (matches what the migrator
  // wrote on the machine that ran `db:migrate`) OR the LF-normalized
  // hash (matches if the file was applied from a different-line-ending
  // checkout). Either form counts as "present".
  const expectedHashSet = new Set<string>();
  for (const e of expected) {
    expectedHashSet.add(e.hash);
    expectedHashSet.add(e.hashLfNormalized);
  }

  const missing: ExpectedMigration[] = [];
  for (const e of expected) {
    const presentRaw = dbHashSet.has(e.hash);
    const presentLf = dbHashSet.has(e.hashLfNormalized);
    if (presentRaw || presentLf) {
      const tag = presentRaw && presentLf
        ? `✓ ${e.tag}`
        : presentRaw
          ? `✓ ${e.tag}`
          : `✓ ${e.tag} (matched via LF-normalized hash)`;
      messages.push(tag);
      log(tag);
    } else {
      missing.push(e);
      const line = `✗ ${e.tag} MISSING from drizzle.__drizzle_migrations (hash ${e.hash.slice(0, 12)}…)`;
      messages.push(line);
      log(line);
    }
  }

  const unknownDbHashes: string[] = [];
  for (const row of dbRows) {
    if (!expectedHashSet.has(row.hash)) {
      unknownDbHashes.push(row.hash);
      const line = `! unknown hash ${row.hash.slice(0, 12)}… in drizzle.__drizzle_migrations (not in _journal.json) — warning only`;
      messages.push(line);
      log(line);
    }
  }

  if (missing.length > 0) {
    const summary = `\nFAIL: ${missing.length} expected migration${
      missing.length === 1 ? "" : "s"
    } missing from drizzle.__drizzle_migrations:\n  - ${missing
      .map((m) => m.tag)
      .join("\n  - ")}`;
    messages.push(summary);
    log(summary);
    return {
      ok: false,
      exitCode: 1,
      mode: "full",
      expected,
      missing,
      unknownDbHashes,
      missingSqlFiles: [],
      messages,
    };
  }

  const okSummary = `\n✓ All ${expected.length} journal entries present in drizzle.__drizzle_migrations.${
    unknownDbHashes.length > 0
      ? ` (${unknownDbHashes.length} extra row${unknownDbHashes.length === 1 ? "" : "s"} in DB — warning only.)`
      : ""
  }`;
  messages.push(okSummary);
  log(okSummary);
  return {
    ok: true,
    exitCode: 0,
    mode: "full",
    expected,
    missing: [],
    unknownDbHashes,
    missingSqlFiles: [],
    messages,
  };
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const drizzleDir = join(here, "..", "drizzle");
  const journalPath = join(drizzleDir, "meta", "_journal.json");

  const io: CheckIO = {
    readJournal: () =>
      JSON.parse(readFileSync(journalPath, "utf8")) as JournalFile,
    readSqlFile: (sqlPath) =>
      existsSync(sqlPath) ? readFileSync(sqlPath) : null,
    resolveSqlPath: (tag) => join(drizzleDir, `${tag}.sql`),
  };

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.length > 0) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(dbUrl, { max: 1, prepare: false });
    io.loadDbHashes = async () => {
      try {
        const rows = await sql<DbMigrationRow[]>`
          SELECT hash, created_at
          FROM drizzle.__drizzle_migrations
          ORDER BY created_at ASC
        `;
        return rows.map((r) => ({ hash: r.hash, created_at: r.created_at }));
      } finally {
        await sql.end({ timeout: 5 });
      }
    };
  } else {
    console.warn(
      "ℹ DATABASE_URL not set — running in offline mode (file-shape check only).",
    );
  }

  const result = await runDriftCheck(io);
  process.exit(result.exitCode);
}

// Only run when invoked as a script, not when imported by tests.
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error("Unexpected error in migration drift guard:", err);
    process.exit(1);
  });
}
