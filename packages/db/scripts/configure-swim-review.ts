import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { APPLICATION_SHA, validateDatabaseUrl } from "./prepare-swim-review";
import {
  buildConfigurationPlan, metadataSchema, OVERRIDE_KEYS, PlanFailure, REVIEW,
  type ConfigurationPlan, type EnvironmentMetadata, type ManualContext,
} from "./swim-review-config-plan";

export const CONFIGURATION_PATHS = [
  ".github/workflows/ci.yml", "HANDOFF.md",
  "packages/db/scripts/prepare-swim-review.ts",
  "packages/db/scripts/__tests__/prepare-swim-review.test.ts",
  "packages/db/scripts/swim-review-config-plan.ts",
  "packages/db/scripts/__tests__/swim-review-config-plan.test.ts",
  "packages/db/scripts/configure-swim-review.ts",
  "packages/db/scripts/__tests__/configure-swim-review.test.ts",
  "packages/db/scripts/deploy-swim-review.ts",
  "packages/db/scripts/__tests__/deploy-swim-review.test.ts",
] as const;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ref = `refs/heads/${REVIEW.branch}` as const;
const limit = 2 * 1024 * 1024;
let gitDeadline = Infinity;
type Stage = "source" | "credentials" | "project" | "project_env" | "shared_env" |
  "supabase" | "auth" | "settings" | "storage" | "alias" | "plan" | "live_head" |
  "auth_write" | "auth_verify" | "env_write" | "env_verify" | "protected_verify" |
  "completion" | "rollback";
type Code = PlanFailure | "passed" | "predicate_refused" | "http_status" | "transport_failed" |
  "response_invalid" | "write_uncertain" | "metadata_envelope_invalid" |
  "metadata_pagination_invalid" | "metadata_entry_invalid";
