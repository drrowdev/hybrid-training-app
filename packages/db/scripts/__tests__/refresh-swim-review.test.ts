import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OTHER_OPERATIONS, REFRESH_PATHS, REFRESH_REFERENCE, refreshArguments, refreshContext, verifyRefreshSource,
  refresh, refreshTransport } from "../refresh-swim-review";
import { ACCEPTED_DEPLOYMENT, BASE_SHA, CONFIGURATION, DEPLOY_ROUTES, RECEIPT, deploymentRoute,
  updateRoute } from "../deploy-swim-review";
import { metadata, ROUTES, storageAdapter } from "../configure-swim-review";
import { INHERITED_KEYS, OVERRIDE_KEYS, REVIEW, type EnvironmentMetadata } from "../swim-review-config-plan";

const sha = "b".repeat(40);
const canary = "offline_sensitive_canary_never_emit_12345";
const env: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF_TYPE: "branch", GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_JOB: "refresh-swim-review",
  GITHUB_SHA: sha, EXPECTED_SHA: sha, REFRESH_SWIM_REVIEW: "true",
  ...Object.fromEntries(OTHER_OPERATIONS.map((key) => [key, "false"])),
  VERCEL_REVIEW_TOKEN: canary, SUPABASE_REVIEW_MANAGEMENT_TOKEN: canary,
  SWIM_REVIEW_SUPABASE_ANON_KEY: `sb_publishable_${canary}`,
  SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${canary}`,
};
afterEach(() => vi.restoreAllMocks());
function sourceIO() {
  return {
    regular: () => true,
    event: () => ({ inputs: { refresh_swim_review: "true", expected_sha: sha,
      ...Object.fromEntries(OTHER_OPERATIONS.map((key) => [key.toLowerCase(), "false"])) } }),
    git: vi.fn((...args: string[]) => {
      if (args[0] === "rev-parse") return sha;
      if (args[0] === "status" || args[0] === "merge-base") return "";
      if (args[0] === "diff") return REFRESH_PATHS.join("\n");
      if (args[0] === "ls-tree") return REFRESH_PATHS.map((path) => `100644 blob ${sha}\t${path}`).join("\n");
      if (args[0] === "ls-remote") return `${args[3] === "refs/heads/main" ? BASE_SHA : sha}\t${args[3]}`;
      throw Error("offline_canary");
    }),
  };
}
function checkRefreshEvent(inputs: Record<string, unknown> | undefined, context: NodeJS.ProcessEnv) {
  if (inputs?.refresh_swim_review === undefined || inputs.refresh_swim_review === "false") return false;
  expect(inputs.refresh_swim_review).toBe("true");
  expect(OTHER_OPERATIONS.every((key) => inputs[key.toLowerCase()] === "false")).toBe(true);
  expect(context.GITHUB_ACTIONS).toBe("true");
  expect(context.GITHUB_EVENT_NAME).toBe("workflow_dispatch");
  expect(context.GITHUB_REPOSITORY).toBe(REVIEW.repository);
  expect(context.GITHUB_REF_TYPE).toBe("branch");
  expect(context.GITHUB_REF).toBe(`refs/heads/${REVIEW.branch}`);
  expect(inputs.expected_sha).toMatch(/^[a-f0-9]{40}$/);
  expect(inputs.expected_sha).toBe(context.GITHUB_SHA);
  return true;
}

describe("refresh workflow boundaries", () => {
  const workflow = readFileSync(resolve(__dirname, "../../../../.github/workflows/ci.yml"), "utf8");
  const job = workflow.split("\n  refresh-swim-review:\n")[1]!;

  it("rejects mixed refresh dispatches in prerequisite CI before any privileged job", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as {
      inputs?: Record<string, unknown>;
    };
    checkRefreshEvent(event.inputs, process.env);
  });
  it("validates the real dispatch in core without impersonating the privileged job", () => {
    expect(checkRefreshEvent(sourceIO().event().inputs, { ...env, GITHUB_JOB: "ci" })).toBe(true);
  });
  it.each(OTHER_OPERATIONS)("rejects refresh mixed with or missing explicit false for %s", (key) => {
    for (const value of ["true", undefined]) {
      const inputs = sourceIO().event().inputs;
      Reflect.set(inputs, key.toLowerCase(), value);
      expect(() => checkRefreshEvent(inputs, env)).toThrow();
    }
  });
  it.each(OTHER_OPERATIONS)("leaves existing %s dispatches to their original guards", (key) => {
    expect(checkRefreshEvent(undefined, env)).toBe(false);
    for (const refresh of [undefined, "false"]) {
      expect(checkRefreshEvent({ refresh_swim_review: refresh, [key.toLowerCase()]: "true" }, env)).toBe(false);
    }
  });
  it.each(["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REF_TYPE", "GITHUB_REF", "GITHUB_SHA"])(
    "rejects incorrect dispatch %s", (key) => {
      expect(() => checkRefreshEvent(sourceIO().event().inputs, { ...env, [key]: "wrong" })).toThrow();
    });
  it.each(["", "wrong", undefined])("rejects invalid expected SHA %#", (expected) => {
    expect(() => checkRefreshEvent({ ...sourceIO().event().inputs, expected_sha: expected }, env)).toThrow();
  });
  it.each(["yes", true, null])("rejects malformed refresh flags %#", (value) => {
    expect(() => checkRefreshEvent({ ...sourceIO().event().inputs, refresh_swim_review: value }, env)).toThrow();
  });
  it("runs through existing package discovery without modifying frozen core jobs", () => {
    const config = readFileSync(resolve(__dirname, "../../vitest.config.ts"), "utf8");
    expect(config).toContain('"scripts/__tests__/**/*.test.ts"');
    expect(workflow).toContain("run: pnpm -r --filter './packages/**' test");
    expect(REFRESH_PATHS).toContain("packages/db/scripts/__tests__/refresh-swim-review.test.ts");
  });
  it("requires the exact manual feature context and both existing prerequisites", () => {
    expect(workflow.match(/\n  refresh-swim-review:/g)).toHaveLength(1);
    expect(workflow).toMatch(/refresh_swim_review:\n\s+description:.*\n\s+required: false\n\s+default: false\n\s+type: boolean/);
    for (const gate of [
      "needs: [ci, identity-guard]", "github.event_name == 'workflow_dispatch'",
      "github.repository == 'drrowdev/hybrid-training-app'", "github.ref_type == 'branch'",
      "github.ref == 'refs/heads/copilot/new-acceptance-cases'", "inputs.refresh_swim_review == true",
      "inputs.expected_sha != '' && inputs.expected_sha == github.sha",
      ...OTHER_OPERATIONS.map((key) => `inputs.${key.toLowerCase()} == false`),
      "environment: swim-review", "contents: read", "fetch-depth: 0", "persist-credentials: false",
      "ref: ${{ inputs.expected_sha }}", "group: swim-review-bootstrap", "cancel-in-progress: false",
      "timeout-minutes: 25", "timeout-minutes: 20", "node-version: 22",
      "REFRESH_SWIM_REVIEW: ${{ inputs.refresh_swim_review }}", "EXPECTED_SHA: ${{ inputs.expected_sha }}",
      ...OTHER_OPERATIONS.map((key) => `${key}: \${{ inputs.${key.toLowerCase()} }}`),
    ]) expect(job).toContain(gate);
    const concurrency = workflow.split("\nconcurrency:\n")[1]!.split("\njobs:\n")[0]!;
    expect(concurrency.match(/inputs\.refresh_swim_review/g)).toHaveLength(2);
    expect(concurrency).toContain("'ci-swim-review-configuration'");
  });
  it("keeps four credentials only in the final step after offline and strict source checks", () => {
    const [before, operation] = job.split("      - name: Refresh existing isolated review\n");
    expect(before).not.toContain("secrets.");
    expect(before!.indexOf("pnpm install")).toBeLessThan(before!.indexOf("vitest run"));
    expect(before!.indexOf("vitest run")).toBeLessThan(before!.indexOf("--check-source"));
    expect(before).toContain("tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --esModuleInterop --skipLibCheck --strict scripts/refresh-swim-review.ts");
    expect(operation!.match(/secrets\.\w+/g)).toEqual([
      "secrets.VERCEL_REVIEW_TOKEN", "secrets.SUPABASE_REVIEW_MANAGEMENT_TOKEN",
      "secrets.SWIM_REVIEW_SUPABASE_ANON_KEY", "secrets.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY",
    ]);
    expect(operation).toContain("run: pnpm --filter @hta/db exec tsx scripts/refresh-swim-review.ts");
    expect(job).not.toContain("DATABASE_URL");
    expect(job).not.toContain("secrets.SWIM_REVIEW_OWNER_");
  });
});

describe("bounded refresh source and transport", () => {
  it("uses a separate accepted-source guard and strict CLI", () => {
    const io = sourceIO();
    verifyRefreshSource(env, io);
    expect(io.git).toHaveBeenCalledWith("merge-base", "--is-ancestor", REFRESH_REFERENCE.sha, "HEAD");
    expect(refreshArguments([])).toBe(false);
    expect(refreshArguments(["--check-source"])).toBe(true);
    for (const args of [["--deploy"], ["--check-source", "--check-source"], ["--check-source", "x"]]) {
      expect(() => refreshArguments(args)).toThrow();
    }
  });

  function harness() {
    const now = ACCEPTED_DEPLOYMENT.end + 60_000;
    const deployment = (id: string, url: string, sourceSha: string, createdAt: number) => ({
      id, url, readyState: "READY", createdAt, projectId: REVIEW.projectId, ownerId: REVIEW.teamId,
      target: null as string | null,
      gitSource: { type: "github", ref: REVIEW.branch, sha: sourceSha },
      meta: { githubCommitSha: sourceSha, githubCommitRef: REVIEW.branch,
        githubCommitOrg: "drrowdev", githubCommitRepo: "hybrid-training-app" },
    });
    const project: EnvironmentMetadata[] = OVERRIDE_KEYS.map((key) => ({
      id: RECEIPT[key], key, type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch,
      createdAt: CONFIGURATION.start + 1000,
      updatedAt: key === "NEXT_PUBLIC_BUILD_SHA" || key === "POOL_SWIMMING_ENABLED" ?
        ACCEPTED_DEPLOYMENT.start + 1000 : CONFIGURATION.end - 1000,
    }));
    const shared: EnvironmentMetadata[] = INHERITED_KEYS.map((key) => ({
      id: `shared_${key}`, key, type: "encrypted", target: ["preview"], gitBranch: null, createdAt: 1, updatedAt: 1,
    }));
    const state = {
      now, project, shared,
      protection: { id: REVIEW.projectId, accountId: REVIEW.teamId, name: REVIEW.projectName,
        rootDirectory: "apps/web", framework: "nextjs",
        link: { type: "github", org: "drrowdev", repo: "hybrid-training-app", productionBranch: "main" },
        ssoProtection: { deploymentType: "all_except_custom_domains" } },
      team: { id: REVIEW.teamId, slug: "drrowdevs-projects", billing: { plan: "hobby" } },
      supabase: { id: REVIEW.supabaseId, name: REVIEW.supabaseName, organization_id: REVIEW.organizationId,
        region: REVIEW.region, status: "ACTIVE_HEALTHY" },
      auth: { site_url: REVIEW.origin, uri_allow_list: `${REVIEW.origin}/auth/callback`, disable_signup: true },
      settings: { external: { email: true, github: false } },
      old: deployment(ACCEPTED_DEPLOYMENT.id, ACCEPTED_DEPLOYMENT.url, ACCEPTED_DEPLOYMENT.sha, ACCEPTED_DEPLOYMENT.start + 1000),
      next: deployment("dpl_RefreshOffline123", "hybrid-training-app-refresh-offline.vercel.app", sha, now),
      alias: { uid: "alias_offline", alias: REVIEW.proposedAlias, projectId: REVIEW.projectId,
        deploymentId: String(ACCEPTED_DEPLOYMENT.id), redirect: null as string | null },
    };
    const request = vi.fn(async (url: string, method = "GET", _body?: unknown): Promise<unknown> => {
      if (url === ROUTES.project) return state.protection;
      if (url === DEPLOY_ROUTES.team) return state.team;
      if (url === ROUTES.supabase) return state.supabase;
      if (url === ROUTES.project_env) return { envs: state.project, hiddenProductionEnvCount: 0 };
      if (url === ROUTES.shared_env) return { data: state.shared, pagination: { count: state.shared.length, next: null } };
      if (url === ROUTES.auth) return state.auth;
      if (url === ROUTES.settings) return state.settings;
      if (url === ROUTES.alias) return state.alias;
      if (url === ROUTES.storage) return true;
      if (url === deploymentRoute(ACCEPTED_DEPLOYMENT.id)) return state.old;
      if (url === updateRoute("NEXT_PUBLIC_BUILD_SHA") && method === "PATCH") {
        const index = state.project.findIndex((row) => row.id === RECEIPT.NEXT_PUBLIC_BUILD_SHA);
        state.project[index] = { ...metadata(state.project[index]), updatedAt: state.now };
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
    const deps = { request, source: vi.fn(), storage: vi.fn(async () => true), now: () => state.now,
      sleep: vi.fn(async (ms: number) => { state.now += ms; }) };
    return { state, request, deps };
  }
  const writes = (h: ReturnType<typeof harness>) =>
    h.request.mock.calls.filter(([url, method]) => method && method !== "GET" && url !== ROUTES.storage);

  describe("refresh old-to-new state machine", () => {
    it("patches only BUILD_SHA, creates one exact-SHA Preview, preserves alias UID and all protected state", async () => {
      const h = harness();
      const before = structuredClone(h.state.project);
      const result = await refresh(env, h.deps);
      expect(result.status).toBe("refresh_pass");
      expect(writes(h)).toEqual([
        [updateRoute("NEXT_PUBLIC_BUILD_SHA"), "PATCH", { key: "NEXT_PUBLIC_BUILD_SHA", value: sha,
          type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch }],
        [DEPLOY_ROUTES.create, "POST", { name: REVIEW.projectName, project: REVIEW.projectId,
          gitSource: { type: "github", org: "drrowdev", repo: "hybrid-training-app", ref: REVIEW.branch, sha } }],
        [deploymentRoute(h.state.next.id, true), "POST", { alias: REVIEW.proposedAlias }],
      ]);
      expect(h.state.project.filter((row) => row.key !== "NEXT_PUBLIC_BUILD_SHA")).toEqual(before.filter((row) => row.key !== "NEXT_PUBLIC_BUILD_SHA"));
      expect(result).toMatchObject({ protectedUnchanged: true, authMatches: true, isolationVerified: true, storageReady: true,
        ready: true, partial: false, manualReconciliation: false, alias: { attempted: true, confirmed: true },
        aliasMapping: { uid: "alias_offline", deploymentId: h.state.next.id } });
      expect(result.changedEnv).toEqual([{ key: "NEXT_PUBLIC_BUILD_SHA", id: RECEIPT.NEXT_PUBLIC_BUILD_SHA }]);
      expect(JSON.stringify(result)).not.toContain(canary);
    });
    it("runs the full flow through the stricter bounded HTTP transport", async () => {
      const h = harness();
      vi.spyOn(Date, "now").mockImplementation(() => h.state.now);
      const fetcher = vi.fn<typeof fetch>(async (url, init) => {
        expect(init?.redirect).toBe("error");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Response(JSON.stringify(await h.request(String(url), init?.method)), { status: 200 });
      });
      const transport = refreshTransport(env, h.state.now + 18 * 60_000, fetcher);
      const result = await refresh(env, { ...h.deps, request: transport, storage: storageAdapter(env, transport) });
      expect(result.status).toBe("refresh_pass");
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
      expect(fetcher.mock.calls.filter(([url, init]) => init?.method === "POST" && String(url) !== ROUTES.storage)).toHaveLength(2);
      expect(fetcher.mock.calls.some(([url, init]) => String(url) === ROUTES.storage && init?.body === "{}")).toBe(true);
    });

    describe("refresh boundary failures", () => {
      it.each(OTHER_OPERATIONS)("requires explicit false for event input %s", (key) => {
        for (const value of [undefined, "true"]) {
          const io = sourceIO();
          const event = io.event();
          Reflect.set(event.inputs, key.toLowerCase(), value);
          io.event = () => event;
          expect(() => verifyRefreshSource(env, io)).toThrow();
        }
      });
      it.each([[], ["--check-source"], ["--check-source", "--check-source"], ["--unknown"]].map((args) => ({ args })))(
        "emits one safe record without credentials for refused CLI $args", ({ args }) => {
          const child = spawnSync(process.execPath, ["--import", "tsx",
            resolve(__dirname, "../refresh-swim-review.ts"), ...args],
          { cwd: resolve(__dirname, "../.."), env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 10_000 });
          expect(child.status).toBe(1);
          expect(child.stderr).toBe("");
          expect(child.stdout.trim().split("\n")).toHaveLength(1);
          expect(JSON.parse(child.stdout)).toMatchObject({ scope: "swim-review-refresh", status: "failed",
            buildSha: { attempted: false }, deployment: { attempted: false }, alias: { attempted: false } });
        });
      it.each(["redirect", "oversized_header", "oversized_stream", "bad_json", "timeout", "http_error"])(
        "bounds and refuses %s responses", async (kind) => {
          const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
            expect(init?.redirect).toBe("error");
            if (kind === "redirect") throw new TypeError(canary);
            if (kind === "timeout") return new Promise((_done, reject) =>
              init?.signal?.addEventListener("abort", () => reject(Error(canary)), { once: true }));
            if (kind === "oversized_header") return new Response("{}", { headers: { "content-length": String(2 * 1024 * 1024 + 1) } });
            if (kind === "oversized_stream") return new Response(" ".repeat(2 * 1024 * 1024 + 1));
            if (kind === "bad_json") return new Response(canary);
            return new Response(canary, { status: 503 });
          });
          if (kind === "timeout") vi.useFakeTimers();
          try {
            const transport = refreshTransport(env, Date.now() + 60_000, fetcher);
            const pending = expect(transport(ROUTES.project)).rejects.toThrow();
            if (kind === "timeout") await vi.advanceTimersByTimeAsync(30_001);
            await pending;
            expect(fetcher).toHaveBeenCalledTimes(1);
          } finally { vi.useRealTimers(); }
        });
      it("does not retry an ambiguous permitted PATCH and refuses other bodies", async () => {
        const fetcher = vi.fn<typeof fetch>(async () => { throw Error(canary); });
        const transport = refreshTransport(env, Date.now() + 60_000, fetcher);
        const body = { key: "NEXT_PUBLIC_BUILD_SHA", type: "encrypted", target: ["preview"],
          gitBranch: REVIEW.branch, value: sha };
        for (const patch of [{ ...body, target: ["production"] }, { ...body, gitBranch: "main" },
          { ...body, value: "a".repeat(40) }, { ...body, extra: true }]) {
          await expect(transport(updateRoute("NEXT_PUBLIC_BUILD_SHA"), "PATCH", patch)).rejects.toThrow();
        }
        expect(fetcher).not.toHaveBeenCalled();
        await expect(transport(updateRoute("NEXT_PUBLIC_BUILD_SHA"), "PATCH", body)).rejects.toThrow();
        await expect(transport(updateRoute("NEXT_PUBLIC_BUILD_SHA"), "PATCH", body)).rejects.toThrow();
        expect(fetcher).toHaveBeenCalledTimes(1);
      });
    });
    it.each(["receipt", "alias_missing", "alias_moved", "alias_uid", "alias_redirect", "alias_project",
      "protection", "auth", "external", "storage", "team", "supabase", "old_sha", "old_url", "old_time", "old_not_ready"])(
      "refuses %s before any write", async (kind) => {
        const h = harness();
        if (kind === "receipt") h.state.project[0]!.updatedAt = ACCEPTED_DEPLOYMENT.end + 1;
        if (kind === "alias_missing") Reflect.deleteProperty(h.state.alias, "uid");
        if (kind === "alias_moved") h.state.alias.deploymentId = "dpl_Other";
        if (kind === "alias_uid") h.state.alias.uid = "bad\nuid";
        if (kind === "alias_redirect") h.state.alias.redirect = REVIEW.origin;
        if (kind === "alias_project") Reflect.set(h.state.alias, "projectId", "prj_other");
        if (kind === "protection") h.state.protection.ssoProtection.deploymentType = "all";
        if (kind === "auth") h.state.auth.disable_signup = false;
        if (kind === "external") h.state.settings.external.github = true;
        if (kind === "storage") h.deps.storage.mockResolvedValue(false);
        if (kind === "team") h.state.team.billing.plan = "pro";
        if (kind === "supabase") Reflect.set(h.state.supabase, "organization_id", "org_wrong");
        if (kind === "old_sha") h.state.old.gitSource.sha = sha;
        if (kind === "old_url") h.state.old.url = h.state.next.url;
        if (kind === "old_time") h.state.old.createdAt = h.state.now;
        if (kind === "old_not_ready") h.state.old.readyState = "BUILDING";
        expect(await refresh(env, h.deps)).toMatchObject({ status: "failed", partial: false, manualReconciliation: false });
        expect(writes(h)).toHaveLength(0);
      });
    it.each(["target", "branch", "sha", "project", "owner", "time", "old_id", "url"])("refuses new deployment %s", async (kind) => {
      const h = harness();
      if (kind === "target") h.state.next.target = "production";
      if (kind === "branch") Reflect.set(h.state.next.gitSource, "ref", "main");
      if (kind === "sha") h.state.next.meta.githubCommitSha = ACCEPTED_DEPLOYMENT.sha;
      if (kind === "project") Reflect.set(h.state.next, "projectId", "prj_other");
      if (kind === "owner") Reflect.set(h.state.next, "ownerId", "team_other");
      if (kind === "time") h.state.next.createdAt--;
      if (kind === "old_id") h.state.next.id = ACCEPTED_DEPLOYMENT.id;
      if (kind === "url") h.state.next.url = "https://example.com";
      expect(await refresh(env, h.deps)).toMatchObject({ status: "failed", partial: true,
        deployment: { attempted: true, confirmed: false }, alias: { attempted: false, confirmed: false } });
      expect(writes(h)).toHaveLength(2);
    });
    it.each(["build_sha", "deployment", "alias"])("retains ambiguous %s truth without retries or rollback", async (kind) => {
      const h = harness();
      const original = h.request.getMockImplementation()!;
      const url = kind === "build_sha" ? updateRoute("NEXT_PUBLIC_BUILD_SHA") :
        kind === "deployment" ? DEPLOY_ROUTES.create : deploymentRoute(h.state.next.id, true);
      h.request.mockImplementation(async (...args) => {
        const value = await original(...args);
        if (args[0] === url) throw Error(canary);
        return value;
      });
      const result = await refresh(env, h.deps);
      expect(result).toMatchObject({ status: "failed", partial: true, manualReconciliation: true });
      expect(result[kind === "build_sha" ? "buildSha" : kind]).toEqual({ attempted: true, confirmed: false });
      expect(h.request.mock.calls.filter(([route]) => route === url)).toHaveLength(1);
      expect(writes(h).every(([, method]) => method === "POST" || method === "PATCH")).toBe(true);
      expect(JSON.stringify(result)).not.toContain(canary);
    });
    it.each(["project", "shared", "auth", "protection", "optional_missing", "source", "alias"])("stops %s drift after SHA write", async (kind) => {
      const h = harness();
      const original = h.request.getMockImplementation()!;
      h.request.mockImplementation(async (...args) => {
        const value = await original(...args);
        if (args[1] === "PATCH") {
          if (kind === "project") h.state.project[0]!.updatedAt++;
          if (kind === "shared") h.state.shared[0]!.updatedAt++;
          if (kind === "auth") h.state.auth.site_url = "https://wrong.example";
          if (kind === "protection") h.state.protection.ssoProtection.deploymentType = "preview";
          if (kind === "optional_missing") Reflect.set(h.state.protection, "passwordProtection", null);
          if (kind === "source") h.deps.source.mockImplementation(() => { throw Error(canary); });
          if (kind === "alias") h.state.alias.uid = "alias_changed";
        }
        return value;
      });
      expect(await refresh(env, h.deps)).toMatchObject({ status: "failed", partial: true,
        buildSha: { attempted: true, confirmed: false }, deployment: { attempted: false } });
      expect(writes(h)).toHaveLength(1);
    });
    it.each(["oldDeploymentId", "uid", "post_mapping", "post_ready", "pre_mapping"])("detects alias %s race without restore", async (kind) => {
      const h = harness();
      const original = h.request.getMockImplementation()!;
      let created = false;
      h.request.mockImplementation(async (...args) => {
        if (args[0] === DEPLOY_ROUTES.create) created = true;
        if (kind === "pre_mapping" && created && args[0] === ROUTES.alias) h.state.alias.deploymentId = "dpl_Race";
        const value = await original(...args);
        if (args[0] === deploymentRoute(h.state.next.id, true)) {
          if (kind === "oldDeploymentId" || kind === "uid") return { alias: REVIEW.proposedAlias,
            uid: kind === "uid" ? "alias_Race" : "alias_offline",
            oldDeploymentId: kind === "oldDeploymentId" ? "dpl_Race" : ACCEPTED_DEPLOYMENT.id };
          if (kind === "post_mapping") h.state.alias.deploymentId = "dpl_Race";
          if (kind === "post_ready") h.state.next.readyState = "ERROR";
        }
        return value;
      });
      expect(await refresh(env, h.deps)).toMatchObject({ status: "failed", manualReconciliation: true,
        alias: { confirmed: false }, aliasMapping: null });
      expect(writes(h)).toHaveLength(kind === "pre_mapping" ? 2 : 3);
    });
    it("bounds READY polling to ten minutes", async () => {
      const h = harness();
      h.state.next.readyState = "BUILDING";
      const start = h.state.now;
      expect(await refresh(env, h.deps)).toMatchObject({ status: "failed", partial: true, ready: false, alias: { attempted: false } });
      expect(h.state.now - start).toBe(10 * 60_000);
      expect(writes(h)).toHaveLength(2);
    });
    it("bounds the total operation to eighteen minutes, including reads", async () => {
      const h = harness();
      const original = h.request.getMockImplementation()!;
      h.request.mockImplementation(async (...args) => {
        h.state.now += 2 * 60_000;
        return original(...args);
      });
      expect(await refresh(env, h.deps)).toMatchObject({ status: "failed", partial: false });
      expect(writes(h)).toHaveLength(0);
    });
    it("never reads secret getters or emits raw failure content", async () => {
      const h = harness();
      for (const object of [h.state.auth, h.state.protection, ...h.state.project]) {
        for (const key of ["value", "password", "passwordHash", "secret"]) {
          Object.defineProperty(object, key, { enumerable: true, get() { throw Error(canary); } });
        }
      }
      const result = await refresh(env, h.deps);
      expect(result.status).toBe("refresh_pass");
      expect(JSON.stringify(result)).not.toContain(canary);
    });
  });
  it.each([...OTHER_OPERATIONS, "GITHUB_JOB", "GITHUB_SHA", "EXPECTED_SHA", "GITHUB_REF", "GITHUB_REPOSITORY",
    "GITHUB_EVENT_NAME", "GITHUB_REF_TYPE", "GITHUB_ACTIONS", "REFRESH_SWIM_REVIEW"])("rejects missing or mixed %s", (key) => {
    expect(() => refreshContext({ ...env, [key]: undefined })).toThrow();
    expect(() => refreshContext({ ...env, [key]: "wrong" })).toThrow();
  });
  it.each(["diff", "status", "rev-parse", "ls-tree", "ls-remote", "merge-base", "regular", "event"])("refuses %s drift", (kind) => {
    const io = sourceIO();
    const original = io.git.getMockImplementation()!;
    io.git.mockImplementation((...args) => {
      if (args[0] === kind) { if (kind === "merge-base") throw Error("offline_canary"); return "wrong"; }
      return original(...args);
    });
    if (kind === "regular") io.regular = () => false;
    if (kind === "event") io.event = () => ({ inputs: { refresh_swim_review: "false", expected_sha: sha } });
    expect(() => verifyRefreshSource(env, io)).toThrow();
  });
  it.each([
    ["https://api.vercel.com/v2/user", "GET", undefined],
    [ROUTES.auth, "PATCH", {}], [ROUTES.storage, "POST", { sql: "forbidden" }],
    [updateRoute("POOL_SWIMMING_ENABLED"), "PATCH", {}],
    [ROUTES.project_env.replace("decrypt=false", "decrypt=true"), "GET", undefined],
    [ROUTES.project, "DELETE", undefined], [ROUTES.project, "GET", {}],
    [ROUTES.storage.replace("swim_storage_ready", "other"), "POST", {}],
  ])("denies unapproved request %s %s", async (url, method, body) => {
    const fetcher = vi.fn<typeof fetch>();
    const request = refreshTransport(env, Date.now() + 60_000, fetcher);
    await expect(request(String(url), String(method), body)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
