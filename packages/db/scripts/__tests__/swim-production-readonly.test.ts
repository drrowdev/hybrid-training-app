import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION, PRODUCTION_READONLY as profile, PRODUCTION_ROUTES,
  productionContext, productionDispatch, productionDatabaseUrl, productionRequestAllowed,
  productionDeploymentRoute, productionAlias, productionDeployment, productionSettings, productionLedger, productionLedgerDiagnostics,
} from "../swim-production-readonly-guards";
import { REVIEW } from "../swim-review-config-plan";

const sha = "c".repeat(40);
const env = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_REF_TYPE: "branch", GITHUB_JOB: profile.job,
  GITHUB_RUN_ID: "34765799999", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: sha, EXPECTED_SHA: sha,
  INSPECT_SWIM_PRODUCTION: "true", ...Object.fromEntries(profile.otherOperations.map((key) => [key, "false"])),
  PRODUCTION_READONLY_SCOPE: "preflight",
};
const inputs = () => ({ inspect_swim_production: "true", review_upgrade_read_only: "true", expected_sha: sha,
  production_readonly_scope: "preflight",
  ...Object.fromEntries(profile.otherOperations.map((key) => [key.toLowerCase(), "false"])) });
const url = `postgresql://postgres.${PRODUCTION.project}:synthetic-only-password@aws-0-eu-north-1.pooler.supabase.com:5432/postgres?sslmode=require`;
const expected = Array.from({ length: 155 }, (_, index) => ({ hash: index.toString(16).padStart(64, "0"), folderMillis: 1000 + index }));
const rows = () => expected.slice(0, 146).map((row, index) => ({ id: index + 1, hash: row.hash, created_at: String(row.folderMillis) }));
const deployment = () => ({
  id: "dpl_SyntheticProduction", projectId: REVIEW.projectId, ownerId: REVIEW.teamId,
  target: "production", readyState: "READY", url: "hybrid-training-app-synthetic.vercel.app", createdAt: 1000,
  gitSource: { type: "github", sha: PRODUCTION.main, ref: "main" },
  meta: { githubCommitSha: PRODUCTION.main, githubCommitRef: "main", githubCommitOrg: "drrowdev", githubCommitRepo: "hybrid-training-app" },
});

