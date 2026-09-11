import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { environmentList, metadata, ROUTES, storageAdapter } from "./configure-swim-review";
import {
  ACCEPTED_DEPLOYMENT, acceptedReceipt, BASE_SHA, DEPLOY_ROUTES, deploymentMetadata,
  deploymentRoute, deploymentTransport, projectIdentity, RECEIPT, supabaseIdentity, teamIdentity, updateRoute,
} from "./deploy-swim-review";
import { REVIEW, type EnvironmentMetadata } from "./swim-review-config-plan";

export const REFRESH_REFERENCE = {
  sha: "0a3d12e862ad2ffe7acbb8498f3442923005674c", run: "34606756220",
} as const;
export const REFRESH_PATHS = [
  "packages/db/scripts/refresh-swim-review.ts", "packages/db/scripts/__tests__/refresh-swim-review.test.ts",
  "packages/db/scripts/deploy-swim-review.ts", "packages/db/scripts/__tests__/deploy-swim-review.test.ts",
  "HANDOFF.md", "docs/knowledge/log.md", ".github/workflows/ci.yml",
] as const;
export const OTHER_OPERATIONS = [
  "DEPLOY_SWIM_REVIEW", "INSPECT_SWIM_REVIEW_DEPLOYMENT", "PROVISION_SWIM_REVIEW_OWNER",
  "CONFIGURE_SWIM_REVIEW", "INSPECT_SWIM_REVIEW_AUTH", "PREPARE_SWIM_REVIEW",
  "INSPECT_SWIM_REVIEW", "SWIM_ACCEPTANCE", "MIGRATE_PRODUCTION", "ALLOW_UNDEPLOYED",
] as const;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const record = z.record(z.unknown());
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type Code = "passed" | "refused" | "deadline" | "transport_failed" | "http_status";
class Refusal extends Error {
  constructor(readonly code: Code, readonly httpStatus?: number) { super(code); }
}
function requireThat(value: unknown): asserts value { if (!value) throw new Refusal("refused"); }
export function refreshArguments(args: string[]) {
  requireThat(args.length === 0 || same(args, ["--check-source"]));
  return args.length === 1;
}
export function refreshContext(env: NodeJS.ProcessEnv) {
  const sha = shaSchema.parse(env.EXPECTED_SHA);
  requireThat(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === REVIEW.repository && env.GITHUB_REF_TYPE === "branch" &&
    env.GITHUB_REF === `refs/heads/${REVIEW.branch}` && env.GITHUB_JOB === "refresh-swim-review" &&
    env.REFRESH_SWIM_REVIEW === "true" && OTHER_OPERATIONS.every((key) => env[key] === "false") &&
    env.GITHUB_SHA === sha && sha !== REFRESH_REFERENCE.sha);
  return sha;
}
type SourceIO = { git(...args: string[]): string; event(): unknown; regular(path: string): boolean };
export function verifyRefreshSource(env: NodeJS.ProcessEnv, io: SourceIO) {
  const sha = refreshContext(env);
  const inputs = record.parse(record.parse(io.event()).inputs);
  requireThat(inputs.refresh_swim_review === "true" && inputs.expected_sha === sha &&
    OTHER_OPERATIONS.every((key) => inputs[key.toLowerCase()] === "false"));
  requireThat(io.git("rev-parse", "HEAD") === sha && io.git("status", "--porcelain", "--untracked-files=all") === "");
  io.git("merge-base", "--is-ancestor", REFRESH_REFERENCE.sha, "HEAD");
  const paths = io.git("diff", "--name-only", "--no-renames", REFRESH_REFERENCE.sha, "HEAD").split("\n");
  requireThat(paths.length > 0 && paths.every((path) => REFRESH_PATHS.some((allowed) => path === allowed)));
  // Check every tracked source path, including unchanged files and parent directories.
  for (const entry of io.git("ls-tree", "-r", "HEAD").split("\n")) {
    const match = /^(100644|100755) blob [a-f0-9]{40}\t([^\t\r\n]+)$/.exec(entry);
    requireThat(match && match[2] && io.regular(match[2]));
  }
  for (const [branch, expected] of [[`refs/heads/${REVIEW.branch}`, sha], ["refs/heads/main", BASE_SHA]]) {
    requireThat(io.git("ls-remote", "--exit-code", `https://github.com/${REVIEW.repository}.git`, branch!) === `${expected}\t${branch}`);
  }
}
type Request = (url: string, method?: string, body?: unknown) => Promise<unknown>;
const buildBody = (sha: string) => ({
  key: "NEXT_PUBLIC_BUILD_SHA", type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch, value: sha,
});
const createBody = (sha: string) => ({
  name: REVIEW.projectName, project: REVIEW.projectId,
  gitSource: { type: "github", org: "drrowdev", repo: "hybrid-training-app", ref: REVIEW.branch, sha },
});
const reads: readonly string[] = [
  ROUTES.project, DEPLOY_ROUTES.team, ROUTES.supabase, ROUTES.project_env,
  ROUTES.shared_env, ROUTES.auth, ROUTES.settings, ROUTES.alias, deploymentRoute(ACCEPTED_DEPLOYMENT.id),
];
export function refreshTransport(env: NodeJS.ProcessEnv, deadline: number, fetcher: typeof fetch = fetch): Request {
  const sha = refreshContext(env);
  const transport = deploymentTransport(env, deadline, fetcher);
  let patched = false;
  let created = false;
  let assigned = false;
  let deployment: ReturnType<typeof deploymentMetadata> | undefined;
  let ready = false;
  return async (url, method = "GET", body) => {
    const patch = method === "PATCH" && url === updateRoute("NEXT_PUBLIC_BUILD_SHA") && same(body, buildBody(sha)) && !patched;
    const create = method === "POST" && url === DEPLOY_ROUTES.create && same(body, createBody(sha)) && patched && !created;
    const alias = method === "POST" && deployment && ready && url === deploymentRoute(deployment.id, true) &&
      same(body, { alias: REVIEW.proposedAlias }) && !assigned;
    requireThat((method === "GET" && body === undefined && (reads.includes(url) ||
      (deployment && url === deploymentRoute(deployment.id)))) ||
      (method === "POST" && url === ROUTES.storage && same(body, {})) || patch || create || alias);
    if (patch) patched = true;
    if (create) created = true;
    if (alias) assigned = true;
    const started = Date.now();
    let raw: unknown;
    try { raw = await transport(url, method, body); }
    catch (error) {
      const parsed = z.object({ code: z.enum(["deadline", "http_status", "transport_failed"]),
        httpStatus: z.number().int().min(100).max(599).optional() }).safeParse(error);
      throw parsed.success ? new Refusal(parsed.data.code, parsed.data.httpStatus) : new Refusal("transport_failed");
    }
    if (create) {
      deployment = deploymentMetadata(raw, sha);
      requireThat(deployment.id !== ACCEPTED_DEPLOYMENT.id && deployment.createdAt >= started && deployment.createdAt <= Date.now());
      ready = deployment.readyState === "READY";
    } else if (deployment && url === deploymentRoute(deployment.id)) {
      const next = deploymentMetadata(raw, sha);
      requireThat(next.id === deployment.id && next.url === deployment.url && next.createdAt === deployment.createdAt);
      ready = next.readyState === "READY";
    }
    return raw;
  };
}
const aliasSchema = z.object({
  uid: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/), alias: z.literal(REVIEW.proposedAlias),
  projectId: z.literal(REVIEW.projectId), deploymentId: z.string(), redirect: z.null().optional(),
});
function aliasMetadata(raw: unknown, id: string, uid?: string) {
  const row = aliasSchema.parse(raw);
  requireThat(row.deploymentId === id && (uid === undefined || row.uid === uid));
  return row;
}
const canonical = (rows: EnvironmentMetadata[]) =>
  [...rows].map((row) => ({ ...row, target: [...row.target].sort() })).sort((a, b) => a.id.localeCompare(b.id));
