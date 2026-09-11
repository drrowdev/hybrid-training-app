import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CONFIGURATION_PATHS, ROUTES, environmentList } from "../configure-swim-review";
import { APPLICATION_SHA } from "../prepare-swim-review";
import { INHERITED_KEYS, OVERRIDE_KEYS, REVIEW, type EnvironmentMetadata } from "../swim-review-config-plan";
import {
  acceptedReceipt, BASE_SHA, CONFIGURATION, deploy, deploymentContext, deploymentMetadata, inspectIsolation, INSPECTION_ROUTES,
  deploymentRoute, deploymentTransport, DEPLOY_ROUTES, RECEIPT, updateRoute, verifyDeploymentSource,
} from "../deploy-swim-review";

const sha = "b".repeat(40);
const canary = "offline_sensitive_canary_not_for_output_1234";
const modes = ["CONFIGURE_SWIM_REVIEW", "INSPECT_SWIM_REVIEW_AUTH", "PREPARE_SWIM_REVIEW",
  "INSPECT_SWIM_REVIEW", "SWIM_ACCEPTANCE", "MIGRATE_PRODUCTION", "ALLOW_UNDEPLOYED"];
const env: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF_TYPE: "branch", GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_JOB: "deploy-swim-review",
  GITHUB_SHA: sha, EXPECTED_SHA: sha, DEPLOY_SWIM_REVIEW: "true", INSPECT_SWIM_REVIEW_DEPLOYMENT: "false",
  ...Object.fromEntries(modes.map((key) => [key, "false"])),
  VERCEL_REVIEW_TOKEN: canary, SUPABASE_REVIEW_MANAGEMENT_TOKEN: canary,
  SWIM_REVIEW_SUPABASE_ANON_KEY: `sb_publishable_${canary}`,
  SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${canary}`,
  SWIM_REVIEW_DATABASE_URL: `postgresql://postgres.whwilnhqfiaquwxgkxwt:${canary}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres?sslmode=require`,
};
const inputs = { deploy_swim_review: "true", inspect_swim_review_deployment: "false", expected_sha: sha,
  ...Object.fromEntries(modes.map((key) => [key.toLowerCase(), "false"])) };
