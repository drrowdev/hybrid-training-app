import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { modularUpdateDispatch, modularMergeCandidate, modularQualifiedRun, modularQualifiedJobs, modularQualifiedNativeRun, requireModularProductionBindings } from "../update-modular-production";
import { productionSettings } from "../swim-production-readonly-guards";
import { MODULAR_PREFLIGHT, MODULAR_DISABLED_OPERATIONS } from "../modular-production-preflight-guards";
import { modularUpdateInventory } from "../modular-production-update-storage";
import { productionHistoryFingerprint } from "../swim-production-reconciliation";

const sha = "c".repeat(40), candidate = "d".repeat(40), tree = "e".repeat(40);
const env = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "drrowdev/hybrid-training-app",
  GITHUB_REF_TYPE: "branch", GITHUB_REF: "refs/heads/main", GITHUB_SHA: sha };
const inputs = () => ({ ...Object.fromEntries(MODULAR_DISABLED_OPERATIONS.map((key) => [key, "false"])),
  update_modular_production: "true", inspect_swim_production: "false", review_upgrade_read_only: "false",
  production_readonly_scope: "preflight", expected_sha: sha });

describe("DC-K4/DC-SW8 modular production update preserves qualified source and history", () => {
  it("validates a selected real dispatch during prerequisite CI", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, unknown> };
    modularUpdateDispatch(event.inputs, process.env);
  });
  it("requires explicit main-only write intent and forbids mixed operations", () => {
    expect(modularUpdateDispatch(inputs(), env)).toBe(true);
    expect(modularUpdateDispatch(undefined, env)).toBe(false);
    for (const key of MODULAR_DISABLED_OPERATIONS.filter((key) => key !== "update_modular_production")) {
      for (const value of ["true", undefined]) expect(() => modularUpdateDispatch({ ...inputs(), [key]: value }, env)).toThrow();
    }
    for (const changed of [{ ...inputs(), inspect_swim_production: "true" }, { ...inputs(), review_upgrade_read_only: "true" },
      { ...inputs(), expected_sha: MODULAR_PREFLIGHT.main }, { ...inputs(), extra: "false" }]) {
      expect(() => modularUpdateDispatch(changed, env)).toThrow();
    }
    expect(() => modularUpdateDispatch(inputs(), { ...env, GITHUB_REF: `refs/heads/${MODULAR_PREFLIGHT.branch}` })).toThrow();
  });
  it("requires the reviewed two-parent merge and identical complete source tree", () => {
    const parents = `${sha} ${MODULAR_PREFLIGHT.main} ${candidate}`;
    expect(modularMergeCandidate(parents, sha, tree, tree)).toBe(candidate);
    for (const changed of [sha, `${sha} ${candidate}`, `${sha} ${candidate} ${MODULAR_PREFLIGHT.main}`, `${parents} ${candidate}`]) {
      expect(() => modularMergeCandidate(changed, sha, tree, tree)).toThrow();
    }
    expect(() => modularMergeCandidate(parents, sha, tree, candidate)).toThrow();
  });
  it("requires exact successful first-attempt native and storage job identities", () => {
    const run = { id: 35326000000, workflow_id: 279507729, head_sha: candidate,
      head_branch: MODULAR_PREFLIGHT.branch, status: "completed", conclusion: "success", run_attempt: 1 };
    expect(modularQualifiedRun({ workflow_runs: [run] }, 279507729, candidate)).toBe(run.id);
    for (const changed of [{ ...run, run_attempt: 2 }, { ...run, conclusion: "failure" }, { ...run, head_sha: sha },
      { ...run, status: "in_progress" }, { ...run, head_branch: "main" }]) {
      expect(() => modularQualifiedRun({ workflow_runs: [changed] }, 279507729, candidate)).toThrow();
    }
    const job = { run_id: run.id, head_sha: candidate, name: "required", status: "completed", conclusion: "success" };
    expect(() => modularQualifiedJobs({ jobs: [job] }, run.id, candidate, ["required"])).not.toThrow();
    for (const jobs of [[], [job, job], [{ ...job, conclusion: "skipped" }], [{ ...job, run_id: 1 }]]) {
      expect(() => modularQualifiedJobs({ jobs }, run.id, candidate, ["required"])).toThrow();
    }
  });
  it("requires existing swim bindings and refuses fixture or build-identity overrides", () => {
    type Settings = ReturnType<typeof productionSettings>;
    const settings: Settings = {
      protection: { sso: null, password: null, trustedIps: null }, valuesRead: false,
      flags: (["POOL_SWIMMING_ENABLED", "SWIM_POOL_EDITING_ENABLED", "SWIM_PRIVATE_COURSE_ENABLED",
        "SWIM_IMPORT_ENABLED", "SWIM_IMPORT_MATCHING_ENABLED", "ENABLE_E2E_FIXTURES", "NEXT_PUBLIC_BUILD_SHA"] as const)
        .map((key, index) => ({ key, configured: index < 5 })),
    };
    expect(() => requireModularProductionBindings(settings)).not.toThrow();
    expect(() => requireModularProductionBindings({ ...settings, flags: [] })).toThrow();
    expect(() => requireModularProductionBindings({ ...settings, flags: Array(7).fill(settings.flags[0]!) })).toThrow();
    for (let index = 0; index < settings.flags.length; index += 1) {
      const changed = structuredClone(settings); changed.flags[index]!.configured = !changed.flags[index]!.configured;
      expect(() => requireModularProductionBindings(changed)).toThrow();
    }
  });
  it.each(["success", "failure"])("ignores a newer %s read-only run whose native job was skipped", async (conclusion) => {
    const native = { id: 35326000000, workflow_id: 279507729, head_sha: candidate,
      head_branch: MODULAR_PREFLIGHT.branch, status: "completed", conclusion: "success", run_attempt: 1 };
    const inspection = { ...native, id: native.id + 1, conclusion };
    const jobs = async (run: number) => ({ jobs: [
      "author identity guard", "lint + typecheck + test + build", "disposable swim RPC and browser acceptance",
    ].map((name) => ({ run_id: run, head_sha: candidate, name, status: "completed",
      conclusion: run === inspection.id && name.startsWith("disposable") ? "skipped" : "success" })) });
    expect(await modularQualifiedNativeRun({ workflow_runs: [inspection, native] }, candidate, jobs)).toBe(native.id);
    await expect(modularQualifiedNativeRun({ workflow_runs: [inspection] }, candidate, jobs)).rejects.toThrow("qualification_run");
  });
  it("never falls back past a failed native execution to an older success", async () => {
    const failed = { id: 35326000001, workflow_id: 279507729, head_sha: candidate,
      head_branch: MODULAR_PREFLIGHT.branch, status: "completed", conclusion: "failure", run_attempt: 1 };
    const requested: number[] = [];
    await expect(modularQualifiedNativeRun({ workflow_runs: [failed, { ...failed, id: failed.id - 1, conclusion: "success" }] },
      candidate, async (run) => {
        requested.push(run);
        return { jobs: [{ run_id: run, head_sha: candidate, name: "disposable swim RPC and browser acceptance",
          status: "completed", conclusion: "failure" }] };
      })).rejects.toThrow("qualification_run");
    expect(requested).toEqual([failed.id]);
  });
  it("recognizes only unchanged legacy history and an exact source156 append", () => {
    const migrations = Array.from({ length: 157 }, (_, index) => ({
      tag: index === 156 ? "0156_modular_training_schedule" : `${String(index).padStart(4, "0")}_synthetic`,
      sql: [`SELECT ${index};`], bps: false, folderMillis: 1000 + index,
      hash: createHash("sha256").update(`SELECT ${index};`).digest("hex"),
    }));
    const retained = Array.from({ length: 203 }, (_, index) => ({
      id: index + 1, hash: migrations[index % 146]!.hash, created_at: String(migrations[index % 146]!.folderMillis),
    }));
    const baseline = { entries: 203, fingerprint: productionHistoryFingerprint(retained) };
    const rows = [...retained, ...migrations.slice(146, 156).map((migration, index) => ({
      id: index + 204, hash: migration.hash, created_at: String(migration.folderMillis),
    }))];
    expect(modularUpdateInventory(rows, migrations, baseline).pending).toHaveLength(1);
    expect(() => modularUpdateInventory(rows, migrations)).toThrow();
    const changed = structuredClone(migrations); changed[156]!.sql[0] = "SELECT 1;";
    expect(() => modularUpdateInventory(rows, changed, baseline)).toThrow("migration_source");
  });
  it("refuses laptop execution without connecting or exposing credentials", () => {
    const child = spawnSync(process.execPath, [require.resolve("tsx/cli"), resolve(__dirname, "../update-modular-production.ts")], {
      encoding: "utf8", timeout: 20_000, env: { ...process.env, GITHUB_ACTIONS: "false", SUPABASE_PROD_DB_URL: "PrivateSyntheticCanary" },
    });
    expect(child.status).toBe(1); expect(child.stderr).toBe("");
    expect(child.stdout).toContain('"databaseConnectionAttempted":false');
    expect(child.stdout).toContain('"attemptedMigrations":0');
    expect(child.stdout).not.toContain("PrivateSyntheticCanary");
  });
  it("keeps production credentials last and serializes the workflow without cancellation", () => {
    const workflow = readFileSync(resolve(__dirname, "../../../../.github/workflows/ci.yml"), "utf8").replaceAll("\r\n", "\n");
    const job = workflow.split("\n  update-modular-production:\n")[1]!.split(/\n  [a-z][a-z0-9-]+:\n/)[0]!;
    for (const guard of ["environment: Production", "needs: [ci, identity-guard]", "persist-credentials: false",
      "inputs.update_modular_production == true", "inputs.expected_sha == github.sha",
      "github.ref == 'refs/heads/main'", "group: production-database-migrations", "cancel-in-progress: false",
      ...MODULAR_DISABLED_OPERATIONS.filter((key) => key !== "update_modular_production").map((key) => `inputs.${key} == false`)]) {
      expect(job).toContain(guard);
    }
    const [before, operation] = job.split("      - name: Append the qualified modular migration\n");
    expect(before).toContain("--check-source"); expect(before).not.toContain("secrets.");
    expect(operation!.match(/secrets\.\w+/g)).toHaveLength(2);
    const concurrency = workflow.split("\nconcurrency:\n")[1]!.split("\njobs:\n")[0]!;
    expect(concurrency).toContain("inputs.update_modular_production && 'ci-modular-production-update'");
    expect(concurrency).toContain("!(github.event_name == 'workflow_dispatch' && inputs.update_modular_production)");
    const storage = readFileSync(resolve(__dirname, "../modular-production-update-storage.ts"), "utf8");
    expect(storage).toContain("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
    expect(storage).not.toMatch(/\bDELETE\s+FROM|\bUPDATE\s+(?:drizzle|public)\.|\bTRUNCATE\b|\bsetval\s*\(/i);
  });
});