class Refusal extends Error {
  readonly httpStatus?: number;
  constructor(readonly code: Code, httpStatus?: number) {
    super(code);
    if (typeof httpStatus === "number" && Number.isInteger(httpStatus) &&
      httpStatus >= 100 && httpStatus <= 599) this.httpStatus = httpStatus;
  }
}
function requireThat(value: unknown, code: Code = "predicate_refused"): asserts value {
  if (!value) throw new Refusal(code);
}
function object(value: unknown, code: Code = "predicate_refused"): Record<string, unknown> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), code);
  return value as Record<string, unknown>;
}
function select(value: unknown, keys: readonly string[]) {
  const record = object(value);
  return Object.fromEntries(keys.map((key) => [key, record[key]]));
}
const authKeys = ["site_url", "uri_allow_list", "disable_signup"] as const;
function authFields(value: unknown) { return select(value, authKeys); }
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
export function metadata(value: unknown): EnvironmentMetadata {
  const item = object(value, "metadata_entry_invalid");
  const result = metadataSchema.safeParse({
    ...select(item, ["key", "type", "target", "id", "createdAt", "updatedAt"]),
    gitBranch: item.gitBranch === undefined ? null : item.gitBranch,
  });
  requireThat(result.success, "metadata_entry_invalid");
  return result.data;
}
function terminalPagination(value: unknown) {
  const result = z.object({
    count: z.number().int().min(0).max(1000),
    next: z.null(), prev: z.union([z.number(), z.string(), z.null()]).optional(),
  }).strict().safeParse(value);
  requireThat(result.success, "metadata_pagination_invalid");
}
export function environmentList(value: unknown, shared: boolean): EnvironmentMetadata[] {
  const envelope = object(value, "metadata_envelope_invalid");
  const allowed = shared ? ["data", "pagination"] : ["envs", "pagination", "hiddenProductionEnvCount"];
  requireThat(Object.keys(envelope).every((key) => allowed.includes(key)), "metadata_envelope_invalid");
  if ("hiddenProductionEnvCount" in envelope) {
    const count = envelope.hiddenProductionEnvCount;
    requireThat(!shared && !("pagination" in envelope) &&
      typeof count === "number" && Number.isInteger(count) && count >= 0, "metadata_envelope_invalid");
    requireThat(count === 0, PlanFailure.Incomplete);
  }
  if (shared || "pagination" in envelope) terminalPagination(envelope.pagination);
  const entries = envelope[shared ? "data" : "envs"];
  requireThat(Array.isArray(entries) && entries.length <= 1000, "metadata_envelope_invalid");
  const projected = entries.map(metadata);
  requireThat(new Set(projected.map((entry) => entry.id)).size === projected.length, PlanFailure.Duplicate);
  return projected;
}
type Mode = "configure" | "inspect-auth";
function validateMode(env: NodeJS.ProcessEnv, mode: Mode) {
  requireThat(mode === "configure" || mode === "inspect-auth");
  requireThat(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === REVIEW.repository && env.GITHUB_REF_TYPE === "branch" &&
    env.GITHUB_REF === ref && env.GITHUB_JOB === "configure-swim-review" &&
    env.CONFIGURE_SWIM_REVIEW === (mode === "configure" ? "true" : "false") &&
    env.INSPECT_SWIM_REVIEW_AUTH === (mode === "inspect-auth" ? "true" : "false") &&
    (env.DEPLOY_SWIM_REVIEW ?? "false") === "false" &&
    (env.INSPECT_SWIM_REVIEW_DEPLOYMENT ?? "false") === "false" &&
    (env.PROVISION_SWIM_REVIEW_OWNER ?? "false") === "false" &&
    env.PREPARE_SWIM_REVIEW === "false" &&
    env.INSPECT_SWIM_REVIEW === "false" && env.SWIM_ACCEPTANCE === "false" &&
    env.MIGRATE_PRODUCTION === "false" && env.ALLOW_UNDEPLOYED === "false" &&
    /^[a-f0-9]{40}$/.test(env.EXPECTED_SHA ?? "") && env.EXPECTED_SHA === env.GITHUB_SHA &&
    env.EXPECTED_SHA !== APPLICATION_SHA);
}
export function configurationContext(env: NodeJS.ProcessEnv): ManualContext {
  validateMode(env, "configure");
  return {
    actions: true, eventName: "workflow_dispatch", repository: REVIEW.repository,
    refType: "branch", ref, configure: true, prepare: false, inspect: false,
    swimAcceptance: false, migrateProduction: false, allowUndeployed: false,
    expectedSha: env.EXPECTED_SHA!, githubSha: env.GITHUB_SHA!,
  };
}
const git = (...args: string[]) => {
  requireThat(Date.now() < gitDeadline);
  return execFileSync("git", args, {
    cwd: root, encoding: "utf8", timeout: Math.max(1, Math.min(15_000, gitDeadline - Date.now())), maxBuffer: limit,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
};
export function verifyConfigurationSource(env: NodeJS.ProcessEnv, mode: Mode = "configure") {
  validateMode(env, mode);
  const event = object(JSON.parse(readFileSync(env.GITHUB_EVENT_PATH!, "utf8")));
  const inputs = object(event.inputs);
  requireThat(inputs.deploy_swim_review === "false");
  requireThat(inputs.inspect_swim_review_deployment === "false");
  requireThat((inputs.provision_swim_review_owner ?? "false") === "false");
  for (const [key, expected] of Object.entries({
    configure_swim_review: mode === "configure" ? "true" : "false",
    inspect_swim_review_auth: mode === "inspect-auth" ? "true" : "false",
    prepare_swim_review: "false", inspect_swim_review: "false",
    swim_acceptance: "false", migrate_production: "false", allow_undeployed: "false",
    expected_sha: env.EXPECTED_SHA,
  })) requireThat(inputs[key] === expected);
  requireThat(git("rev-parse", "HEAD") === env.EXPECTED_SHA);
  git("merge-base", "--is-ancestor", APPLICATION_SHA, "HEAD");
  requireThat(git("status", "--porcelain", "--untracked-files=all") === "");
  const changed = git("diff", "--name-only", "--no-renames", APPLICATION_SHA, "HEAD").split("\n");
  requireThat(changed.length > 0 && changed.every((path) =>
    (CONFIGURATION_PATHS as readonly string[]).includes(path)));
  for (const path of CONFIGURATION_PATHS) {
    requireThat(git("ls-tree", "HEAD", "--", path).startsWith("100644 blob ") &&
      lstatSync(resolve(root, path)).isFile() && !lstatSync(resolve(root, path)).isSymbolicLink());
  }
}
function liveHead(env: NodeJS.ProcessEnv) {
  requireThat(git("ls-remote", "--exit-code", `https://github.com/${REVIEW.repository}.git`, ref) ===
    `${env.EXPECTED_SHA}\t${ref}`);
}

export const ROUTES = {
  project: `https://api.vercel.com/v9/projects/${REVIEW.projectId}?teamId=${REVIEW.teamId}`,
  project_env: `https://api.vercel.com/v10/projects/${REVIEW.projectId}/env?teamId=${REVIEW.teamId}&decrypt=false`,
  shared_env: `https://api.vercel.com/v1/env?teamId=${REVIEW.teamId}&projectId=${REVIEW.projectId}`,
  supabase: `https://api.supabase.com/v1/projects/${REVIEW.supabaseId}`,
  auth: `https://api.supabase.com/v1/projects/${REVIEW.supabaseId}/config/auth`,
  settings: `${REVIEW.supabaseUrl}/auth/v1/settings`,
  storage: `${REVIEW.supabaseUrl}/rest/v1/rpc/swim_storage_ready`,
  alias: `https://api.vercel.com/v4/aliases/${REVIEW.proposedAlias}?teamId=${REVIEW.teamId}`,
  create: `https://api.vercel.com/v10/projects/${REVIEW.projectId}/env?teamId=${REVIEW.teamId}&upsert=false`,
} as const;
function deleteRoute(id: string) {
  requireThat(/^[A-Za-z0-9_-]{1,256}$/.test(id));
  return `https://api.vercel.com/v9/projects/${REVIEW.projectId}/env/${id}?teamId=${REVIEW.teamId}`;
}
type Request = (url: string, method?: string, body?: unknown) => Promise<unknown>;
export function storageAdapter(env: NodeJS.ProcessEnv, request: Request): () => Promise<boolean> {
  return async () => {
    const client = createClient(REVIEW.supabaseUrl, env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { fetch: async (input, init) => {
        requireThat(String(input) === ROUTES.storage && init?.method === "POST" && init.body === "{}");
        const value = await request(ROUTES.storage, "POST", {});
        return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
      } },
    });
    const { data, error } = await client.rpc("swim_storage_ready");
    return error === null && data === true;
  };
}
export function boundedTransport(env: NodeJS.ProcessEnv, deadline: number,
  fetcher: typeof fetch = fetch, mode: Mode = "configure"): Request {
  return async (url, method = "GET", body) => {
    requireThat(mode === "configure" || (mode === "inspect-auth" && method === "GET" &&
      body === undefined && (url === ROUTES.supabase || url === ROUTES.auth)));
    const deletion = method === "DELETE" && url.startsWith(
      `https://api.vercel.com/v9/projects/${REVIEW.projectId}/env/`) &&
      url.endsWith(`?teamId=${REVIEW.teamId}`) &&
      url === deleteRoute(url.split("/env/")[1]!.split("?")[0]!);
    requireThat((method === "GET" && Object.entries(ROUTES).some(([key, route]) =>
      !["create", "storage"].includes(key) && route === url)) ||
      (method === "PATCH" && url === ROUTES.auth) ||
      (method === "POST" && [ROUTES.create, ROUTES.storage].includes(url as typeof ROUTES.create)) ||
      deletion);
    const remaining = deadline - Date.now();
    requireThat(remaining > 0);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(30_000, remaining));
    let observedStatus: number | undefined;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (url.startsWith("https://api.vercel.com/")) headers.Authorization = ["Bearer", env.VERCEL_REVIEW_TOKEN].join(" ");
      else if (url.startsWith("https://api.supabase.com/")) headers.Authorization = ["Bearer", env.SUPABASE_REVIEW_MANAGEMENT_TOKEN].join(" ");
      else headers.apikey = url === ROUTES.settings ?
        env.SWIM_REVIEW_SUPABASE_ANON_KEY! : env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY!;
      const response = await fetcher(url, {
        method, headers, redirect: "error", signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      observedStatus = response.status;
      if (url === ROUTES.alias && response.status === 404) {
        await response.body?.cancel();
        return { available: true };
      }
      if (!response.ok || url === ROUTES.alias) {
        await response.body?.cancel();
        throw new Refusal("http_status", observedStatus);
      }
      requireThat(Number(response.headers.get("content-length") ?? 0) <= limit);
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            requireThat(size <= limit);
            chunks.push(next.value);
          }
        } finally { await reader.cancel(); }
      }
      if (method === "DELETE" && size === 0) return null;
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
      catch { throw new Refusal("response_invalid"); }
    } catch (error) {
      throw new Refusal(error instanceof Refusal ? error.code : "transport_failed", observedStatus);
    } finally { clearTimeout(timer); }
  };
}
type Dependencies = {
  source(): void;
  liveHead(): void;
  request: Request;
  storage(): Promise<boolean>;
  cron(): string;
};
type Summary = {
  scope: "swim-review-config"; testedSha: string | null; acceptedApplicationSha: string;
  projectId: string; teamId: string; supabaseId: string;
  status: "failed" | "configuration_pass";
  stages: { stage: Stage; code: Code; status: "passed" | "failed"; underlyingCode?: Code; httpStatus?: number }[];
  createdEnv: { id: string; key: string }[];
  protectedUnchanged: { project: boolean; shared: boolean };
  auth: { previous: ConfigurationPlan["auth"]["previous"] | null; patchMatches: boolean };
  rollback: { environment: "not_needed" | "restored" | "manual"; auth: "not_needed" | "restored" | "manual" };
  partial: boolean; deploymentAttempted: false; aliasCreated: false;
  runtimePending: true; deploymentPending: true; ownerLoginPending: true;
};
function summary(env: NodeJS.ProcessEnv): Summary {
  return {
    scope: "swim-review-config", testedSha: /^[a-f0-9]{40}$/.test(env.EXPECTED_SHA ?? "") ? env.EXPECTED_SHA! : null,
    acceptedApplicationSha: APPLICATION_SHA, projectId: REVIEW.projectId, teamId: REVIEW.teamId,
    supabaseId: REVIEW.supabaseId, status: "failed", stages: [], createdEnv: [],
    protectedUnchanged: { project: false, shared: false },
    auth: { previous: null, patchMatches: false },
    rollback: { environment: "not_needed", auth: "not_needed" }, partial: false,
    deploymentAttempted: false, aliasCreated: false,
    runtimePending: true, deploymentPending: true, ownerLoginPending: true,
  };
}
function baseline(entries: EnvironmentMetadata[]) {
  return [...entries].map((entry) => ({ ...entry, target: [...entry.target].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
export async function configure(env: NodeJS.ProcessEnv, deps: Dependencies): Promise<Summary> {
  const result = summary(env);
  let stage: Stage = "source";
  let plan: ConfigurationPlan | undefined;
  let authAttempted = false;
  let authCertain = false;
  let envAttempted = false;
  let envCertain = false;
  const created: EnvironmentMetadata[] = [];
  async function step<T>(name: Stage, action: () => T | Promise<T>): Promise<T> {
    stage = name;
    const value = await action();
    result.stages.push({ stage, code: "passed", status: "passed" });
    return value;
  }
  const readProject = async () => environmentList(await deps.request(ROUTES.project_env), false);
  const readShared = async () => environmentList(await deps.request(ROUTES.shared_env), true);
  try {
    const context = await step("source", () => {
      const value = configurationContext(env);
      deps.source();
      return value;
    });
    const credentials = await step("credentials", () => {
      for (const name of ["VERCEL_REVIEW_TOKEN", "SUPABASE_REVIEW_MANAGEMENT_TOKEN"]) {
        requireThat(/^[A-Za-z0-9_.-]{20,512}$/.test(env[name] ?? ""));
      }
      requireThat(/^sb_publishable_[A-Za-z0-9_-]{20,256}$/.test(env.SWIM_REVIEW_SUPABASE_ANON_KEY ?? "") &&
        /^sb_secret_[A-Za-z0-9_-]{20,256}$/.test(env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY ?? ""));
      return {
        publishableKey: env.SWIM_REVIEW_SUPABASE_ANON_KEY!,
        secretKey: env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY!,
        databaseUrl: validateDatabaseUrl(env.SWIM_REVIEW_DATABASE_URL), testCronSecret: deps.cron(),
      };
    });
    const project = await step("project", async () => {
      const raw = object(await deps.request(ROUTES.project));
      return { ...select(raw, ["id", "accountId", "name", "rootDirectory", "framework"]),
        link: select(raw.link, ["type", "org", "repo", "productionBranch"]) };
    });
    const projectEntries = await step("project_env", readProject);
    const sharedEntries = await step("shared_env", readShared);
    const supabase = await step("supabase", async () => {
      const raw = object(await deps.request(ROUTES.supabase));
      requireThat(raw.status === "ACTIVE_HEALTHY");
      return select(raw, ["id", "name", "organization_id", "region"]);
    });
    const priorAuth = await step("auth", async () => authFields(await deps.request(ROUTES.auth)));
    await step("settings", async () => {
      const external = object(object(await deps.request(ROUTES.settings)).external);
      requireThat(external.email === true && Object.keys(external).length <= 100 &&
        Object.entries(external).every(([key, value]) => key === "email" || value === false));
    });
    await step("storage", async () => requireThat(await deps.storage() === true));
    await step("alias", async () => requireThat(same(await deps.request(ROUTES.alias), { available: true })));
    plan = await step("plan", () => {
      const built = buildConfigurationPlan({ context, project, supabase, priorAuth, credentials,
        projectEnvironment: { entries: projectEntries, complete: true, pagination: null },
        sharedEnvironment: { entries: sharedEntries, complete: true, pagination: null } });
      if (!built.ok) throw new Refusal(built.code);
      requireThat(built.plan.environment.overrides.length === 18);
      requireThat(new Set([...projectEntries, ...sharedEntries].map((e) => e.id)).size ===
        projectEntries.length + sharedEntries.length);
      return built.plan;
    });
    result.auth.previous = plan.auth.previous;
    await step("live_head", () => deps.liveHead());
    // Recheck the complete preflight snapshot immediately before the first write.
    await step("protected_verify", async () => {
      requireThat(same(baseline(await readProject()), baseline(projectEntries)) &&
        same(baseline(await readShared()), baseline(sharedEntries)) &&
        same(authFields(await deps.request(ROUTES.auth)), plan!.auth.previous));
    });
    await step("auth_write", async () => {
      authAttempted = true;
      await deps.request(ROUTES.auth, "PATCH", plan!.auth.patch);
      authCertain = true;
    });
    await step("auth_verify", async () => {
      requireThat(same(authFields(await deps.request(ROUTES.auth)), plan!.auth.patch));
      result.auth.patchMatches = true;
    });
    await step("env_write", async () => {
      envAttempted = true;
      const envelope = object(await deps.request(ROUTES.create, "POST", plan!.environment.overrides));
      requireThat(Object.keys(envelope).every((key) => ["created", "failed"].includes(key)));
      requireThat(Array.isArray(envelope.failed) && envelope.failed.length <= 18);
      const rows = Array.isArray(envelope.created) ? envelope.created : [envelope.created];
      requireThat(rows.length <= 18);
      const knownIds = new Set([...projectEntries, ...sharedEntries].map((e) => e.id));
      const keys = new Set<string>();
      for (const raw of rows) {
        const entry = metadata(raw);
        requireThat(!knownIds.has(entry.id) && !keys.has(entry.key) &&
          (OVERRIDE_KEYS as readonly string[]).includes(entry.key) &&
          entry.gitBranch === REVIEW.branch && entry.type === "encrypted" &&
          same(entry.target, ["preview"]));
        knownIds.add(entry.id);
        keys.add(entry.key);
        created.push(entry);
        result.createdEnv.push({ id: entry.id, key: entry.key });
      }
      for (const raw of envelope.failed) {
        const key = object(object(raw).error).key;
        requireThat(typeof key === "string" && (OVERRIDE_KEYS as readonly string[]).includes(key) && !keys.has(key));
        keys.add(key);
      }
      requireThat(keys.size === 18);
      envCertain = true;
      requireThat(envelope.failed.length === 0 && created.length === 18);
    });
    await step("env_verify", async () => {
      const current = await readProject();
      requireThat(same(baseline(current.filter((e) => e.gitBranch === REVIEW.branch)), baseline(created)));
      result.protectedUnchanged.project = same(
        baseline(current.filter((e) => !created.some((c) => c.id === e.id))), baseline(projectEntries));
      requireThat(result.protectedUnchanged.project);
    });
    await step("protected_verify", async () => {
      result.protectedUnchanged.shared = same(baseline(await readShared()), baseline(sharedEntries));
      requireThat(result.protectedUnchanged.shared);
      result.auth.patchMatches = same(authFields(await deps.request(ROUTES.auth)), plan!.auth.patch);
      requireThat(result.auth.patchMatches);
    });
    await step("completion", () => deps.liveHead());
    result.status = "configuration_pass";
  } catch (error) {
    result.auth.patchMatches = false;
    result.protectedUnchanged = { project: false, shared: false };
    result.stages.push({ stage, status: "failed",
      code: (authAttempted && !authCertain) || (envAttempted && !envCertain) ?
        "write_uncertain" : error instanceof Refusal ? error.code : "predicate_refused",
      ...(error instanceof Refusal ? {
        ...((authAttempted && !authCertain) || (envAttempted && !envCertain) ?
          { underlyingCode: error.code } : {}),
        ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
      } : {}),
    });
    if (envAttempted) result.rollback.environment = "manual";
    if (authAttempted) result.rollback.auth = "manual";
    // Only complete, attributable responses permit cleanup; unknown writes remain isolated.
    let protectedReconciled = false;
    try {
      if (envAttempted || authAttempted) deps.liveHead();
      if (envAttempted && envCertain) {
        for (const entry of created) {
          const live = (await readProject()).find((item) => item.id === entry.id);
          requireThat(same(live, entry));
          await deps.request(deleteRoute(entry.id), "DELETE");
        }
        const remaining = await readProject();
        requireThat(!remaining.some((e) => created.some((c) => c.id === e.id)));
      }
      if (authAttempted && plan && (!envAttempted || envCertain)) {
        result.protectedUnchanged.project = same(
          baseline(await readProject()), baseline(plan.environment.preserved.project));
        result.protectedUnchanged.shared = same(
          baseline(await readShared()), baseline(plan.environment.preserved.shared));
        requireThat(result.protectedUnchanged.project && result.protectedUnchanged.shared);
        protectedReconciled = true;
        if (envAttempted) result.rollback.environment = "restored";
      }
    } catch { /* Preserve the original failure and leave uncertain resources untouched. */ }
    try {
      if (authAttempted && authCertain && plan && protectedReconciled &&
        result.rollback.environment !== "manual") {
        deps.liveHead();
        result.auth.patchMatches = same(authFields(await deps.request(ROUTES.auth)), plan.auth.patch);
        requireThat(result.auth.patchMatches);
        await deps.request(ROUTES.auth, "PATCH", plan.auth.previous);
        requireThat(same(authFields(await deps.request(ROUTES.auth)), plan.auth.previous));
        result.rollback.auth = "restored";
        result.auth.patchMatches = false;
      }
    } catch { /* A concurrent edit or failed rollback requires manual reconciliation. */ }
    result.partial = result.rollback.environment === "manual" || result.rollback.auth === "manual";
  }
  return result;
}

type Classification = "previous" | "intended" | "other";
type InspectionSummary = {
  scope: "swim-review-auth-inspection"; testedSha: string | null; acceptedApplicationSha: string;
  supabaseId: string; supabaseName: string; organizationId: string; region: string;
  status: "failed" | "unresolved" | "inspection_pass"; stages: Summary["stages"];
  authState: "matches_previous" | "matches_intended" | "other"; stable: boolean;
  fields: Record<typeof authKeys[number], Classification>; signupDisabled: boolean | null;
  writesAttempted: false; configurationAccepted: false; deploymentAttempted: false;
};
function inspectionSummary(env: NodeJS.ProcessEnv): InspectionSummary {
  return {
    scope: "swim-review-auth-inspection",
    testedSha: /^[a-f0-9]{40}$/.test(env.EXPECTED_SHA ?? "") ? env.EXPECTED_SHA! : null,
    acceptedApplicationSha: APPLICATION_SHA, supabaseId: REVIEW.supabaseId,
    supabaseName: REVIEW.supabaseName, organizationId: REVIEW.organizationId, region: REVIEW.region,
    status: "failed", stages: [], authState: "other", stable: false,
    fields: { site_url: "other", uri_allow_list: "other", disable_signup: "other" },
    signupDisabled: null, writesAttempted: false, configurationAccepted: false, deploymentAttempted: false,
  };
}
export async function inspectAuth(env: NodeJS.ProcessEnv,
  deps: Pick<Dependencies, "source" | "liveHead" | "request">): Promise<InspectionSummary> {
  const result = inspectionSummary(env);
  let stage: Stage = "source";
  async function step<T>(name: Stage, action: () => T | Promise<T>): Promise<T> {
    stage = name;
    const value = await action();
    result.stages.push({ stage, code: "passed", status: "passed" });
    return value;
  }
  try {
    await step("source", () => { validateMode(env, "inspect-auth"); deps.source(); });
    await step("credentials", () =>
      requireThat(/^[A-Za-z0-9_.-]{20,512}$/.test(env.SUPABASE_REVIEW_MANAGEMENT_TOKEN ?? "")));
    await step("live_head", deps.liveHead);
    await step("supabase", async () => {
      const identity = select(await deps.request(ROUTES.supabase, "GET"),
        ["id", "name", "organization_id", "region", "status"]);
      requireThat(identity.id === REVIEW.supabaseId && identity.name === REVIEW.supabaseName &&
        identity.organization_id === REVIEW.organizationId && identity.region === REVIEW.region &&
        identity.status === "ACTIVE_HEALTHY", PlanFailure.Supabase);
    });
    const first = await step("auth", async () => authFields(await deps.request(ROUTES.auth, "GET")));
    await step("live_head", deps.liveHead);
    const second = await step("auth_verify", async () => authFields(await deps.request(ROUTES.auth, "GET")));
    await step("completion", deps.liveHead);
    const previous = { site_url: "http://localhost:3000", uri_allow_list: "", disable_signup: false };
    const intended = { site_url: REVIEW.origin, uri_allow_list: `${REVIEW.origin}/auth/callback`, disable_signup: true };
    result.stable = authKeys.every((key) =>
      (second[key] === null || typeof second[key] === (key === "disable_signup" ? "boolean" : "string")) &&
      first[key] === second[key]);
    for (const key of authKeys) {
      result.fields[key] = second[key] === previous[key] ? "previous" :
        second[key] === intended[key] ? "intended" : "other";
    }
    result.signupDisabled = typeof second.disable_signup === "boolean" ? second.disable_signup : null;
    if (result.stable && authKeys.every((key) => result.fields[key] === "previous")) result.authState = "matches_previous";
    if (result.stable && authKeys.every((key) => result.fields[key] === "intended")) result.authState = "matches_intended";
    result.status = result.authState === "other" ? "unresolved" : "inspection_pass";
  } catch (error) {
    result.stages.push({ stage, code: error instanceof Refusal ? error.code : "predicate_refused", status: "failed",
      ...(error instanceof Refusal && error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
    });
  }
  return result;
}
export function configurationArguments(args: string[]): { mode: Mode; checkSource: boolean } {
  requireThat(args.length <= 2 && new Set(args).size === args.length &&
    args.every((arg) => arg === "--check-source" || arg === "--inspect-auth"));
  return { mode: args.includes("--inspect-auth") ? "inspect-auth" : "configure",
    checkSource: args.includes("--check-source") };
}
async function main() {
  const env = process.env;
  let result: Summary | InspectionSummary;
  try {
    gitDeadline = Date.now() + 300_000;
    const { mode, checkSource } = configurationArguments(process.argv.slice(2));
    if (checkSource) {
      verifyConfigurationSource(env, mode);
      liveHead(env);
      return;
    }
    const deadline = gitDeadline;
    const request = boundedTransport(env, deadline, fetch, mode);
    const deps = {
      source: () => verifyConfigurationSource(env, mode), liveHead: () => {
        requireThat(Date.now() < deadline);
        liveHead(env);
      },
      request,
    };
    result = mode === "inspect-auth" ? await inspectAuth(env, deps) : await configure(env, {
      ...deps, cron: () => randomBytes(48).toString("base64url"),
      storage: storageAdapter(env, request),
    });
  } catch {
    result = process.argv.includes("--inspect-auth") || env.INSPECT_SWIM_REVIEW_AUTH === "true" ?
      inspectionSummary(env) : summary(env);
    result.stages.push({ stage: "source", code: "predicate_refused", status: "failed" });
  }
  console.log(JSON.stringify(result));
  if (result.status !== "configuration_pass" && result.status !== "inspection_pass") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
