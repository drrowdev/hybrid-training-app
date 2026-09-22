import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  MODULAR_PREFLIGHT, MODULAR_DISABLED_OPERATIONS, modularPreflightDispatch,
  modularPreflightContext, modularMigrationInventory,
} from "../modular-production-preflight-guards";
import { productionHistoryFingerprint } from "../swim-production-reconciliation";
import { productionDispatch } from "../swim-production-readonly-guards";

const sha = "c".repeat(40);
const env = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "drrowdev/hybrid-training-app", GITHUB_REF_TYPE: "branch",
  GITHUB_REF: `refs/heads/${MODULAR_PREFLIGHT.branch}`, GITHUB_JOB: MODULAR_PREFLIGHT.job,
  GITHUB_SHA: sha, EXPECTED_SHA: sha, GITHUB_RUN_ID: "35326000000", GITHUB_RUN_ATTEMPT: "1",
};
const inputs = () => ({
  inspect_swim_production: "true", review_upgrade_read_only: "true",
  production_readonly_scope: MODULAR_PREFLIGHT.scope, expected_sha: sha,
  ...Object.fromEntries(MODULAR_DISABLED_OPERATIONS.map((key) => [key, "false"])),
});
const migrations = Array.from({ length: 157 }, (_, index) => ({
  tag: `${String(index).padStart(4, "0")}_synthetic`,
  hash: index.toString(16).padStart(64, "0"), folderMillis: 1000 + index,
}));
const retained = Array.from({ length: 203 }, (_, index) => ({
  id: index + 1, hash: migrations[index % 146]!.hash, created_at: String(migrations[index % 146]!.folderMillis),
}));
const baseline = { entries: 203, fingerprint: productionHistoryFingerprint(retained) };
const rows = (appended = 9) => [
  ...retained.map((entry) => ({ ...entry })),
  ...migrations.slice(146, 146 + appended).map((entry, index) => ({
    id: 204 + index, hash: entry.hash, created_at: String(entry.folderMillis),
  })),
];

