import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CONFIGURATION_PATHS, ROUTES, environmentList } from "../configure-swim-review";
import { APPLICATION_SHA } from "../prepare-swim-review";
import { INHERITED_KEYS, OVERRIDE_KEYS, REVIEW, type EnvironmentMetadata } from "../swim-review-config-plan";
import {
  acceptedReceipt, BASE_SHA, CONFIGURATION, deploy, deploymentContext, deploymentMetadata, inspectIsolation, INSPECTION_ROUTES,
  deploymentRoute, deploymentTransport, DEPLOY_ROUTES, RECEIPT, updateRoute, verifyDeploymentSource,
  ACCEPTED_DEPLOYMENT, OWNER_ROUTE, ownerInputs, provisionOwner,
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
const optionalProtections = ["passwordProtection", "trustedIps"] as const;
function observedProtection(h: ReturnType<typeof harness>, keys: readonly string[] = optionalProtections) {
  h.state.settings.ssoProtection.deploymentType = "all_except_custom_domains";
  for (const key of keys) Reflect.deleteProperty(h.state.settings, key);
}
function presentProtection(key: typeof optionalProtections[number]) {
  return key === "trustedIps" ?
    { deploymentType: "all", addresses: [{ value: "192.0.2.1" }], protectionMode: "additional" } :
    { deploymentType: "all" };
}

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
    const reviewModes = ["deploy_swim_review", "inspect_swim_review_deployment", "provision_swim_review_owner"];
    if (!reviewModes.some((key) => event.inputs?.[key] === "true")) return;
    expect(reviewModes.filter((key) => event.inputs?.[key] === "true")).toHaveLength(1);
    expect(reviewModes.every((key) => ["true", "false"].includes(event.inputs?.[key] ?? ""))).toBe(true);
    expect(modes.every((key) => event.inputs?.[key.toLowerCase()] === "false")).toBe(true);
    expect(process.env.GITHUB_REPOSITORY).toBe(REVIEW.repository);
    expect(process.env.GITHUB_REF).toBe(`refs/heads/${REVIEW.branch}`);
    expect(event.inputs?.expected_sha).toMatch(/^[a-f0-9]{40}$/);
    expect(event.inputs?.expected_sha).toBe(process.env.GITHUB_SHA);
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
  it.each(["build_sha", "activation", "deployment", "alias"].flatMap((stage) =>
    [false, true].map((omitted) => ({ stage, omitted }))))("retains uncertain $stage with optional omission=$omitted without retry or cleanup", async ({ stage, omitted }) => {
    const h = harness();
    if (omitted) observedProtection(h);
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
    const read = job.split("- name: Inspect deployment isolation")[1]!.split("- name: Provision isolated owner")[0]!;
    expect(write.match(/secrets\./g)).toHaveLength(5);
    expect(read.match(/secrets\.\w+/g)).toEqual(["secrets.VERCEL_REVIEW_TOKEN", "secrets.SUPABASE_REVIEW_MANAGEMENT_TOKEN"]);
    expect(write).toContain("if: inputs.deploy_swim_review == true && inputs.inspect_swim_review_deployment == false");
    expect(read).toContain("if: inputs.deploy_swim_review == false && inputs.inspect_swim_review_deployment == true");
    expect(job).toContain("--check-source --inspect-isolation");
    expect(workflow).toContain("inspect_swim_review_deployment:\n        description: Inspect isolated deployment metadata read-only\n        required: false\n        default: false");
  });
});

const inspectionEnv = { ...env, DEPLOY_SWIM_REVIEW: "false", INSPECT_SWIM_REVIEW_DEPLOYMENT: "true" };
const ownerEnv = { ...env, DEPLOY_SWIM_REVIEW: "false", PROVISION_SWIM_REVIEW_OWNER: "true",
  SWIM_REVIEW_OWNER_EMAIL: "offline-owner@example.invalid", SWIM_REVIEW_OWNER_PASSWORD: canary };
