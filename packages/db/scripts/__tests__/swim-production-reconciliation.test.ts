import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  historicalMigrationHashes, productionHistoryInventory, productionSchemaInventory, SWIM_SCHEMA_TABLES,
  SWIM_SCHEMA_FUNCTIONS, SCHEMA_TABLE_SQL, SCHEMA_FUNCTION_SQL, SCHEMA_SHARED_SQL,
} from "../swim-production-reconciliation";
import { PRODUCTION, PRODUCTION_RECONCILIATION, productionDispatch, productionContext } from "../swim-production-readonly-guards";
import { REVIEW } from "../swim-review-config-plan";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const source = Array.from({ length: 155 }, (_, index) => ({
  tag: `${String(index).padStart(4, "0")}_synthetic`,
  sql: `-- synthetic migration ${index}\nSELECT ${index};\n`,
  folderMillis: 1000 + index,
})).map((entry) => ({ ...entry, hash: digest(entry.sql) }));
const objects = source.slice(0, 146).map((entry, index) => ({
  ...entry, oid: index.toString(16).padStart(40, "0"),
}));
const listing = Buffer.from(objects.map((entry) => `${entry.oid} packages/db/drizzle/${entry.tag}.sql`).join("\n") + "\n");
const batch = Buffer.concat(objects.map((entry) => Buffer.concat([
  Buffer.from(`${entry.oid} blob ${Buffer.byteLength(entry.sql)}\n`), Buffer.from(entry.sql), Buffer.from("\n"),
])));
const history = () => historicalMigrationHashes((args, input) => {
  if (args[0] === "rev-list") {
    expect(args).toEqual(["rev-list", "--objects", PRODUCTION.main, "--", "packages/db/drizzle"]);
    return listing;
  }
  expect(args).toEqual(["cat-file", "--batch"]);
  expect(input).toBe(objects.map((entry) => entry.oid).join("\n") + "\n");
  return batch;
});
const ledger = () => source.slice(0, 146).map((entry, index) => ({
  id: index + 1, hash: entry.hash as string | null, created_at: String(entry.folderMillis) as string | null,
}));
const tables = () => SWIM_SCHEMA_TABLES.map((name) => ({
  name, present: false, rls: null, forced: null, owner_uuid: false, columns: 0, policies: 0, foreign_keys: 0,
}));
const functions = () => SWIM_SCHEMA_FUNCTIONS.map((name) => ({ name, definitions: 0 }));
const shared = () => [{ swim_result: false, completion_body: "before", movement_keys: null }];

