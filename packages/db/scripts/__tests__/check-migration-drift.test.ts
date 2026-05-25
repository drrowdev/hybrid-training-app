/**
 * Unit tests for the migration drift guard.
 *
 * Mocks the journal, SQL files, and DB rows so we can exercise every
 * branch (all-match, missing-in-db, unknown-in-db, missing-sql-file,
 * offline mode) without a real database.
 */
import { describe, expect, it, vi } from "vitest";
import {
  hashSqlContents,
  hashSqlContentsLfNormalized,
  runDriftCheck,
  type CheckIO,
  type JournalFile,
} from "../check-migration-drift";

function makeIo(opts: {
  journal: JournalFile;
  sqlFiles: Record<string, string | null>;
  dbHashes?: string[];
}): CheckIO {
  const { journal, sqlFiles, dbHashes } = opts;
  const io: CheckIO = {
    readJournal: () => journal,
    resolveSqlPath: (tag) => `/fake/drizzle/${tag}.sql`,
    readSqlFile: (sqlPath) => {
      const tag = sqlPath.replace("/fake/drizzle/", "").replace(/\.sql$/, "");
      const contents = sqlFiles[tag];
      return contents === undefined ? null : contents;
    },
    logger: () => {},
  };
  if (dbHashes !== undefined) {
    io.loadDbHashes = async () =>
      dbHashes.map((hash) => ({ hash, created_at: 0 }));
  }
  return io;
}

describe("hashSqlContents", () => {
  it("hashes the raw bytes as written on disk (CRLF and LF differ)", () => {
    const lf = "CREATE TABLE foo (id int);\nALTER TABLE foo ADD bar text;\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(hashSqlContents(lf)).not.toBe(hashSqlContents(crlf));
  });

  it("hashSqlContentsLfNormalized normalizes CRLF to LF before hashing", () => {
    const lf = "CREATE TABLE foo (id int);\nALTER TABLE foo ADD bar text;\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(hashSqlContentsLfNormalized(lf)).toBe(
      hashSqlContentsLfNormalized(crlf),
    );
  });

  it("produces a stable 64-char hex digest", () => {
    const h = hashSqlContents("SELECT 1;\n");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("runDriftCheck — full mode", () => {
  it("exits 0 when every journal hash is present in the DB (raw bytes)", async () => {
    const sqlA = "-- 0001\nCREATE TABLE a (id int);\n";
    const sqlB = "-- 0002\nCREATE TABLE b (id int);\n";
    const io = makeIo({
      journal: {
        entries: [
          { idx: 0, tag: "0001_alpha" },
          { idx: 1, tag: "0002_beta" },
        ],
      },
      sqlFiles: { "0001_alpha": sqlA, "0002_beta": sqlB },
      dbHashes: [hashSqlContents(sqlA), hashSqlContents(sqlB)],
    });
    const result = await runDriftCheck(io);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.mode).toBe("full");
    expect(result.missing).toHaveLength(0);
    expect(result.unknownDbHashes).toHaveLength(0);
  });

  it("accepts the LF-normalized hash when the on-disk file is CRLF but the DB stored LF", async () => {
    const lf = "-- 0001\nCREATE TABLE a (id int);\n";
    const crlfOnDisk = lf.replace(/\n/g, "\r\n");
    const io = makeIo({
      journal: { entries: [{ idx: 0, tag: "0001_alpha" }] },
      sqlFiles: { "0001_alpha": crlfOnDisk },
      // DB row stored with the LF hash (e.g. applied from Linux CI).
      dbHashes: [hashSqlContentsLfNormalized(crlfOnDisk)],
    });
    const result = await runDriftCheck(io);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.messages.some((m) => m.includes("LF-normalized"))).toBe(true);
  });

  it("exits 1 and lists the missing tag when a hash is absent from the DB", async () => {
    const sqlA = "-- 0001\n";
    const sqlB = "-- 0002\n";
    const io = makeIo({
      journal: {
        entries: [
          { idx: 0, tag: "0001_alpha" },
          { idx: 1, tag: "0002_beta" },
        ],
      },
      sqlFiles: { "0001_alpha": sqlA, "0002_beta": sqlB },
      dbHashes: [hashSqlContents(sqlA)],
    });
    const result = await runDriftCheck(io);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.missing.map((m) => m.tag)).toEqual(["0002_beta"]);
    expect(result.messages.some((m) => m.includes("0002_beta MISSING"))).toBe(
      true,
    );
  });

  it("warns but still exits 0 when the DB has an unknown hash not in the journal", async () => {
    const sqlA = "-- 0001\n";
    const io = makeIo({
      journal: { entries: [{ idx: 0, tag: "0001_alpha" }] },
      sqlFiles: { "0001_alpha": sqlA },
      dbHashes: [
        hashSqlContents(sqlA),
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      ],
    });
    const result = await runDriftCheck(io);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.unknownDbHashes).toHaveLength(1);
    expect(result.messages.some((m) => m.includes("unknown hash"))).toBe(true);
  });

  it("exits 1 with a clear message when a journal entry has no matching .sql file", async () => {
    const io = makeIo({
      journal: {
        entries: [
          { idx: 0, tag: "0001_alpha" },
          { idx: 1, tag: "0002_orphan" },
        ],
      },
      sqlFiles: { "0001_alpha": "-- 0001\n" },
      dbHashes: [],
    });
    const result = await runDriftCheck(io);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.missingSqlFiles.map((f) => f.tag)).toEqual(["0002_orphan"]);
    expect(
      result.messages.some(
        (m) =>
          m.includes("0002_orphan") && m.includes("MISSING .sql file"),
      ),
    ).toBe(true);
  });
});

describe("runDriftCheck — offline mode", () => {
  it("verifies file shape and exits 0 when DATABASE_URL is unavailable", async () => {
    const io = makeIo({
      journal: {
        entries: [
          { idx: 0, tag: "0001_alpha" },
          { idx: 1, tag: "0002_beta" },
        ],
      },
      sqlFiles: { "0001_alpha": "-- 0001\n", "0002_beta": "-- 0002\n" },
      // No dbHashes → io.loadDbHashes stays undefined → offline mode.
    });
    const result = await runDriftCheck(io);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.mode).toBe("offline");
    expect(result.expected).toHaveLength(2);
  });

  it("still fails offline when a journal entry has no .sql file", async () => {
    const io = makeIo({
      journal: { entries: [{ idx: 0, tag: "0001_ghost" }] },
      sqlFiles: {},
    });
    const result = await runDriftCheck(io);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.missingSqlFiles).toHaveLength(1);
  });

  it("does not attempt to load DB hashes when loadDbHashes is undefined", async () => {
    const loadSpy = vi.fn();
    const io: CheckIO = {
      readJournal: () => ({ entries: [{ idx: 0, tag: "0001_alpha" }] }),
      resolveSqlPath: (tag) => `/fake/${tag}.sql`,
      readSqlFile: () => "-- 0001\n",
      logger: () => {},
    };
    const result = await runDriftCheck(io);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(result.mode).toBe("offline");
  });
});
