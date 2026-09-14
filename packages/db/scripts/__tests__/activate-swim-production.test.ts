import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ACTIVATION_DEPLOYMENT, ACTIVATION_FLAGS, ACTIVATION_MAIN, ACTIVATION_PROFILE,
  activateProductionSwimming, activationContext, activationDeploymentBody, activationDispatch,
  activationFlagsBody, activationTransport,
} from "../activate-swim-production";
import { ROUTES } from "../configure-swim-review";
import { DEPLOY_ROUTES } from "../deploy-swim-review";
import { PRODUCTION_ROUTES, productionDeploymentRoute } from "../swim-production-readonly-guards";
import { REVIEW } from "../swim-review-config-plan";

const sha = "c".repeat(40);
const env = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF_TYPE: "branch", GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_JOB: "activate-swim-production",
  GITHUB_SHA: sha, EXPECTED_SHA: sha, GITHUB_RUN_ID: "34820000000", GITHUB_RUN_ATTEMPT: "1",
  ACTIVATE_SWIM_PRODUCTION: "true", VERCEL_REVIEW_TOKEN: "SyntheticPrivateToken123456",
  ...Object.fromEntries(ACTIVATION_PROFILE.otherOperations.map((key) => [key, "false"])),
};
const inputs = () => ({
  activate_swim_production: "true", expected_sha: sha, review_upgrade_read_only: "true", production_readonly_scope: "preflight",
  ...Object.fromEntries(ACTIVATION_PROFILE.otherOperations.map((key) => [key.toLowerCase(), "false"])),
});
const project = {
  id: REVIEW.projectId, accountId: REVIEW.teamId, name: REVIEW.projectName, rootDirectory: "apps/web", framework: "nextjs",
  link: { type: "github", org: "drrowdev", repo: "hybrid-training-app", productionBranch: "main" },
  ssoProtection: { deploymentType: "all_except_custom_domains" },
};
const deployed = (id: string, readyState = "READY", createdAt = 1000) => ({
  id, projectId: REVIEW.projectId, ownerId: REVIEW.teamId, target: "production", readyState, createdAt,
  url: `hybrid-training-app-${id.toLowerCase().replaceAll("_", "-")}.vercel.app`,
  gitSource: { type: "github", ref: "main", sha: ACTIVATION_MAIN },
  meta: { githubCommitSha: ACTIVATION_MAIN, githubCommitRef: "main", githubCommitOrg: "drrowdev",
    githubCommitRepo: "hybrid-training-app" },
});
function fixture(options: { storageFails?: boolean; flagsWrong?: boolean; initialFlag?: boolean;
  buildFails?: boolean; buildNeverReady?: boolean; aliasWrong?: boolean; unrelatedChanges?: boolean;
  reviewAliasChanges?: boolean } = {}) {
  let now = 1000, created = false;
  const preview = { key: "POOL_SWIMMING_ENABLED", value: "PrivatePreviewCanary", type: "encrypted",
    target: ["preview"], gitBranch: REVIEW.branch, id: "preview", createdAt: 1, updatedAt: 1 };
  const credential = { key: "DATABASE_URL", value: "PrivateDatabaseCanary", type: "encrypted",
    target: ["production"], id: "credential", createdAt: 1, updatedAt: 1 };
  const rows = [preview, credential, ...(options.initialFlag ? [{
    ...credential, key: "POOL_SWIMMING_ENABLED", id: "existing", value: "false",
  }] : [])];
  const writes: { url: string; body: unknown }[] = [];
  const added = activationFlagsBody().map((row, index) =>
    ({ ...row, id: `new_${index}`, createdAt: 1000, updatedAt: 1000 }));
  const source = vi.fn(), storage = vi.fn(async () => { if (options.storageFails) throw new Error("PrivateStorageCanary"); });
  const request = async (url: string, method = "GET", body?: unknown): Promise<unknown> => {
    if (method === "POST") {
      writes.push({ url, body });
      if (url === ROUTES.create) {
        rows.push(...added);
        if (options.unrelatedChanges) credential.updatedAt = 2;
        return { created: options.flagsWrong ? added.map((row) => ({ ...row, value: "false" })) : added, failed: [] };
      }
      if (url === DEPLOY_ROUTES.create) {
        created = true; return deployed("dpl_New", options.buildFails ? "ERROR" : "BUILDING", now);
      }
      throw new Error("unexpected_write");
    }
    if (url === PRODUCTION_ROUTES.project) return project;
    if (url === PRODUCTION_ROUTES.projectEnv) return { envs: rows };
    if (url === PRODUCTION_ROUTES.sharedEnv) return { data: [], pagination: { count: 0, next: null } };
    if (url === ROUTES.alias) return { uid: "protected_alias", alias: REVIEW.proposedAlias,
      projectId: REVIEW.projectId, deploymentId: created && options.reviewAliasChanges ? "dpl_Changed" : "dpl_Protected" };
    if (url === PRODUCTION_ROUTES.alias) return {
      alias: "getsxc.app", projectId: REVIEW.projectId,
      deploymentId: created && !options.aliasWrong ? "dpl_New" : ACTIVATION_DEPLOYMENT,
    };
    if (url === productionDeploymentRoute(ACTIVATION_DEPLOYMENT)) return deployed(ACTIVATION_DEPLOYMENT);
    if (url === productionDeploymentRoute("dpl_New")) return deployed("dpl_New", options.buildNeverReady ? "BUILDING" : "READY");
    throw new Error("unexpected_read");
  };
  return { writes, source, storage, request, now: () => now, sleep: async (ms: number) => { now += ms; } };
}

