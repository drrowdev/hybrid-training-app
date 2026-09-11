import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  boundedTransport, configure, configurationContext, environmentList, ROUTES,
} from "../configure-swim-review";
import { INHERITED_KEYS, REVIEW, type EnvironmentMetadata } from "../swim-review-config-plan";

const canary = "offline_canary_never_emit_sensitive_content_42";
const env = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: REVIEW.repository, GITHUB_REF_TYPE: "branch",
  GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_JOB: "configure-swim-review",
  EXPECTED_SHA: "a".repeat(40), GITHUB_SHA: "a".repeat(40),
  CONFIGURE_SWIM_REVIEW: "true", PREPARE_SWIM_REVIEW: "false", INSPECT_SWIM_REVIEW: "false",
  SWIM_ACCEPTANCE: "false", MIGRATE_PRODUCTION: "false", ALLOW_UNDEPLOYED: "false",
  VERCEL_REVIEW_TOKEN: canary, SUPABASE_REVIEW_MANAGEMENT_TOKEN: canary,
  SWIM_REVIEW_SUPABASE_ANON_KEY: `sb_publishable_${canary}`,
  SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${canary}`,
  SWIM_REVIEW_DATABASE_URL: `postgresql://postgres.whwilnhqfiaquwxgkxwt:${canary}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres?sslmode=require`,
};
function entry(key: string, extra: Partial<EnvironmentMetadata> = {}): EnvironmentMetadata {
  return { id: `old_${key}`, key, type: "encrypted", target: ["preview"],
    gitBranch: null, createdAt: 1, updatedAt: 2, ...extra };
}
function fixture() {
  const prior = { site_url: "http://localhost:3000", uri_allow_list: "", disable_signup: false };
  const state = {
    auth: { ...prior }, project: [
      ...INHERITED_KEYS.map((key) => entry(key)),
      entry("PRODUCTION_ONLY", { target: ["production"] }),
    ],
    shared: [entry("DATABASE_URL", { id: "shared_db", target: ["production", "preview"] })],
    partial: false, uncertain: false, failReadback: false, concurrentAuth: false, concurrentEnv: false,
  };
  const request = vi.fn(async (url: string, method = "GET", body?: unknown): Promise<unknown> => {
    if (url === ROUTES.project) return {
      id: REVIEW.projectId, accountId: REVIEW.teamId, name: REVIEW.projectName,
      framework: "nextjs", rootDirectory: "apps/web", ignored: canary,
      link: { type: "github", org: "drrowdev", repo: "hybrid-training-app", productionBranch: "main", ignored: canary },
    };
    if (url === ROUTES.project_env) {
      if (state.failReadback && state.project.some((e) => e.gitBranch === REVIEW.branch)) {
        state.failReadback = false;
        if (state.concurrentEnv) state.project.find((e) => e.gitBranch === REVIEW.branch)!.updatedAt++;
        if (state.concurrentAuth) state.auth.site_url = "http://127.0.0.1:3000";
        throw new Error(canary);
      }
      return { envs: state.project.map((e) => ({ ...e, value: canary })) };
    }
    if (url === ROUTES.shared_env) return { data: state.shared, pagination: { count: 1, next: null } };
    if (url === ROUTES.supabase) return {
      id: REVIEW.supabaseId, name: REVIEW.supabaseName, organization_id: "ttxxqipkcgtirtmhhlnb",
      region: "eu-north-1", status: "ACTIVE_HEALTHY", ignored: canary,
    };
    if (url === ROUTES.auth) {
      if (method === "PATCH") state.auth = structuredClone(body) as typeof prior;
      return { ...state.auth, smtp_pass: canary };
    }
    if (url === ROUTES.settings) return { external: { email: true, google: false, phone: false } };
    if (url === ROUTES.alias) return { available: true };
    if (url === ROUTES.create) {
      const overrides = body as EnvironmentMetadata[];
      const created = overrides.slice(0, state.partial ? 2 : 18).map((e) =>
        entry(e.key, { id: `new_${e.key}`, gitBranch: REVIEW.branch }));
      state.project.push(...created);
      if (state.uncertain) throw new Error(canary);
      return { created: created.map((e) => ({ ...e, value: canary })),
        failed: state.partial ? overrides.slice(2).map((e) => ({ key: e.key, error: { message: canary } })) : [] };
    }
    if (method === "DELETE") {
      const id = url.split("/env/")[1]!.split("?")[0]!;
      state.project = state.project.filter((e) => e.id !== id);
      return null;
    }
    throw new Error(canary);
  });
  const deps = { request, source: vi.fn(), liveHead: vi.fn(), storage: vi.fn(async () => true),
    cron: () => `independent_${canary}` };
  return { state, deps, prior };
}
async function run(f = fixture(), values: NodeJS.ProcessEnv = env) {
  const output = await configure(values, f.deps);
  expect(JSON.stringify(output)).not.toContain(canary);
  expect(output.deploymentAttempted).toBe(false);
  expect(output.aliasCreated).toBe(false);
  return output;
}
describe("configuration-only runtime", () => {
  it("projects official envelopes, preserves production/shared metadata and creates only 18 encrypted preview overrides", async () => {
    const f = fixture();
    const protectedBefore = structuredClone(f.state);
    const output = await run(f);
    expect(output.status).toBe("configuration_pass");
    expect(output.createdEnv).toHaveLength(18);
    expect(output.protectedUnchanged).toEqual({ project: true, shared: true });
    expect(f.state.project.filter((e) => e.gitBranch === null)).toEqual(protectedBefore.project);
    expect(f.state.shared).toEqual(protectedBefore.shared);
    const writes = f.deps.request.mock.calls.filter(([, method]) => method && method !== "GET");
    expect(writes.map(([url, method]) => [url, method])).toEqual([
      [ROUTES.auth, "PATCH"], [ROUTES.create, "POST"],
    ]);
    for (const row of writes[1]![2] as EnvironmentMetadata[]) {
      expect(row).toMatchObject({ type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch });
    }
    expect(f.deps.liveHead).toHaveBeenCalledTimes(2);
  });
  it.each(Object.keys(env).filter((key) => !key.includes("TOKEN") && !key.includes("KEY") && !key.includes("URL")))(
    "rejects absent context field %s before any target access", async (key) => {
      const missing: NodeJS.ProcessEnv = { ...env };
      delete missing[key];
      const f = fixture();
      expect((await run(f, missing)).status).toBe("failed");
      expect(f.deps.request).not.toHaveBeenCalled();
    });
  it.each(["SWIM_REVIEW_SUPABASE_ANON_KEY", "SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY", "SWIM_REVIEW_DATABASE_URL"])(
    "rejects invalid modern credentials/target %s before HTTP", async (key) => {
      const f = fixture();
      expect((await run(f, { ...env, [key]: canary })).status).toBe("failed");
      expect(f.deps.request).not.toHaveBeenCalled();
    });
  it.each([ROUTES.project, ROUTES.project_env, ROUTES.shared_env, ROUTES.supabase,
    ROUTES.auth, ROUTES.settings, ROUTES.alias])("redacts refusal at API stage %s", async (route) => {
    const f = fixture();
    const original = f.deps.request.getMockImplementation()!;
    f.deps.request.mockImplementation(async (...args) => args[0] === route ? { error: canary } : original(...args));
    expect((await run(f)).status).toBe("failed");
    expect(f.deps.request.mock.calls.some(([, method]) => method === "PATCH" || method === "POST")).toBe(false);
  });
  it("refuses false readiness before writes", async () => {
    const f = fixture();
    f.deps.storage.mockResolvedValue(false);
    expect((await run(f)).stages.at(-1)?.stage).toBe("storage");
  });
  it("rolls back complete partial creation using only returned IDs", async () => {
    const f = fixture();
    f.state.partial = true;
    const output = await run(f);
    expect(output.rollback).toEqual({ environment: "restored", auth: "restored" });
    expect(f.state.auth).toEqual(f.prior);
    expect(f.deps.request.mock.calls.filter(([, method]) => method === "DELETE")).toHaveLength(2);
  });
  it("preserves uncertain creation without blind deletion", async () => {
    const f = fixture();
    f.state.uncertain = true;
    const output = await run(f);
    expect(output.partial).toBe(true);
    expect(output.rollback.environment).toBe("manual");
    expect(f.deps.request.mock.calls.some(([, method]) => method === "DELETE")).toBe(false);
  });
  it.each(["missing", "wrong_target", "duplicate", "old_id"])(
    "preserves overrides when created-ID evidence is %s", async (fault) => {
      const f = fixture();
      const original = f.deps.request.getMockImplementation()!;
      f.deps.request.mockImplementation(async (...args) => {
        const response = await original(...args);
        if (args[0] !== ROUTES.create) return response;
        const envelope = response as { created: EnvironmentMetadata[]; failed: unknown[] };
        if (fault === "missing") envelope.created.pop();
        if (fault === "wrong_target") envelope.created[0]!.target = ["production"];
        if (fault === "duplicate") envelope.created[1] = envelope.created[0]!;
        if (fault === "old_id") envelope.created[0]!.id = f.state.project[0]!.id;
        return envelope;
      });
      const output = await run(f);
      expect(output.rollback.environment).toBe("manual");
      expect(output.partial).toBe(true);
      expect(f.deps.request.mock.calls.some(([, method]) => method === "DELETE")).toBe(false);
    });
  it("never automatically restores an uncertain Auth write", async () => {
    const f = fixture();
    const original = f.deps.request.getMockImplementation()!;
    f.deps.request.mockImplementation(async (...args) => {
      const response = await original(...args);
      if (args[0] === ROUTES.auth && args[1] === "PATCH") throw new Error(canary);
      return response;
    });
    const output = await run(f);
    expect(output.rollback.auth).toBe("manual");
    expect(f.deps.request.mock.calls.filter(([, method]) => method === "PATCH")).toHaveLength(1);
    expect(f.deps.request.mock.calls.some(([url]) => url === ROUTES.create)).toBe(false);
  });
  it("preserves the original failure when cleanup itself fails", async () => {
    const f = fixture();
    f.state.partial = true;
    const original = f.deps.request.getMockImplementation()!;
    f.deps.request.mockImplementation(async (...args) => {
      if (args[1] === "DELETE") throw new Error(canary);
      return original(...args);
    });
    const output = await run(f);
    expect(output.stages.at(-1)).toMatchObject({ stage: "env_write", status: "failed" });
    expect(output.rollback.environment).toBe("manual");
  });
  it.each([{ email: false }, { email: true, google: true }, { email: true, unknown: canary }])(
    "refuses enabled or unknown external-provider state %#", async (external) => {
      const f = fixture();
      const original = f.deps.request.getMockImplementation()!;
      f.deps.request.mockImplementation(async (...args) =>
        args[0] === ROUTES.settings ? { external } : original(...args));
      expect((await run(f)).stages.at(-1)?.stage).toBe("settings");
    });
  it("restores known configuration after readback failure", async () => {
    const f = fixture();
    f.state.failReadback = true;
    expect((await run(f)).rollback).toEqual({ environment: "restored", auth: "restored" });
  });
  it("does not overwrite concurrent Auth edits or delete changed environment entries", async () => {
    const f = fixture();
    Object.assign(f.state, { failReadback: true, concurrentAuth: true, concurrentEnv: true });
    const output = await run(f);
    expect(output.rollback).toEqual({ environment: "manual", auth: "manual" });
    expect(f.state.auth.site_url).toBe("http://127.0.0.1:3000");
    expect(f.deps.request.mock.calls.some(([, method]) => method === "DELETE")).toBe(false);
  });
  it("does not clean up when live feature ownership changes", async () => {
    const f = fixture();
    f.deps.liveHead.mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error(canary); });
    expect((await run(f)).partial).toBe(true);
    expect(f.deps.request.mock.calls.some(([, method]) => method === "DELETE")).toBe(false);
  });
});
describe("bounded fixed-route transport and metadata", () => {
  it.each([{}, [], { data: [] }, { data: [], pagination: {} },
    { data: [], pagination: { count: 0, next: "cursor" } },
    { data: [], pagination: { count: 0, next: null, more: true } }])(
    "refuses incomplete shared metadata %#", (value) => expect(() => environmentList(value, true)).toThrow());
  it("accepts explicit terminal shared pagination and documented project envelope", () => {
    expect(environmentList({ data: [], pagination: { count: 0, next: null } }, true)).toEqual([]);
    expect(environmentList({ envs: [] }, false)).toEqual([]);
  });
  it.each([403, 500, 200])("does not mistake alias status %s for unallocated", async (status) => {
    const request = boundedTransport(env, Date.now() + 10_000,
      vi.fn(async () => new Response(JSON.stringify({ error: canary }), { status })));
    await expect(request(ROUTES.alias)).rejects.toThrow("http_status");
  });
  it("uses redirect:error, abort signal, fixed target and explicit 404", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
    const request = boundedTransport(env, Date.now() + 10_000, fetcher);
    expect(await request(ROUTES.alias)).toEqual({ available: true });
    expect(fetcher).toHaveBeenCalledWith(ROUTES.alias, expect.objectContaining({
      redirect: "error", signal: expect.any(AbortSignal),
    }));
    await expect(request("https://unapproved.invalid")).rejects.toThrow("predicate_refused");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds response bytes, redacts malformed bodies and does not retry writes", async () => {
    for (const body of [canary, "x".repeat(2 * 1024 * 1024 + 1)]) {
      const fetcher = vi.fn(async () => new Response(body));
      const request = boundedTransport(env, Date.now() + 10_000, fetcher);
      await expect(request(ROUTES.auth, "PATCH", {})).rejects.not.toThrow(canary);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("refuses expired overall deadline without HTTP", async () => {
    const fetcher = vi.fn();
    await expect(boundedTransport(env, Date.now() - 1, fetcher)(ROUTES.project)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("aborts an individual request within 30 seconds without exposing its error", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(new Error(canary)));
        }));
      const request = boundedTransport(env, Date.now() + 300_000, fetcher);
      const pending = expect(request(ROUTES.project)).rejects.toThrow("transport_failed");
      await vi.advanceTimersByTimeAsync(30_000);
      await pending;
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("requires the actual configuration job", () => {
    expect(() => configurationContext({ ...env, GITHUB_JOB: "prepare-swim-review" })).toThrow();
  });
});
describe("configuration workflow boundaries", () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const job = workflow.split("\n  configure-swim-review:\n")[1]!;
  it("preserves every previously published job byte-for-byte", () => {
    const prior = execFileSync("git", ["show", "b6e09d2240081472ba91f168d94aba3915316218:.github/workflows/ci.yml"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    expect(workflow.split("\n  configure-swim-review:\n")[0]!.trimEnd().split("\njobs:")[1])
      .toBe(prior.trimEnd().split("\njobs:")[1]);
  });
  it("places offline checks and source validation before exactly five runtime-only secrets", () => {
    expect(job).toContain("needs: [ci, identity-guard]");
    expect(job).toContain("cancel-in-progress: false");
    expect(job).toContain("environment: swim-review");
    expect(job).toContain("timeout-minutes: 12");
    expect(job).toContain("timeout-minutes: 7");
    expect(job.indexOf("vitest run")).toBeLessThan(job.indexOf("--check-source"));
    expect(job.indexOf("--check-source")).toBeLessThan(job.indexOf("secrets."));
    expect(job.match(/secrets\./g)).toHaveLength(5);
    expect(job).not.toMatch(/run:.*(?:vercel|db:migrate|db:seed|prepare-swim-review\.ts)/);
  });
});
