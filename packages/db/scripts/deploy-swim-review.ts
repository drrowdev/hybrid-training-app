import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIGURATION_PATHS, environmentList, metadata, ROUTES, storageAdapter } from "./configure-swim-review";
import { APPLICATION_SHA, validateDatabaseUrl } from "./prepare-swim-review";
import { INHERITED_KEYS, OVERRIDE_KEYS, REVIEW, type EnvironmentMetadata } from "./swim-review-config-plan";

export const CONFIGURATION = {
  run: "34585357240", sha: "5d26364a49d934acdcac0ae8c924ae7e6bb784f4",
  start: Date.parse("2026-09-11T09:43:14Z"), end: Date.parse("2026-09-11T09:43:41Z"),
} as const;
export const BASE_SHA = "672e4202792da122281639e3db810029432573f5";
export const RECEIPT = {
  STRAVA_REDIRECT_URI: "5s4lV71zocHvhRIV", ADMIN_EMAILS: "mg3o0suSOHFOy755",
  STRAVA_WEBHOOK_SUBSCRIPTION_ID: "Mr7NfhtE7VZszliZ", STRAVA_CLIENT_SECRET: "K0f4bhLbrF9EzjRG",
  STRAVA_CLIENT_ID: "glwp4Hb8iScFF8TE", STRAVA_WEBHOOK_CALLBACK_URL: "1Y5ArnNHj70vfXvp",
  STRAVA_WEBHOOK_VERIFY_TOKEN: "DtwpdNCatjEGqsP6", MCP_TOKEN_SIGNING_KEY: "5aNA7VPG2ZYq4vzS",
  AI_KEY_ENCRYPTION_KEY: "kprOuHvyWrnghmm8", CRON_SECRET: "KoR1hloY4E8LjI5g",
  NEXT_PUBLIC_SITE_URL: "lvTFIjqg23s9wmxQ", NEXT_PUBLIC_SUPABASE_URL: "LxsjhH0UPsvO4xkF",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "JVYMqd23W7QP2ncf", SUPABASE_SERVICE_ROLE_KEY: "XdwKUYZn4ap4tCq8",
  DATABASE_URL: "mH2CeFYgq2AePCPB", POOL_SWIMMING_ENABLED: "PET4OqfrLse8Ajig",
  ENABLE_E2E_FIXTURES: "EtvHG4BnNq0HYrMy", NEXT_PUBLIC_BUILD_SHA: "8RFJ8mROPAe9Dwq9",
} as const;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ref = `refs/heads/${REVIEW.branch}`;
const shaPattern = /^[a-f0-9]{40}$/;
const idPattern = /^[A-Za-z0-9_-]{1,256}$/;
const deploymentPattern = /^dpl_[A-Za-z0-9]{1,128}$/;
const limit = 2 * 1024 * 1024;
const otherModes = ["CONFIGURE_SWIM_REVIEW", "INSPECT_SWIM_REVIEW_AUTH", "PREPARE_SWIM_REVIEW",
  "INSPECT_SWIM_REVIEW", "SWIM_ACCEPTANCE", "MIGRATE_PRODUCTION", "ALLOW_UNDEPLOYED"] as const;
type Code = "passed" | "predicate_refused" | "receipt_invalid" | "isolation_changed" |
  "http_status" | "transport_failed" | "response_invalid" | "deadline" | "deployment_failed" | "alias_conflict" |
  "project_structure" | "project_identity" | "team_structure" | "team_identity" |
  "billing_missing" | "billing_null" | "billing_invalid" | "billing_plan" | "supabase_identity" |
  `${"ssoProtection" | "passwordProtection" | "trustedIps"}_${"missing" | "invalid" | "deploymentType"}` |
  "trustedIps_addresses" | "trustedIps_protectionMode";
