import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_UPDATE, productionUpdateContext, productionUpdateDispatch, productionVercelDeploymentIds,
  successfulProductionStatus, productionGitHubDeploymentsRoute, productionGitHubStatusRoute, requireSwimmingDisabled,
} from "../swim-production-update-guards";
import {
  productionSwimmingMigrations, validateProductionMigrationSource, validateProductionSwimBaseline, validateProductionSwimAppend,
} from "../swim-production-update-storage";
import { productionHistoryFingerprint } from "../swim-production-reconciliation";
import { PRODUCTION_READONLY, productionDeployment, productionSettings } from "../swim-production-readonly-guards";
import { refreshContext, verifyRefreshSource } from "../refresh-swim-review";
import { REVIEW } from "../swim-review-config-plan";

const sha = "c".repeat(40);
const env = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF_TYPE: "branch", GITHUB_REF: "refs/heads/main", GITHUB_JOB: PRODUCTION_UPDATE.job,
  GITHUB_SHA: sha, EXPECTED_SHA: sha, GITHUB_RUN_ID: "34780000000", GITHUB_RUN_ATTEMPT: "1",
  UPDATE_SWIM_PRODUCTION: "true", ACCEPT_LEGACY_SWIM_HISTORY: "true",
  ...Object.fromEntries(PRODUCTION_UPDATE.otherOperations.map((key) => [key, "false"])),
};
const inputs = () => ({
  update_swim_production: "true", accept_legacy_swim_history: "true", expected_sha: sha,
  production_readonly_scope: "preflight", review_upgrade_read_only: "true",
  ...Object.fromEntries(PRODUCTION_UPDATE.otherOperations.map((key) => [key.toLowerCase(), "false"])),
});
const migrations = productionSwimmingMigrations();
const rows = () => [
  ...migrations.slice(0, 146).map((entry, index) => ({ id: index + 1, hash: entry.hash, created_at: String(entry.folderMillis) })),
  ...Array.from({ length: 57 }, (_, index) => ({ id: index + 147, hash: `synthetic-legacy-${index}`, created_at: "1" })),
];
const baseline = (value: unknown) => ({ entries: 203 as const, fingerprint: productionHistoryFingerprint(value) });
const appended = () => [...rows(), ...migrations.slice(146).map((entry, index) =>
  ({ id: 1000 + index, hash: entry.hash, created_at: String(entry.folderMillis) }))];

