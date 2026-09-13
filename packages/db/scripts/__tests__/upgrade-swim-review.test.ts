import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  checkUpgradeDispatch, UPGRADE_FLAGS, UPGRADE_REVIEW, upgradeFlagBody,
  upgradeFlagTransport, upgradeReview, upgradeSummary,
} from "../upgrade-swim-review";
import { reviewMigrations, validateReviewLedger } from "../upgrade-swim-review-storage";
import { refresh, verifyRefreshSource } from "../refresh-swim-review";
import {
  ACCEPTED_DEPLOYMENT, BASE_SHA, CONFIGURATION, DEPLOY_ROUTES, RECEIPT, deploymentRoute, updateRoute,
} from "../deploy-swim-review";
import { metadata, ROUTES } from "../configure-swim-review";
import { OVERRIDE_KEYS, REVIEW, type EnvironmentMetadata } from "../swim-review-config-plan";

const sha = "b".repeat(40), canary = "SyntheticSensitiveCanary987654321";
const env: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF_TYPE: "branch", GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_SHA: sha,
  GITHUB_JOB: "upgrade-swim-review", EXPECTED_SHA: sha, UPGRADE_SWIM_REVIEW: "true",
  ...Object.fromEntries(UPGRADE_REVIEW.otherOperations.map((key) => [key, "false"])),
  SWIM_REVIEW_DATABASE_URL: `postgresql://postgres.${REVIEW.supabaseId}:${canary}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  VERCEL_REVIEW_TOKEN: canary, SUPABASE_REVIEW_MANAGEMENT_TOKEN: canary,
  SWIM_REVIEW_SUPABASE_ANON_KEY: `sb_publishable_${canary}`,
  SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${canary}`,
};
const inputs = () => ({
  upgrade_swim_review: "true", expected_sha: sha,
  ...Object.fromEntries(UPGRADE_REVIEW.otherOperations.map((key) => [key.toLowerCase(), "false"])),
});
function harness() {
  const previous = UPGRADE_REVIEW.previous;
  const deployment = (id: string, url: string, source: string, time: number) => ({
    id, url, readyState: "READY", createdAt: time, projectId: REVIEW.projectId, ownerId: REVIEW.teamId, target: null,
    gitSource: { type: "github", ref: REVIEW.branch, sha: source },
    meta: { githubCommitSha: source, githubCommitRef: REVIEW.branch,
      githubCommitOrg: "drrowdev", githubCommitRepo: "hybrid-training-app" },
  });
  const project: EnvironmentMetadata[] = OVERRIDE_KEYS.map((key) => ({
    id: RECEIPT[key], key, type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch,
    createdAt: CONFIGURATION.start + 1000,
    updatedAt: key === "NEXT_PUBLIC_BUILD_SHA" ? previous.start + 1000 :
      key === "POOL_SWIMMING_ENABLED" ? ACCEPTED_DEPLOYMENT.start + 1000 : CONFIGURATION.end - 1000,
  }));
  const state = {
    now: previous.end + 60_000, project,
    protection: { id: REVIEW.projectId, accountId: REVIEW.teamId, name: REVIEW.projectName,
      rootDirectory: "apps/web", framework: "nextjs",
      link: { type: "github", org: "drrowdev", repo: "hybrid-training-app", productionBranch: "main" },
      ssoProtection: { deploymentType: "all_except_custom_domains" } },
    team: { id: REVIEW.teamId, slug: "drrowdevs-projects", billing: { plan: "hobby" } },
    database: { id: REVIEW.supabaseId, name: REVIEW.supabaseName, organization_id: REVIEW.organizationId,
      region: REVIEW.region, status: "ACTIVE_HEALTHY" },
    auth: { site_url: REVIEW.origin, uri_allow_list: `${REVIEW.origin}/auth/callback`, disable_signup: true },
    settings: { external: { email: true, github: false } },
    old: deployment(previous.id, previous.url, previous.sha, previous.start + 1000),
    next: deployment("dpl_UpgradeSynthetic123", "hybrid-training-app-upgrade-synthetic.vercel.app", sha, previous.end + 60_000),
    alias: { uid: UPGRADE_REVIEW.aliasUid!, alias: REVIEW.proposedAlias, projectId: REVIEW.projectId,
      deploymentId: previous.id, redirect: null },
  };
  const request = vi.fn(async (url: string, method = "GET", _body?: unknown): Promise<unknown> => {
    if (url === ROUTES.project) return state.protection;
    if (url === DEPLOY_ROUTES.team) return state.team;
    if (url === ROUTES.supabase) return state.database;
    if (url === ROUTES.project_env) return { envs: state.project, hiddenProductionEnvCount: 0 };
    if (url === ROUTES.shared_env) return { data: [], pagination: { count: 0, next: null } };
    if (url === ROUTES.auth) return state.auth;
    if (url === ROUTES.settings) return state.settings;
    if (url === ROUTES.alias) return state.alias;
    if (url === ROUTES.storage) return true;
    if (url === deploymentRoute(previous.id)) return state.old;
    if (url === updateRoute("NEXT_PUBLIC_BUILD_SHA") && method === "PATCH") {
      const index = state.project.findIndex((row) => row.id === RECEIPT.NEXT_PUBLIC_BUILD_SHA);
      state.project[index] = { ...state.project[index]!, updatedAt: state.now };
      return state.project[index];
    }
    if (url === DEPLOY_ROUTES.create || url === deploymentRoute(state.next.id)) return state.next;
    if (url === deploymentRoute(state.next.id, true)) {
      const oldDeploymentId = state.alias.deploymentId;
      state.alias.deploymentId = state.next.id;
      return { alias: state.alias.alias, uid: state.alias.uid, oldDeploymentId };
    }
    throw Error(canary);
  });
  const source = vi.fn(), storage = vi.fn(async () => true);
  const deps: Parameters<typeof upgradeReview>[1] = {
    source, request, storage,
    createFlags: vi.fn(async () => {
      const created = upgradeFlagBody().map((body, index) => metadata({
        ...body, id: `flag_${index}`, createdAt: state.now, updatedAt: state.now,
      }));
      state.project.push(...created);
      return { created, failed: [] };
    }),
    inspectLedger: vi.fn(async () => {}),
    append: vi.fn(async (guard) => { for (let i = 0; i < 5; i++) await guard(); }),
    close: vi.fn(async () => {}),
    now: () => state.now,
    deploy: vi.fn((profile) => refresh(env, {
      source, request, storage, now: () => state.now, sleep: async (ms) => { state.now += ms; },
    }, profile)),
  };
  return { state, deps, request };
}