class Refusal extends Error {
  constructor(readonly code: Code, readonly httpStatus?: number) { super(code); }
}
function requireThat(value: unknown, code: Code = "predicate_refused"): asserts value {
  if (!value) throw new Refusal(code);
}
function object(value: unknown): Record<string, unknown> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "response_invalid");
  return value as Record<string, unknown>;
}
function select(value: unknown, keys: readonly string[]) {
  const row = object(value);
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function canonical(rows: EnvironmentMetadata[]) {
  return [...rows].map((row) => ({ ...row, target: [...row.target].sort() })).sort((a, b) => a.id.localeCompare(b.id));
}
export function deploymentContext(env: NodeJS.ProcessEnv, inspect = false) {
  requireThat(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === REVIEW.repository && env.GITHUB_REF_TYPE === "branch" &&
    env.GITHUB_REF === ref && env.GITHUB_JOB === "deploy-swim-review" &&
    env.DEPLOY_SWIM_REVIEW === (inspect ? "false" : "true") &&
    env.INSPECT_SWIM_REVIEW_DEPLOYMENT === (inspect ? "true" : "false") &&
    otherModes.every((key) => env[key] === "false") &&
    shaPattern.test(env.EXPECTED_SHA ?? "") && env.EXPECTED_SHA === env.GITHUB_SHA &&
    env.EXPECTED_SHA !== APPLICATION_SHA && env.EXPECTED_SHA !== CONFIGURATION.sha);
}
type SourceIO = {
  git(...args: string[]): string;
  event(): unknown;
  regular(path: string): boolean;
};
export function verifyDeploymentSource(env: NodeJS.ProcessEnv, io: SourceIO, inspect = false) {
  deploymentContext(env, inspect);
  const inputs = object(object(io.event()).inputs);
  requireThat(inputs.deploy_swim_review === (inspect ? "false" : "true") &&
    inputs.inspect_swim_review_deployment === (inspect ? "true" : "false") &&
    inputs.expected_sha === env.EXPECTED_SHA &&
    otherModes.every((key) => inputs[key.toLowerCase()] === "false"));
  requireThat(io.git("rev-parse", "HEAD") === env.EXPECTED_SHA);
  io.git("merge-base", "--is-ancestor", APPLICATION_SHA, "HEAD");
  io.git("merge-base", "--is-ancestor", CONFIGURATION.sha, "HEAD");
  requireThat(io.git("status", "--porcelain", "--untracked-files=all") === "");
  const paths = io.git("diff", "--name-only", "--no-renames", APPLICATION_SHA, "HEAD").split("\n");
  requireThat(paths.length > 0 && paths.every((path) => (CONFIGURATION_PATHS as readonly string[]).includes(path)));
  for (const path of CONFIGURATION_PATHS) {
    requireThat(io.git("ls-tree", "HEAD", "--", path).startsWith("100644 blob ") && io.regular(path));
  }
  for (const [branch, sha] of [[ref, env.EXPECTED_SHA], ["refs/heads/main", BASE_SHA]]) {
    requireThat(io.git("ls-remote", "--exit-code", `https://github.com/${REVIEW.repository}.git`, branch!) ===
      `${sha}\t${branch}`);
  }
}
export const DEPLOY_ROUTES = {
  team: `https://api.vercel.com/v2/teams/${REVIEW.teamId}`,
  create: `https://api.vercel.com/v13/deployments?teamId=${REVIEW.teamId}`,
} as const;
export function updateRoute(key: "NEXT_PUBLIC_BUILD_SHA" | "POOL_SWIMMING_ENABLED") {
  return `https://api.vercel.com/v9/projects/${REVIEW.projectId}/env/${RECEIPT[key]}?teamId=${REVIEW.teamId}`;
}
export function deploymentRoute(id: string, alias = false) {
  requireThat(deploymentPattern.test(id));
  return `https://api.vercel.com/${alias ? "v2" : "v13"}/deployments/${id}${alias ? "/aliases" : ""}?teamId=${REVIEW.teamId}`;
}
type Request = (url: string, method?: string, body?: unknown) => Promise<unknown>;
export const INSPECTION_ROUTES = [ROUTES.project, DEPLOY_ROUTES.team, ROUTES.supabase,
  ROUTES.project_env, ROUTES.shared_env] as const;
export function deploymentTransport(env: NodeJS.ProcessEnv, deadline: number, fetcher: typeof fetch = fetch, inspect = false): Request {
  return async (url, method = "GET", body) => {
    if (inspect) requireThat(method === "GET" && body === undefined &&
      (INSPECTION_ROUTES as readonly string[]).includes(url));
    const readRoutes: readonly string[] = [ROUTES.project, ROUTES.project_env, ROUTES.shared_env,
      ROUTES.supabase, ROUTES.auth, ROUTES.settings, ROUTES.alias, DEPLOY_ROUTES.team];
    const id = /^https:\/\/api\.vercel\.com\/v(13|2)\/deployments\/(dpl_[A-Za-z0-9]{1,128})(\/aliases)?\?teamId=/.exec(url)?.[2];
    requireThat((method === "GET" && body === undefined &&
      (readRoutes.includes(url) || (id && url === deploymentRoute(id)))) ||
      (method === "PATCH" && [updateRoute("NEXT_PUBLIC_BUILD_SHA"), updateRoute("POOL_SWIMMING_ENABLED")].includes(url)) ||
      (method === "POST" && (url === DEPLOY_ROUTES.create || url === ROUTES.storage ||
        (id && url === deploymentRoute(id, true)))));
    requireThat(Date.now() < deadline, "deadline");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(30_000, deadline - Date.now()));
    let status: number | undefined;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (url.startsWith("https://api.vercel.com/")) headers.Authorization = ["Bearer", env.VERCEL_REVIEW_TOKEN].join(" ");
      else if (url.startsWith("https://api.supabase.com/")) headers.Authorization = ["Bearer", env.SUPABASE_REVIEW_MANAGEMENT_TOKEN].join(" ");
      else headers.apikey = (url === ROUTES.settings ? env.SWIM_REVIEW_SUPABASE_ANON_KEY : env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY)!;
      const response = await fetcher(url, { method, headers, redirect: "error", signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      status = response.status;
      if (url === ROUTES.alias && status === 404) {
        await response.body?.cancel();
        return { available: true };
      }
      if (status !== 200) { await response.body?.cancel(); throw new Refusal("http_status", status); }
      requireThat(Number(response.headers.get("content-length") ?? 0) <= limit, "response_invalid");
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            requireThat(size <= limit, "response_invalid");
            chunks.push(next.value);
          }
        } finally { await reader.cancel(); }
      }
      requireThat(!controller.signal.aborted && Date.now() < deadline, "deadline");
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
      catch { throw new Refusal("response_invalid"); }
    } catch (error) {
      throw new Refusal(error instanceof Refusal ? error.code : "transport_failed", status);
    } finally { clearTimeout(timer); }
  };
}
export function acceptedReceipt(project: EnvironmentMetadata[], shared: EnvironmentMetadata[]) {
  requireThat(new Set([...project, ...shared].map((row) => row.id)).size === project.length + shared.length, "receipt_invalid");
  for (const rows of [project, shared]) {
    const scopes = new Set<string>();
    for (const row of rows) {
      for (const target of row.target) {
        const scope = JSON.stringify([row.key, row.gitBranch, target]);
        requireThat(!scopes.has(scope), "receipt_invalid");
        scopes.add(scope);
      }
      if (row.gitBranch === null && row.target.includes("preview")) {
        requireThat((INHERITED_KEYS as readonly string[]).includes(row.key), "receipt_invalid");
      }
    }
  }
  requireThat(!shared.some((row) => row.gitBranch === REVIEW.branch), "receipt_invalid");
  const feature = project.filter((row) => row.gitBranch === REVIEW.branch);
  requireThat(feature.length === 18 && OVERRIDE_KEYS.every((key) => feature.some((row) =>
    row.key === key && row.id === RECEIPT[key] && row.type === "encrypted" &&
    same(row.target, ["preview"]) && row.createdAt >= CONFIGURATION.start &&
    row.updatedAt >= row.createdAt && row.updatedAt <= CONFIGURATION.end)), "receipt_invalid");
  return feature;
}
const intendedAuth = { site_url: REVIEW.origin, uri_allow_list: `${REVIEW.origin}/auth/callback`, disable_signup: true };
const deploymentTypes = ["all", "preview", "production", "prod_deployment_urls_and_all_previews", "all_except_custom_domains"] as const;
type Shape = "missing" | "null" | "object" | "invalid";
function shape(value: unknown): Shape {
  return value === undefined ? "missing" : value === null ? "null" :
    typeof value === "object" && !Array.isArray(value) ? "object" : "invalid";
}
function structure(value: unknown, code: Code) {
  requireThat(shape(value) === "object", code);
  return value as Record<string, unknown>;
}
function classification(value: unknown, field: "deploymentType" | "plan") {
  const type = shape(value);
  if (type !== "object") return { type };
  const known = field === "deploymentType" ? deploymentTypes : ["hobby", "pro", "enterprise"] as const;
  const entry = (value as Record<string, unknown>)[field];
  return { type, [field]: typeof entry === "string" ? known.find((item) => item === entry) ?? "other" : shape(entry) };
}
function projectIdentity(raw: unknown) {
  const row = structure(raw, "project_structure");
  const link = structure(row.link, "project_structure");
  requireThat(row.id === REVIEW.projectId && row.accountId === REVIEW.teamId && row.name === REVIEW.projectName &&
    row.rootDirectory === "apps/web" && row.framework === "nextjs" &&
    same(select(link, ["type", "org", "repo", "productionBranch"]),
      { type: "github", org: "drrowdev", repo: "hybrid-training-app", productionBranch: "main" }), "project_identity");
  // Project updatedAt also changes for our env/deployment writes; compare settings, not that aggregate marker.
  // Never inspect password hashes or protection bypass secrets.
  const protection = (key: "ssoProtection" | "passwordProtection" | "trustedIps") => {
    if (key !== "ssoProtection" && !Object.hasOwn(row, key)) {
      requireThat(Object.hasOwn(row, "ssoProtection") && shape(row.ssoProtection) === "object" &&
        (row.ssoProtection as Record<string, unknown>).deploymentType === "all_except_custom_domains", `${key}_missing`);
      // Optional omission is preserved metadata, not null or disabled protection.
      return "missing" as const;
    }
    if (row[key] === null) return null;
    requireThat(row[key] !== undefined, `${key}_missing`);
    const value = select(structure(row[key], `${key}_invalid`), ["deploymentType"]);
    requireThat(typeof value.deploymentType === "string" &&
      (deploymentTypes as readonly string[]).includes(value.deploymentType), `${key}_deploymentType`);
    return value;
  };
  const sso = protection("ssoProtection");
  const password = protection("passwordProtection");
  const trustedIps = protection("trustedIps");
  const ips = trustedIps === null || trustedIps === "missing" ? null : structure(row.trustedIps, "trustedIps_invalid");
  let addresses: unknown = null;
  let protectionMode: unknown = null;
  if (ips) {
    if (ips.addresses !== undefined) {
      requireThat(Array.isArray(ips.addresses) && ips.addresses.length <= 1000, "trustedIps_addresses");
      addresses = ips.addresses.map((address) => select(address, ["value"]));
      requireThat((addresses as Record<string, unknown>[]).every((address) =>
        typeof address.value === "string" && address.value.length <= 128), "trustedIps_addresses");
      requireThat(ips.protectionMode === "additional" || ips.protectionMode === "exclusive", "trustedIps_protectionMode");
      protectionMode = ips.protectionMode;
    } else requireThat(ips.deploymentType === "production", "trustedIps_deploymentType");
  }
  return { sso, password, trustedIps, addresses, protectionMode };
}
function teamIdentity(raw: unknown) {
  const row = structure(raw, "team_structure");
  requireThat(row.id === REVIEW.teamId && row.slug === "drrowdevs-projects", "team_identity");
  requireThat(row.billing !== undefined, "billing_missing");
  requireThat(row.billing !== null, "billing_null");
  requireThat(structure(row.billing, "billing_invalid").plan === "hobby", "billing_plan");
}
function supabaseIdentity(raw: unknown) {
  const row = object(raw);
  requireThat(row.id === REVIEW.supabaseId && row.name === REVIEW.supabaseName &&
    row.organization_id === REVIEW.organizationId && row.region === REVIEW.region &&
    row.status === "ACTIVE_HEALTHY", "supabase_identity");
}
type Deployment = { id: string; url: string; readyState: string; createdAt: number };
// Official SDK: createdeploymentresponsebody / getdeploymentresponsebody (owner projection).
export function deploymentMetadata(raw: unknown, sha: string): Deployment {
  const row = object(raw);
  const meta = object(row.meta);
  const source = object(row.gitSource);
  requireThat(typeof row.id === "string" && deploymentPattern.test(row.id) &&
    typeof row.url === "string" && /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]\.vercel\.app$/.test(row.url) &&
    row.projectId === REVIEW.projectId && row.ownerId === REVIEW.teamId && row.target === null &&
    Number.isSafeInteger(row.createdAt) && (row.createdAt as number) >= 0 &&
    source.type === "github" && source.sha === sha && source.ref === REVIEW.branch &&
    meta.githubCommitSha === sha && meta.githubCommitRef === REVIEW.branch &&
    meta.githubCommitOrg === "drrowdev" && meta.githubCommitRepo === "hybrid-training-app" &&
    typeof row.readyState === "string" && ["QUEUED", "INITIALIZING", "BUILDING", "READY", "ERROR", "CANCELED"].includes(row.readyState),
  "response_invalid");
  return { id: row.id, url: row.url, readyState: row.readyState, createdAt: row.createdAt as number };
}
type Stage = InspectionStage | "isolation" | "prewrite" | "build_sha" | "activation" |
  "predeploy" | "deployment" | "readiness" | "prealias" | "alias" | "completion";