function receipt(): EnvironmentMetadata[] {
  return OVERRIDE_KEYS.map((key) => ({ id: RECEIPT[key], key, type: "encrypted",
    target: ["preview"], gitBranch: REVIEW.branch, createdAt: CONFIGURATION.start + 1000, updatedAt: CONFIGURATION.end - 1000 }));
}
function sourceIO() {
  return {
    event: () => ({ inputs }),
    regular: () => true,
    git: vi.fn((...args: string[]) => {
      if (args[0] === "rev-parse") return sha;
      if (args[0] === "status" || args[0] === "merge-base") return "";
      if (args[0] === "diff") return CONFIGURATION_PATHS.join("\n");
      if (args[0] === "ls-tree") return "100644 blob offline";
      if (args[0] === "ls-remote") return `${args[3] === "refs/heads/main" ? BASE_SHA : sha}\t${args[3]}`;
      throw Error(canary);
    }),
  };
}
function harness() {
  const state = {
    now: CONFIGURATION.end + 60_000, project: receipt(),
    shared: INHERITED_KEYS.map((key) => ({ key, id: `shared_${key}`, target: ["preview"] as EnvironmentMetadata["target"],
      gitBranch: null, type: "encrypted" as const, createdAt: 1, updatedAt: 1 })) as EnvironmentMetadata[],
    auth: { site_url: REVIEW.origin, uri_allow_list: `${REVIEW.origin}/auth/callback`, disable_signup: true },
    settings: { updatedAt: 123, id: REVIEW.projectId, accountId: REVIEW.teamId, name: REVIEW.projectName,
      rootDirectory: "apps/web", framework: "nextjs",
      link: { type: "github", org: "drrowdev", repo: "hybrid-training-app", productionBranch: "main" },
      ssoProtection: { deploymentType: "all" }, passwordProtection: null, trustedIps: null },
    deployment: { id: "dpl_Offline123", url: "hybrid-training-app-web-offline.vercel.app", readyState: "QUEUED",
      createdAt: CONFIGURATION.end + 60_000,
      gitSource: { type: "github", ref: REVIEW.branch, sha },
      projectId: REVIEW.projectId, ownerId: REVIEW.teamId, target: null as string | null,
      meta: { githubCommitSha: sha, githubCommitRef: REVIEW.branch, githubCommitOrg: "drrowdev", githubCommitRepo: "hybrid-training-app" } },
    alias: false, polls: 0,
  };
  const request = vi.fn(async (url: string, method = "GET", body?: unknown): Promise<unknown> => {
    if (url === ROUTES.project) return state.settings;
    if (url === DEPLOY_ROUTES.team) return { id: REVIEW.teamId, slug: "drrowdevs-projects", billing: { plan: "hobby" } };
    if (url === ROUTES.supabase) return { id: REVIEW.supabaseId, name: REVIEW.supabaseName,
      organization_id: REVIEW.organizationId, region: REVIEW.region, status: "ACTIVE_HEALTHY" };
    if (url === ROUTES.project_env) return { envs: state.project, hiddenProductionEnvCount: 0 };
    if (url === ROUTES.shared_env) return { data: state.shared, pagination: { count: state.shared.length, next: null } };
    if (url === ROUTES.auth) return state.auth;
    if (url === ROUTES.settings) return { external: { email: true, github: false } };
    if (url === ROUTES.alias) return state.alias ? { uid: "alias_offline", alias: REVIEW.proposedAlias,
      projectId: REVIEW.projectId, deploymentId: state.deployment.id, redirect: null } : { available: true };
    if (method === "PATCH") {
      const key = (body as { key: string }).key;
      const index = state.project.findIndex((row) => row.key === key);
      state.project[index] = { ...state.project[index]!, updatedAt: state.now };
      return state.project[index];
    }
    if (url === DEPLOY_ROUTES.create) return state.deployment;
    if (url === deploymentRoute(state.deployment.id)) {
      state.polls++;
      return { ...state.deployment, readyState: "READY" };
    }
    if (url === deploymentRoute(state.deployment.id, true)) {
      state.alias = true;
      return { uid: "alias_offline", alias: REVIEW.proposedAlias, created: "2026-09-11T10:00:00Z" };
    }
    throw Error(canary);
  });
  const deps = { request, source: vi.fn(), storage: vi.fn(async () => true), now: () => state.now,
    sleep: vi.fn(async (ms: number) => { state.now += ms; }) };
  return { state, deps, request };
}
const writes = (h: ReturnType<typeof harness>) => h.request.mock.calls.filter(([, method]) => method === "PATCH" || method === "POST");

