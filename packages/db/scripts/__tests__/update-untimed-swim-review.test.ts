import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  checkUntimedDispatch, UNTIMED_FLAG_RECEIPT, UNTIMED_REVIEW as profile,
  untimedReceipt, untimedUpdateSummary, updateUntimedReview,
} from "../update-untimed-swim-review";
import { inspectUpgradeSnapshot, upgradeSnapshotTransport } from "../upgrade-swim-review";
import { untimedReviewMigrations, validateUntimedLedger } from "../untimed-swim-review-storage";
import { refresh, verifyRefreshSource } from "../refresh-swim-review";
import { ACCEPTED_DEPLOYMENT, BASE_SHA, CONFIGURATION, DEPLOY_ROUTES, deploymentRoute, RECEIPT, updateRoute } from "../deploy-swim-review";
import { OVERRIDE_KEYS, REVIEW, type EnvironmentMetadata } from "../swim-review-config-plan";
import { ROUTES } from "../configure-swim-review";

const sha = "b".repeat(40), canary = "SyntheticSensitiveCanary987654321";
const env: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF_TYPE: "branch", GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_SHA: sha,
  GITHUB_JOB: profile.job, EXPECTED_SHA: sha, UPDATE_UNTIMED_SWIM_REVIEW: "true", REVIEW_UPGRADE_READ_ONLY: "false",
  ...Object.fromEntries(profile.otherOperations.map((key) => [key, "false"])),
  SWIM_REVIEW_DATABASE_URL: `postgresql://postgres.${REVIEW.supabaseId}:${canary}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  VERCEL_REVIEW_TOKEN: canary, SUPABASE_REVIEW_MANAGEMENT_TOKEN: canary,
  SWIM_REVIEW_SUPABASE_ANON_KEY: `sb_publishable_${canary}`,
  SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${canary}`,
};
const inputs = () => ({
  update_untimed_swim_review: "true", review_upgrade_read_only: "false", expected_sha: sha,
  ...Object.fromEntries(profile.otherOperations.map((key) => [key.toLowerCase(), "false"])),
});
function harness() {
  const previous = profile.previous;
  const deployment = (id: string, url: string, source: string, time: number) => ({
    id, url, readyState: "READY", createdAt: time, projectId: REVIEW.projectId, ownerId: REVIEW.teamId, target: null,
    gitSource: { type: "github", ref: REVIEW.branch, sha: source },
    meta: { githubCommitSha: source, githubCommitRef: REVIEW.branch, githubCommitOrg: "drrowdev", githubCommitRepo: "hybrid-training-app" },
  });
  const project: EnvironmentMetadata[] = [
    ...OVERRIDE_KEYS.map((key): EnvironmentMetadata => ({
      id: RECEIPT[key], key, type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch,
      createdAt: CONFIGURATION.start + 1000,
      updatedAt: key === "NEXT_PUBLIC_BUILD_SHA" ? previous.start + 1000 :
        key === "POOL_SWIMMING_ENABLED" ? ACCEPTED_DEPLOYMENT.start + 1000 : CONFIGURATION.end - 1000,
    })),
    ...Object.entries(UNTIMED_FLAG_RECEIPT).map(([key, id]): EnvironmentMetadata => ({
      id, key, type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch,
      createdAt: previous.start + 1000, updatedAt: previous.start + 1000,
    })),
  ];
  const state = {
    project, now: previous.end + 60_000, ledger: 154,
    protection: { id: REVIEW.projectId, accountId: REVIEW.teamId, name: REVIEW.projectName,
      rootDirectory: "apps/web", framework: "nextjs",
      link: { type: "github", org: "drrowdev", repo: "hybrid-training-app", productionBranch: "main" },
      ssoProtection: { deploymentType: "all_except_custom_domains" } },
    old: deployment(previous.id, previous.url, previous.sha, previous.start + 1000),
    next: deployment("dpl_UntimedSynthetic123", "hybrid-training-app-untimed-synthetic.vercel.app", sha, previous.end + 60_000),
    alias: { uid: profile.aliasUid!, alias: REVIEW.proposedAlias, projectId: REVIEW.projectId,
      deploymentId: previous.id, redirect: null },
  };
  const request = vi.fn(async (url: string, method = "GET"): Promise<unknown> => {
    if (url === ROUTES.project) return state.protection;
    if (url === DEPLOY_ROUTES.team) return { id: REVIEW.teamId, slug: "drrowdevs-projects", billing: { plan: "hobby" } };
    if (url === ROUTES.supabase) return { id: REVIEW.supabaseId, name: REVIEW.supabaseName,
      organization_id: REVIEW.organizationId, region: REVIEW.region, status: "ACTIVE_HEALTHY" };
    if (url === ROUTES.project_env) return { envs: state.project, hiddenProductionEnvCount: 0 };
    if (url === ROUTES.shared_env) return { data: [], pagination: { count: 0, next: null } };
    if (url === ROUTES.auth) return { site_url: REVIEW.origin, uri_allow_list: `${REVIEW.origin}/auth/callback`, disable_signup: true };
    if (url === ROUTES.settings) return { external: { email: true, github: false } };
    if (url === ROUTES.alias) return state.alias;
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
    throw new Error(canary);
  });
  const source = vi.fn(), storage = vi.fn(async () => true);
  const deps = {
    source, snapshot: vi.fn(() => inspectUpgradeSnapshot(request, storage, profile)),
    inspectLedger: vi.fn(async (count: 154 | 155) => { if (state.ledger !== count) throw new Error(canary); }),
    append: vi.fn(async (guard: () => Promise<void>) => { await guard(); state.ledger = 155; await guard(); }),
    deploy: vi.fn(() => refresh(env, {
      source, request, storage, now: () => state.now, sleep: async (ms) => { state.now += ms; },
    }, profile)),
    close: vi.fn(async () => {}), now: () => state.now,
  };
  return { state, deps, request };
}