describe("DC-SW3/SW5/SW8 bounded production swimming activation", () => {
  it("validates selected activation dispatches in prerequisite CI", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, unknown> };
    activationDispatch(event.inputs, process.env);
  });
  it("requires one exact feature-source operation and never deploys that feature source", () => {
    expect(activationDispatch(inputs(), env)).toBe(true);
    expect(activationContext(env)).toBe(sha);
    expect(ACTIVATION_PROFILE.expectedMain).toBe(ACTIVATION_MAIN);
    expect(activationDeploymentBody().gitSource).toMatchObject({ ref: "main", sha: ACTIVATION_MAIN });
    for (const key of ACTIVATION_PROFILE.otherOperations) {
      expect(() => activationDispatch({ ...inputs(), [key.toLowerCase()]: "true" }, env)).toThrow();
    }
    expect(() => activationDispatch({ ...inputs(), private: "canary" }, env)).toThrow();
    expect(() => activationContext({ ...env, GITHUB_REF: "refs/heads/main" })).toThrow();
    expect(() => activationContext({ ...env, GITHUB_RUN_ATTEMPT: "2" })).toThrow();
  });
  it("creates only five new production flags, preserves other settings and verifies the new ready alias", async () => {
    const deps = fixture(), result = await activateProductionSwimming(env, deps);
    expect(result.status).toBe("activation_pass");
    expect(result).toMatchObject({ storageVerified: true, databaseClosed: true, ready: true, aliasVerified: true,
      preserved: true, manualReconciliation: false, deployedSha: ACTIVATION_MAIN });
    expect(deps.writes).toEqual([
      { url: ROUTES.create, body: activationFlagsBody() }, { url: DEPLOY_ROUTES.create, body: activationDeploymentBody() },
    ]);
    expect(deps.storage).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toMatch(/Private|SyntheticPrivateToken/);
    expect(ACTIVATION_FLAGS).not.toContain("ENABLE_E2E_FIXTURES");
    expect(result.httpRequests).toBeLessThanOrEqual(60);
  });
  it.each([
    { storageFails: true }, { initialFlag: true },
  ])("refuses unsafe starting conditions before any write: %j", async (options) => {
    const deps = fixture(options), result = await activateProductionSwimming(env, deps);
    expect(result.status).toBe("failed"); expect(result.manualReconciliation).toBe(false);
    expect(deps.writes).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("Private");
  });
  it.each([
    { flagsWrong: true }, { unrelatedChanges: true },
    { buildFails: true }, { buildNeverReady: true }, { aliasWrong: true }, { reviewAliasChanges: true },
  ])("reports partial activation rather than retrying or hiding failures: %j", async (options) => {
    const deps = fixture(options), result = await activateProductionSwimming(env, deps);
    expect(result.status).toBe("failed"); expect(result.manualReconciliation).toBe(true);
    expect(result.flags.attempted).toBe(true);
    expect(deps.writes.filter((write) => write.url === ROUTES.create)).toHaveLength(1);
    expect(deps.writes.length).toBeLessThanOrEqual(2);
  });
  it("checks live source again before writes and treats a lost write response as uncertain", async () => {
    const changed = fixture();
    changed.source.mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error("changed_source"); });
    expect((await activateProductionSwimming(env, changed)).status).toBe("failed");
    expect(changed.writes).toHaveLength(0);
    const lost = fixture(), original = lost.request;
    lost.request = async (...args) => {
      if (args[1] === "POST") throw new Error("PrivateLostResponse");
      return original(...args);
    };
    const result = await activateProductionSwimming(env, lost);
    expect(result).toMatchObject({ status: "failed", flags: { attempted: true, confirmed: false }, manualReconciliation: true });
    expect(JSON.stringify(result)).not.toContain("PrivateLostResponse");
  });
  it("restricts HTTP writes, denies replay and caps reads", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      new Response(JSON.stringify(String(url) === DEPLOY_ROUTES.create ? deployed("dpl_New") : {})));
    const request = activationTransport(env, Date.now() + 60_000, fetcher);
    await expect(request(DEPLOY_ROUTES.create, "POST", activationDeploymentBody())).rejects.toThrow();
    await expect(request(ROUTES.auth, "PATCH", {})).rejects.toThrow();
    await expect(request(ROUTES.create, "POST", [{ key: "ENABLE_E2E_FIXTURES", value: "true" }])).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await request(ROUTES.create, "POST", activationFlagsBody());
    await expect(request(ROUTES.create, "POST", activationFlagsBody())).rejects.toThrow();
    await request(DEPLOY_ROUTES.create, "POST", activationDeploymentBody());
    await expect(request(DEPLOY_ROUTES.create, "POST", activationDeploymentBody())).rejects.toThrow();
    const bounded = activationTransport(env, Date.now() + 60_000, fetcher);
    for (let count = 0; count < 60; count += 1) await bounded(PRODUCTION_ROUTES.project);
    await expect(bounded(PRODUCTION_ROUTES.project)).rejects.toThrow("activation_http_boundary");
  });
  it("refuses local execution with a closed receipt before credentials or network", () => {
    const child = spawnSync(process.execPath, [require.resolve("tsx/cli"), resolve(__dirname, "../activate-swim-production.ts")], {
      encoding: "utf8", timeout: 20_000, env: { ...process.env, GITHUB_ACTIONS: "false",
        VERCEL_REVIEW_TOKEN: "PrivateCanary", SUPABASE_PROD_DB_URL: "PrivateCanary" },
    });
    expect(child.status).toBe(1); expect(child.stderr).toBe("");
    expect(child.stdout).toContain('"httpRequests":0'); expect(child.stdout).not.toContain("PrivateCanary");
  });
  it("keeps credentials final, uses a read-only transaction and serializes production changes", () => {
    const workflow = readFileSync(resolve(__dirname, "../../../../.github/workflows/ci.yml"), "utf8");
    const job = workflow.split("\n  activate-swim-production:\n")[1]!.split("\n  update-swim-production:\n")[0]!;
    const [before, operation] = job.split("      - name: Activate approved swimming features once\n");
    expect(before).toContain("needs: [ci, identity-guard]");
    expect(before).toContain("environment: Production");
    expect(before).toContain("group: production-database-migrations");
    expect(before).toContain("persist-credentials: false");
    expect(before).toContain("--check-source"); expect(before).not.toContain("secrets.");
    expect(operation!.match(/secrets\.\w+/g)).toHaveLength(2);
    const source = readFileSync(resolve(__dirname, "../activate-swim-production.ts"), "utf8");
    expect(source).toContain("ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(source).toContain("default_transaction_read_only: true");
    expect(source).not.toMatch(/\b(?:INSERT INTO|DELETE FROM|TRUNCATE|ALTER TABLE|GRANT EXECUTE)\b/);
    expect(job).not.toContain("upload-artifact");
  });
});