describe("DC-SW8 bounded read-only production history reconciliation", () => {
  it("requires the explicit approved scope and reference in the original guarded operation", () => {
    const sha = "c".repeat(40);
    const env = {
      GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
      GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_REF_TYPE: "branch", GITHUB_SHA: sha, EXPECTED_SHA: sha,
      GITHUB_JOB: PRODUCTION_RECONCILIATION.job, GITHUB_RUN_ID: "34770000000", GITHUB_RUN_ATTEMPT: "1",
      INSPECT_SWIM_PRODUCTION: "true", PRODUCTION_READONLY_SCOPE: "reconciliation",
      ...Object.fromEntries(PRODUCTION_RECONCILIATION.otherOperations.map((key) => [key, "false"])),
    };
    const inputs = { inspect_swim_production: "true", review_upgrade_read_only: "true", expected_sha: sha,
      production_readonly_scope: "reconciliation",
      ...Object.fromEntries(PRODUCTION_RECONCILIATION.otherOperations.map((key) => [key.toLowerCase(), "false"])) };
    expect(productionDispatch(inputs, env)).toBe(true);
    expect(productionContext(env)).toBe(sha);
    expect(() => productionDispatch({ ...inputs, production_readonly_scope: "preflight" }, env)).toThrow();
    expect(() => productionDispatch(inputs, { ...env, PRODUCTION_READONLY_SCOPE: "unbounded" })).toThrow();
    expect(() => productionDispatch({ ...inputs, expected_sha: PRODUCTION_RECONCILIATION.reference.sha },
      { ...env, GITHUB_SHA: PRODUCTION_RECONCILIATION.reference.sha })).toThrow();
    for (const key of PRODUCTION_RECONCILIATION.otherOperations) {
      expect(() => productionDispatch({ ...inputs, [key.toLowerCase()]: "true" }, env)).toThrow();
    }
  });
  it("classifies exact, LF and CRLF source variants without treating them as schema proof", () => {
    const variants = history();
    expect(variants.blobs).toBe(146);
    expect(variants.hashes.get(digest(source[0]!.sql.replace(/\n/g, "\r\n")))).toEqual(new Set([source[0]!.tag]));
    const entries = ledger();
    entries.push({ id: 147, hash: digest(source[0]!.sql.replace(/\n/g, "\r\n")), created_at: "2000" });
    entries.push({ ...entries[0]!, id: 148 });
    entries.push({ id: 149, hash: "f".repeat(64), created_at: "2001" });
    entries.push({ id: 150, hash: "PrivateSyntheticCanary", created_at: null });
    entries.push({ id: 151, hash: null, created_at: null });
    const result = productionHistoryInventory(entries, source, variants);
    expect(result).toMatchObject({ rowsRead: 151, complete: true, malformedHashRows: 2, duplicateHashRows: 1,
      invalidTimestampRows: 2, historicalOnlyRows: 1, unmatchedHashRows: 1, productionReady: false });
    expect(result.current[0]).toMatchObject({ canonicalRows: 2, canonicalTimestampRows: 2, historicalVariantRows: 1,
      newerThanLatest: null });
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("PrivateSyntheticCanary");
    expect(JSON.stringify(result)).not.toContain('"2001"');
  });
  it("never equates a 512-entry prefix with a complete history", () => {
    const entries = Array.from({ length: 512 }, (_, index) => ({ ...ledger()[0]!, id: index + 1 }));
    expect(productionHistoryInventory(entries, source, history()).complete).toBe(false);
    expect(() => productionHistoryInventory([...entries, entries[0]], source, history())).toThrow("ledger_inventory_shape");
    const complete = productionHistoryInventory(ledger(), source, history());
    expect(complete.current.slice(146).every((entry) => entry.newerThanLatest === true && entry.canonicalRows === 0)).toBe(true);
  });
  it("refuses oversized, incomplete or substituted Git blob inventories", () => {
    for (const changed of [batch.subarray(0, batch.length - 1), Buffer.concat([batch, Buffer.from("extra")]),
      Buffer.from(batch.toString("utf8").replace(" blob ", " tree "))]) {
      expect(() => historicalMigrationHashes((args) => args[0] === "rev-list" ? listing : changed)).toThrow();
    }
    expect(() => historicalMigrationHashes(() => Buffer.from("incomplete"))).toThrow("history_bound");
  });
  it("returns only closed metadata for named objects, not user rows or routine bodies", () => {
    const value = productionSchemaInventory(tables(), functions(), shared());
    expect(value.compatibilityVerified).toBe(false);
    expect(value.tables.every((entry) => !entry.present)).toBe(true);
    expect(() => productionSchemaInventory([...tables()].reverse(), functions(), shared())).toThrow();
    expect(() => productionSchemaInventory(tables(), [{ ...functions()[0], name: "PrivateSyntheticCanary" }], shared())).toThrow();
    expect(() => productionSchemaInventory(tables(), functions(), [{ ...shared()[0], sql: "PrivateSyntheticCanary" }])).toThrow();
    for (const query of [SCHEMA_TABLE_SQL, SCHEMA_FUNCTION_SQL, SCHEMA_SHARED_SQL]) {
      expect(query).not.toMatch(/(?:FROM|JOIN)\s+(?:public|auth)\.|\b(?:INSERT|UPDATE|DELETE|ALTER|GRANT|CREATE)\b|pg_stat/i);
    }
  });
  it("retains the historical preflight limit and bounds the explicit inventory separately", () => {
    const script = readFileSync(resolve(__dirname, "../inspect-swim-production.ts"), "utf8");
    expect(script).toContain("ORDER BY id LIMIT 156");
    expect(script).toContain("ORDER BY id LIMIT 512");
    expect(script).toContain('requireInspection(result.inventory.complete, "ledger_inventory_limit")');
    expect(script).toContain("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    expect(script).not.toContain("process.env.DATABASE_URL");
  });
});