describe("DC-SW3/SW5/SW8 protected untimed-course update", () => {
  it("rejects mixed actual dispatches in prerequisite CI, before privileged jobs", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, unknown> };
    checkUntimedDispatch(event.inputs, process.env);
  });
  it("requires a new exact source and an explicit inspection/apply selection", () => {
    expect(checkUntimedDispatch(inputs(), { ...env, GITHUB_JOB: "ci" })).toBe(true);
    expect(checkUntimedDispatch(undefined, env)).toBe(false);
    for (const value of [undefined, null, true, "unknown"]) {
      expect(() => checkUntimedDispatch({ ...inputs(), review_upgrade_read_only: value }, env)).toThrow();
    }
    expect(() => checkUntimedDispatch({ ...inputs(), expected_sha: profile.reference.sha }, { ...env, GITHUB_SHA: profile.reference.sha })).toThrow();
    expect(() => checkUntimedDispatch({ ...inputs(), unexpected: "false" }, env)).toThrow();
  });
  it.each(profile.otherOperations)("rejects mixed or omitted %s", (key) => {
    for (const value of ["true", undefined, true]) {
      expect(() => checkUntimedDispatch({ ...inputs(), [key.toLowerCase()]: value }, env)).toThrow();
    }
  });
  it.each(["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REF_TYPE", "GITHUB_REF", "GITHUB_SHA"])("rejects %s drift", (key) => {
    expect(() => checkUntimedDispatch(inputs(), { ...env, [key]: "wrong" })).toThrow();
  });
  it("keeps application, migrations, dirty trees, symlinks and live refs outside the allowed tooling delta", () => {
    const io = {
      event: () => ({ inputs: inputs() }), regular: () => true,
      git: (...args: string[]) => {
        if (args[0] === "rev-parse") return sha;
        if (args[0] === "status" || args[0] === "merge-base") return "";
        if (args[0] === "diff") return profile.paths.join("\n");
        if (args[0] === "ls-tree") return profile.paths.map((path) => `100644 blob ${sha}\t${path}`).join("\n");
        if (args[0] === "ls-remote") return `${args.at(-1) === "refs/heads/main" ? BASE_SHA : sha}\t${args.at(-1)}`;
        throw new Error(canary);
      },
    };
    expect(() => verifyRefreshSource(env, io, profile)).not.toThrow();
    expect(() => verifyRefreshSource(env, { ...io, regular: () => false }, profile)).toThrow();
    for (const [command, value] of [
      ["diff", "packages/db/drizzle/0154_swim_untimed_courses.sql"], ["diff", "apps/web/src/app/page.tsx"],
      ["status", " M app.ts"], ["ls-remote", "changed"], ["ls-tree", `120000 blob ${sha}\tsource`],
    ]) expect(() => verifyRefreshSource(env, { ...io, git: (...args) => args[0] === command ? value! : io.git(...args) }, profile)).toThrow();
  });
  it("requires all existing feature IDs/scopes/timestamps without creating or modifying flags", () => {
    const { state } = harness();
    expect(() => untimedReceipt(state.project, [])).not.toThrow();
    const changes: Partial<EnvironmentMetadata>[] = [
      { gitBranch: "main" }, { target: ["production"] }, { id: "wrong" }, { updatedAt: profile.previous.end + 1 },
    ];
    for (const key of Object.keys(UNTIMED_FLAG_RECEIPT)) {
      for (const change of changes) {
        const rows = state.project.map((row) => row.key === key ? { ...row, ...change } : row);
        expect(() => untimedReceipt(rows, [])).toThrow();
      }
    }
    expect(() => untimedReceipt([...state.project, state.project[0]!], [])).toThrow();
  });
  it("checks the full canonical154 prefix and155 result, not just the last ledger row", () => {
    expect(untimedReviewMigrations).toThrow("migration_source");
    const migrations = readMigrationFiles({ migrationsFolder: resolve(__dirname, "../../drizzle") }).slice(0, 155);
    const rows = migrations.map((entry, index) => ({ id: index + 10, hash: entry.hash, created_at: String(entry.folderMillis) }));
    expect(() => validateUntimedLedger(rows.slice(0, 154), migrations, 154)).not.toThrow();
    expect(() => validateUntimedLedger(rows, migrations, 155)).not.toThrow();
    expect(() => validateUntimedLedger(rows, migrations, 154)).toThrow();
    for (const value of [rows.slice(1), [...rows, rows[0]], rows.map((row, index) => index === 30 ? { ...row, hash: "0".repeat(64) } : row)]) {
      expect(() => validateUntimedLedger(value, migrations, 155)).toThrow();
    }
  });
  it("inspects without any database/environment/deployment write", async () => {
    const h = harness(), result = await updateUntimedReview({ ...env, REVIEW_UPGRADE_READ_ONLY: "true" }, h.deps);
    expect(result).toMatchObject({ status: "inspection_pass", migrations: { attempted: false }, databaseClosed: true, partial: false });
    expect(h.deps.append).not.toHaveBeenCalled(); expect(h.deps.deploy).not.toHaveBeenCalled();
    expect(h.request.mock.calls.every(([, method]) => method === undefined || method === "GET")).toBe(true);
  });
  it("migrates once before the real guarded refresh, preserving protection and alias identity", async () => {
    const h = harness(), result = await updateUntimedReview(env, h.deps);
    expect(result).toMatchObject({
      status: "upgrade_pass", migrations: { before: 154, after: 155, attempted: true, committed: true, verified: true },
      deployment: { status: "refresh_pass", ready: true, protectedUnchanged: true, authMatches: true, isolationVerified: true },
      databaseClosed: true, partial: false,
    });
    expect(h.deps.append).toHaveBeenCalledOnce(); expect(h.deps.deploy).toHaveBeenCalledOnce();
    expect(h.deps.append.mock.invocationCallOrder[0]).toBeLessThan(h.deps.deploy.mock.invocationCallOrder[0]!);
    expect(h.state.alias.deploymentId).toBe(h.state.next.id);
    expect(h.request.mock.calls.filter(([, method]) => method && method !== "GET").map(([url]) => url))
      .toEqual([updateRoute("NEXT_PUBLIC_BUILD_SHA"), DEPLOY_ROUTES.create, deploymentRoute(h.state.next.id, true)]);
  });
  it.each(["source", "snapshot", "inspectLedger", "append", "deploy", "close"] as const)("does not hide a %s failure behind cleanup", async (method) => {
    const h = harness();
    h.deps[method].mockImplementationOnce(() => { throw new Error(canary); });
    const result = await updateUntimedReview(env, h.deps);
    expect(result.status).toBe("failed");
    expect(result.stages.some((stage) => stage.status === "failed")).toBe(true);
    expect(untimedUpdateSummary(result)).not.toContain(canary);
    if (["source", "snapshot", "inspectLedger", "append"].includes(method)) expect(h.deps.deploy).not.toHaveBeenCalled();
  });
  it("refuses changed protected metadata before any migration", async () => {
    const h = harness(), snapshot = h.deps.snapshot.getMockImplementation()!;
    h.deps.snapshot.mockImplementationOnce(snapshot).mockImplementationOnce(async () => {
      h.state.protection.ssoProtection.deploymentType = "all";
      return snapshot();
    });
    expect((await updateUntimedReview(env, h.deps)).status).toBe("failed");
    expect(h.deps.append).not.toHaveBeenCalled();
  });
  it("never lets read-only snapshot transport mutate settings or create a deployment", () => {
    const fetcher = vi.fn<typeof fetch>(), request = upgradeSnapshotTransport(env, Date.now() + 60_000, fetcher, profile);
    for (const url of [ROUTES.auth, ROUTES.create, DEPLOY_ROUTES.create, updateRoute("NEXT_PUBLIC_BUILD_SHA")]) {
      expect(() => request(url, "POST", {})).toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("emits one closed CLI refusal before credentials outside the authorized job", () => {
    const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/update-untimed-swim-review.ts", "--check-source"], {
      cwd: resolve(__dirname, "../.."), encoding: "utf8",
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, EXPECTED_SHA: sha }, timeout: 15000,
    });
    expect(child.status).toBe(1);
    expect(child.stdout.match(/SWIM_UNTIMED_REVIEW_SUMMARY/g)).toHaveLength(1);
    expect(child.stdout).not.toContain(canary);
    expect(child.stderr).toBe("");
  });
  it("pins prior jobs and the modular selector, and gates the update before five credentials", () => {
    const workflow = readFileSync(resolve(__dirname, "../../../../.github/workflows/ci.yml"), "utf8").replaceAll("\r\n", "\n");
    // Prior bodies plus the explicit modular acceptance selector; shallow-checkout safe.
    const baseline = {
      "identity-guard": "35779b9424f98e571769068bcf1bbff818aff147c51eb178bd83438bc267e479",
      ci: "4724e763613720c466c5d4fc2f38986dc49d564f33b9b8c838e89a0a66636944",
      e2e: "e914376e6fd30d96f046e1b42ac3a369122dd55d4c338f8bdf48de43d7cb1614",
      "rpc-smoke": "b75d4c6c69f7ac4ae8380d117c4776352d21d358df5db6e56fceb7e6782438e3",
      "swim-acceptance": "0bd16b671a0d2e40f04ead2c0687001902486b21f9f1ad1d3877fbca99ee4a1b",
      "prod-migrate": "4c3643cb734fcaeb1f70d97b5f12590f84684fb7625f7d6b3fe3eb15e6272a06",
      "prod-drift": "fe7c0ca259846a82aa0612ef08135411618c75c22bad3bb9f23cf3e6cf6e4f12",
      "prepare-swim-review": "ef39894054b135464e2743bf958d6f98776935347a6f227e36fa34040fd1d715",
      "configure-swim-review": "c373b86bd0e3e74ad671d7fce30d30a302db1d2366367644878f46b6ce10f345",
      "deploy-swim-review": "d15657fbd9d284dfde7265111866e9cd980e96be7c91751f99d509cd2d92e6db",
      "upgrade-swim-review": "90f619776def70d737c7b46442f7b6efe8d114a8918d27aa6181f95656466c58",
      "refresh-swim-readonly-review": "ba6abb775af015b61cd5d85529775f6d2ed77a3c32ddf2344ee4966086d42411",
      "refresh-swim-plan-review": "da73ff93c546891102d80428b0ea9130bbc88a669c143dc22e5f3e2b692eebaa",
      "refresh-swim-review": "57cb6bec277ae7b6ab42c51ff51bbe58dbc9d07df7c7abea223c40561858f880",
    };
    const jobs = (text: string) => {
      const body = text.split("\njobs:\n")[1];
      if (!body) throw new Error("Workflow jobs missing");
      return new Map([...("\n" + body).matchAll(/\n  ([a-z][a-z0-9-]+):\n([\s\S]*?)(?=\n  [a-z][a-z0-9-]+:\n|$)/g)]
        .map((match) => [match[1]!, createHash("sha256").update(match[2]!).digest("hex")]));
    };
    const current = jobs(workflow);
    for (const [name, hash] of Object.entries(baseline)) expect(current.get(name), name).toBe(hash);
    const job = workflow.split("\n  update-untimed-swim-review:\n")[1]!;
    for (const gate of ["needs: [ci, identity-guard]", "environment: swim-review", "group: swim-review-bootstrap",
      "cancel-in-progress: false", "persist-credentials: false", "inputs.expected_sha != '' && inputs.expected_sha == github.sha",
      ...profile.otherOperations.map((key) => `inputs.${key.toLowerCase()} == false`)]) expect(job).toContain(gate);
    const [before, operation] = job.split("      - name: Update protected untimed review once\n");
    expect(before).not.toContain("secrets."); expect(before).toContain("--check-source");
    expect(operation!.match(/secrets\.\w+/g)).toHaveLength(5);
  });
});