function ownerHarness() {
  const h = harness();
  observedProtection(h);
  h.state.now = ACCEPTED_DEPLOYMENT.end + 60_000;
  for (const row of h.state.project) if (["NEXT_PUBLIC_BUILD_SHA", "POOL_SWIMMING_ENABLED"].includes(row.key)) {
    row.updatedAt = ACCEPTED_DEPLOYMENT.end;
  }
  Object.assign(h.state.deployment, { id: ACCEPTED_DEPLOYMENT.id, url: ACCEPTED_DEPLOYMENT.url,
    readyState: "READY", createdAt: ACCEPTED_DEPLOYMENT.start });
  h.state.deployment.gitSource.sha = ACCEPTED_DEPLOYMENT.sha;
  h.state.deployment.meta.githubCommitSha = ACCEPTED_DEPLOYMENT.sha;
  h.state.alias = true;
  const user = { id: "12345678-1234-4123-8123-123456789abc", email: ownerEnv.SWIM_REVIEW_OWNER_EMAIL,
    role: "authenticated", aud: "authenticated", is_anonymous: false,
    app_metadata: { provider: "email", providers: ["email"] },
    created_at: new Date(h.state.now).toISOString(), email_confirmed_at: new Date(h.state.now).toISOString() };
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (...args) => {
    if (args[0] === OWNER_ROUTE || args[0] === `${OWNER_ROUTE}/${user.id}`) return user;
    return original(...args);
  });
  return { ...h, user };
}
describe("native one-shot owner provisioning", () => {
  it("creates only the exact payload, reads only the returned ID, and leaves login pending", async () => {
    const h = ownerHarness();
    const result = await provisionOwner(ownerEnv, h.deps);
    expect(result).toMatchObject({ status: "owner_provision_pass", testedSha: sha,
      deployedSha: ACCEPTED_DEPLOYMENT.sha, accountCreate: { attempted: true, confirmed: true },
      accountVerified: true, partial: false, manualReconciliation: false, runtimePending: true, ownerLoginPending: true });
    expect(writes(h)).toEqual([[OWNER_ROUTE, "POST", { email: ownerEnv.SWIM_REVIEW_OWNER_EMAIL,
      password: canary, email_confirm: true }]]);
    expect(h.request.mock.calls.filter(([url]) => url.startsWith(OWNER_ROUTE))).toEqual([
      [OWNER_ROUTE, "POST", ownerInputs(ownerEnv)], [`${OWNER_ROUTE}/${h.user.id}`],
    ]);
    expect(result.stages.map(({ stage }) => stage)).toEqual(
      ["source", "credentials", "snapshot", "precreate", "account_create", "account_verify", "postcreate", "completion"]);
    for (const secret of [canary, h.user.id, h.user.email]) expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("requires native event and deployed ancestry without touching credentials", async () => {
    const io = sourceIO();
    io.event = () => ({ inputs: { ...inputs, deploy_swim_review: "false", provision_swim_review_owner: "true" } });
    expect(() => verifyDeploymentSource(ownerEnv, io, "provision-owner")).not.toThrow();
    expect(io.git).toHaveBeenCalledWith("merge-base", "--is-ancestor", ACCEPTED_DEPLOYMENT.sha, "HEAD");
    expect(() => verifyDeploymentSource(ownerEnv, sourceIO(), "provision-owner")).toThrow();
    for (const key of [...modes, "DEPLOY_SWIM_REVIEW", "INSPECT_SWIM_REVIEW_DEPLOYMENT"]) {
      const h = ownerHarness();
      const mixed = { ...ownerEnv, [key]: "true" };
      Object.defineProperty(mixed, "SWIM_REVIEW_OWNER_PASSWORD", { get() { throw Error(canary); } });
      expect((await provisionOwner(mixed, h.deps)).stages.at(-1)?.stage).toBe("source");
      expect(h.request).not.toHaveBeenCalled();
    }
    expect(() => deploymentContext(ownerEnv)).toThrow();
    expect(() => deploymentContext(ownerEnv, true)).toThrow();
  });
  it.each(["", "short", " leading-valid-password", "trailing-valid-password ", "valid-password\ncontrol", "x".repeat(257)])(
    "rejects invalid password without requests %#", async (password) => {
      const h = ownerHarness();
      expect((await provisionOwner({ ...ownerEnv, SWIM_REVIEW_OWNER_PASSWORD: password }, h.deps)).status).toBe("failed");
      expect(h.request).not.toHaveBeenCalled();
    });
  it.each(["bad", " offline@example.invalid", "offline@example.invalid ", `${"a".repeat(250)}@example.invalid`])(
    "rejects invalid email %#", (email) => expect(() => ownerInputs({ ...ownerEnv, SWIM_REVIEW_OWNER_EMAIL: email })).toThrow());
  it("keeps the original receipt policy and allows only the two exact post-deploy windows", () => {
    const h = ownerHarness();
    expect(() => acceptedReceipt(h.state.project, h.state.shared)).toThrow();
    expect(() => acceptedReceipt(h.state.project, h.state.shared, true)).not.toThrow();
    for (const row of h.state.project) {
      const before = row.updatedAt;
      row.updatedAt = ["NEXT_PUBLIC_BUILD_SHA", "POOL_SWIMMING_ENABLED"].includes(row.key) ?
        ACCEPTED_DEPLOYMENT.start - 1 : CONFIGURATION.end + 1;
      expect(() => acceptedReceipt(h.state.project, h.state.shared, true)).toThrow();
      row.updatedAt = before;
    }
  });
  it.each(["deployment", "alias", "protection", "auth", "storage", "hobby", "supabase"])(
    "refuses mismatched %s before creation", async (kind) => {
      const h = ownerHarness();
      if (kind === "deployment") h.state.deployment.gitSource.sha = sha;
      if (kind === "alias") h.state.alias = false;
      if (kind === "protection") h.state.settings.ssoProtection.deploymentType = "all";
      if (kind === "auth") h.state.auth.disable_signup = false;
      if (kind === "storage") h.deps.storage.mockResolvedValue(false);
      const original = h.request.getMockImplementation()!;
      h.request.mockImplementation(async (...args) => {
        if (kind === "hobby" && args[0] === DEPLOY_ROUTES.team) return { id: REVIEW.teamId, slug: "drrowdevs-projects", billing: { plan: "pro" } };
        if (kind === "supabase" && args[0] === ROUTES.supabase) return {};
        return original(...args);
      });
      expect((await provisionOwner(ownerEnv, h.deps)).accountCreate.attempted).toBe(false);
      expect(writes(h)).toHaveLength(0);
    });
  it.each(["throw", "duplicate", "id", "email", "role", "confirmed", "old", "get-mismatch", "postguard"])(
    "preserves the account and uncertainty after %s; no retry or deletion", async (kind) => {
      const h = ownerHarness();
      const original = h.request.getMockImplementation()!;
      h.request.mockImplementation(async (...args) => {
        if (args[0] === OWNER_ROUTE) {
          if (kind === "throw") throw Error(canary);
          if (kind === "duplicate") return { msg: canary };
          if (kind === "postguard") h.state.auth.disable_signup = false;
          return { ...h.user, ...(kind === "id" ? { id: "wrong" } : {}),
            ...(kind === "email" ? { email: "wrong@example.invalid" } : {}),
            ...(kind === "role" ? { role: "service_role" } : {}),
            ...(kind === "confirmed" ? { email_confirmed_at: null } : {}),
            ...(kind === "old" ? { created_at: "2020-01-01T00:00:00Z" } : {}) };
        }
        if (kind === "get-mismatch" && args[0].startsWith(`${OWNER_ROUTE}/`)) return { ...h.user, id: "wrong" };
        return original(...args);
      });
      const result = await provisionOwner(ownerEnv, h.deps);
      expect(result).toMatchObject({ status: "failed", partial: true, manualReconciliation: true });
      expect(writes(h)).toHaveLength(1);
      expect(h.request.mock.calls.some(([, method]) => method === "DELETE" || method === "PATCH")).toBe(false);
      expect(JSON.stringify(result)).not.toContain(canary);
    });
  it.each([2, 3])("retains exact snapshots at guard %s", async (read) => {
    const h = ownerHarness();
    let count = 0;
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (...args) => {
      if (args[0] === ROUTES.project && ++count === read) Object.assign(h.state.settings, { passwordProtection: null });
      return original(...args);
    });
    const result = await provisionOwner(ownerEnv, h.deps);
    expect(result.status).toBe("failed");
    expect(result.accountCreate.attempted).toBe(read === 3);
  });
  it("never reads private metadata/user getters or a DATABASE_URL", async () => {
    const h = ownerHarness();
    const privateGetter = vi.fn(() => { throw Error(canary); });
    for (const row of [h.user, h.state.settings, ...h.state.project]) {
      for (const key of ["value", "passwordHash", "encrypted_password", "toJSON"]) Object.defineProperty(row, key, { get: privateGetter });
    }
    const credentials = { ...ownerEnv };
    Object.defineProperty(credentials, "SWIM_REVIEW_DATABASE_URL", { get: privateGetter });
    expect((await provisionOwner(credentials, h.deps)).status).toBe("owner_provision_pass");
    expect(privateGetter).not.toHaveBeenCalled();
  });
  it("restricts owner transport to one literal create and one returned-ID read", async () => {
    const h = ownerHarness();
    const fake = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(h.user)));
    const request = deploymentTransport(ownerEnv, Date.now() + 300_000, fake, "provision-owner");
    for (const [url, method, body] of [
      [OWNER_ROUTE, "GET", undefined], [`${OWNER_ROUTE}/${h.user.id}`, "GET", undefined],
      [OWNER_ROUTE, "POST", { ...ownerInputs(ownerEnv), email_confirm: false }],
      [ROUTES.auth, "PATCH", {}], [DEPLOY_ROUTES.create, "POST", {}],
      [deploymentRoute("dpl_Arbitrary"), "GET", undefined], [OWNER_ROUTE, "DELETE", undefined],
    ] as const) await expect(request(url, method, body)).rejects.toThrow();
    expect(fake).not.toHaveBeenCalled();
    await request(OWNER_ROUTE, "POST", ownerInputs(ownerEnv));
    await expect(request(OWNER_ROUTE, "POST", ownerInputs(ownerEnv))).rejects.toThrow();
    await request(`${OWNER_ROUTE}/${h.user.id}`);
    await expect(request(`${OWNER_ROUTE}/${h.user.id}`)).rejects.toThrow();
    expect(fake).toHaveBeenCalledTimes(2);
    expect(fake.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", method: "POST",
      headers: { apikey: env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY } });
  });
});
describe("optional project protection snapshots", () => {
  it.each([[optionalProtections[0]], [optionalProtections[1]], [...optionalProtections]])(
    "preserves observed Hobby omission %j through five GETs and fake deployment", async (...keys) => {
      const h = harness();
      observedProtection(h, keys);
      const result = await inspectIsolation(inspectionEnv, h.deps);
      expect(result).toMatchObject({ status: "inspection_pass", receiptMatches: true,
        writesAttempted: false, deploymentAttempted: false, deploymentAccepted: false,
        runtimePending: true, ownerLoginPending: true });
      expect(result.stages).toEqual(
        ["source", "credentials", "project", "team", "supabase", "project_env", "shared_env", "receipt", "completion"]
          .map((stage) => ({ stage, code: "passed", status: "passed" })));
      expect(result.classifications.project).toEqual({
        ssoProtection: { type: "object", deploymentType: "all_except_custom_domains" },
        ...Object.fromEntries(optionalProtections.map((key) => [key, { type: keys.some((entry) => entry === key) ? "missing" : "null" }])),
      });
      expect(h.request.mock.calls).toEqual(INSPECTION_ROUTES.map((route) => [route]));
      expect(h.deps.storage).not.toHaveBeenCalled();
      expect(writes(h)).toHaveLength(0);
      expect((await deploy(env, h.deps)).status).toBe("deployment_pass");
      expect(writes(h).map(([route, method]) => [route, method])).toEqual([
        [updateRoute("NEXT_PUBLIC_BUILD_SHA"), "PATCH"], [updateRoute("POOL_SWIMMING_ENABLED"), "PATCH"],
        [DEPLOY_ROUTES.create, "POST"], [deploymentRoute(h.state.deployment.id, true), "POST"],
      ]);
      for (const key of keys) expect(Object.hasOwn(h.state.settings, key)).toBe(false);
    });
  it.each(optionalProtections)("requires explicit observed SSO for omitted %s", async (key) => {
    for (const value of ["absent", undefined, null, [], {}, { deploymentType: "all" },
      { deploymentType: "preview" }, { deploymentType: "production" },
      { deploymentType: "prod_deployment_urls_and_all_previews" }, { deploymentType: canary }]) {
      const h = harness();
      observedProtection(h, [key]);
      if (value === "absent") Reflect.deleteProperty(h.state.settings, "ssoProtection");
      else Object.assign(h.state.settings, { ssoProtection: value });
      expect((await inspectIsolation(inspectionEnv, h.deps)).status).toBe("failed");
      expect(h.request).toHaveBeenCalledTimes(1);
      expect((await deploy(env, h.deps)).status).toBe("failed");
      expect(writes(h)).toHaveLength(0);
    }
  });
  it.each(optionalProtections)("does not treat own undefined or malformed %s as absence", async (key) => {
    for (const value of [undefined, [], false, 42, canary, {}, { deploymentType: canary },
      ...(key === "trustedIps" ? [
        { deploymentType: "all", addresses: null, protectionMode: "additional" },
        { deploymentType: "all", addresses: [null], protectionMode: "additional" },
        { deploymentType: "all", addresses: [{ value: 42 }], protectionMode: "additional" },
        { deploymentType: "all", addresses: [{ value: "x".repeat(129) }], protectionMode: "additional" },
        { deploymentType: "all", addresses: [], protectionMode: "wrong" },
      ] : [])]) {
      const h = harness();
      observedProtection(h);
      Object.assign(h.state.settings, { [key]: value });
      expect(Object.hasOwn(h.state.settings, key)).toBe(true);
      const result = await inspectIsolation(inspectionEnv, h.deps);
      expect(result.status).toBe("failed");
      expect(h.request).toHaveBeenCalledTimes(1);
      expect((await deploy(env, h.deps)).status).toBe("failed");
      expect(writes(h)).toHaveLength(0);
      expect(JSON.stringify(result)).not.toContain(canary);
    }
  });
  it.each(optionalProtections)("preserves explicit null and present %s beside omission", async (key) => {
    for (const value of [null, presentProtection(key)]) {
      const h = harness();
      observedProtection(h);
      Object.assign(h.state.settings, { [key]: value });
      const result = await inspectIsolation(inspectionEnv, h.deps);
      expect(result.status).toBe("inspection_pass");
      expect(result.classifications.project?.[key]).toEqual(value === null ?
        { type: "null" } : { type: "object", deploymentType: "all" });
      expect((await deploy(env, h.deps)).status).toBe("deployment_pass");
      expect(h.state.settings[key]).toBe(value);
    }
  });
  it.each(["id", "accountId", "name", "rootDirectory", "framework",
    "link.type", "link.org", "link.repo", "link.productionBranch", "team.id", "team.slug",
    "billing.absent", "billing.null", "billing.pro", "billing.enterprise"])(
    "still requires exact project/link/team/Hobby predicates with omission: %s", async (field) => {
      const h = harness();
      observedProtection(h);
      const team: Record<string, unknown> = { id: REVIEW.teamId, slug: "drrowdevs-projects", billing: { plan: "hobby" } };
      if (field.startsWith("link.")) Object.assign(h.state.settings.link, { [field.slice(5)]: "wrong" });
      else if (field.startsWith("team.")) team[field.slice(5)] = "wrong";
      else if (field === "billing.absent") delete team.billing;
      else if (field === "billing.null") team.billing = null;
      else if (field.startsWith("billing.")) team.billing = { plan: field.slice(8) };
      else Object.assign(h.state.settings, { [field]: "wrong" });
      const original = h.request.getMockImplementation()!;
      h.request.mockImplementation(async (...args) => args[0] === DEPLOY_ROUTES.team ? team : original(...args));
      const result = await inspectIsolation(inspectionEnv, h.deps);
      expect(result.status).toBe("failed");
      expect(result.receiptMatches).toBe(false);
      expect(result.stages.at(-1)?.stage).toBe(field.startsWith("team.") || field.startsWith("billing.") ? "team" : "project");
      expect((await deploy(env, h.deps)).status).toBe("failed");
      expect(writes(h)).toHaveLength(0);
    });
  it("does not infer explicit SSO from an inherited value", async () => {
    const h = harness();
    observedProtection(h);
    const inherited = h.state.settings.ssoProtection;
    Reflect.deleteProperty(h.state.settings, "ssoProtection");
    Object.setPrototypeOf(h.state.settings, { ssoProtection: inherited });
    expect((await inspectIsolation(inspectionEnv, h.deps)).status).toBe("failed");
    expect((await deploy(env, h.deps)).status).toBe("failed");
    expect(writes(h)).toHaveLength(0);
  });
  it("does not read private getters during omitted-setting deployment guards", async () => {
    const h = harness();
    observedProtection(h);
    const sensitive = vi.fn(() => { throw Error(canary); });
    for (const row of [h.state.settings, h.state.settings.ssoProtection, ...h.state.project]) {
      for (const key of ["password", "hash", "passwordHash", "bypass", "value", "toJSON", "billingCustomer"]) {
        Object.defineProperty(row, key, { get: sensitive });
      }
    }
    const result = await deploy(env, h.deps);
    expect(result.status).toBe("deployment_pass");
    expect(sensitive).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(canary);
  });
  const guards = [
    { read: 2, stage: "prewrite", mutations: 0 }, { read: 3, stage: "build_sha", mutations: 0 },
    { read: 4, stage: "build_sha", mutations: 1 }, { read: 5, stage: "activation", mutations: 1 },
    { read: 6, stage: "activation", mutations: 2 }, { read: 7, stage: "predeploy", mutations: 2 },
    { read: 8, stage: "prealias", mutations: 3 }, { read: 9, stage: "completion", mutations: 4 },
  ];
  it.each(optionalProtections.flatMap((key) => ["missing", "null", "object"].flatMap((from) =>
    ["missing", "null", "object"].filter((to) => to !== from).flatMap((to) =>
      guards.map((guard) => ({ key, from, to, ...guard }))))))(
    "refuses $key $from->$to at guard $read ($stage)", async ({ key, from, to, read, stage, mutations }) => {
      const h = harness();
      observedProtection(h);
      const set = (state: string) => {
        if (state === "missing") Reflect.deleteProperty(h.state.settings, key);
        else Object.assign(h.state.settings, { [key]: state === "null" ? null : presentProtection(key) });
      };
      set(from);
      let reads = 0;
      const original = h.request.getMockImplementation()!;
      h.request.mockImplementation(async (...args) => {
        if (args[0] === ROUTES.project && ++reads === read) set(to);
        return original(...args);
      });
      const result = await deploy(env, h.deps);
      expect(result.status).toBe("failed");
      expect(result.stages.at(-1)).toEqual({ stage, code: "isolation_changed", status: "failed" });
      expect(writes(h)).toHaveLength(mutations);
      expect(result.partial).toBe(mutations > 0);
      expect(result.manualReconciliation).toBe(mutations > 0);
    });
  it.each(["sso", "sso.null", "sso.missing", "password.undefined", "trusted.undefined",
    "addresses", "mode", "scope", "link"].flatMap((change) =>
    guards.map((guard) => ({ change, ...guard }))))(
    "refuses changed $change at guard $read before another mutation", async ({ change, read, stage, mutations }) => {
      const h = harness();
      observedProtection(h);
      const trusted = presentProtection("trustedIps");
      Object.assign(h.state.settings, { trustedIps: trusted });
      let reads = 0;
      const original = h.request.getMockImplementation()!;
      h.request.mockImplementation(async (...args) => {
        if (args[0] === ROUTES.project && ++reads === read) {
          if (change === "sso") h.state.settings.ssoProtection.deploymentType = "preview";
          if (change === "sso.null") Object.assign(h.state.settings, { ssoProtection: null });
          if (change === "sso.missing") Reflect.deleteProperty(h.state.settings, "ssoProtection");
          if (change === "password.undefined") Object.assign(h.state.settings, { passwordProtection: undefined });
          if (change === "trusted.undefined") Object.assign(h.state.settings, { trustedIps: undefined });
          if (change === "addresses") trusted.addresses = [{ value: "192.0.2.2" }];
          if (change === "mode") trusted.protectionMode = "exclusive";
          if (change === "scope") trusted.deploymentType = "preview";
          if (change === "link") h.state.settings.link.productionBranch = "wrong";
        }
        return original(...args);
      });
      const result = await deploy(env, h.deps);
      expect(result.status).toBe("failed");
      expect(result.stages.at(-1)?.stage).toBe(stage);
      expect(writes(h)).toHaveLength(mutations);
    });
});
describe("native read-only deployment isolation inspection", () => {
  it.each([["--inspect-isolation"], ["--check-source", "--inspect-isolation"],
    ["--inspect-isolation", "--unknown"]])("fails closed with one plain JSON record for invalid CLI context %#", (...args) => {
    const child = spawnSync(process.execPath, ["--import", "tsx", resolve(import.meta.dirname, "../deploy-swim-review.ts"), ...args],
      { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 10_000 });
    expect(child.status).toBe(1);
    expect(child.stderr).toBe("");
    const lines = child.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ scope: "swim-review-deployment-inspection", status: "failed",
      stages: [{ stage: "source", code: "predicate_refused", status: "failed" }],
      writesAttempted: false, deploymentAttempted: false, deploymentAccepted: false,
      runtimePending: true, ownerLoginPending: true });
  });
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
  it.each(["main", "feature"])("refuses a changed live %s in native inspection source checks", (branch) => {
    const io = sourceIO();
    io.event = () => ({ inputs: { ...inputs, deploy_swim_review: "false", inspect_swim_review_deployment: "true" } });
    const original = io.git.getMockImplementation()!;
    io.git.mockImplementation((...args) => args[0] === "ls-remote" &&
      (args[3] === "refs/heads/main") === (branch === "main") ? "wrong" : original(...args));
    expect(() => verifyDeploymentSource(inspectionEnv, io, true)).toThrow();
  });
  it.each([...modes, "DEPLOY_SWIM_REVIEW"])("rejects mixed inspection/%s before any provider read", async (key) => {
    const h = harness();
    const result = await inspectIsolation({ ...inspectionEnv, [key]: "true" }, h.deps);
    expect(result.stages).toEqual([{ stage: "source", code: "predicate_refused", status: "failed" }]);
    expect(h.request).not.toHaveBeenCalled();
  });
  it.each([false, true])("emits one safe fixed schema after only five GETs with omission=%s", async (omitted) => {
    const h = harness();
    if (omitted) observedProtection(h);
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
      classifications: { project: { ssoProtection: { type: "object", deploymentType: omitted ? "all_except_custom_domains" : "all" },
        passwordProtection: { type: omitted ? "missing" : "null" }, trustedIps: { type: omitted ? "missing" : "null" } },
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
  it("never reads billing customer details or trusted IP values into diagnostics", async () => {
    const h = harness();
    const sensitive = vi.fn(() => { throw Error(canary); });
    const billing = { plan: "hobby" };
    const password = { deploymentType: "all" };
    for (const row of [billing, password]) {
      for (const key of ["password", "hash", "customerId", "address", "toJSON"]) {
        Object.defineProperty(row, key, { get: sensitive });
      }
    }
    Object.assign(h.state.settings, { passwordProtection: password,
      trustedIps: { deploymentType: "all", addresses: [{ value: canary }], protectionMode: "additional" } });
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (...args) => args[0] === DEPLOY_ROUTES.team ?
      { id: REVIEW.teamId, slug: "drrowdevs-projects", billing } : original(...args));
    const result = await inspectIsolation(inspectionEnv, h.deps);
    expect(result.status).toBe("inspection_pass");
    expect(sensitive).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(canary);
  });
  it.each(["id", "accountId", "name", "rootDirectory", "framework", "link"])("rejects wrong project %s", async (key) => {
    const h = harness();
    Object.assign(h.state.settings, { [key]: key === "link" ? { ...h.state.settings.link, productionBranch: "wrong" } : "wrong" });
    expect((await inspectIsolation(inspectionEnv, h.deps)).stages.at(-1)).toMatchObject({
      stage: "project", code: "project_identity", status: "failed",
    });
    expect(h.request).toHaveBeenCalledTimes(1);
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
  it.each([[undefined, "missing"], [null, "null"], [123, "invalid"], [{}, "object"], [canary, "other"]])(
    "classifies only fixed deploymentType and plan shapes %#", async (value, expected) => {
      const h = harness();
      Object.assign(h.state.settings.ssoProtection, { deploymentType: value });
      const project = await inspectIsolation(inspectionEnv, h.deps);
      expect(project.classifications.project?.ssoProtection).toEqual({ type: "object", deploymentType: expected });
      const f = harness();
      const original = f.request.getMockImplementation()!;
      f.request.mockImplementation(async (...args) => args[0] === DEPLOY_ROUTES.team ?
        { id: REVIEW.teamId, slug: "drrowdevs-projects", billing: { plan: value } } : original(...args));
      const team = await inspectIsolation(inspectionEnv, f.deps);
      expect(team.classifications.team?.billing).toEqual({ type: "object", plan: expected });
      expect(team.stages.at(-1)?.code).toBe("billing_plan");
      expect(JSON.stringify([project, team])).not.toContain(canary);
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
  it.each(INSPECTION_ROUTES)("stops at an HTTP failure on %s without a write or fallback", async (route) => {
    const h = harness();
    const original = h.request.getMockImplementation()!;
    const fake = vi.fn(async (url: string | URL | Request) => url === route ?
      new Response(canary, { status: 503 }) : new Response(JSON.stringify(await original(String(url)))));
    const request = deploymentTransport(inspectionEnv, Date.now() + 300_000, fake, true);
    const result = await inspectIsolation(inspectionEnv, { ...h.deps, request });
    expect(result.status).toBe("failed");
    expect(result.stages.at(-1)).toMatchObject({ code: "http_status", httpStatus: 503 });
    expect(fake.mock.calls.at(-1)?.[0]).toBe(route);
    expect(fake.mock.calls).toHaveLength(INSPECTION_ROUTES.indexOf(route) + 1);
    expect(result.writesAttempted).toBe(false);
    expect(JSON.stringify(result)).not.toContain(canary);
  });
});
