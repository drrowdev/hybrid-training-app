import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CONFIGURATION_PATHS, ROUTES, environmentList } from "../configure-swim-review";
import { APPLICATION_SHA } from "../prepare-swim-review";
import { INHERITED_KEYS, OVERRIDE_KEYS, REVIEW, type EnvironmentMetadata } from "../swim-review-config-plan";
import {
  acceptedReceipt, BASE_SHA, CONFIGURATION, deploy, deploymentContext, deploymentMetadata,
  deploymentRoute, deploymentTransport, DEPLOY_ROUTES, RECEIPT, updateRoute, verifyDeploymentSource,
} from "../deploy-swim-review";

const sha = "b".repeat(40);
const canary = "offline_sensitive_canary_not_for_output_1234";
const modes = ["CONFIGURE_SWIM_REVIEW", "INSPECT_SWIM_REVIEW_AUTH", "PREPARE_SWIM_REVIEW",
  "INSPECT_SWIM_REVIEW", "SWIM_ACCEPTANCE", "MIGRATE_PRODUCTION", "ALLOW_UNDEPLOYED"];
const env: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF_TYPE: "branch", GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_JOB: "deploy-swim-review",
  GITHUB_SHA: sha, EXPECTED_SHA: sha, DEPLOY_SWIM_REVIEW: "true",
  ...Object.fromEntries(modes.map((key) => [key, "false"])),
  VERCEL_REVIEW_TOKEN: canary, SUPABASE_REVIEW_MANAGEMENT_TOKEN: canary,
  SWIM_REVIEW_SUPABASE_ANON_KEY: `sb_publishable_${canary}`,
  SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${canary}`,
  SWIM_REVIEW_DATABASE_URL: `postgresql://postgres.whwilnhqfiaquwxgkxwt:${canary}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres?sslmode=require`,
};
const inputs = { deploy_swim_review: "true", expected_sha: sha,
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
      ssoProtection: { deploymentType: "all" } },
    deployment: { id: "dpl_Offline123", url: "hybrid-training-app-web-offline.vercel.app", readyState: "QUEUED",
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
  it.each([...modes, "DEPLOY_SWIM_REVIEW", "GITHUB_JOB", "GITHUB_SHA", "GITHUB_REF", "GITHUB_REPOSITORY",
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
    if (event.inputs?.deploy_swim_review !== "true") return;
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
      if (kind === "protected") h.state.settings.updatedAt++;
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
  it.each(["projectId", "ownerId", "target", "id", "url", "sha", "ref"])("rejects deployment %s mismatch", (key) => {
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
    expect(job.match(/secrets\./g)).toHaveLength(5);
  });
});
