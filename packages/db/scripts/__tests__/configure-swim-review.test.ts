import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  boundedTransport, configure, configurationContext, environmentList, ROUTES, storageAdapter,
} from "../configure-swim-review";
import { INHERITED_KEYS, PlanFailure, REVIEW, type EnvironmentMetadata } from "../swim-review-config-plan";

const canary = "offline_canary_never_emit_sensitive_content_42";
// https://vercel.com/docs/rest-api/projects/retrieve-the-environment-variables-of-a-project-by-id-or-name
const officialProjectList = {
  envs: [
    { id: "old_STRAVA_REDIRECT_URI", key: "STRAVA_REDIRECT_URI", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_ADMIN_EMAILS", key: "ADMIN_EMAILS", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_STRAVA_WEBHOOK_SUBSCRIPTION_ID", key: "STRAVA_WEBHOOK_SUBSCRIPTION_ID", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_STRAVA_CLIENT_SECRET", key: "STRAVA_CLIENT_SECRET", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_STRAVA_CLIENT_ID", key: "STRAVA_CLIENT_ID", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_STRAVA_WEBHOOK_CALLBACK_URL", key: "STRAVA_WEBHOOK_CALLBACK_URL", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_STRAVA_WEBHOOK_VERIFY_TOKEN", key: "STRAVA_WEBHOOK_VERIFY_TOKEN", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_MCP_TOKEN_SIGNING_KEY", key: "MCP_TOKEN_SIGNING_KEY", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_AI_KEY_ENCRYPTION_KEY", key: "AI_KEY_ENCRYPTION_KEY", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_CRON_SECRET", key: "CRON_SECRET", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_NEXT_PUBLIC_SITE_URL", key: "NEXT_PUBLIC_SITE_URL", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_NEXT_PUBLIC_SUPABASE_URL", key: "NEXT_PUBLIC_SUPABASE_URL", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_NEXT_PUBLIC_SUPABASE_ANON_KEY", key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_SUPABASE_SERVICE_ROLE_KEY", key: "SUPABASE_SERVICE_ROLE_KEY", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
    { id: "old_DATABASE_URL", key: "DATABASE_URL", type: "encrypted",
      target: ["production", "preview", "development"], gitBranch: null, createdAt: 1, updatedAt: 2 },
  ],
  hiddenProductionEnvCount: 0,
} satisfies { envs: EnvironmentMetadata[]; hiddenProductionEnvCount: number };
// https://vercel.com/docs/rest-api/projects/create-one-or-more-environment-variables
const officialPartialFailure = [
  { error: { key: "STRAVA_WEBHOOK_SUBSCRIPTION_ID", code: "ENV_CONFLICT", message: canary, value: canary } },
  { error: { key: "STRAVA_CLIENT_SECRET" } },
  { error: { key: "STRAVA_CLIENT_ID" } },
  { error: { key: "STRAVA_WEBHOOK_CALLBACK_URL" } },
  { error: { key: "STRAVA_WEBHOOK_VERIFY_TOKEN" } },
  { error: { key: "MCP_TOKEN_SIGNING_KEY" } },
  { error: { key: "AI_KEY_ENCRYPTION_KEY" } },
  { error: { key: "CRON_SECRET" } },
  { error: { key: "NEXT_PUBLIC_SITE_URL" } },
  { error: { key: "NEXT_PUBLIC_SUPABASE_URL" } },
  { error: { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY" } },
  { error: { key: "SUPABASE_SERVICE_ROLE_KEY" } },
  { error: { key: "DATABASE_URL" } },
  { error: { key: "POOL_SWIMMING_ENABLED" } },
  { error: { key: "ENABLE_E2E_FIXTURES" } },
  { error: { key: "NEXT_PUBLIC_BUILD_SHA" } },
];
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
        failed: state.partial ? structuredClone(officialPartialFailure) : [] };
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
  for (const [url, , body] of f.deps.request.mock.calls) {
    if (url === ROUTES.create) {
      expect(body).toEqual(expect.arrayContaining([{ key: "POOL_SWIMMING_ENABLED", value: "false",
        type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch }]));
      expect((body as { value: string }[]).some((row) => row.value === "true")).toBe(false);
    }
  }
  return output;
}
describe("configuration-only runtime", () => {
  it("configures all 18 branch-only overrides from the documented 15-entry zero-hidden fixture after isolation checks", async () => {
    const f = fixture();
    f.state.project = structuredClone(officialProjectList.envs);
    const protectedBefore = structuredClone(f.state);
    const original = f.deps.request.getMockImplementation()!;
    f.deps.request.mockImplementation(async (...args) => {
      const response = await original(...args);
      return args[0] === ROUTES.project_env ? { ...officialProjectList, envs: f.state.project } : response;
    });
    const output = await run(f);
    expect(output.status).toBe("configuration_pass");
    expect(output.createdEnv).toHaveLength(18);
    expect(output.protectedUnchanged).toEqual({ project: true, shared: true });
    expect(f.state.project.filter((e) => e.gitBranch === null)).toEqual(officialProjectList.envs);
    expect(f.state.shared).toEqual(protectedBefore.shared);
    const calls = f.deps.request.mock.calls;
    const firstWrite = calls.findIndex(([, method]) => method !== undefined && method !== "GET");
    expect(calls.slice(0, firstWrite).map(([url]) => url)).toEqual([
      ROUTES.project, ROUTES.project_env, ROUTES.shared_env, ROUTES.supabase, ROUTES.auth,
      ROUTES.settings, ROUTES.alias, ROUTES.project_env, ROUTES.shared_env, ROUTES.auth,
    ]);
    expect(f.deps.source.mock.invocationCallOrder[0]).toBeLessThan(f.deps.request.mock.invocationCallOrder[0]!);
    expect(f.deps.storage).toHaveBeenCalledOnce();
    expect(f.deps.storage.mock.invocationCallOrder[0]).toBeLessThan(f.deps.request.mock.invocationCallOrder[firstWrite]!);
    expect(f.deps.liveHead.mock.invocationCallOrder[0]).toBeLessThan(f.deps.request.mock.invocationCallOrder[firstWrite]!);
    expect(output.stages.slice(0, output.stages.findIndex((s) => s.stage === "auth_write"))).toEqual(
      ["source", "credentials", "project", "project_env", "shared_env", "supabase", "auth",
        "settings", "storage", "alias", "plan", "live_head", "protected_verify"]
        .map((stage) => ({ stage, status: "passed", code: "passed" })));
    const writes = calls.filter(([, method]) => method && method !== "GET");
    expect(writes.map(([url, method]) => [url, method])).toEqual([
      [ROUTES.auth, "PATCH"], [ROUTES.create, "POST"],
    ]);
    expect(writes[1]![2]).toHaveLength(18);
    for (const row of writes[1]![2] as EnvironmentMetadata[]) {
      expect(row).toMatchObject({ type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch });
    }
  });
  describe.each([1, 2])("documented project envelope at pre-write read %s", (read) => {
    it.each<[unknown, string]>([
      [{ ...officialProjectList, hiddenProductionEnvCount: 1 }, PlanFailure.Incomplete],
      [{ ...officialProjectList, hiddenProductionEnvCount: 15 }, PlanFailure.Incomplete],
      ...[-1, 0.5, NaN, Infinity, -Infinity, "0", null, undefined, false, {}].map((count): [unknown, string] =>
        [{ ...officialProjectList, hiddenProductionEnvCount: count }, "metadata_envelope_invalid"]),
      [{ hiddenProductionEnvCount: 0 }, "metadata_envelope_invalid"],
      [{ ...officialProjectList, envs: null }, "metadata_envelope_invalid"],
      [{ ...officialProjectList, envs: [null] }, "metadata_entry_invalid"],
      [{ ...officialProjectList, envs: [{ ...officialProjectList.envs[0], updatedAt: canary }] }, "metadata_entry_invalid"],
      [{ ...officialProjectList, envs: [...officialProjectList.envs, officialProjectList.envs[0]] }, PlanFailure.Duplicate],
      [{ ...officialProjectList, unknown: canary }, "metadata_envelope_invalid"],
      [{ ...officialProjectList, error: { message: canary } }, "metadata_envelope_invalid"],
      [{ ...officialProjectList, pagination: { count: 15, next: null } }, "metadata_envelope_invalid"],
      [{ ...officialProjectList, pagination: { count: 15, next: canary } }, "metadata_envelope_invalid"],
      [{ ...officialProjectList, pagination: undefined }, "metadata_envelope_invalid"],
      [{ ...officialProjectList, data: [] }, "metadata_envelope_invalid"],
      [officialProjectList.envs[0], "metadata_envelope_invalid"],
    ])("refuses incomplete or unsupported variant %# before any mutation", async (response, code) => {
      const f = fixture();
      f.state.project = structuredClone(officialProjectList.envs);
      const protectedBefore = structuredClone(f.state);
      const original = f.deps.request.getMockImplementation()!;
      let reads = 0;
      f.deps.request.mockImplementation(async (...args) =>
        args[0] === ROUTES.project_env ? (++reads === read ? response : officialProjectList) : original(...args));
      const output = await run(f);
      expect(output.status).toBe("failed");
      expect(output.stages.at(-1)).toEqual({
        stage: read === 1 ? "project_env" : "protected_verify", code, status: "failed",
      });
      expect(output.createdEnv).toEqual([]);
      expect(output.rollback).toEqual({ environment: "not_needed", auth: "not_needed" });
      expect(output.partial).toBe(false);
      expect(f.deps.request.mock.calls.every(([, method]) => method === undefined || method === "GET")).toBe(true);
      expect(f.state).toEqual(protectedBefore);
      if (read === 1) expect(output.auth.previous).toBeNull();
    });
    it("refuses a zero-hidden fixture missing inherited metadata before any mutation", async () => {
      const f = fixture();
      const original = f.deps.request.getMockImplementation()!;
      let reads = 0;
      f.deps.request.mockImplementation(async (...args) =>
        args[0] === ROUTES.project_env ? (++reads === read ?
          { ...officialProjectList, envs: officialProjectList.envs.slice(1) } : officialProjectList) : original(...args));
      const output = await run(f);
      expect(output.stages.at(-1)).toEqual({
        stage: read === 1 ? "plan" : "protected_verify",
        code: read === 1 ? PlanFailure.Incomplete : "predicate_refused", status: "failed",
      });
      expect(output.createdEnv).toEqual([]);
      expect(output.rollback).toEqual({ environment: "not_needed", auth: "not_needed" });
      expect(output.partial).toBe(false);
      expect(f.deps.request.mock.calls.every(([, method]) => method === undefined || method === "GET")).toBe(true);
    });
    it("refuses the project-only field in shared metadata before any mutation", async () => {
      const f = fixture();
      const original = f.deps.request.getMockImplementation()!;
      let reads = 0;
      f.deps.request.mockImplementation(async (...args) => {
        const response = await original(...args);
        return args[0] === ROUTES.shared_env && ++reads === read ?
          { data: f.state.shared, pagination: { count: 1, next: null }, hiddenProductionEnvCount: 0 } : response;
      });
      const output = await run(f);
      expect(output.stages.at(-1)).toEqual({
        stage: read === 1 ? "shared_env" : "protected_verify", code: "metadata_envelope_invalid", status: "failed",
      });
      expect(output.createdEnv).toEqual([]);
      expect(output.rollback).toEqual({ environment: "not_needed", auth: "not_needed" });
      expect(f.deps.request.mock.calls.every(([, method]) => method === undefined || method === "GET")).toBe(true);
    });
  });
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
  it("rolls back the literal official nested partial failure using only returned IDs and three prior Auth fields", async () => {
    const f = fixture();
    f.state.partial = true;
    const output = await run(f);
    expect(output.rollback).toEqual({ environment: "restored", auth: "restored" });
    expect(f.state.auth).toEqual(f.prior);
    expect(output.stages.at(-1)).toEqual({ stage: "env_write", code: "predicate_refused", status: "failed" });
    expect(output.protectedUnchanged).toEqual({ project: true, shared: true });
    expect(output.partial).toBe(false);
    const calls = f.deps.request.mock.calls;
    expect(calls.filter(([, method]) => method === "DELETE").map(([url]) => url.split("/env/")[1]!.split("?")[0]))
      .toEqual(["new_STRAVA_REDIRECT_URI", "new_ADMIN_EMAILS"]);
    expect(calls.filter(([, method]) => method === "PATCH").at(-1)?.[2]).toEqual(f.prior);
    const lastDelete = calls.map(([, method]) => method).lastIndexOf("DELETE");
    const restore = calls.map(([, method]) => method).lastIndexOf("PATCH");
    expect(calls.slice(lastDelete + 1, restore).map(([url]) => url))
      .toEqual(expect.arrayContaining([ROUTES.project_env, ROUTES.shared_env]));
  });
  it("preserves uncertain creation without blind deletion", async () => {
    const f = fixture();
    f.state.uncertain = true;
    const output = await run(f);
    expect(output.partial).toBe(true);
    expect(output.rollback).toEqual({ environment: "manual", auth: "manual" });
    expect(output.stages.at(-1)).toMatchObject({ stage: "env_write", code: "write_uncertain" });
    expect(f.state.auth).toEqual({ site_url: REVIEW.origin,
      uri_allow_list: `${REVIEW.origin}/auth/callback`, disable_signup: true });
    expect(f.deps.request.mock.calls.filter(([, method]) => method === "PATCH")).toHaveLength(1);
    expect(f.deps.request.mock.calls.some(([, method]) => method === "DELETE")).toBe(false);
  });
  it.each(["flat", "unknown", "duplicate", "created_key", "incomplete", "missing_error"])(
    "leaves malformed failed[] attribution %s isolated and manual", async (fault) => {
      const f = fixture();
      f.state.partial = true;
      const original = f.deps.request.getMockImplementation()!;
      f.deps.request.mockImplementation(async (...args) => {
        const response = await original(...args);
        if (args[0] !== ROUTES.create) return response;
        const envelope = response as { failed: unknown[] };
        if (fault === "flat") envelope.failed[0] = { key: "STRAVA_WEBHOOK_SUBSCRIPTION_ID", error: { message: canary } };
        if (fault === "unknown") envelope.failed[0] = { error: { key: canary, message: canary } };
        if (fault === "duplicate") envelope.failed[1] = envelope.failed[0];
        if (fault === "created_key") envelope.failed[0] = { error: { key: "ADMIN_EMAILS" } };
        if (fault === "incomplete") envelope.failed.pop();
        if (fault === "missing_error") envelope.failed[0] = { error: null };
        return envelope;
      });
      const output = await run(f);
      expect(output.rollback).toEqual({ environment: "manual", auth: "manual" });
      expect(output.partial).toBe(true);
      expect(f.state.auth.disable_signup).toBe(true);
      expect(f.deps.request.mock.calls.filter(([, method]) => method === "PATCH")).toHaveLength(1);
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
    expect(output.stages.at(-1)).toEqual({ stage: "env_write", code: "predicate_refused", status: "failed" });
    expect(output.rollback).toEqual({ environment: "manual", auth: "manual" });
    expect(output.partial).toBe(true);
    expect(f.state.auth.disable_signup).toBe(true);
    expect(f.deps.request.mock.calls.filter(([, method]) => method === "PATCH")).toHaveLength(1);
  });
  it.each(["project", "shared", "ownership", "project_read", "shared_read"])(
    "does not reopen Auth when post-cleanup protected reconciliation fails: %s", async (fault) => {
      const f = fixture();
      f.state.partial = true;
      const original = f.deps.request.getMockImplementation()!;
      let cleaned = false;
      f.deps.request.mockImplementation(async (...args) => {
        if (cleaned && ((fault === "project_read" && args[0] === ROUTES.project_env) ||
          (fault === "shared_read" && args[0] === ROUTES.shared_env))) throw new Error(canary);
        const response = await original(...args);
        if (args[1] === "DELETE" && !f.state.project.some((e) => e.gitBranch === REVIEW.branch)) {
          cleaned = true;
          if (fault === "project") f.state.project[0]!.updatedAt++;
          if (fault === "shared") f.state.shared[0]!.updatedAt++;
          if (fault === "ownership") f.state.project.push(entry("DATABASE_URL",
            { id: "concurrent_owner", gitBranch: REVIEW.branch }));
        }
        return response;
      });
      const output = await run(f);
      expect(cleaned).toBe(true);
      expect(output.stages.at(-1)).toEqual({ stage: "env_write", code: "predicate_refused", status: "failed" });
      expect(output.rollback).toEqual({ environment: "manual", auth: "manual" });
      expect(output.partial).toBe(true);
      expect(f.state.auth.disable_signup).toBe(true);
      expect(f.deps.request.mock.calls.filter(([, method]) => method === "PATCH")).toHaveLength(1);
      expect(f.deps.request.mock.calls.filter(([, method]) => method === "DELETE")).toHaveLength(2);
    });
  it("does not restore Auth after a concurrent created-entry edit alone", async () => {
    const f = fixture();
    Object.assign(f.state, { failReadback: true, concurrentEnv: true });
    expect((await run(f)).rollback).toEqual({ environment: "manual", auth: "manual" });
    expect(f.state.auth.disable_signup).toBe(true);
    expect(f.deps.request.mock.calls.filter(([, method]) => method === "PATCH")).toHaveLength(1);
  });
  it.each([PlanFailure.Project, PlanFailure.Supabase, PlanFailure.Incomplete,
    PlanFailure.ExistingOverride, PlanFailure.UnknownPreviewKey, PlanFailure.Auth])(
    "preserves the safe pure-plan enum %s without raw diagnostics", async (code) => {
      const f = fixture();
      const original = f.deps.request.getMockImplementation()!;
      if (code === PlanFailure.Incomplete) f.state.project.shift();
      if (code === PlanFailure.ExistingOverride) f.state.project.push(entry("DATABASE_URL",
        { id: "existing_override", gitBranch: REVIEW.branch }));
      if (code === PlanFailure.UnknownPreviewKey) f.state.project.push(entry("UNREVIEWED"));
      if (code === PlanFailure.Auth) f.state.auth.site_url = canary;
      f.deps.request.mockImplementation(async (...args) => {
        const response = await original(...args);
        if ((code === PlanFailure.Project && args[0] === ROUTES.project) ||
          (code === PlanFailure.Supabase && args[0] === ROUTES.supabase)) {
          return { ...(response as object), name: canary };
        }
        return response;
      });
      expect((await run(f)).stages.at(-1)).toEqual({ stage: "plan", code, status: "failed" });
      expect(f.deps.request.mock.calls.some(([, method]) => method === "PATCH" || method === "POST")).toBe(false);
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
  it("projects only metadata from the documented zero-hidden fixture without reading sensitive fields", () => {
    const response = structuredClone(officialProjectList);
    const readSensitive = vi.fn(() => { throw new Error(canary); });
    for (const row of response.envs) {
      for (const key of ["value", "legacyValue", "internalContentHint", "credentials", "error"]) {
        Object.defineProperty(row, key, { enumerable: true, get: readSensitive });
      }
    }
    expect(environmentList(response, false)).toEqual(officialProjectList.envs);
    expect(readSensitive).not.toHaveBeenCalled();
    expect(ROUTES.project_env).toContain("decrypt=false");
  });
  it("retains the 1000-entry limit for the zero-hidden variant", () => {
    const envs = Array.from({ length: 1000 }, (_, i) => ({
      ...officialProjectList.envs[0]!, id: `metadata_${i}`,
    }));
    expect(environmentList({ envs, hiddenProductionEnvCount: 0 }, false)).toHaveLength(1000);
    expect(() => environmentList({ envs: [...envs, { ...envs[0], id: "overflow" }],
      hiddenProductionEnvCount: 0 }, false)).toThrow("metadata_envelope_invalid");
  });
  it.each([
    [{ envs: [], error: canary }, "metadata_envelope_invalid"],
    [{ envs: [], pagination: { count: 0, next: canary } }, "metadata_pagination_invalid"],
    [{ envs: [null] }, "metadata_entry_invalid"],
    [{ envs: [{ ...entry("DATABASE_URL"), updatedAt: canary }] }, "metadata_entry_invalid"],
    [{ envs: [entry("DATABASE_URL"), entry("DATABASE_URL")] }, PlanFailure.Duplicate],
  ])("reports a bounded metadata category %# at its original stage", async (response, code) => {
    const f = fixture();
    const original = f.deps.request.getMockImplementation()!;
    f.deps.request.mockImplementation(async (...args) =>
      args[0] === ROUTES.project_env ? response : original(...args));
    expect((await run(f)).stages.at(-1)).toEqual({ stage: "project_env", code, status: "failed" });
    expect(f.deps.request.mock.calls.some(([, method]) => method === "PATCH" || method === "POST")).toBe(false);
  });
  it.each([{}, [], { data: [] }, { data: [], pagination: {} },
    { data: [], pagination: { count: 0, next: "cursor" } },
    { data: [], pagination: { count: 0, next: null, more: true } }])(
    "refuses incomplete shared metadata %#", (value) => expect(() => environmentList(value, true)).toThrow());
  it("accepts explicit terminal shared pagination and documented project envelope", () => {
    expect(environmentList({ data: [], pagination: { count: 0, next: null } }, true)).toEqual([]);
    expect(environmentList({ envs: [] }, false)).toEqual([]);
    expect(environmentList({ envs: officialProjectList.envs,
      pagination: { count: 15, next: null, prev: null } }, false)).toEqual(officialProjectList.envs);
    expect(environmentList({ envs: [], hiddenProductionEnvCount: 0 }, false)).toEqual([]);
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
describe("installed Supabase storage adapter, offline", () => {
  it.each([
    { body: true, status: 200, accepted: true },
    { body: false, status: 200, accepted: false },
    { body: { error: canary, message: canary }, status: 200, accepted: false },
    { body: { error: canary, message: canary }, status: 500, accepted: false },
    { body: canary, status: 200, accepted: false },
  ])("uses one bounded POST with the installed client and refuses non-true/error outcomes %#", async ({ body, status, accepted }) => {
    const unexpectedFetch = vi.fn(() => { throw new Error(canary); });
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("fetch", unexpectedFetch);
    vi.stubGlobal("localStorage", storage);
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async () => new Response(
        typeof body === "string" ? body : JSON.stringify(body),
        { status, headers: { "Content-Type": "application/json" } }));
      const credentials = { ...env, VERCEL_REVIEW_TOKEN: `vercel_${canary}`,
        SUPABASE_REVIEW_MANAGEMENT_TOKEN: `pat_${canary}` };
      const request = boundedTransport(credentials, Date.now() + 300_000, fetcher);
      expect(await storageAdapter(credentials, request)()).toBe(accepted);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith(ROUTES.storage, {
        method: "POST", body: "{}", redirect: "error", signal: expect.any(AbortSignal),
        headers: { "Content-Type": "application/json", apikey: env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY },
      });
      const sent = JSON.stringify(fetcher.mock.calls);
      expect(sent).not.toContain(credentials.VERCEL_REVIEW_TOKEN);
      expect(sent).not.toContain(credentials.SUPABASE_REVIEW_MANAGEMENT_TOKEN);
      expect(sent).not.toContain(env.SWIM_REVIEW_SUPABASE_ANON_KEY);
      expect(unexpectedFetch).not.toHaveBeenCalled();
      for (const operation of Object.values(storage)) expect(operation).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
describe("configuration workflow boundaries", () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const job = workflow.split("\n  configure-swim-review:\n")[1]!;
  it("preserves every previously published job byte-for-byte", () => {
    // SHA-256 of prior.trimEnd().split("\njobs:")[1] at b6e09d2240081472ba91f168d94aba3915316218.
    const jobs = workflow.split("\n  configure-swim-review:\n")[0]!.trimEnd().split("\njobs:")[1]!;
    expect(createHash("sha256").update(jobs).digest("hex"))
      .toBe("c7199fb2c2a1ea40d72d5a0dc5d5aca2400d173f7f4f4158c45453be78408b79");
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