type Attempt = { attempted: boolean; confirmed: boolean };
function summary(env: NodeJS.ProcessEnv) {
  return {
    scope: "swim-review-deployment" as const,
    testedSha: shaPattern.test(env.EXPECTED_SHA ?? "") ? env.EXPECTED_SHA! : null,
    acceptedApp: APPLICATION_SHA, configurationRun: CONFIGURATION.run, configurationSha: CONFIGURATION.sha,
    projectId: REVIEW.projectId, teamId: REVIEW.teamId, testProject: REVIEW.supabaseId,
    status: "failed" as "failed" | "deployment_pass",
    stages: [] as { stage: Stage; code: Code; status: "passed" | "failed"; httpStatus?: number }[],
    acceptedEnv: [] as { id: string; key: string }[], updatedEnv: [] as { id: string; key: string }[],
    protectedUnchanged: { project: false, shared: false }, authMatches: false, isolationVerified: false,
    buildSha: { attempted: false, confirmed: false } as Attempt,
    activation: { attempted: false, confirmed: false } as Attempt,
    deployment: { attempted: false, confirmed: false } as Attempt,
    alias: { attempted: false, confirmed: false } as Attempt,
    deploymentId: null as string | null, deploymentUrl: null as string | null,
    aliasMapping: null as { alias: string; deploymentId: string; projectId: string; teamId: string } | null,
    ready: false, partial: false, manualReconciliation: false,
    runtimePending: true, ownerLoginPending: true,
  };
}
type Dependencies = { source(): void; request: Request; storage(): Promise<boolean>; now(): number; sleep(ms: number): Promise<void> };
type InspectionStage = "source" | "credentials" | "project" | "team" | "supabase" |
  "project_env" | "shared_env" | "receipt" | "completion";