describe("deployment context and source", () => {
  it("accepts only the dedicated context and exact ten regular source paths", () => {
    expect(() => deploymentContext(env)).not.toThrow();
    expect(CONFIGURATION_PATHS).toHaveLength(10);
    const io = sourceIO();
    expect(() => verifyDeploymentSource(env, io)).not.toThrow();
    expect(io.git).toHaveBeenCalledWith("merge-base", "--is-ancestor", APPLICATION_SHA, "HEAD");
  });
  it.each([...modes, "DEPLOY_SWIM_REVIEW", "INSPECT_SWIM_REVIEW_DEPLOYMENT", "GITHUB_JOB", "GITHUB_SHA", "GITHUB_REF", "GITHUB_REPOSITORY",
    "GITHUB_EVENT_NAME", "GITHUB_REF_TYPE", "GITHUB_ACTIONS", "EXPECTED_SHA"])("rejects wrong or mixed %s", (key) => {
    expect(() => deploymentContext({ ...env, [key]: modes.includes(key) ? "true" : "wrong" })).toThrow();
  });
  it.each(["HEAD", "tree", "diff", "regular", "main", "feature", "event", "ancestor"])("rejects changed source %s", (kind) => {
    const io = sourceIO();
    const original = io.git.getMockImplementation()!;
    io.git.mockImplementation((...args) => {
      if (kind === "HEAD" && args[0] === "rev-parse") return "a".repeat(40);
      if (kind === "tree" && args[0] === "status") return " M HANDOFF.md";
      if (kind === "diff" && args[0] === "diff") return "apps/web/app/page.tsx";
      if (kind === "ancestor" && args[0] === "merge-base") throw Error(canary);
      if ((kind === "main" || kind === "feature") && args[0] === "ls-remote" &&
        (args[3] === "refs/heads/main") === (kind === "main")) return "wrong";
      return original(...args);
    });
    if (kind === "regular") io.regular = () => false;
    if (kind === "event") io.event = () => ({ inputs: { ...inputs, configure_swim_review: "true" } });
    expect(() => verifyDeploymentSource(env, io)).toThrow();
  });
  it("blocks mixed deployment dispatches in prerequisite CI before any dependent mutation job", () => {
    // Existing mutation jobs all need ci; keep their immutable bytes while refusing mixed dispatches here.
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, string> };
    if (event.inputs?.deploy_swim_review !== "true" && event.inputs?.inspect_swim_review_deployment !== "true") return;
    expect((event.inputs.deploy_swim_review === "true" && event.inputs.inspect_swim_review_deployment === "false") ||
      (event.inputs.deploy_swim_review === "false" && event.inputs.inspect_swim_review_deployment === "true")).toBe(true);
    expect(modes.every((key) => event.inputs?.[key.toLowerCase()] === "false")).toBe(true);
    expect(process.env.GITHUB_REPOSITORY).toBe(REVIEW.repository);
    expect(process.env.GITHUB_REF).toBe(`refs/heads/${REVIEW.branch}`);
    expect(event.inputs.expected_sha).toMatch(/^[a-f0-9]{40}$/);
    expect(event.inputs.expected_sha).toBe(process.env.GITHUB_SHA);
  });
});

describe("accepted receipt and isolation", () => {
  it.each(["missing", "id", "key", "late", "early", "type", "branch", "target", "duplicate", "shared", "unknown"])(
    "rejects %s evidence before any write", async (kind) => {
      const h = harness();
      const row = h.state.project[0]!;
      if (kind === "missing") h.state.project.pop();
      if (kind === "id") row.id = "wrong";
      if (kind === "key") row.key = "WRONG";
      if (kind === "late") row.updatedAt = CONFIGURATION.end + 1;
      if (kind === "early") row.createdAt = CONFIGURATION.start - 1;
      if (kind === "type") row.type = "plain";
      if (kind === "branch") row.gitBranch = "another";
      if (kind === "target") row.target = ["production"];
      if (kind === "duplicate") h.state.project.push({ ...row });
      if (kind === "shared") h.state.shared.push({ ...row, gitBranch: null, type: "encrypted" });
      if (kind === "unknown") h.state.shared[0]!.key = "UNKNOWN_PREVIEW";
      expect((await deploy(env, h.deps)).status).toBe("failed");
      expect(writes(h)).toHaveLength(0);
    });
  it.each(["auth", "storage", "protected", "shared", "project"])("refuses changed %s before activation", async (kind) => {
    const h = harness();
    if (kind === "auth") h.state.auth.disable_signup = false;
    if (kind === "storage") h.deps.storage.mockResolvedValue(false);
    if (kind === "protected" || kind === "shared" || kind === "project") h.deps.source.mockImplementationOnce(() => {}).mockImplementation(() => {
      if (kind === "protected") h.state.settings.ssoProtection.deploymentType = "preview";
      if (kind === "shared") h.state.shared[0]!.updatedAt++;
      if (kind === "project") h.state.project[0]!.updatedAt++;
    });
    expect((await deploy(env, h.deps)).status).toBe("failed");
    expect(writes(h)).toHaveLength(0);
  });
  it.each([{ envs: [], pagination: { next: 1, count: 0 } }, { envs: [], hiddenProductionEnvCount: 1 },
    { envs: [], extra: true }, { envs: [{}] }])("fails malformed/incomplete metadata", (input) => {
    expect(() => environmentList(input, false)).toThrow();
  });
  it("does not read secret getters or emit canaries", async () => {
    const h = harness();
    for (const row of h.state.project) for (const key of ["value", "legacyValue", "internalContentHint"]) {
      Object.defineProperty(row, key, { get() { throw Error(canary); } });
    }
    const output = await deploy(env, h.deps);
    expect(output.status).toBe("deployment_pass");
    expect(JSON.stringify(output)).not.toContain(canary);
    expect(JSON.stringify(output)).not.toContain("sb_secret_");
  });
  it("binds every accepted key to the exact successful configuration receipt", () => {
    expect(acceptedReceipt(receipt(), [])).toHaveLength(18);
    expect(CONFIGURATION.run).toBe("34585357240");
    expect(CONFIGURATION.sha).toBe("5d26364a49d934acdcac0ae8c924ae7e6bb784f4");
  });
});