describe("approved existing-data review upgrade", () => {
  it("rejects mixed dispatches in actual prerequisite CI before any privileged job", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, unknown> };
    checkUpgradeDispatch(event.inputs, process.env);
  });
  it("checks the real CI context without impersonating the privileged job", () => {
    expect(checkUpgradeDispatch(inputs(), { ...env, GITHUB_JOB: "ci" })).toBe(true);
    expect(checkUpgradeDispatch(undefined, env)).toBe(false);
    expect(checkUpgradeDispatch({ upgrade_swim_review: "false", refresh_swim_review: "true" }, env)).toBe(false);
  });
  it.each(UPGRADE_REVIEW.otherOperations)("rejects mixed or missing %s in prerequisite CI", (key) => {
    for (const value of ["true", undefined, true]) {
      const mixed = inputs();
      Reflect.set(mixed, key.toLowerCase(), value);
      expect(() => checkUpgradeDispatch(mixed, env)).toThrow();
    }
  });
  it.each(["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REF_TYPE", "GITHUB_REF", "GITHUB_SHA"])(
    "refuses %s context drift", (key) => expect(() => checkUpgradeDispatch(inputs(), { ...env, [key]: "wrong" })).toThrow());
  it("requires a new exact reviewed source and rejects unknown operation inputs", () => {
    expect(() => checkUpgradeDispatch({ ...inputs(), unexpected: "true" }, env)).toThrow();
    expect(() => checkUpgradeDispatch({ ...inputs(), upgrade_swim_review: true }, env)).toThrow();
    expect(() => checkUpgradeDispatch({ ...inputs(), expected_sha: UPGRADE_REVIEW.reference.sha },
      { ...env, GITHUB_SHA: UPGRADE_REVIEW.reference.sha })).toThrow();
  });
  it("reuses whole-source/head/base/symlink guards without admitting application or migration edits", () => {
    const io = {
      event: () => ({ inputs: inputs() }), regular: () => true,
      git: (...args: string[]) => {
        if (args[0] === "rev-parse") return sha;
        if (args[0] === "status" || args[0] === "merge-base") return "";
        if (args[0] === "diff") return UPGRADE_REVIEW.paths.join("\n");
        if (args[0] === "ls-tree") return UPGRADE_REVIEW.paths.map((path) => `100644 blob ${sha}\t${path}`).join("\n");
        if (args[0] === "ls-remote") return `${args[3] === "refs/heads/main" ? BASE_SHA : sha}\t${args[3]}`;
        throw Error(canary);
      },
    };
    expect(() => verifyRefreshSource(env, io, UPGRADE_REVIEW)).not.toThrow();
    expect(() => verifyRefreshSource(env, { ...io, regular: () => false }, UPGRADE_REVIEW)).toThrow();
    for (const path of ["apps/web/src/app/page.tsx", "packages/db/drizzle/0152_swim_private_courses.sql"]) {
      expect(() => verifyRefreshSource(env, { ...io, git: (...args) => args[0] === "diff" ? path : io.git(...args) }, UPGRADE_REVIEW)).toThrow();
    }
  });
  it("validates every ledger hash and timestamp, preserving legitimate sequence gaps", () => {
    const migrations = reviewMigrations();
    const rows = migrations.map((entry, index) => ({ id: index + 10, hash: entry.hash, created_at: String(entry.folderMillis) }));
    expect(() => validateReviewLedger(rows.slice(0, 150), migrations, 150)).not.toThrow();
    expect(() => validateReviewLedger(rows, migrations, 154)).not.toThrow();
    for (const change of [
      rows.slice(0, 149), rows.slice(0, 151),
      rows.slice(0, 150).map((row, index) => index === 42 ? { ...row, hash: "0".repeat(64) } : row),
      rows.slice(0, 150).map((row, index) => index === 42 ? { ...row, created_at: "1" } : row),
      rows.slice(0, 150).map((row, index) => index === 42 ? { ...row, id: 1 } : row),
    ]) expect(() => validateReviewLedger(change, migrations, 150)).toThrow();
  });
  it("migrates before enabling branch-only features and reuses the guarded exact-SHA deployment", async () => {
    const h = harness(), result = await upgradeReview(env, h.deps);
    expect(result.status).toBe("upgrade_pass");
    expect(result.migrations).toEqual({ before: 150, after: 154, attempted: true, committed: true, verified: true });
    expect(h.deps.inspectLedger).toHaveBeenNthCalledWith(1, 150);
    expect(h.deps.inspectLedger).toHaveBeenNthCalledWith(2, 154);
    expect(h.deps.createFlags).toHaveBeenCalledTimes(1);
    expect(h.deps.createFlags).toHaveBeenCalledWith(ROUTES.create, "POST", upgradeFlagBody());
    expect(h.deps.append).toHaveBeenCalledTimes(1);
    expect(h.deps.deploy).toHaveBeenCalledTimes(1);
    expect(result.deployment).toMatchObject({ status: "refresh_pass", ready: true, protectedUnchanged: true });
    expect(result.databaseClosed).toBe(true);
    expect(h.state.alias.deploymentId).toBe(h.state.next.id);
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(h.request.mock.calls.filter(([, method]) => method === "POST").map(([url]) => url))
      .toEqual([DEPLOY_ROUTES.create, deploymentRoute(h.state.next.id, true)]);
  });
  it.each(["receipt", "protection", "auth", "alias", "previous", "storage", "ledger"] as const)(
    "refuses %s before migration or flag creation", async (kind) => {
      const h = harness();
      if (kind === "receipt") h.state.project[0]!.updatedAt = UPGRADE_REVIEW.previous.end + 1;
      if (kind === "protection") h.state.protection.ssoProtection.deploymentType = "all";
      if (kind === "auth") h.state.auth.disable_signup = false;
      if (kind === "alias") h.state.alias.deploymentId = "dpl_Other";
      if (kind === "previous") h.state.old.readyState = "BUILDING";
      if (kind === "storage") h.deps.storage = vi.fn(async () => false);
      if (kind === "ledger") h.deps.inspectLedger = vi.fn(async () => { throw Error(canary); });
      const result = await upgradeReview(env, h.deps);
      expect(result.status).toBe("failed");
      expect(h.deps.append).not.toHaveBeenCalled();
      expect(h.deps.createFlags).not.toHaveBeenCalled();
      expect(h.deps.deploy).not.toHaveBeenCalled();
      expect(result.databaseClosed).toBe(true);
      expect(upgradeSummary(result)).not.toContain(canary);
    },
  );
  it.each(["append", "createFlags", "deploy", "close"] as const)(
    "retains failed %s even when cleanup succeeds, without retries or deletion", async (operation) => {
      const h = harness();
      h.deps[operation] = vi.fn(async () => { throw Error(canary); });
      const result = await upgradeReview(env, h.deps);
      expect(result.status).toBe("failed");
      expect(result.partial).toBe(true);
      expect(result.manualReconciliation).toBe(true);
      expect(h.deps[operation]).toHaveBeenCalledTimes(1);
      expect(h.request.mock.calls.some(([, method]) => method === "DELETE")).toBe(false);
      expect(upgradeSummary(result)).not.toContain(canary);
    },
  );
  it("rechecks protection during migration and after creating flags", async () => {
    const h = harness();
    h.deps.append = vi.fn(async (guard) => { h.state.auth.disable_signup = false; await guard(); });
    expect((await upgradeReview(env, h.deps)).status).toBe("failed");
    expect(h.deps.createFlags).not.toHaveBeenCalled();
    const second = harness(), create = second.deps.createFlags;
    second.deps.createFlags = async (...args) => {
      const result = await create(...args);
      second.state.project[0]!.updatedAt++;
      return result;
    };
    expect((await upgradeReview(env, second.deps)).status).toBe("failed");
    expect(second.deps.deploy).not.toHaveBeenCalled();
  });
  it("retains confirmed partial flag identities without treating uncertain writes as absent", async () => {
    const h = harness();
    h.deps.createFlags = vi.fn(async () => ({ created: [{
      ...upgradeFlagBody()[0], id: "partial_flag", createdAt: h.state.now, updatedAt: h.state.now,
    }], failed: [{ error: { key: UPGRADE_FLAGS[1] } }] }));
    const result = await upgradeReview(env, h.deps);
    expect(result.status).toBe("failed");
    expect(result.flags).toEqual({ attempted: true, confirmed: false,
      entries: [{ id: "partial_flag", key: UPGRADE_FLAGS[0] }] });
    expect(result.migrations.committed).toBe(true);
    expect(h.deps.deploy).not.toHaveBeenCalled();
    const second = harness();
    second.deps.createFlags = vi.fn(async () => { throw Error(canary); });
    expect((await upgradeReview(env, second.deps)).flags.entries).toBeNull();
  });
  it("allows exactly one fixed flag creation, never overwrites, production, Auth changes or ambiguous retries", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw Error(canary); });
    const transport = upgradeFlagTransport(env, Date.now() + 60_000, fetcher);
    for (const body of [
      upgradeFlagBody().slice(0, 3),
      upgradeFlagBody().map((row) => ({ ...row, target: ["production"] })),
      upgradeFlagBody().map((row) => ({ ...row, gitBranch: "main" })),
      upgradeFlagBody().map((row) => ({ ...row, value: "false" })),
    ]) await expect(transport(ROUTES.create, "POST", body)).rejects.toThrow();
    await expect(transport(ROUTES.auth, "PATCH", {})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(transport(ROUTES.create, "POST", upgradeFlagBody())).rejects.toThrow();
    await expect(transport(ROUTES.create, "POST", upgradeFlagBody())).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(ROUTES.create).toContain("upsert=false");
  });
  it("uses bounded metadata-only SQL and leaves historical bootstrap unchanged", () => {
    const storage = readFileSync(resolve(__dirname, "../upgrade-swim-review-storage.ts"), "utf8");
    expect(storage).toContain("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
    expect(storage).toContain("await sql.begin");
    expect(storage).toContain("SET LOCAL ROLE authenticated");
    expect(storage).not.toMatch(/DELETE FROM|UPDATE .*__drizzle_migrations|CREATE SCHEMA|CREATE TABLE|FROM auth\.users|FROM public\.swim_(?:plans|workouts)/);
    const bootstrap = readFileSync(resolve(__dirname, "../prepare-swim-review.ts"), "utf8");
    expect(bootstrap).toContain("journal.entries.length === 150");
  });
  it("emits one marked closed refusal before credentials outside the authorized runtime", () => {
    const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/upgrade-swim-review.ts", "--check-source"], {
      cwd: resolve(__dirname, "../.."), encoding: "utf8",
      env: { PATH: process.env.PATH, EXPECTED_SHA: sha, SWIM_REVIEW_DATABASE_URL: canary },
      timeout: 15_000,
    });
    expect(child.status).toBe(1);
    expect(child.stderr).toBe("");
    expect(child.stdout).not.toContain(canary);
    expect(child.stdout.match(/SWIM_REVIEW_UPGRADE_SUMMARY/g)).toHaveLength(1);
    const content = /<pre>([\s\S]+)<\/pre>/.exec(child.stdout)![1]!;
    const record = JSON.parse(content.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
    expect(record).toMatchObject({ status: "failed", project: REVIEW.supabaseId, testedSha: sha,
      migrations: { attempted: false }, flags: { attempted: false }, deployment: null });
  });
  it("puts the new job behind exact context, both prerequisites, shared lock and credential-free checks", () => {
    const workflow = readFileSync(resolve(__dirname, "../../../../.github/workflows/ci.yml"), "utf8");
    const job = workflow.split("\n  upgrade-swim-review:\n")[1]!.split("\n  refresh-swim-readonly-review:\n")[0]!;
    for (const value of [
      "needs: [ci, identity-guard]", "environment: swim-review", "group: swim-review-bootstrap",
      "cancel-in-progress: false", "persist-credentials: false", "inputs.upgrade_swim_review == true",
      "inputs.expected_sha != '' && inputs.expected_sha == github.sha", "timeout-minutes: 25",
      ...UPGRADE_REVIEW.otherOperations.map((key) => `inputs.${key.toLowerCase()} == false`),
    ]) expect(job).toContain(value);
    const [before, operation] = job.split("      - name: Upgrade existing protected review once\n");
    expect(before).not.toContain("secrets.");
    expect(before).toContain("--check-source");
    expect(operation!.match(/secrets\.\w+/g)).toHaveLength(5);
    expect(UPGRADE_FLAGS).toHaveLength(4);
  });
});
