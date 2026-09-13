import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { boundedTransport, environmentList, metadata, ROUTES, storageAdapter } from "./configure-swim-review";
import {
  acceptedReceipt, DEPLOY_ROUTES, deploymentMetadata, deploymentRoute, deploymentTransport,
  projectIdentity, supabaseIdentity, teamIdentity,
} from "./deploy-swim-review";
import {
  OTHER_OPERATIONS, refresh, refreshArguments, refreshContext, refreshTransport, verifyRefreshSource,
  type RefreshProfile,
} from "./refresh-swim-review";
import { REVIEW, type EnvironmentMetadata } from "./swim-review-config-plan";
import { validateDatabaseUrl } from "./prepare-swim-review";
import { projectMigrationError } from "./migrate-evidence";
import {
  appendReviewMigrations, connectReviewDatabase, inspectReviewLedger, reviewMigrations,
  REVIEW_BASE_COUNT, REVIEW_UPGRADED_COUNT, ReviewStorageRefusal, type ReviewStorageCode,
} from "./upgrade-swim-review-storage";

export const UPGRADE_FLAGS = [
  "SWIM_POOL_EDITING_ENABLED", "SWIM_PRIVATE_COURSE_ENABLED", "SWIM_IMPORT_ENABLED", "SWIM_IMPORT_MATCHING_ENABLED",
] as const;
export const UPGRADE_REVIEW: RefreshProfile = {
  reference: { sha: "196045c864f9dca98d7ea6ef4dbdaf949dafbc64", run: "34741360990", kind: "automatic_ci" },
  paths: [
    ".github/workflows/ci.yml", ".github/workflows/swim-import-storage.yml",
    "packages/db/scripts/upgrade-swim-review.ts", "packages/db/scripts/upgrade-swim-review-storage.ts",
    "packages/db/scripts/__tests__/upgrade-swim-review.test.ts",
    "packages/db/scripts/refresh-swim-review.ts", "packages/db/integration-tests/swim-pool-storage.mts",
    "docs/design/swimming-programme-rebuild.md", "docs/knowledge/log.md",
  ],
  operation: "UPGRADE_SWIM_REVIEW", job: "upgrade-swim-review", scope: "swim-existing-review-upgrade",
  otherOperations: [...OTHER_OPERATIONS, "REFRESH_SWIM_REVIEW", "REFRESH_SWIM_PLAN_REVIEW", "REFRESH_SWIM_READONLY_REVIEW"],
  previous: {
    run: "34677376367", sha: "4d4d946cff6a5413b336fffe69c4321267e0d8dd",
    id: "dpl_5nL1aQq45MmDrZmkNgZwj7BX9PoA", url: "hybrid-training-app-ftavbuk0o-drrowdevs-projects.vercel.app",
    start: Date.parse("2026-09-12T06:13:58Z"), end: Date.parse("2026-09-12T06:15:45Z"),
  },
  aliasUid: "bcb28e248512a31abb41a4c636e0a6350165115f2432b6e4cba8e469c48194af0087b087a511792f853550ea01e3b2c97246876450542c7823eb40e11b303aa1",
  receipt: (project, shared) => { acceptedReceipt(project, shared, true, UPGRADE_REVIEW.previous); },
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const canonical = (rows: EnvironmentMetadata[]) =>
  [...rows].map((row) => ({ ...row, target: [...row.target].sort() })).sort((a, b) => a.id.localeCompare(b.id));
type Code = "passed" | "refused" | "deadline" | "storage_refused" | "deployment_refused" | "close_failed" | "report_failed";
class Refusal extends Error {
  constructor(readonly code: Code) { super(code); }
}
function requireThat(value: unknown): asserts value {
  if (!value) throw new Refusal("refused");
}

export function checkUpgradeDispatch(inputs: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv) {
  if (inputs?.upgrade_swim_review === undefined || inputs.upgrade_swim_review === "false") return false;
  requireThat(inputs.upgrade_swim_review === "true" &&
    UPGRADE_REVIEW.otherOperations.every((key) => inputs[key.toLowerCase()] === "false") &&
    Object.keys(inputs).every((key) => ["upgrade_swim_review", "expected_sha",
      ...UPGRADE_REVIEW.otherOperations.map((name) => name.toLowerCase())].includes(key)) &&
    env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === REVIEW.repository && env.GITHUB_REF_TYPE === "branch" &&
    env.GITHUB_REF === `refs/heads/${REVIEW.branch}` && inputs.expected_sha === env.GITHUB_SHA &&
    typeof inputs.expected_sha === "string" && /^[a-f0-9]{40}$/.test(inputs.expected_sha) &&
    inputs.expected_sha !== UPGRADE_REVIEW.reference.sha);
  return true;
}

export const upgradeFlagBody = () => UPGRADE_FLAGS.map((key) => ({
  key, value: "true", type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch,
}));
type Request = (url: string, method?: string, body?: unknown) => Promise<unknown>;
export function upgradeFlagTransport(env: NodeJS.ProcessEnv, deadline: number, fetcher: typeof fetch = fetch): Request {
  refreshContext(env, UPGRADE_REVIEW);
  const transport = boundedTransport(env, deadline, fetcher);
  let attempted = false;
  return async (url, method, body) => {
    requireThat(!attempted && url === ROUTES.create && method === "POST" && same(body, upgradeFlagBody()));
    attempted = true;
    return transport(url, method, body);
  };
}

const aliasSchema = z.object({
  uid: z.literal(UPGRADE_REVIEW.aliasUid!), alias: z.literal(REVIEW.proposedAlias),
  projectId: z.literal(REVIEW.projectId), deploymentId: z.literal(UPGRADE_REVIEW.previous.id),
  redirect: z.null().optional(),
});
export async function inspectUpgradeSnapshot(request: Request, storage: () => Promise<boolean>) {
  const protection = projectIdentity(await request(ROUTES.project));
  requireThat(same(protection.sso, { deploymentType: "all_except_custom_domains" }));
  const team = teamIdentity(await request(DEPLOY_ROUTES.team));
  const database = supabaseIdentity(await request(ROUTES.supabase));
  const project = canonical(environmentList(await request(ROUTES.project_env), false));
  const shared = canonical(environmentList(await request(ROUTES.shared_env), true));
  const auth = z.object({
    site_url: z.literal(REVIEW.origin), uri_allow_list: z.literal(`${REVIEW.origin}/auth/callback`),
    disable_signup: z.literal(true),
  }).parse(await request(ROUTES.auth));
  const { external } = z.object({ external: z.record(z.boolean()) }).parse(await request(ROUTES.settings));
  requireThat(external.email === true && Object.keys(external).length <= 100 &&
    Object.entries(external).every(([key, value]) => key === "email" || value === false));
  const old = deploymentMetadata(await request(deploymentRoute(UPGRADE_REVIEW.previous.id)), UPGRADE_REVIEW.previous.sha);
  requireThat(old.readyState === "READY" && old.id === UPGRADE_REVIEW.previous.id &&
    old.url === UPGRADE_REVIEW.previous.url && old.createdAt >= UPGRADE_REVIEW.previous.start &&
    old.createdAt <= UPGRADE_REVIEW.previous.end);
  const alias = aliasSchema.parse(await request(ROUTES.alias));
  requireThat(await storage() === true);
  return { protection, team, database, project, shared, auth, external: Object.entries(external).sort(), old, alias };
}

type Stage = "source" | "credentials" | "snapshot" | "ledger" | "migrations" | "flags" | "deployment" | "completion" | "close" | "report";
export type UpgradeResult = {
  scope: "swim-existing-review-upgrade"; testedSha: string | null; project: typeof REVIEW.supabaseId;
  acceptedApplicationSha: string; acceptedApplicationRun: string;
  status: "failed" | "source_pass" | "upgrade_pass";
  stages: { stage: Stage; status: "passed" | "failed"; code: Code | ReviewStorageCode }[];
  error?: ReturnType<typeof projectMigrationError>["error"];
  migrations: { before: 150; after: 154; attempted: boolean; committed: boolean; verified: boolean };
  flags: { attempted: boolean; confirmed: boolean; entries: { id: string; key: string }[] | null };
  deployment: Awaited<ReturnType<typeof refresh>> | null;
  partial: boolean; manualReconciliation: boolean; databaseClosed: boolean;
};
function initialResult(env: NodeJS.ProcessEnv): UpgradeResult {
  return {
    scope: "swim-existing-review-upgrade",
    testedSha: /^[a-f0-9]{40}$/.test(env.EXPECTED_SHA ?? "") ? env.EXPECTED_SHA! : null,
    project: REVIEW.supabaseId, acceptedApplicationSha: UPGRADE_REVIEW.reference.sha,
    acceptedApplicationRun: UPGRADE_REVIEW.reference.run, status: "failed", stages: [],
    migrations: { before: 150, after: 154, attempted: false, committed: false, verified: false },
    flags: { attempted: false, confirmed: false, entries: [] }, deployment: null,
    partial: false, manualReconciliation: false, databaseClosed: false,
  };
}
type Dependencies = {
  source(): void; request: Request; createFlags: Request; storage(): Promise<boolean>;
  inspectLedger(count: number): Promise<void>;
  append(guard: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
  deploy(profile: RefreshProfile): Promise<Awaited<ReturnType<typeof refresh>>>;
  now(): number;
};
export async function upgradeReview(env: NodeJS.ProcessEnv, deps: Dependencies): Promise<UpgradeResult> {
  const result = initialResult(env);
  const deadline = deps.now() + 18 * 60_000;
  let stage: Stage = "source";
  const time = () => { if (deps.now() >= deadline) throw new Refusal("deadline"); };
  const source = () => { time(); deps.source(); time(); };
  async function step<T>(name: Stage, action: () => T | Promise<T>) {
    stage = name; time();
    const value = await action(); time();
    result.stages.push({ stage, code: "passed", status: "passed" });
    return value;
  }
  try {
    await step("source", () => { source(); refreshContext(env, UPGRADE_REVIEW); });
    await step("credentials", () => {
      validateDatabaseUrl(env.SWIM_REVIEW_DATABASE_URL);
      for (const key of ["VERCEL_REVIEW_TOKEN", "SUPABASE_REVIEW_MANAGEMENT_TOKEN"]) {
        requireThat(/^[A-Za-z0-9_.-]{20,512}$/.test(env[key] ?? ""));
      }
      requireThat(/^sb_publishable_[A-Za-z0-9_-]{20,256}$/.test(env.SWIM_REVIEW_SUPABASE_ANON_KEY ?? "") &&
        /^sb_secret_[A-Za-z0-9_-]{20,256}$/.test(env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY ?? ""));
    });
    let expected = await step("snapshot", async () => {
      const snapshot = await inspectUpgradeSnapshot(deps.request, deps.storage);
      UPGRADE_REVIEW.receipt(snapshot.project, snapshot.shared);
      return snapshot;
    });
    const guard = async () => {
      source();
      requireThat(same(await inspectUpgradeSnapshot(deps.request, deps.storage), expected));
      source();
    };
    await step("ledger", async () => { await guard(); await deps.inspectLedger(REVIEW_BASE_COUNT); });
    await step("migrations", async () => {
      await guard();
      result.migrations.attempted = true;
      await deps.append(guard);
      result.migrations.committed = true;
      await deps.inspectLedger(REVIEW_UPGRADED_COUNT);
      await guard();
      result.migrations.verified = true;
    });
    const created = await step("flags", async () => {
      await guard();
      const started = deps.now();
      result.flags.attempted = true;
      result.flags.entries = null;
      const envelope = z.object({ created: z.unknown(), failed: z.array(z.unknown()).max(4) }).strict()
        .parse(await deps.createFlags(ROUTES.create, "POST", upgradeFlagBody()));
      const rows = (Array.isArray(envelope.created) ? envelope.created : [envelope.created]).map(metadata);
      const knownIds = new Set([...expected.project, ...expected.shared].map((row) => row.id));
      requireThat(rows.length <= 4 &&
        new Set(rows.map((row) => row.key)).size === rows.length && new Set(rows.map((row) => row.id)).size === rows.length &&
        rows.every((row) => !knownIds.has(row.id) && UPGRADE_FLAGS.some((key) => key === row.key) &&
          row.type === "encrypted" && row.gitBranch === REVIEW.branch && same(row.target, ["preview"]) &&
          row.createdAt >= started && row.createdAt <= deps.now() && row.updatedAt >= row.createdAt &&
          row.updatedAt <= deps.now()));
      result.flags.entries = rows.map(({ id, key }) => ({ id, key }));
      requireThat(envelope.failed.length === 0 && rows.length === 4);
      expected = { ...expected, project: canonical([...expected.project, ...rows]) };
      await guard();
      result.flags.confirmed = true;
      return rows;
    });
    await step("deployment", async () => {
      await guard();
      const ids = new Set(created.map((row) => row.id));
      const profile: RefreshProfile = {
        ...UPGRADE_REVIEW,
        receipt: (project, shared) => {
          requireThat(same(canonical(project.filter((row) => ids.has(row.id))), canonical(created)));
          UPGRADE_REVIEW.receipt(project.filter((row) => !ids.has(row.id)), shared);
        },
      };
      result.deployment = await deps.deploy(profile);
      if (result.deployment.status !== "refresh_pass") throw new Refusal("deployment_refused");
    });
    await step("completion", () => source());
    result.status = "upgrade_pass";
  } catch (error) {
    result.error = projectMigrationError(error).error;
    result.stages.push({ stage, status: "failed", code: error instanceof Refusal || error instanceof ReviewStorageRefusal ? error.code :
      ["ledger", "migrations"].includes(stage) ? "storage_refused" : "refused" });
  } finally {
    try {
      await deps.close();
      result.databaseClosed = true;
      result.stages.push({ stage: "close", status: "passed", code: "passed" });
    } catch {
      result.status = "failed";
      result.stages.push({ stage: "close", status: "failed", code: "close_failed" });
    }
    if (result.status === "failed") {
      result.partial = result.migrations.attempted || result.flags.attempted || result.deployment?.partial === true;
      result.manualReconciliation = result.partial;
    }
  }
  return result;
}

export function upgradeSummary(result: UpgradeResult) {
  const escaped = JSON.stringify(result).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `SWIM_REVIEW_UPGRADE_SUMMARY\n<pre>${escaped}</pre>\n`;
}
async function main() {
  const env = process.env;
  let result = initialResult(env);
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
        const event: unknown = JSON.parse(readFileSync(path, "utf8"));
        const { inputs } = z.object({ inputs: z.record(z.unknown()) }).parse(event);
        requireThat(checkUpgradeDispatch(inputs, env));
        return event;
      },
      regular: (path) => path.split("/").every((_, index, parts) => {
        const stat = lstatSync(resolve(root, ...parts.slice(0, index + 1)));
        return !stat.isSymbolicLink() && (index === parts.length - 1 ? stat.isFile() : stat.isDirectory());
      }),
    }, UPGRADE_REVIEW);
    if (check) {
      source(); reviewMigrations();
      result.status = "source_pass";
      result.stages.push({ stage: "source", code: "passed", status: "passed" });
    } else {
      source();
      const migrations = reviewMigrations();
      let sql: ReturnType<typeof connectReviewDatabase> | undefined;
      const database = () => sql ??= connectReviewDatabase(env.SWIM_REVIEW_DATABASE_URL);
      const request = deploymentTransport(env, deadline);
      result = await upgradeReview(env, {
        source, request, createFlags: upgradeFlagTransport(env, deadline),
        storage: storageAdapter(env, request), now: Date.now,
        inspectLedger: (count) => inspectReviewLedger(database(), migrations, count),
        append: (guard) => appendReviewMigrations(database(), migrations, guard),
        close: async () => { if (sql) await sql.end({ timeout: 5 }); },
        deploy: (profile) => {
          const transport = refreshTransport(env, deadline, fetch, profile);
          return refresh(env, { source, request: transport, storage: storageAdapter(env, transport),
            now: Date.now, sleep: (ms) => new Promise((done) => setTimeout(done, ms)) }, profile);
        },
      });
    }
  } catch {
    result.stages.push({ stage: "source", status: "failed", code: "refused" });
  }
  try {
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, upgradeSummary(result));
  } catch {
    result.status = "failed";
    result.stages.push({ stage: "report", status: "failed", code: "report_failed" });
    result.partial = result.migrations.attempted;
    result.manualReconciliation = result.partial;
  }
  console.log(upgradeSummary(result));
  if (result.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