describe("DC-SW8 modular release preflight preserves production history without writes", () => {
  it("validates the selected dispatch during prerequisite CI", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, unknown> };
    modularPreflightDispatch(event.inputs, process.env);
  });

  it("routes only the new scope to the new exact-branch guard", () => {
    expect(modularPreflightDispatch(inputs(), env)).toBe(true);
    expect(modularPreflightContext(inputs(), env)).toBe(sha);
    expect(productionDispatch(inputs(), env)).toBe(false);
    expect(modularPreflightDispatch(undefined, env)).toBe(false);
    expect(modularPreflightDispatch({ ...inputs(), production_readonly_scope: "preflight" }, env)).toBe(false);
  });

  it.each(MODULAR_DISABLED_OPERATIONS)("rejects enabled or missing %s", (key) => {
    for (const value of ["true", true, undefined]) {
      expect(() => modularPreflightDispatch({ ...inputs(), [key]: value }, env)).toThrow();
    }
  });

  it.each(["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REF_TYPE",
    "GITHUB_REF", "GITHUB_JOB", "GITHUB_SHA", "EXPECTED_SHA", "GITHUB_RUN_ATTEMPT", "GITHUB_RUN_ID"])
  ("rejects an invalid %s before credentials", (key) => {
    expect(() => modularPreflightContext(inputs(), { ...env, [key]: "wrong" })).toThrow();
  });

  it("rejects unreviewed, ambiguous and write-enabled dispatches", () => {
    for (const changed of [
      { ...inputs(), expected_sha: MODULAR_PREFLIGHT.main },
      { ...inputs(), expected_sha: "main" },
      { ...inputs(), inspect_swim_production: "false" },
      { ...inputs(), review_upgrade_read_only: "false" },
      { ...inputs(), hidden_write: "false" },
    ]) expect(() => modularPreflightDispatch(changed, env)).toThrow();
    expect(() => modularPreflightContext(inputs(), { ...env, GITHUB_RUN_ATTEMPT: "2" })).toThrow();
  });

  it("retains the exact legacy prefix and identifies only unapplied source migrations", () => {
    expect(modularMigrationInventory(rows(), migrations, baseline)).toMatchObject({
      entries: 212, retainedEntries: 203, legacyHistoryUnchanged: true, canonicalAppendedEntries: 9,
      sourceEntries: 157, currentMainEntries: 156, pending: migrations.slice(155), migrationAuthorized: false,
    });
    expect(modularMigrationInventory(rows(10), migrations, baseline).pending).toEqual(migrations.slice(156));
    expect(modularMigrationInventory(rows(11), migrations, baseline).pending).toEqual([]);
  });

  it("never treats a historical receipt as a fresh ledger match", () => {
    const changed = rows(); changed[0]!.created_at = "999";
    expect(() => modularMigrationInventory(changed, migrations, baseline)).toThrow("legacy_history_changed");
    expect(() => modularMigrationInventory(rows(), migrations)).toThrow("legacy_history_changed");
  });

  it("refuses unknown, duplicated, reordered or modified appended entries", () => {
    const unknown = rows(); unknown[203]!.hash = "f".repeat(64);
    const duplicate = rows(); duplicate[204]!.hash = duplicate[203]!.hash;
    const changedTime = rows(); changedTime[203]!.created_at = "9999";
    const changedId = rows(); changedId[204]!.id = changedId[203]!.id;
    for (const ledger of [unknown, duplicate, changedTime, changedId, rows(8), [...rows()].reverse()]) {
      expect(() => modularMigrationInventory(ledger, migrations, baseline)).toThrow();
    }
    const overflow = Array.from({ length: 512 }, (_, index) => ({ ...rows()[index % 212]!, id: index + 1 }));
    expect(() => modularMigrationInventory(overflow, migrations, baseline)).toThrow("ledger_shape");
  });

  it("refuses a pending migration that the timestamp-based migrator would skip", () => {
    const newerLegacy = retained.map((entry) => ({ ...entry }));
    newerLegacy[0]!.created_at = "9999";
    const nextBaseline = { entries: 203, fingerprint: productionHistoryFingerprint(newerLegacy) };
    expect(() => modularMigrationInventory([...newerLegacy, ...rows().slice(203)], migrations, nextBaseline))
      .toThrow("pending_timestamp");
  });

  it("requires unique ordered source identities without leaking malformed ledger content", () => {
    const duplicate = migrations.map((entry) => ({ ...entry }));
    duplicate[156]!.hash = duplicate[155]!.hash;
    expect(() => modularMigrationInventory(rows(), duplicate, baseline)).toThrow("source_journal");
    const changed = rows(); changed[203]!.hash = "PrivateSyntheticCanary";
    try {
      modularMigrationInventory(changed, migrations, baseline);
      throw new Error("Expected ledger rejection");
    } catch (error) {
      expect(String(error)).not.toContain("PrivateSyntheticCanary");
      expect(String(error)).toContain("ledger_append_changed");
    }
  });

  it("refuses laptop execution without DB attempts or credential/error output", () => {
    const canary = "PrivateSyntheticCanary";
    const child = spawnSync(process.execPath, [require.resolve("tsx/cli"), resolve(__dirname, "../modular-production-preflight.ts")], {
      encoding: "utf8", timeout: 20_000, env: { ...process.env, GITHUB_ACTIONS: "false", SUPABASE_PROD_DB_URL: canary },
    });
    expect(child.status).toBe(1); expect(child.stderr).toBe("");
    expect(child.stdout).toContain('"databaseReadAttempted":false');
    expect(child.stdout).toContain('"writesAttempted":false');
    expect(child.stdout).toContain('"status":"failed"');
    expect(child.stdout).not.toContain(canary);
  });

  it("keeps credentials after source guards and reuses the production migration lock", () => {
    const workflow = readFileSync(resolve(__dirname, "../../../../.github/workflows/ci.yml"), "utf8").replaceAll("\r\n", "\n");
    const job = workflow.split("\n  inspect-modular-production:\n")[1]!.split("\n  inspect-swim-production:\n")[0]!;
    for (const guard of ["needs: [ci, identity-guard]", "persist-credentials: false", "environment: Production",
      "group: production-database-migrations", "cancel-in-progress: false",
      ...MODULAR_DISABLED_OPERATIONS.map((key) => `inputs.${key} == false`)]) expect(job).toContain(guard);
    const [before, operation] = job.split("      - name: Inspect modular production metadata without writes\n");
    expect(before).toContain("--check-source"); expect(before).not.toContain("secrets.");
    expect(operation!.match(/secrets\.\w+/g)).toHaveLength(2);
    expect(job).not.toContain("db:migrate"); expect(job).not.toContain("upload-artifact");
    expect(job).not.toContain("environment: swim-review");
    const script = readFileSync(resolve(__dirname, "../modular-production-preflight.ts"), "utf8");
    expect(script).toContain("default_transaction_read_only: true");
    expect(script).toContain('tx.unsafe("SET TRANSACTION READ ONLY")');
    expect(script).toContain('tx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")');
    expect(script).not.toMatch(/FROM public\.|FROM auth\.|ALTER TABLE|GRANT |INSERT INTO|UPDATE public|DELETE FROM/);
  });
});