type Stage = "source" | "credentials" | "snapshot" | "build_sha" | "deployment" | "readiness" | "alias" | "completion";
type Attempt = { attempted: boolean; confirmed: boolean };
type Summary = {
  scope: "swim-review-refresh"; testedSha: string | null; acceptedSha: string; acceptedReferenceRun: string;
  projectId: string; teamId: string; testProject: string; status: "failed" | "refresh_pass" | "source_pass";
  stages: { stage: Stage; code: Code; status: "passed" | "failed"; httpStatus?: number }[];
  oldDeploymentId: string; oldDeploymentUrl: string; newDeploymentId: string | null; newDeploymentUrl: string | null;
  aliasMapping: { alias: string; uid: string; deploymentId: string; projectId: string } | null;
  changedEnv: { key: "NEXT_PUBLIC_BUILD_SHA"; id: typeof RECEIPT.NEXT_PUBLIC_BUILD_SHA }[];
  buildSha: Attempt; deployment: Attempt; alias: Attempt;
  ready: boolean; storageReady: boolean; protectedUnchanged: boolean; authMatches: boolean; isolationVerified: boolean;
  partial: boolean; manualReconciliation: boolean;
};
function summary(env: NodeJS.ProcessEnv): Summary {
  const sha = shaSchema.safeParse(env.EXPECTED_SHA);
  return {
    scope: "swim-review-refresh", testedSha: sha.success ? sha.data : null,
    acceptedSha: REFRESH_REFERENCE.sha, acceptedReferenceRun: REFRESH_REFERENCE.run,
    projectId: REVIEW.projectId, teamId: REVIEW.teamId, testProject: REVIEW.supabaseId, status: "failed", stages: [],
    oldDeploymentId: ACCEPTED_DEPLOYMENT.id, oldDeploymentUrl: `https://${ACCEPTED_DEPLOYMENT.url}`,
    newDeploymentId: null, newDeploymentUrl: null, aliasMapping: null, changedEnv: [],
    buildSha: { attempted: false, confirmed: false }, deployment: { attempted: false, confirmed: false },
    alias: { attempted: false, confirmed: false }, ready: false, storageReady: false, protectedUnchanged: false,
    authMatches: false, isolationVerified: false, partial: false, manualReconciliation: false,
  };
}
type Dependencies = { source(): void; request: Request; storage(): Promise<boolean>; now(): number; sleep(ms: number): Promise<void> };
export async function refresh(env: NodeJS.ProcessEnv, deps: Dependencies): Promise<Summary> {
  const result = summary(env);
  const deadline = deps.now() + 18 * 60_000;
  let stage: Stage = "source";
  const time = () => { if (deps.now() >= deadline) throw new Refusal("deadline"); };
  const source = () => { time(); deps.source(); time(); };
  const request: Request = async (...args) => { time(); const raw = await deps.request(...args); time(); return raw; };
  async function step<T>(name: Stage, action: () => T | Promise<T>) {
    stage = name; time();
    const value = await action(); time();
    result.stages.push({ stage, code: "passed", status: "passed" });
    return value;
  }
  const snapshot = async () => {
    const protection = projectIdentity(await request(ROUTES.project));
    requireThat(same(protection.sso, { deploymentType: "all_except_custom_domains" }));
    teamIdentity(await request(DEPLOY_ROUTES.team));
    supabaseIdentity(await request(ROUTES.supabase));
    const project = environmentList(await request(ROUTES.project_env), false);
    const shared = environmentList(await request(ROUTES.shared_env), true);
    z.object({ site_url: z.literal(REVIEW.origin), uri_allow_list: z.literal(`${REVIEW.origin}/auth/callback`),
      disable_signup: z.literal(true) }).parse(await request(ROUTES.auth));
    const { external } = z.object({ external: record }).parse(await request(ROUTES.settings));
    requireThat(external.email === true && Object.keys(external).length <= 100 &&
      Object.entries(external).every(([key, value]) => key === "email" || value === false));
    requireThat(await deps.storage() === true); time();
    return { protection, project: canonical(project), shared: canonical(shared),
      external: Object.entries(external).sort(([a], [b]) => a.localeCompare(b)) };
  };
  try {
    const sha = await step("source", () => { source(); return refreshContext(env); });
    await step("credentials", () => {
      for (const key of ["VERCEL_REVIEW_TOKEN", "SUPABASE_REVIEW_MANAGEMENT_TOKEN"]) {
        requireThat(/^[A-Za-z0-9_.-]{20,512}$/.test(env[key] ?? ""));
      }
      requireThat(/^sb_publishable_[A-Za-z0-9_-]{20,256}$/.test(env.SWIM_REVIEW_SUPABASE_ANON_KEY ?? "") &&
        /^sb_secret_[A-Za-z0-9_-]{20,256}$/.test(env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY ?? ""));
    });
    const initial = await step("snapshot", async () => {
      const state = await snapshot();
      acceptedReceipt(state.project, state.shared, true);
      const old = deploymentMetadata(await request(deploymentRoute(ACCEPTED_DEPLOYMENT.id)), ACCEPTED_DEPLOYMENT.sha);
      requireThat(old.id === ACCEPTED_DEPLOYMENT.id && old.url === ACCEPTED_DEPLOYMENT.url && old.readyState === "READY" &&
        old.createdAt >= ACCEPTED_DEPLOYMENT.start && old.createdAt <= ACCEPTED_DEPLOYMENT.end);
      return { state, alias: aliasMetadata(await request(ROUTES.alias), old.id) };
    });
    let expected = initial.state;
    const guards = async (id: string = ACCEPTED_DEPLOYMENT.id) => {
      result.protectedUnchanged = false; result.authMatches = false; result.isolationVerified = false; result.storageReady = false;
      source();
      requireThat(same(await snapshot(), expected));
      const old = deploymentMetadata(await request(deploymentRoute(ACCEPTED_DEPLOYMENT.id)), ACCEPTED_DEPLOYMENT.sha);
      requireThat(old.id === ACCEPTED_DEPLOYMENT.id && old.url === ACCEPTED_DEPLOYMENT.url && old.readyState === "READY" &&
        old.createdAt >= ACCEPTED_DEPLOYMENT.start && old.createdAt <= ACCEPTED_DEPLOYMENT.end);
      source();
      const mapping = aliasMetadata(await request(ROUTES.alias), id, initial.alias.uid);
      result.protectedUnchanged = true; result.authMatches = true; result.isolationVerified = true; result.storageReady = true;
      return mapping;
    };
    await step("build_sha", async () => {
      await guards();
      const before = expected.project.find((row) => row.id === RECEIPT.NEXT_PUBLIC_BUILD_SHA);
      requireThat(before);
      const started = deps.now();
      result.buildSha.attempted = true;
      const row = metadata(await request(updateRoute("NEXT_PUBLIC_BUILD_SHA"), "PATCH", buildBody(sha)));
      requireThat(same({ ...row, updatedAt: before.updatedAt }, before) && row.updatedAt >= started && row.updatedAt <= deps.now());
      expected = { ...expected, project: expected.project.map((entry) => entry.id === row.id ? row : entry) };
      await guards();
      result.buildSha.confirmed = true;
      result.changedEnv.push({ key: "NEXT_PUBLIC_BUILD_SHA", id: RECEIPT.NEXT_PUBLIC_BUILD_SHA });
    });
    let deployment = await step("deployment", async () => {
      await guards();
      const started = deps.now();
      result.deployment.attempted = true;
      const row = deploymentMetadata(await request(DEPLOY_ROUTES.create, "POST", createBody(sha)), sha);
      requireThat(row.id !== ACCEPTED_DEPLOYMENT.id && row.createdAt >= started && row.createdAt <= deps.now());
      result.newDeploymentId = row.id; result.newDeploymentUrl = `https://${row.url}`;
      await guards();
      result.deployment.confirmed = true;
      return row;
    });
    const verifyDeployment = async () => {
      const row = deploymentMetadata(await request(deploymentRoute(deployment.id)), sha);
      requireThat(row.id === deployment.id && row.url === deployment.url && row.createdAt === deployment.createdAt);
      return row;
    };
    await step("readiness", async () => {
      const pollingDeadline = Math.min(deadline, deps.now() + 10 * 60_000);
      do {
        if (deps.now() >= pollingDeadline) throw new Refusal("deadline");
        deployment = await verifyDeployment();
        if (deps.now() >= pollingDeadline) throw new Refusal("deadline");
        requireThat(deployment.readyState !== "ERROR" && deployment.readyState !== "CANCELED");
        if (deployment.readyState !== "READY") await deps.sleep(Math.min(5000, pollingDeadline - deps.now()));
      } while (deployment.readyState !== "READY");
      result.ready = true;
    });
    await step("alias", async () => {
      requireThat((await verifyDeployment()).readyState === "READY");
      await guards();
      // Read-before-write and postverification are NOT atomic CAS; a concurrent writer can race this POST.
      result.alias.attempted = true;
      const assigned = z.object({ alias: z.literal(REVIEW.proposedAlias),
        uid: z.literal(initial.alias.uid), oldDeploymentId: z.literal(ACCEPTED_DEPLOYMENT.id) })
        .parse(await request(deploymentRoute(deployment.id, true), "POST", { alias: REVIEW.proposedAlias }));
      const mapping = aliasMetadata(await request(ROUTES.alias), deployment.id, assigned.uid);
      requireThat((await verifyDeployment()).readyState === "READY");
      await guards(deployment.id);
      result.alias.confirmed = true;
      result.aliasMapping = { alias: mapping.alias, uid: mapping.uid, projectId: mapping.projectId, deploymentId: deployment.id };
    });
    await step("completion", async () => { await guards(deployment.id); requireThat((await verifyDeployment()).readyState === "READY"); source(); });
    result.status = "refresh_pass";
  } catch (error) {
    result.stages.push({ stage, status: "failed", code: error instanceof Refusal ? error.code : "refused",
      ...(error instanceof Refusal && error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}) });
    result.partial = result.buildSha.attempted || result.deployment.attempted || result.alias.attempted;
    result.manualReconciliation = result.partial;
    result.protectedUnchanged = false; result.authMatches = false; result.isolationVerified = false;
    result.storageReady = false; result.ready = false; result.aliasMapping = null;
  }
  return result;
}
async function main() {
  const env = process.env;
  let result = summary(env);
  try {
    const check = refreshArguments(process.argv.slice(2));
    const deadline = Date.now() + (check ? 300_000 : 18 * 60_000);
    const source = () => verifyRefreshSource(env, {
      git: (...args) => {
        if (Date.now() >= deadline) throw new Refusal("deadline");
        return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
          timeout: Math.max(1, Math.min(15_000, deadline - Date.now())), stdio: ["ignore", "pipe", "ignore"] }).trim();
      },
      event: () => {
        const path = env.GITHUB_EVENT_PATH;
        requireThat(path && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && lstatSync(path).size <= 2 * 1024 * 1024);
        return JSON.parse(readFileSync(path, "utf8"));
      },
      regular: (path) => {
        const parts = path.split("/");
        return parts.every((_, i) => {
          const stat = lstatSync(resolve(root, ...parts.slice(0, i + 1)));
          return !stat.isSymbolicLink() && (i === parts.length - 1 ? stat.isFile() : stat.isDirectory());
        });
      },
    });
    if (check) {
      source(); result.status = "source_pass";
      result.stages.push({ stage: "source", code: "passed", status: "passed" });
    }
    else {
      const request = refreshTransport(env, deadline);
      result = await refresh(env, { source, request, storage: storageAdapter(env, request), now: Date.now,
        sleep: (ms) => new Promise((done) => setTimeout(done, ms)) });
    }
  } catch { result.stages.push({ stage: "source", code: "refused", status: "failed" }); }
  console.log(JSON.stringify(result));
  if (result.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