describe("DC-SW3/SW5/SW8 history-preserving production updater", () => {
  it("validates selected dispatches in prerequisite CI without connecting", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, unknown> };
    productionUpdateDispatch(event.inputs, process.env);
  });
  it("requires main, an exact new source, one operation and explicit legacy-history acceptance", () => {
    expect(productionUpdateDispatch(inputs(), env)).toBe(true);
    expect(productionUpdateContext(env)).toBe(sha);
    expect(productionUpdateDispatch(undefined, env)).toBe(false);
    expect(() => productionUpdateDispatch({ ...inputs(), update_swim_production: "false" }, env)).toThrow();
    for (const value of ["false", true, undefined]) {
      expect(() => productionUpdateDispatch({ ...inputs(), accept_legacy_swim_history: value }, env)).toThrow();
    }
    for (const key of PRODUCTION_UPDATE.otherOperations) {
      expect(() => productionUpdateDispatch({ ...inputs(), [key.toLowerCase()]: "true" }, env)).toThrow();
    }
    expect(() => productionUpdateDispatch({ ...inputs(), extra: "false" }, env)).toThrow();
    expect(() => productionUpdateDispatch({ ...inputs(), production_readonly_scope: "reconciliation" }, env)).toThrow();
    expect(() => productionUpdateContext({ ...env, GITHUB_REF: `refs/heads/${REVIEW.branch}` })).toThrow();
    expect(() => productionUpdateContext({ ...env, GITHUB_RUN_ATTEMPT: "2" })).toThrow();
    expect(() => productionUpdateContext({ ...env, ACCEPT_LEGACY_SWIM_HISTORY: "false" })).toThrow();
  });
  it("checks the entire checkout and live main without widening historical review contexts", () => {
    const calls: string[][] = [];
    const sourcePath = "packages/db/scripts/update-swim-production.ts";
    const io = {
      event: () => ({ inputs: inputs() }), regular: () => true,
      git: (...args: string[]) => {
        calls.push(args);
        if (args[0] === "rev-parse") return sha;
        if (args[0] === "status" || args[0] === "merge-base") return "";
        if (args[0] === "diff") return sourcePath;
        if (args[0] === "ls-tree") return `100644 blob ${"a".repeat(40)}\t${sourcePath}`;
        if (args[0] === "ls-remote") return `${sha}\trefs/heads/main`;
        throw new Error("unexpected_git_command");
      },
    };
    verifyRefreshSource(env, io, PRODUCTION_UPDATE);
    expect(calls.filter((args) => args[0] === "ls-remote")).toEqual([
      ["ls-remote", "--exit-code", `https://github.com/${REVIEW.repository}.git`, "refs/heads/main"],
    ]);
    expect(calls).toContainEqual(["merge-base", "--is-ancestor", PRODUCTION_UPDATE.reference.sha, "HEAD"]);
    expect(() => verifyRefreshSource(env, { ...io, regular: () => false }, PRODUCTION_UPDATE)).toThrow();
    const reader = { ...env, GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_JOB: PRODUCTION_READONLY.job,
      UPDATE_SWIM_PRODUCTION: "false", INSPECT_SWIM_PRODUCTION: "true" };
    expect(refreshContext(reader, PRODUCTION_READONLY)).toBe(sha);
    expect(() => refreshContext({ ...reader, GITHUB_REF: "refs/heads/main" }, PRODUCTION_READONLY)).toThrow();
  });
  it("preserves every accepted legacy row and refuses changed history or replay", () => {
    const before = rows(), accepted = baseline(before);
    expect(validateProductionSwimBaseline(before, migrations, accepted)).toEqual(before);
    expect(() => validateProductionSwimBaseline(before, migrations)).toThrow("baseline_fingerprint");
    const changed = rows(); changed[0]!.created_at = "2";
    expect(() => validateProductionSwimBaseline(changed, migrations, accepted)).toThrow("baseline_fingerprint");
    expect(validateProductionSwimAppend(appended(), migrations, accepted)).toEqual({ entries: 212, retainedEntries: 203, appendedEntries: 9 });
    expect(() => validateProductionSwimBaseline(appended(), migrations, accepted)).toThrow("baseline_fingerprint");
    const rewritten = appended(); rewritten[0]!.hash = rewritten[1]!.hash;
    expect(() => validateProductionSwimAppend(rewritten, migrations, accepted)).toThrow("baseline_fingerprint");
    expect(() => validateProductionSwimAppend([...appended(), appended()[211]!], migrations, accepted)).toThrow("append_count");
    const reordered = appended(); [reordered[203], reordered[204]] = [reordered[204]!, reordered[203]!];
    expect(() => validateProductionSwimAppend(reordered, migrations, accepted)).toThrow("append_mismatch");
  });
  it("refuses missing main history, already-recorded new changes and unsafe timestamp boundaries", () => {
    const missing = rows(); missing[0]!.hash = missing[1]!.hash;
    expect(() => validateProductionSwimBaseline(missing, migrations, baseline(missing))).toThrow("baseline_membership");
    const pending = rows(); pending[202]!.hash = migrations[146]!.hash;
    expect(() => validateProductionSwimBaseline(pending, migrations, baseline(pending))).toThrow("baseline_membership");
    const future = rows(); future[202]!.created_at = "9999999999999999";
    expect(() => validateProductionSwimBaseline(future, migrations, baseline(future))).toThrow("baseline_timestamp");
    const duplicateIds = rows(); duplicateIds[1]!.id = duplicateIds[0]!.id;
    expect(() => validateProductionSwimBaseline(duplicateIds, migrations, baseline(duplicateIds))).toThrow("baseline_ids");
  });
  it("checks all nine SQL hashes instead of trusting a modified in-memory payload", () => {
    const altered = structuredClone(migrations); altered[146]!.sql[0] += "\nSELECT 1;";
    expect(() => validateProductionMigrationSource(altered)).toThrow("migration_source");
    expect(() => validateProductionMigrationSource(migrations.slice(1))).toThrow("migration_source");
  });
  it("requires a Vercel-created successful Production deployment for the exact release", () => {
    const deployment = { id: 123, sha, environment: "Production", creator: { login: "vercel[bot]", type: "Bot" } };
    expect(productionVercelDeploymentIds([deployment], sha)).toEqual([123]);
    expect(() => productionVercelDeploymentIds([{ ...deployment, creator: { login: "github-actions[bot]", type: "Bot" } }], sha)).toThrow();
    expect(() => productionVercelDeploymentIds([{ ...deployment, sha: "a".repeat(40) }], sha)).toThrow();
    expect(successfulProductionStatus([{ state: "failure" }, { state: "success" }])).toBe(true);
    expect(successfulProductionStatus([{ state: "in_progress" }])).toBe(false);
    expect(() => productionGitHubDeploymentsRoute("../wrong")).toThrow();
    expect(() => productionGitHubStatusRoute(-1)).toThrow();
    const raw = { id: "dpl_Release", projectId: REVIEW.projectId, ownerId: REVIEW.teamId, readyState: "READY",
      target: "production", url: "hybrid-training-app-release.vercel.app", createdAt: 1000,
      gitSource: { type: "github", sha, ref: "main" },
      meta: { githubCommitSha: sha, githubCommitRef: "main", githubCommitOrg: "drrowdev", githubCommitRepo: "hybrid-training-app" } };
    expect(productionDeployment(raw, raw.id, sha).sha).toBe(sha);
    expect(() => productionDeployment(raw, raw.id)).toThrow();
  });
  it("requires unset swimming and fixture bindings, not guessed encrypted flag values", () => {
    const project = { id: REVIEW.projectId, accountId: REVIEW.teamId, name: REVIEW.projectName,
      rootDirectory: "apps/web", framework: "nextjs",
      link: { type: "github", org: "drrowdev", repo: "hybrid-training-app", productionBranch: "main" },
      ssoProtection: { deploymentType: "all_except_custom_domains" } };
    const empty = { data: [], pagination: { count: 0, next: null } };
    expect(() => requireSwimmingDisabled(productionSettings(project, { envs: [] }, empty))).not.toThrow();
    const enabled = { id: "synthetic", key: "POOL_SWIMMING_ENABLED", type: "encrypted", target: ["production"],
      createdAt: 1000, updatedAt: 1000, value: "false" };
    expect(() => requireSwimmingDisabled(productionSettings(project, { envs: [enabled] }, empty))).toThrow("production_flags");
  });
  it("refuses a local executable before credentials, requests or database connection", () => {
    const canary = "PrivateSyntheticCanary";
    const child = spawnSync(process.execPath, [require.resolve("tsx/cli"), resolve(__dirname, "../update-swim-production.ts")], {
      encoding: "utf8", timeout: 20_000,
      env: { ...process.env, GITHUB_ACTIONS: "false", SUPABASE_PROD_DB_URL: canary, VERCEL_REVIEW_TOKEN: canary },
    });
    expect(child.status).toBe(1); expect(child.stderr).toBe("");
    expect(child.stdout).toContain('"databaseConnectionAttempted":false');
    expect(child.stdout).toContain('"commitConfirmed":false');
    expect(child.stdout).not.toContain(canary);
  });
  it("keeps the old production job unchanged and new credentials in the final guarded step", () => {
    const path = resolve(__dirname, "../../../../.github/workflows/ci.yml");
    const current = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
    const old = execFileSync("git", ["show", `${PRODUCTION_UPDATE.reference.sha}:.github/workflows/ci.yml`],
      { encoding: "utf8", timeout: 15_000 }).replaceAll("\r\n", "\n");
    const existing = (text: string) => text.split("\n  prod-migrate:\n")[1]!.split("\n  prod-drift:\n")[0];
    expect(existing(current)).toBe(existing(old));
    const job = current.split("\n  update-swim-production:\n")[1]!.split("\n  inspect-swim-production:\n")[0]!;
    for (const guard of ["needs: [ci, identity-guard]", "github.ref == 'refs/heads/main'", "inputs.accept_legacy_swim_history == true",
      "group: production-database-migrations", "cancel-in-progress: false", "persist-credentials: false",
      ...PRODUCTION_UPDATE.otherOperations.map((key) => `inputs.${key.toLowerCase()} == false`)]) expect(job).toContain(guard);
    const [before, operation] = job.split("      - name: Append approved swimming migrations\n");
    expect(before).toContain("--check-source"); expect(before).not.toContain("secrets.");
    expect(operation!.match(/secrets\.\w+/g)).toHaveLength(2);
    expect(job).not.toContain("upload-artifact");
    const storage = readFileSync(resolve(__dirname, "../swim-production-update-storage.ts"), "utf8");
    expect(storage).toContain("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
    expect(storage).not.toMatch(/\bDELETE\s+FROM|\bUPDATE\s+(?:drizzle|public)\.|\bTRUNCATE\b|\bsetval\s*\(/i);
  });
});