describe("one-way deployment and alias state machine", () => {
  it("patches SHA then activation, creates one Preview and assigns only the fixed absent alias", async () => {
    const h = harness();
    const result = await deploy(env, h.deps);
    expect(result.status).toBe("deployment_pass");
    expect(writes(h)).toEqual([
      [updateRoute("NEXT_PUBLIC_BUILD_SHA"), "PATCH", { key: "NEXT_PUBLIC_BUILD_SHA", type: "encrypted",
        target: ["preview"], gitBranch: REVIEW.branch, value: sha }],
      [updateRoute("POOL_SWIMMING_ENABLED"), "PATCH", { key: "POOL_SWIMMING_ENABLED", type: "encrypted",
        target: ["preview"], gitBranch: REVIEW.branch, value: "true" }],
      [DEPLOY_ROUTES.create, "POST", { name: REVIEW.projectName, project: REVIEW.projectId,
        gitSource: { type: "github", org: "drrowdev", repo: "hybrid-training-app", ref: REVIEW.branch, sha } }],
      [deploymentRoute(h.state.deployment.id, true), "POST", { alias: REVIEW.proposedAlias }],
    ]);
    expect(h.state.polls).toBe(2);
    expect(result.ready).toBe(true);
    expect(result.runtimePending).toBe(true);
    expect(result.ownerLoginPending).toBe(true);
    expect(result.acceptedEnv).toHaveLength(18);
    expect(result.updatedEnv).toHaveLength(2);
  });
  it.each(["projectId", "ownerId", "target", "id", "url", "sha", "ref", "gitSource", "createdAt"])("rejects deployment %s mismatch", (key) => {
    const h = harness();
    const row = h.state.deployment;
    if (key === "sha") row.meta.githubCommitSha = "a".repeat(40);
    else if (key === "ref") row.meta.githubCommitRef = "wrong" as typeof REVIEW.branch;
    else Object.assign(row, { [key]: "wrong" });
    expect(() => deploymentMetadata(row, sha)).toThrow();
  });
  it.each(["build_sha", "activation", "deployment", "alias"])("retains uncertain %s without retry or cleanup", async (stage) => {
    const h = harness();
    const original = h.request.getMockImplementation()!;
    const route = { build_sha: updateRoute("NEXT_PUBLIC_BUILD_SHA"), activation: updateRoute("POOL_SWIMMING_ENABLED"),
      deployment: DEPLOY_ROUTES.create, alias: deploymentRoute(h.state.deployment.id, true) }[stage]!;
    h.request.mockImplementation(async (...args) => {
      const response = await original(...args);
      if (args[0] === route) throw Error(canary);
      return response;
    });
    const result = await deploy(env, h.deps);
    expect(result.status).toBe("failed");
    expect(result.partial).toBe(true);
    expect(result.manualReconciliation).toBe(true);
    expect(result.stages.at(-1)?.stage).toBe(stage);
    expect(h.request.mock.calls.filter(([url]) => url === route)).toHaveLength(1);
    expect(h.request.mock.calls.some(([, method]) => method === "DELETE")).toBe(false);
    expect(h.request.mock.calls.some(([url, method]) => url === ROUTES.auth && method === "PATCH")).toBe(false);
    expect(JSON.stringify(result)).not.toContain(canary);
  });
  it("refuses a foreign PATCH owner before activating", async () => {
    const h = harness();
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (...args) => {
      const response = await original(...args);
      return args[1] === "PATCH" ? { ...(response as object), id: "foreign" } : response;
    });
    const result = await deploy(env, h.deps);
    expect(result.buildSha).toEqual({ attempted: true, confirmed: false });
    expect(result.activation.attempted).toBe(false);
  });
  it("allows provider aggregate project timestamps to advance without changing protected settings", async () => {
    const h = harness();
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (...args) => {
      const response = await original(...args);
      if (args[1] === "PATCH" || args[0] === DEPLOY_ROUTES.create) h.state.settings.updatedAt++;
      return response;
    });
    expect((await deploy(env, h.deps)).status).toBe("deployment_pass");
  });
  it("never mistakes queued for READY and bounds polling to ten minutes", async () => {
    const h = harness();
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (...args) => args[0] === deploymentRoute(h.state.deployment.id) ?
      h.state.deployment : original(...args));
    const start = h.state.now;
    const result = await deploy(env, h.deps);
    expect(result.stages.at(-1)?.code).toBe("deadline");
    expect(result.ready).toBe(false);
    expect(result.alias.attempted).toBe(false);
    expect(h.state.now - start).toBe(600_000);
  });
  it("rejects reuse of a historical deployment even when its SHA matches", async () => {
    const h = harness();
    h.state.deployment.createdAt--;
    const result = await deploy(env, h.deps);
    expect(result.deployment).toEqual({ attempted: true, confirmed: false });
    expect(result.alias.attempted).toBe(false);
    expect(result.manualReconciliation).toBe(true);
  });
  it.each(["sha", "project", "production", "failed"])("rejects %s on a readiness observation", async (kind) => {
    const h = harness();
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (...args) => {
      const response = await original(...args);
      if (args[0] !== deploymentRoute(h.state.deployment.id)) return response;
      const row = { ...(response as typeof h.state.deployment) };
      if (kind === "sha") row.gitSource = { ...row.gitSource, sha: "a".repeat(40) };
      if (kind === "project") row.projectId = "wrong" as typeof REVIEW.projectId;
      if (kind === "production") row.target = "production";
      if (kind === "failed") row.readyState = "ERROR";
      return row;
    });
    const result = await deploy(env, h.deps);
    expect(result.status).toBe("failed");
    expect(result.alias.attempted).toBe(false);
  });
  it("retains the original failure and stops when the overall deadline expires", async () => {
    const h = harness();
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (...args) => {
      const response = await original(...args);
      if (args[1] === "PATCH") h.state.now += 18 * 60_000;
      return response;
    });
    const result = await deploy(env, h.deps);
    expect(result.stages.at(-1)).toMatchObject({ stage: "build_sha", code: "deadline", status: "failed" });
    expect(writes(h)).toHaveLength(1);
    expect(result.partial).toBe(true);
  });
  it.each(["before", "after"])("does not conceal an alias race %s assignment", async (when) => {
    const h = harness();
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (...args) => {
      const response = await original(...args);
      if (when === "before" && args[0] === DEPLOY_ROUTES.create) h.state.alias = true;
      if (when === "after" && args[0] === deploymentRoute(h.state.deployment.id, true)) {
        return { ...(response as object), oldDeploymentId: "dpl_Conflicting" };
      }
      return response;
    });
    const result = await deploy(env, h.deps);
    expect(result.status).toBe("failed");
    expect(result.alias.confirmed).toBe(false);
    expect(result.alias.attempted).toBe(when === "after");
    expect(h.request.mock.calls.some(([, method]) => method === "DELETE")).toBe(false);
  });
});

