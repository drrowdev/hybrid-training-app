import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { z } from "zod";
import { environmentList, metadata, ROUTES } from "./configure-swim-review";
import { DEPLOY_ROUTES } from "./deploy-swim-review";
import { refreshContext, verifyRefreshSource, type GuardedSourceProfile } from "./refresh-swim-review";
import { REVIEW, type EnvironmentMetadata } from "./swim-review-config-plan";
import {
  PRODUCTION, PRODUCTION_READONLY, PRODUCTION_ROUTES, ProductionInspectionRefusal,
  productionAlias, productionDatabaseUrl, productionDeployment, productionDeploymentRoute,
  productionSettings, requireInspection,
} from "./swim-production-readonly-guards";
import {
  productionSwimmingMigrations, PRODUCTION_UPDATE_LEDGER_QUERY, validateProductionSwimAppend, verifyProductionSwimAfter,
  PRODUCTION_SWIM_BASELINE, type ProductionSwimmingBaseline,
} from "./swim-production-update-storage";

export const ACTIVATION_MAIN = "8d4311987ccc2ab8858a87bc3153db2396bc69ed";
export const ACTIVATION_DEPLOYMENT = "dpl_8STpXb4z8Shtq85LPG3TMJ5osngj";
export const ACTIVATION_FLAGS = [
  "POOL_SWIMMING_ENABLED", "SWIM_POOL_EDITING_ENABLED", "SWIM_PRIVATE_COURSE_ENABLED",
  "SWIM_IMPORT_ENABLED", "SWIM_IMPORT_MATCHING_ENABLED",
] as const;
export const ACTIVATION_PROFILE: GuardedSourceProfile = {
  reference: { sha: "dab7624bb2107fdc1e816a9c18073b1989ee0fbe", run: "34814413709", kind: "automatic_ci" },
  expectedMain: ACTIVATION_MAIN, operation: "ACTIVATE_SWIM_PRODUCTION", job: "activate-swim-production",
  otherOperations: [...PRODUCTION_READONLY.otherOperations, "INSPECT_SWIM_PRODUCTION", "ACCEPT_LEGACY_SWIM_HISTORY"],
  paths: [".github/workflows/ci.yml", "packages/db/scripts/activate-swim-production.ts",
    "packages/db/scripts/__tests__/activate-swim-production.test.ts",
    "packages/db/integration-tests/swim-production-update-rehearsal.ts",
    "docs/design/swimming-programme-rebuild.md", "docs/knowledge/log.md"],
};
const record = z.record(z.unknown());
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function activationContext(env: NodeJS.ProcessEnv) {
  const sha = refreshContext(env, ACTIVATION_PROFILE);
  requireInspection(env.GITHUB_RUN_ATTEMPT === "1" && /^\d{8,16}$/.test(env.GITHUB_RUN_ID ?? ""), "activation_context");
  return sha;
}
export function activationDispatch(inputs: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv) {
  if (inputs?.activate_swim_production === undefined || inputs.activate_swim_production === "false") return false;
  requireInspection(inputs.activate_swim_production === "true" && inputs.review_upgrade_read_only === "true" &&
    inputs.production_readonly_scope === "preflight" && inputs.expected_sha === env.GITHUB_SHA &&
    typeof inputs.expected_sha === "string" && /^[a-f0-9]{40}$/.test(inputs.expected_sha) &&
    env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === REVIEW.repository && env.GITHUB_REF_TYPE === "branch" &&
    env.GITHUB_REF === `refs/heads/${REVIEW.branch}` &&
    ACTIVATION_PROFILE.otherOperations.every((key) => inputs[key.toLowerCase()] === "false") &&
    Object.keys(inputs).every((key) => ["activate_swim_production", "expected_sha", "review_upgrade_read_only",
      "production_readonly_scope", ...ACTIVATION_PROFILE.otherOperations.map((name) => name.toLowerCase())].includes(key)),
  "activation_dispatch");
  return true;
}
export const activationFlagsBody = () =>
  ACTIVATION_FLAGS.map((key) => ({ key, value: "true", type: "plain", target: ["production"] }));
export const activationDeploymentBody = () => ({
  name: REVIEW.projectName, project: REVIEW.projectId, target: "production",
  gitSource: { type: "github", org: "drrowdev", repo: "hybrid-training-app", ref: "main", sha: ACTIVATION_MAIN },
});
const canonical = (rows: EnvironmentMetadata[]) =>
  [...rows].map((row) => ({ ...row, target: [...row.target].sort() })).sort((a, b) => a.id.localeCompare(b.id));
