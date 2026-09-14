import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { readMigrationFiles } from "drizzle-orm/migrator";

const release = "8d4311987ccc2ab8858a87bc3153db2396bc69ed";

/** Test fixture only: prove the original release prefix has not changed. */
export function historicalSwimMigrations() {
  const source = readFileSync(new URL("./historical-swim-migrations.json", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(source).digest("hex"),
    "ea2cfb7f1be40478d9df38db97500d6abec7742a431a2d0de58f0a5d8e519ca2");
  type Entry = { idx: number; version: string; tag: string; when: number; breakpoints: boolean; hash: string };
  const fixture: { sourceSha: string; entries: Entry[] } = JSON.parse(source);
  assert.equal(fixture.sourceSha, release);
  assert.equal(fixture.entries.length, 155);
  const current: { entries: Omit<Entry, "hash">[] } = JSON.parse(
    readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  const migrations: ReturnType<typeof readMigrationFiles> = fixture.entries.map(({ hash, ...entry }, index) => {
    assert.deepEqual(current.entries[index], entry);
    const sql = readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
    assert.equal(createHash("sha256").update(sql).digest("hex"), hash, `Historical migration changed: ${entry.tag}`);
    return {
      sql: sql.split("--> statement-breakpoint"), bps: entry.breakpoints,
      folderMillis: entry.when, hash,
    };
  });
  return migrations;
}