function inspectionSummary(env: NodeJS.ProcessEnv) {
  return {
    scope: "swim-review-deployment-inspection" as const,
    testedSha: shaPattern.test(env.EXPECTED_SHA ?? "") ? env.EXPECTED_SHA! : null,
    acceptedApp: APPLICATION_SHA, configurationRun: CONFIGURATION.run, configurationSha: CONFIGURATION.sha,
    projectId: REVIEW.projectId, teamId: REVIEW.teamId, testProject: REVIEW.supabaseId,
    status: "failed" as "failed" | "inspection_pass",
    stages: [] as { stage: InspectionStage; code: Code; status: "passed" | "failed"; httpStatus?: number }[],
    classifications: {
      project: null as null | Record<"ssoProtection" | "passwordProtection" | "trustedIps", ReturnType<typeof classification>>,
      team: null as null | { billing: ReturnType<typeof classification> },
    },
    receiptMatches: false, writesAttempted: false, deploymentAttempted: false, deploymentAccepted: false,
    runtimePending: true, ownerLoginPending: true,
  };
}
export async function inspectIsolation(env: NodeJS.ProcessEnv, deps: Pick<Dependencies, "source" | "request" | "now">) {
  const result = inspectionSummary(env);
  const deadline = deps.now() + 300_000;
  let stage: InspectionStage = "source";
  const checkTime = () => requireThat(deps.now() < deadline, "deadline");
  async function step<T>(name: InspectionStage, action: () => T | Promise<T>) {
    stage = name; checkTime();
    deps.source(); checkTime();
    const value = await action(); checkTime();
    result.stages.push({ stage, code: "passed", status: "passed" });
    return value;
  }
  try {
    deploymentContext(env, true);
    await step("source", () => {});
    await step("credentials", () => {
      for (const key of ["VERCEL_REVIEW_TOKEN", "SUPABASE_REVIEW_MANAGEMENT_TOKEN"]) {
        requireThat(/^[A-Za-z0-9_.-]{20,512}$/.test(env[key] ?? ""));
      }
    });
    await step("project", async () => {
      const raw = await deps.request(ROUTES.project);
      const row = structure(raw, "project_structure");
      result.classifications.project = {
        ssoProtection: classification(row.ssoProtection, "deploymentType"),
        passwordProtection: classification(row.passwordProtection, "deploymentType"),
        trustedIps: classification(row.trustedIps, "deploymentType"),
      };
      projectIdentity(raw);
    });
    await step("team", async () => {
      const raw = await deps.request(DEPLOY_ROUTES.team);
      const row = structure(raw, "team_structure");
      result.classifications.team = { billing: classification(row.billing, "plan") };
      teamIdentity(raw);
    });
    await step("supabase", async () => supabaseIdentity(await deps.request(ROUTES.supabase)));
    const read = async (url: string, shared: boolean) => {
      const raw = await deps.request(url);
      try { return environmentList(raw, shared); }
      catch { throw new Refusal("response_invalid"); }
    };
    const project = await step("project_env", () => read(ROUTES.project_env, false));
    const shared = await step("shared_env", () => read(ROUTES.shared_env, true));
    await step("receipt", () => { acceptedReceipt(project, shared); result.receiptMatches = true; });
    await step("completion", () => {});
    result.status = "inspection_pass";
  } catch (error) {
    result.stages.push({ stage, status: "failed", code: error instanceof Refusal ? error.code : "predicate_refused",
      ...(error instanceof Refusal && Number.isInteger(error.httpStatus) && error.httpStatus! >= 100 &&
        error.httpStatus! <= 599 ? { httpStatus: error.httpStatus } : {}) });
  }
  return result;
}
export async function deploy(env: NodeJS.ProcessEnv, deps: Dependencies) {
  const result = summary(env);
  const deadline = deps.now() + 18 * 60_000;
  let stage: Stage = "source";
  const checkTime = () => requireThat(deps.now() < deadline, "deadline");
  async function step<T>(name: Stage, action: () => T | Promise<T>) {
    stage = name; checkTime();
    const value = await action(); checkTime();
    result.stages.push({ stage, code: "passed", status: "passed" });
    return value;
  }
  const read = async () => ({
    project: environmentList(await deps.request(ROUTES.project_env), false),
    shared: environmentList(await deps.request(ROUTES.shared_env), true),
  });
  const auth = async () => {
    result.authMatches = same(select(await deps.request(ROUTES.auth), Object.keys(intendedAuth)), intendedAuth);
    requireThat(result.authMatches, "isolation_changed");
    const external = object(object(await deps.request(ROUTES.settings)).external);
    requireThat(external.email === true && Object.keys(external).length <= 100 &&
      Object.entries(external).every(([key, value]) => key === "email" || value === false));
  };
  const absent = async () => requireThat(same(await deps.request(ROUTES.alias), { available: true }), "alias_conflict");
  try {
    await step("source", () => { deploymentContext(env); deps.source(); });
    await step("credentials", () => {
      for (const key of ["VERCEL_REVIEW_TOKEN", "SUPABASE_REVIEW_MANAGEMENT_TOKEN"]) {
        requireThat(/^[A-Za-z0-9_.-]{20,512}$/.test(env[key] ?? ""));
      }
      requireThat(/^sb_publishable_[A-Za-z0-9_-]{20,256}$/.test(env.SWIM_REVIEW_SUPABASE_ANON_KEY ?? "") &&
        /^sb_secret_[A-Za-z0-9_-]{20,256}$/.test(env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY ?? ""));
      validateDatabaseUrl(env.SWIM_REVIEW_DATABASE_URL);
    });
    const settings = await step("project", async () => projectIdentity(await deps.request(ROUTES.project)));
    await step("team", async () => teamIdentity(await deps.request(DEPLOY_ROUTES.team)));
    await step("supabase", async () => supabaseIdentity(await deps.request(ROUTES.supabase)));
    const project = await step("project_env", async () => environmentList(await deps.request(ROUTES.project_env), false));
    const shared = await step("shared_env", async () => environmentList(await deps.request(ROUTES.shared_env), true));
    await step("receipt", () => {
      result.acceptedEnv = acceptedReceipt(project, shared).map(({ id, key }) => ({ id, key }));
    });
    await step("isolation", async () => {
      await auth();
      requireThat(await deps.storage() === true);
      await absent();
    });
    const initial = { project, shared, settings };
    let expectedProject = initial.project;
    const guards = async () => {
      checkTime(); deps.source();
      result.isolationVerified = false;
      requireThat(same(projectIdentity(await deps.request(ROUTES.project)), initial.settings), "isolation_changed");
      teamIdentity(await deps.request(DEPLOY_ROUTES.team));
      const rows = await read();
      result.protectedUnchanged.project = same(canonical(rows.project), canonical(expectedProject));
      result.protectedUnchanged.shared = same(canonical(rows.shared), canonical(initial.shared));
      requireThat(result.protectedUnchanged.project && result.protectedUnchanged.shared, "isolation_changed");
      await auth(); checkTime();
      result.isolationVerified = true;
    };
    await step("prewrite", async () => { await guards(); await absent(); });
    for (const key of ["NEXT_PUBLIC_BUILD_SHA", "POOL_SWIMMING_ENABLED"] as const) {
      const attempt = key === "NEXT_PUBLIC_BUILD_SHA" ? result.buildSha : result.activation;
      await step(key === "NEXT_PUBLIC_BUILD_SHA" ? "build_sha" : "activation", async () => {
        await guards();
        const before = expectedProject.find((row) => row.id === RECEIPT[key])!;
        const started = deps.now();
        attempt.attempted = true;
        const row = metadata(await deps.request(updateRoute(key), "PATCH", {
          key, type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch,
          value: key === "NEXT_PUBLIC_BUILD_SHA" ? env.EXPECTED_SHA! : "true",
        }));
        requireThat(same({ ...row, updatedAt: before.updatedAt }, before) &&
          row.updatedAt >= started && row.updatedAt <= deps.now(), "isolation_changed");
        expectedProject = expectedProject.map((entry) => entry.id === row.id ? row : entry);
        await guards();
        attempt.confirmed = true;
        result.updatedEnv.push({ key, id: row.id });
      });
    }
    await step("predeploy", async () => { await guards(); await absent(); });
    let deployment = await step("deployment", async () => {
      const started = deps.now();
      result.deployment.attempted = true;
      const row = deploymentMetadata(await deps.request(DEPLOY_ROUTES.create, "POST", {
        name: REVIEW.projectName, project: REVIEW.projectId,
        gitSource: { type: "github", org: "drrowdev", repo: "hybrid-training-app", ref: REVIEW.branch, sha: env.EXPECTED_SHA },
      }), env.EXPECTED_SHA!);
      requireThat(row.createdAt >= started && row.createdAt <= deps.now(), "response_invalid");
      result.deployment.confirmed = true;
      result.deploymentId = row.id; result.deploymentUrl = `https://${row.url}`;
      return row;
    });
    await step("readiness", async () => {
      const pollingDeadline = Math.min(deadline, deps.now() + 10 * 60_000);
      while (deployment.readyState !== "READY") {
        requireThat(!["ERROR", "CANCELED"].includes(deployment.readyState), "deployment_failed");
        requireThat(deps.now() < pollingDeadline, "deadline");
        await deps.sleep(Math.min(5000, pollingDeadline - deps.now()));
        requireThat(deps.now() < pollingDeadline, "deadline");
        const row = deploymentMetadata(await deps.request(deploymentRoute(deployment.id)), env.EXPECTED_SHA!);
        requireThat(row.id === deployment.id && row.url === deployment.url &&
          row.createdAt === deployment.createdAt, "response_invalid");
        requireThat(deps.now() < pollingDeadline, "deadline");
        deployment = row;
      }
      result.ready = true;
    });
    await step("prealias", async () => { await guards(); await absent(); });
    await step("alias", async () => {
      // Read-before-write is not provider-atomic CAS; a concurrent claim can still race this POST.
      result.alias.attempted = true;
      const assigned = object(await deps.request(deploymentRoute(deployment.id, true), "POST", { alias: REVIEW.proposedAlias }));
      requireThat(assigned.alias === REVIEW.proposedAlias && typeof assigned.uid === "string" &&
        idPattern.test(assigned.uid) && assigned.oldDeploymentId == null, "alias_conflict");
      const current = object(await deps.request(ROUTES.alias));
      requireThat(current.uid === assigned.uid && current.alias === REVIEW.proposedAlias &&
        current.deploymentId === deployment.id && current.projectId === REVIEW.projectId && current.redirect == null, "alias_conflict");
      const verified = deploymentMetadata(await deps.request(deploymentRoute(deployment.id)), env.EXPECTED_SHA!);
      requireThat(verified.id === deployment.id && verified.url === deployment.url &&
        verified.createdAt === deployment.createdAt && verified.readyState === "READY");
      result.alias.confirmed = true;
      result.aliasMapping = { alias: REVIEW.proposedAlias, deploymentId: deployment.id, projectId: REVIEW.projectId, teamId: REVIEW.teamId };
    });
    await step("completion", guards);
    result.status = "deployment_pass";
  } catch (error) {
    result.stages.push({ stage, status: "failed", code: error instanceof Refusal ? error.code : "predicate_refused",
      ...(error instanceof Refusal && Number.isInteger(error.httpStatus) && error.httpStatus! >= 100 &&
        error.httpStatus! <= 599 ? { httpStatus: error.httpStatus } : {}) });
    result.partial = [result.buildSha, result.activation, result.deployment, result.alias].some((attempt) => attempt.attempted);
    result.manualReconciliation = result.partial;
    result.isolationVerified = false;
    result.protectedUnchanged = { project: false, shared: false };
    result.authMatches = false;
    // Earlier configuration owns all 18 overrides and Auth. Never roll them back or delete history.
  }
  return result;
}
async function main() {
  const env = process.env;
  const args = process.argv.slice(2);
  const inspect = args.includes("--inspect-isolation");
  let result: ReturnType<typeof summary> | ReturnType<typeof inspectionSummary> = inspect ? inspectionSummary(env) : summary(env);
  try {
    requireThat(args.length === 0 || same(args, ["--check-source"]) ||
      same(args, ["--inspect-isolation"]) || same(args, ["--check-source", "--inspect-isolation"]));
    const deadline = Date.now() + (inspect ? 300_000 : 18 * 60_000);
    const source = () => verifyDeploymentSource(env, {
      event: () => JSON.parse(readFileSync(env.GITHUB_EVENT_PATH!, "utf8")),
      regular: (path) => { const stat = lstatSync(resolve(root, path)); return stat.isFile() && !stat.isSymbolicLink(); },
      git: (...args) => {
        requireThat(Date.now() < deadline, "deadline");
        return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: limit,
          timeout: Math.max(1, Math.min(15_000, deadline - Date.now())), stdio: ["ignore", "pipe", "ignore"] }).trim();
      },
    }, inspect);
    if (args.includes("--check-source")) { source(); return; }
    const request = deploymentTransport(env, deadline, fetch, inspect);
    result = inspect ? await inspectIsolation(env, { source, request, now: Date.now }) :
      await deploy(env, { source, request, storage: storageAdapter(env, request), now: Date.now,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) });
  } catch {
    result.stages.push({ stage: "source", code: "predicate_refused", status: "failed" });
  }
  console.log(JSON.stringify(result));
  if (result.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