type Request = (url: string, method?: string, body?: unknown) => Promise<unknown>;
type Dependencies = { source(): void; request: Request; storage(): Promise<void>; now(): number; sleep(ms: number): Promise<void> };
function snapshot(project: unknown, projectEnv: unknown, sharedEnv: unknown, reviewAlias: unknown) {
  const settings = productionSettings(project, projectEnv, sharedEnv);
  const rows = environmentList(projectEnv, false), shared = environmentList(sharedEnv, true);
  const flagRows = rows.filter((row) => row.target.includes("production") && ACTIVATION_FLAGS.some((key) => key === row.key));
  const raw = z.object({ envs: z.array(record).max(1000) }).parse(projectEnv).envs;
  const valuesMatch = flagRows.every((row) => raw.find((item) => item.id === row.id)?.value === "true");
  const protectedAlias = z.object({
    uid: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/), alias: z.literal(REVIEW.proposedAlias),
    projectId: z.literal(REVIEW.projectId), deploymentId: z.string().regex(/^dpl_[A-Za-z0-9]{1,128}$/),
    redirect: z.null().optional(),
  }).parse(reviewAlias);
  return { settings, flags: flagRows, valuesMatch,
    preserved: { protection: settings.protection, reviewAlias: protectedAlias,
      project: canonical(rows.filter((row) => !flagRows.includes(row))), shared: canonical(shared) } };
}
function createdFlags(raw: unknown) {
  const parsed = z.object({ created: z.array(record).length(5), failed: z.array(z.unknown()).length(0) }).safeParse(raw);
  requireInspection(parsed.success, "activation_flags_response");
  requireInspection(parsed.data.created.every((row) => row.value === "true"), "activation_flag_values");
  const rows = parsed.data.created.map(metadata);
  requireInspection(new Set(rows.map((row) => row.id)).size === 5 &&
    new Set(rows.map((row) => row.key)).size === 5 && rows.every((row) =>
      ACTIVATION_FLAGS.some((key) => key === row.key) && row.type === "plain" &&
      same(row.target, ["production"]) && row.gitBranch === null), "activation_flags_response");
  return rows;
}
function deploymentState(raw: unknown) {
  const parsed = z.object({ id: z.string().regex(/^dpl_[A-Za-z0-9]{1,128}$/), createdAt: z.number().int().nonnegative(),
    readyState: z.enum(["QUEUED", "INITIALIZING", "BUILDING", "READY", "ERROR", "CANCELED"]) }).safeParse(raw);
  requireInspection(parsed.success, "activation_deployment");
  const row = parsed.data;
  // Validate the same identity and source while allowing only the documented build states.
  const identity = productionDeployment({ ...record.parse(raw), readyState: "READY" }, row.id, ACTIVATION_MAIN);
  return { ...identity, createdAt: row.createdAt, readyState: row.readyState };
}
export function activationTransport(env: NodeJS.ProcessEnv, deadline: number, fetcher: typeof fetch = fetch): Request {
  let flags = false, deployment = false, id: string | undefined, requests = 0;
  return async (url, method = "GET", body) => {
    activationContext(env);
    const createFlags = method === "POST" && url === ROUTES.create && same(body, activationFlagsBody()) && !flags;
    const createDeployment = method === "POST" && url === DEPLOY_ROUTES.create &&
      same(body, activationDeploymentBody()) && flags && !deployment;
    const reads = [...Object.values(PRODUCTION_ROUTES), ROUTES.alias, productionDeploymentRoute(ACTIVATION_DEPLOYMENT),
      ...(id ? [productionDeploymentRoute(id)] : [])];
    requireInspection(++requests <= 60 && Date.now() < deadline &&
      (method === "GET" && body === undefined && reads.includes(url) || createFlags || createDeployment), "activation_http_boundary");
    if (createFlags) flags = true;
    if (createDeployment) deployment = true;
    const response = await fetcher(url, { method, redirect: "error",
      signal: AbortSignal.timeout(Math.min(15_000, deadline - Date.now())),
      headers: { Authorization: `Bearer ${env.VERCEL_REVIEW_TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) { await response.body?.cancel(); throw new ProductionInspectionRefusal("http_status", response.status); }
    const reader = response.body?.getReader(); requireInspection(reader, "http_body");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 1024 * 1024) { await reader.cancel(); throw new ProductionInspectionRefusal("http_size"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    requireInspection(Date.now() < deadline, "deadline");
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (createDeployment) id = deploymentState(raw).id;
    return raw;
  };
}
export async function activateProductionSwimming(env: NodeJS.ProcessEnv, deps: Dependencies, sourceOnly = false) {
  const result = {
    scope: "swim-production-activation", testedSha: /^[a-f0-9]{40}$/.test(env.EXPECTED_SHA ?? "") ? env.EXPECTED_SHA : null,
    deployedSha: ACTIVATION_MAIN, run: /^\d{8,16}$/.test(env.GITHUB_RUN_ID ?? "") ? env.GITHUB_RUN_ID : null,
    project: PRODUCTION.project, alias: PRODUCTION.alias, oldDeploymentId: ACTIVATION_DEPLOYMENT,
    status: "failed", stages: [] as { stage: string; status: "passed" | "failed"; code: string }[],
    flags: { attempted: false, confirmed: false }, deployment: { attempted: false, confirmed: false },
    storageVerified: false, databaseClosed: false, ready: false, aliasVerified: false, preserved: false,
    newDeploymentId: null as string | null, newDeploymentUrl: null as string | null,
    httpRequests: 0, httpStatus: null as number | null, databaseCode: null as string | null, manualReconciliation: false,
  };
  const deadline = deps.now() + 10 * 60_000;
  let stage = "source";
  const time = () => requireInspection(deps.now() < deadline, "deadline");
  const source = () => { time(); deps.source(); time(); };
  const request: Request = async (...args) => {
    time(); requireInspection(++result.httpRequests <= 60, "activation_http_boundary");
    const raw = await deps.request(...args); time(); return raw;
  };
  const step = async (name: string, action: () => Promise<void> | void) => {
    stage = name; time(); await action(); time(); result.stages.push({ stage, status: "passed", code: "passed" });
  };
  const inspect = async () => snapshot(await request(PRODUCTION_ROUTES.project),
    await request(PRODUCTION_ROUTES.projectEnv), await request(PRODUCTION_ROUTES.sharedEnv), await request(ROUTES.alias));
  try {
    await step("source", () => { source(); activationContext(env); });
    if (sourceOnly) { result.status = "source_pass"; return result; }
    await step("credentials", () => {
      requireInspection(typeof env.VERCEL_REVIEW_TOKEN === "string" && env.VERCEL_REVIEW_TOKEN.length >= 20 &&
        env.VERCEL_REVIEW_TOKEN.length <= 2048 && !/[\s\x00-\x1f\x7f]/.test(env.VERCEL_REVIEW_TOKEN), "credentials");
    });
    let before: ReturnType<typeof snapshot>;
    await step("snapshot", async () => {
      before = await inspect();
      requireInspection(before.settings.flags.every((row) => !row.configured), "activation_initial_flags");
      requireInspection(productionAlias(await request(PRODUCTION_ROUTES.alias)).deploymentId === ACTIVATION_DEPLOYMENT, "activation_old_alias");
      productionDeployment(await request(productionDeploymentRoute(ACTIVATION_DEPLOYMENT)), ACTIVATION_DEPLOYMENT, ACTIVATION_MAIN);
    });
    await step("storage", async () => {
      await deps.storage(); result.databaseClosed = true; result.storageVerified = true; source();
    });
    let added: EnvironmentMetadata[];
    const verifyFlags = async () => {
      const after = await inspect();
      requireInspection(same(after.preserved, before.preserved) && after.flags.length === 5 && after.valuesMatch &&
        same(canonical(after.flags), canonical(added)) && after.settings.flags.slice(5).every((row) => !row.configured),
      "activation_settings_changed");
      result.preserved = true;
    };
    await step("flags", async () => {
      requireInspection(same(await inspect(), before), "activation_settings_changed");
      requireInspection(productionAlias(await request(PRODUCTION_ROUTES.alias)).deploymentId === ACTIVATION_DEPLOYMENT, "activation_old_alias");
      source(); result.flags.attempted = true;
      added = createdFlags(await request(ROUTES.create, "POST", activationFlagsBody()));
      await verifyFlags(); result.flags.confirmed = true;
    });
    let deployed: ReturnType<typeof deploymentState>;
    await step("deployment", async () => {
      source();
      requireInspection(productionAlias(await request(PRODUCTION_ROUTES.alias)).deploymentId === ACTIVATION_DEPLOYMENT, "activation_old_alias");
      const started = deps.now(); result.deployment.attempted = true;
      deployed = deploymentState(await request(DEPLOY_ROUTES.create, "POST", activationDeploymentBody()));
      requireInspection(deployed.id !== ACTIVATION_DEPLOYMENT && deployed.createdAt >= started &&
        deployed.createdAt <= deps.now(), "activation_deployment");
      result.newDeploymentId = deployed.id; result.newDeploymentUrl = deployed.url; result.deployment.confirmed = true;
    });
    await step("readiness", async () => {
      for (let attempt = 0; attempt < 30 && deployed.readyState !== "READY"; attempt += 1) {
        requireInspection(!["ERROR", "CANCELED"].includes(deployed.readyState), "activation_build_failed");
        await deps.sleep(10_000); source();
        const next = deploymentState(await request(productionDeploymentRoute(deployed.id)));
        requireInspection(next.id === deployed.id && next.url === deployed.url && next.createdAt === deployed.createdAt,
          "activation_deployment");
        deployed = next;
      }
      requireInspection(deployed.readyState === "READY", "activation_not_ready"); result.ready = true;
    });
    await step("completion", async () => {
      await verifyFlags(); source();
      productionDeployment(await request(productionDeploymentRoute(deployed.id)), deployed.id, ACTIVATION_MAIN);
      requireInspection(productionAlias(await request(PRODUCTION_ROUTES.alias)).deploymentId === deployed.id, "activation_alias");
      result.aliasVerified = true; result.status = "activation_pass";
    });
  } catch (error) {
    result.status = "failed";
    result.stages.push({ stage, status: "failed", code: error instanceof ProductionInspectionRefusal ? error.code : "refused" });
    if (error instanceof ProductionInspectionRefusal && error.httpStatus !== undefined) result.httpStatus = error.httpStatus;
    if (stage === "storage" && error instanceof Error) {
      const code: unknown = Object.getOwnPropertyDescriptor(error, "code")?.value;
      if (typeof code === "string" && (/^[0-9A-Z]{5}$/.test(code) ||
        ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "CONNECT_TIMEOUT", "CONNECTION_CLOSED"].includes(code))) result.databaseCode = code;
    }
  } finally {
    result.manualReconciliation = result.status === "failed" && (result.flags.attempted || result.deployment.attempted);
  }
  return result;
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export async function verifyActivationStorage(tx: postgres.TransactionSql,
  baseline: ProductionSwimmingBaseline = PRODUCTION_SWIM_BASELINE) {
  const mode = await tx.unsafe("SELECT current_setting('transaction_read_only')='on' AS readonly");
  requireInspection(mode.length === 1 && mode[0]!.readonly === true, "activation_readonly");
  validateProductionSwimAppend(Array.from(await tx.unsafe(PRODUCTION_UPDATE_LEDGER_QUERY)), productionSwimmingMigrations(), baseline);
  await verifyProductionSwimAfter(tx);
}
async function storage(env: NodeJS.ProcessEnv) {
  const sql = postgres(productionDatabaseUrl(env.SUPABASE_PROD_DB_URL), {
    max: 1, prepare: false, ssl: "require", connect_timeout: 10, onnotice: () => {},
    connection: { default_transaction_read_only: true, statement_timeout: 10_000, lock_timeout: 5_000,
      idle_in_transaction_session_timeout: 15_000, row_security: "on", client_min_messages: "error" },
  });
  try {
    await sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", (tx) => verifyActivationStorage(tx));
  } finally { await sql.end({ timeout: 5 }); }
}
async function main() {
  const args = process.argv.slice(2), env = process.env;
  if (args.length > 1 || args.some((arg) => arg !== "--check-source")) {
    console.log("SWIM_PRODUCTION_ACTIVATION_REFUSED"); process.exitCode = 1; return;
  }
  const deadline = Date.now() + 10 * 60_000;
  const source = () => verifyRefreshSource(env, {
    git: (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: env.PATH ?? "", HOME: env.HOME ?? "", NODE_ENV: "production" } }).trim(),
    event: () => {
      const path = env.GITHUB_EVENT_PATH;
      requireInspection(path && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() &&
        lstatSync(path).size <= 2 * 1024 * 1024, "event");
      const event = record.parse(JSON.parse(readFileSync(path, "utf8")));
      requireInspection(activationDispatch(record.parse(event.inputs), env), "activation_dispatch"); return event;
    },
    regular: (path) => path.split("/").every((_, index, parts) => {
      const entry = lstatSync(resolve(root, ...parts.slice(0, index + 1)));
      return !entry.isSymbolicLink() && (index === parts.length - 1 ? entry.isFile() : entry.isDirectory());
    }),
  }, ACTIVATION_PROFILE);
  const result = await activateProductionSwimming(env, {
    source, request: activationTransport(env, deadline), storage: () => storage(env), now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }, args.length === 1);
  const marker = args.length ? "SWIM_PRODUCTION_ACTIVATION_SOURCE" : "SWIM_PRODUCTION_ACTIVATION_SUMMARY";
  const summary = () => `${marker}\n<pre>${JSON.stringify(result).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>\n`;
  try { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary()); }
  catch { result.status = "failed"; result.manualReconciliation = result.flags.attempted || result.deployment.attempted;
    result.stages.push({ stage: "report", status: "failed", code: "report_failed" }); }
  console.log(summary()); if (result.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