describe("bounded fixed-route transport and saved workflow", () => {
  it("uses literal route/method/body and redirect:error; only 404 means absent", async () => {
    const fake = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 404 }));
    const request = deploymentTransport(env, Date.now() + 60_000, fake);
    expect(await request(ROUTES.alias)).toEqual({ available: true });
    expect(fake.mock.calls[0]?.[1]).toMatchObject({ method: "GET", redirect: "error" });
    await expect(request(ROUTES.auth, "PATCH", {})).rejects.toThrow();
    await expect(request("https://api.supabase.com/v1/projects/grhetczkxawkcfgkwerj")).rejects.toThrow();
    await expect(request(ROUTES.project_env.replace("false", "true"))).rejects.toThrow();
    await expect(request(deploymentRoute("dpl_Offline123"), "DELETE")).rejects.toThrow();
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it.each([201, 302, 403, 500])("rejects status %s without raw error output", async (status) => {
    const request = deploymentTransport(env, Date.now() + 60_000,
      vi.fn(async () => new Response(canary, { status })));
    await expect(request(ROUTES.alias)).rejects.toMatchObject({ code: "http_status", httpStatus: status });
  });
  it("bounds bytes, malformed bodies and expired overall deadline", async () => {
    for (const text of ["x".repeat(2 * 1024 * 1024 + 1), canary]) {
      const request = deploymentTransport(env, Date.now() + 60_000, vi.fn(async () => new Response(text)));
      await expect(request(ROUTES.project)).rejects.toMatchObject({ code: "response_invalid" });
    }
    const fake = vi.fn();
    await expect(deploymentTransport(env, 0, fake)(ROUTES.project)).rejects.toThrow("deadline");
    expect(fake).not.toHaveBeenCalled();
  });
  it("aborts an HTTP request at thirty seconds", async () => {
    vi.useFakeTimers();
    try {
      const fake = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(Error(canary)));
      }));
      const request = deploymentTransport(env, Date.now() + 18 * 60_000, fake);
      const assertion = expect(request(ROUTES.project)).rejects.toThrow("transport_failed");
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally { vi.useRealTimers(); }
  });
  it("appends exactly one guarded job with offline/source checks before five secrets", () => {
    const workflow = readFileSync(resolve(import.meta.dirname, "../../../../.github/workflows/ci.yml"), "utf8");
    const job = workflow.split("\n  deploy-swim-review:\n")[1]!;
    expect(workflow.match(/\n  deploy-swim-review:/g)).toHaveLength(1);
    for (const text of ["needs: [ci, identity-guard]", "timeout-minutes: 25", "timeout-minutes: 18",
      "environment: swim-review", "contents: read", "fetch-depth: 0", "persist-credentials: false",
      "group: swim-review-bootstrap", "cancel-in-progress: false", "inputs.deploy_swim_review == true",
      ...modes.map((key) => `inputs.${key.toLowerCase()} == false`)]) expect(job).toContain(text);
    expect(job.indexOf("vitest run")).toBeLessThan(job.indexOf("--check-source"));
    expect(job.indexOf("--check-source")).toBeLessThan(job.indexOf("secrets."));
    const write = job.split("- name: Deploy isolated Preview once")[1]!.split("- name: Inspect deployment isolation")[0]!;
    const read = job.split("- name: Inspect deployment isolation")[1]!;
    expect(write.match(/secrets\./g)).toHaveLength(5);
    expect(read.match(/secrets\.\w+/g)).toEqual(["secrets.VERCEL_REVIEW_TOKEN", "secrets.SUPABASE_REVIEW_MANAGEMENT_TOKEN"]);
    expect(write).toContain("if: inputs.deploy_swim_review == true && inputs.inspect_swim_review_deployment == false");
    expect(read).toContain("if: inputs.deploy_swim_review == false && inputs.inspect_swim_review_deployment == true");
    expect(job).toContain("--check-source --inspect-isolation");
    expect(workflow).toContain("inspect_swim_review_deployment:\n        description: Inspect isolated deployment metadata read-only\n        required: false\n        default: false");
  });
});