describe("DC-SW8 production inspection never writes or reads personal tables", () => {
  it("validates a selected real dispatch in prerequisite CI", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, unknown> };
    productionDispatch(event.inputs, { ...process.env, PRODUCTION_READONLY_SCOPE: String(event.inputs?.production_readonly_scope) });
  });
  it("requires exactly one operation and a reviewed feature head", () => {
    expect(productionDispatch(inputs(), env)).toBe(true);
    expect(productionDispatch(undefined, env)).toBe(false);
    for (const key of profile.otherOperations) {
      for (const value of ["true", true, undefined]) {
        expect(() => productionDispatch({ ...inputs(), [key.toLowerCase()]: value }, env)).toThrow();
      }
    }
    expect(() => productionDispatch({ ...inputs(), extra: "false" }, env)).toThrow();
    expect(() => productionDispatch({ ...inputs(), review_upgrade_read_only: "false" }, env)).toThrow();
  });
  it.each(["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REF", "GITHUB_REF_TYPE",
    "GITHUB_JOB", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA", "PRODUCTION_READONLY_SCOPE"])("refuses incorrect %s before credentials", (key) => {
    expect(() => productionContext({ ...env, [key]: "wrong" })).toThrow();
  });
  it("accepts only the pinned production DB target over TLS", () => {
    expect(productionDatabaseUrl(url)).toBe(url);
    const direct = `postgresql://postgres:synthetic-only-password@db.${PRODUCTION.project}.supabase.co:5432/postgres`;
    expect(productionDatabaseUrl(direct)).toBe(direct);
    for (const bad of [url.replace(PRODUCTION.project, REVIEW.supabaseId), url.replace(".pooler.supabase.com", ".example.invalid"),
      url.replace(":5432", ":80"), url + "&options=-cstatement_timeout=0", url.replace("require", "disable"),
      direct.replace(PRODUCTION.project, REVIEW.supabaseId), url + "#fragment", " " + url]) {
      expect(() => productionDatabaseUrl(bad)).toThrow();
    }
  });
  it("permits only fixed Vercel GETs and the discovered deployment", () => {
    for (const target of Object.values(PRODUCTION_ROUTES)) {
      expect(productionRequestAllowed(target, "GET", undefined)).toBe(true);
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect(productionRequestAllowed(target, method, undefined)).toBe(false);
      expect(productionRequestAllowed(target, "GET", {})).toBe(false);
    }
    const target = productionDeploymentRoute("dpl_Synthetic");
    expect(productionRequestAllowed(target, "GET", undefined)).toBe(false);
    expect(productionRequestAllowed(target, "GET", undefined, "dpl_Synthetic")).toBe(true);
    expect(productionRequestAllowed(PRODUCTION_ROUTES.projectEnv.replace("decrypt=false", "decrypt=true"), "GET", undefined)).toBe(false);
    expect(productionRequestAllowed(`https://${PRODUCTION.project}.supabase.co/rest/v1/profiles`, "GET", undefined)).toBe(false);
    expect(() => productionDeploymentRoute("../wrong")).toThrow();
  });
  it("binds the production alias and exact-main READY production deployment", () => {
    expect(productionAlias({ alias: PRODUCTION.alias, projectId: REVIEW.projectId, deploymentId: deployment().id }).deploymentId)
      .toBe(deployment().id);
    expect(productionDeployment(deployment(), deployment().id).sha).toBe(PRODUCTION.main);
    for (const changed of [{ target: null }, { readyState: "ERROR" }, { ownerId: "wrong" },
      { gitSource: { ...deployment().gitSource, sha } }, { meta: { ...deployment().meta, githubCommitRef: REVIEW.branch } }]) {
      expect(() => productionDeployment({ ...deployment(), ...changed }, deployment().id)).toThrow();
    }
    expect(() => productionAlias({ alias: REVIEW.proposedAlias, projectId: REVIEW.projectId, deploymentId: deployment().id })).toThrow();
  });
  it("projects settings without decrypting or retaining environment values", () => {
    const project = { id: REVIEW.projectId, accountId: REVIEW.teamId, name: REVIEW.projectName,
      rootDirectory: "apps/web", framework: "nextjs",
      link: { type: "github", org: "drrowdev", repo: "hybrid-training-app", productionBranch: "main" },
      ssoProtection: { deploymentType: "all_except_custom_domains" } };
    const entry = { id: "syntheticFlag", key: "POOL_SWIMMING_ENABLED", type: "encrypted", target: ["production"],
      createdAt: 1000, updatedAt: 1000, value: "PrivateSyntheticCanary" };
    const value = productionSettings(project, { envs: [entry] }, { data: [], pagination: { count: 0, next: null } });
    expect(value.flags[0]!.configured).toBe(true); expect(value.valuesRead).toBe(false);
    expect(JSON.stringify(value)).not.toContain("PrivateSyntheticCanary");
    expect(() => productionSettings(project, { envs: [entry], hiddenProductionEnvCount: 1 },
      { data: [], pagination: { count: 0, next: null } })).toThrow();
  });
  it("reports an exact ordered ledger prefix without silently accepting unknowns or duplicates", () => {
    expect(productionLedger(rows(), expected)).toEqual({
      entries: 146, mainEntries: 146, candidateEntries: 155, canonicalPrefix: true, pending: 9,
    });
    const modified = rows(); modified[1] = { ...modified[0]!, id: 2 };
    for (const invalid of [modified, rows().slice(1), [...rows()].reverse(),
      [...rows(), { id: 147, hash: "f".repeat(64), created_at: "9999" }]]) {
      expect(() => productionLedger(invalid, expected)).toThrow();
    }
    const changed = rows(); changed[0]!.created_at = "999";
    expect(() => productionLedger(changed, expected)).toThrow();
    const complete = expected.map((row, index) => ({ id: index + 1, hash: row.hash, created_at: row.folderMillis }));
    expect(productionLedger(complete, expected).pending).toBe(0);
  });
  it("reports only bounded ledger diagnostics without relaxing acceptance", () => {
    expect(productionLedgerDiagnostics(rows(), expected)).toEqual({
      rowsRead: 146, rowLimitReached: false, invalidRows: 0, invalidIds: 0, invalidHashes: 0,
      invalidTimestamps: 0, duplicateHashes: 0, unknownHashes: 0, orderMismatches: 0, timestampMismatches: 0,
    });
    const changed: unknown[] = rows();
    changed[0] = { ...rows()[0], id: 0 };
    changed[1] = { ...rows()[1], hash: "PrivateSyntheticCanary" };
    changed[2] = { ...rows()[2], created_at: null };
    changed[3] = { ...rows()[3], created_at: "999" };
    changed[4] = { ...rows()[0], id: 5 };
    changed[5] = { ...rows()[5], hash: "f".repeat(64) };
    const diagnostics = productionLedgerDiagnostics(changed, expected);
    expect(diagnostics).toEqual({
      rowsRead: 146, rowLimitReached: false, invalidRows: 3, invalidIds: 1, invalidHashes: 1,
      invalidTimestamps: 1, duplicateHashes: 1, unknownHashes: 1, orderMismatches: 2, timestampMismatches: 1,
    });
    expect(JSON.stringify(diagnostics)).not.toContain("PrivateSyntheticCanary");
    expect(() => productionLedger(changed, expected)).toThrow("ledger_shape");
    const overflow = [...expected.map((row, index) => ({ id: index + 1, hash: row.hash, created_at: row.folderMillis })),
      { id: 156, hash: "f".repeat(64), created_at: 9999 }];
    expect(productionLedgerDiagnostics(overflow, expected)).toMatchObject({ rowsRead: 156, rowLimitReached: true, unknownHashes: 1 });
    expect(() => productionLedger(overflow, expected)).toThrow("ledger_shape");
    expect(() => productionLedgerDiagnostics([...overflow, overflow[0]], expected)).toThrow("ledger_shape");
    expect(productionLedgerDiagnostics([null], expected)).toMatchObject({
      invalidRows: 1, invalidIds: 1, invalidHashes: 1, invalidTimestamps: 1,
    });
  });
  it("refuses local execution without connecting or exposing credentials", () => {
    const canary = "PrivateSyntheticCanary";
    const child = spawnSync(process.execPath, [require.resolve("tsx/cli"), resolve(__dirname, "../inspect-swim-production.ts")], {
      encoding: "utf8", timeout: 20_000, env: { ...process.env, GITHUB_ACTIONS: "false", SUPABASE_PROD_DB_URL: canary },
    });
    expect(child.status).toBe(1); expect(child.stderr).toBe("");
    expect(child.stdout).toContain('"databaseReadAttempted":false');
    expect(child.stdout).toContain('"writesAttempted":false');
    expect(child.stdout).not.toContain(canary);
  });
  it("keeps production credentials in the final exact-source read-only step", () => {
    const workflow = readFileSync(resolve(__dirname, "../../../../.github/workflows/ci.yml"), "utf8").replaceAll("\r\n", "\n");
    const job = workflow.split("\n  inspect-swim-production:\n")[1]!.split("\n  test-swim-account-flow:\n")[0]!;
    for (const guard of ["needs: [ci, identity-guard]", "persist-credentials: false", "group: production-database-migrations",
      "cancel-in-progress: false", ...profile.otherOperations.map((key) => `inputs.${key.toLowerCase()} == false`)]) expect(job).toContain(guard);
    const [before, operation] = job.split("      - name: Inspect production metadata and ledger without writes\n");
    expect(before).toContain("--check-source"); expect(before).not.toContain("secrets.");
    expect(operation!.match(/secrets\.\w+/g)).toHaveLength(2);
    expect(job).not.toContain("db:migrate"); expect(job).not.toContain("upload-artifact");
    const script = readFileSync(resolve(__dirname, "../inspect-swim-production.ts"), "utf8");
    expect(script).toContain("default_transaction_read_only: true");
    expect(script).toContain('tx.unsafe("SET TRANSACTION READ ONLY")');
    expect(script).toContain("FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 156");
    expect(script).not.toMatch(/FROM public\.|FROM auth\.|ALTER TABLE|GRANT |INSERT INTO|UPDATE public|DELETE FROM/);
  });
});