const inspectionEnv = { ...env, DEPLOY_SWIM_REVIEW: "false", INSPECT_SWIM_REVIEW_DEPLOYMENT: "true" };
describe("native read-only deployment isolation inspection", () => {
  it("validates actual read-only context and event without forging deploy", () => {
    const io = sourceIO();
    io.event = () => ({ inputs: { ...inputs, deploy_swim_review: "false", inspect_swim_review_deployment: "true" } });
    expect(() => verifyDeploymentSource(inspectionEnv, io, true)).not.toThrow();
    expect(() => verifyDeploymentSource(inspectionEnv, sourceIO(), true)).toThrow();
    expect(() => verifyDeploymentSource(env, io, true)).toThrow();
    for (const key of [...modes, "DEPLOY_SWIM_REVIEW", "INSPECT_SWIM_REVIEW_DEPLOYMENT"]) {
      for (const value of [undefined, "wrong", key === "INSPECT_SWIM_REVIEW_DEPLOYMENT" ? "false" : "true"]) {
        expect(() => deploymentContext({ ...inspectionEnv, [key]: value }, true)).toThrow();
      }
    }
  });
  it("emits one safe fixed schema after only five GETs and repeated source checks", async () => {
    const h = harness();
    const sensitive = vi.fn(() => { throw Error(canary); });
    const values = { ...inspectionEnv };
    for (const key of ["SWIM_REVIEW_DATABASE_URL", "SWIM_REVIEW_SUPABASE_ANON_KEY", "SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY"]) {
      Object.defineProperty(values, key, { get: sensitive });
    }
    for (const row of [h.state.settings, h.state.settings.ssoProtection, ...h.state.project]) {
      for (const key of ["password", "bypass", "value", "toJSON", "billingCustomer"]) {
        Object.defineProperty(row, key, { get: sensitive });
      }
    }
    const result = await inspectIsolation(values, h.deps);
    expect(result).toEqual({
      scope: "swim-review-deployment-inspection", testedSha: sha, acceptedApp: APPLICATION_SHA,
      configurationRun: CONFIGURATION.run, configurationSha: CONFIGURATION.sha,
      projectId: REVIEW.projectId, teamId: REVIEW.teamId, testProject: REVIEW.supabaseId,
      status: "inspection_pass",
      stages: ["source", "credentials", "project", "team", "supabase", "project_env", "shared_env", "receipt", "completion"]
        .map((stage) => ({ stage, code: "passed", status: "passed" })),
      classifications: { project: { ssoProtection: { type: "object", deploymentType: "all" },
        passwordProtection: { type: "null" }, trustedIps: { type: "null" } },
      team: { billing: { type: "object", plan: "hobby" } } },
      receiptMatches: true, writesAttempted: false, deploymentAttempted: false, deploymentAccepted: false,
      runtimePending: true, ownerLoginPending: true,
    });
    expect(h.request.mock.calls).toEqual(INSPECTION_ROUTES.map((route) => [route]));
    expect(h.deps.source).toHaveBeenCalledTimes(9);
    expect(h.deps.storage).not.toHaveBeenCalled();
    expect(sensitive).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(canary);
  });
  it.each(["ssoProtection", "passwordProtection", "trustedIps"])("keeps strict %s predicates with safe shape evidence", async (key) => {
    for (const [value, suffix, type] of [[undefined, "missing", "missing"], [[], "invalid", "invalid"],
      [canary, "invalid", "invalid"], [{}, "deploymentType", "object"],
      [{ deploymentType: canary }, "deploymentType", "object"]] as const) {
      const h = harness();
      Object.assign(h.state.settings, { [key]: value });
      const result = await inspectIsolation(inspectionEnv, h.deps);
      expect(result.stages.at(-1)).toMatchObject({ stage: "project", code: `${key}_${suffix}`, status: "failed" });
      expect(result.classifications.project?.[key as "ssoProtection"]).toMatchObject({ type });
      expect(h.request).toHaveBeenCalledTimes(1);
      expect((await deploy(env, h.deps)).stages.at(-1)?.code).toBe(`${key}_${suffix}`);
      expect(writes(h)).toHaveLength(0);
      expect(JSON.stringify(result)).not.toContain(canary);
    }
    const h = harness();
    Object.assign(h.state.settings, { [key]: null });
    expect((await inspectIsolation(inspectionEnv, h.deps)).status).toBe("inspection_pass");
  });
  it.each([
    [ROUTES.project, null, "project", "project_structure"],
    [ROUTES.project, { link: {} }, "project", "project_identity"],
    [DEPLOY_ROUTES.team, null, "team", "team_structure"],
    [DEPLOY_ROUTES.team, { id: "wrong" }, "team", "team_identity"],
    ...[[undefined, "billing_missing"], [null, "billing_null"], [[], "billing_invalid"],
      [{}, "billing_plan"], [{ plan: "pro" }, "billing_plan"], [{ plan: canary }, "billing_plan"]]
      .map(([billing, code]) => [DEPLOY_ROUTES.team, { id: REVIEW.teamId, slug: "drrowdevs-projects", billing }, "team", code]),
    [ROUTES.supabase, { id: "wrong" }, "supabase", "supabase_identity"],
    [ROUTES.project_env, {}, "project_env", "response_invalid"],
    [ROUTES.shared_env, {}, "shared_env", "response_invalid"],
  ] as [string, unknown, string, string][])("reports the first rejected checkpoint for %s / %s", async (route, value, stage, code) => {
    const h = harness();
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (...args) => args[0] === route ? value : original(...args));
    const result = await inspectIsolation(inspectionEnv, h.deps);
    expect(result.stages.at(-1)).toMatchObject({ stage, code, status: "failed" });
    expect(h.request.mock.calls.at(-1)?.[0]).toBe(route);
    expect(writes(h)).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(canary);
  });
  it("refuses receipt drift and changed live refs or total deadline without repairs", async () => {
    const h = harness();
    h.state.project[0]!.updatedAt++;
    h.state.project[0]!.id = "wrong";
    expect((await inspectIsolation(inspectionEnv, h.deps)).stages.at(-1)?.code).toBe("receipt_invalid");
    for (let check = 1; check <= 9; check++) {
      const f = harness();
      let count = 0;
      f.deps.source.mockImplementation(() => { if (++count === check) throw Error(canary); });
      expect((await inspectIsolation(inspectionEnv, f.deps)).status).toBe("failed");
      expect(writes(f)).toHaveLength(0);
    }
    const f = harness();
    f.deps.source.mockImplementation(() => { f.state.now += 300_000; });
    expect((await inspectIsolation(inspectionEnv, f.deps)).stages.at(-1)?.code).toBe("deadline");
    expect(f.request).not.toHaveBeenCalled();
  });
  it("enforces the exact bodyless GET allowlist even on error", async () => {
    const fake = vi.fn(async () => new Response("{}"));
    const request = deploymentTransport(inspectionEnv, Date.now() + 300_000, fake, true);
    for (const route of [...Object.values(ROUTES), ...Object.values(DEPLOY_ROUTES),
      updateRoute("NEXT_PUBLIC_BUILD_SHA"), updateRoute("POOL_SWIMMING_ENABLED"),
      deploymentRoute("dpl_Offline123"), deploymentRoute("dpl_Offline123", true),
      ROUTES.project_env.replace("false", "true")]) {
      for (const method of ["GET", "PATCH", "POST", "DELETE"]) {
        if (method === "GET" && (INSPECTION_ROUTES as readonly string[]).includes(route)) await request(route);
        else await expect(request(route, method)).rejects.toThrow();
      }
      await expect(request(route, "GET", {})).rejects.toThrow();
    }
    expect(fake.mock.calls.every((call) => (call as unknown as [string, RequestInit])[1].redirect === "error")).toBe(true);
    for (const [status, body, code] of [[403, canary, "http_status"], [200, canary, "response_invalid"],
      [200, "x".repeat(2 * 1024 * 1024 + 1), "response_invalid"]] as const) {
      const f = harness();
      f.deps.request = deploymentTransport(inspectionEnv, Date.now() + 300_000,
        vi.fn(async () => new Response(body, { status })), true) as typeof f.deps.request;
      const result = await inspectIsolation(inspectionEnv, f.deps);
      expect(result.stages.at(-1)).toMatchObject({ stage: "project", code, httpStatus: status });
      expect(JSON.stringify(result)).not.toContain(canary);
    }
  });
});
