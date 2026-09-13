import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { acceptedReceipt } from "./deploy-swim-review";
import { storageAdapter } from "./configure-swim-review";
import { REVIEW, type EnvironmentMetadata } from "./swim-review-config-plan";
import { OTHER_OPERATIONS, refresh, refreshArguments, refreshContext, refreshTransport, verifyRefreshSource, type RefreshProfile } from "./refresh-swim-review";
import { inspectUpgradeSnapshot, upgradeSnapshotTransport, UPGRADE_REVIEW } from "./upgrade-swim-review";
import { connectReviewDatabase } from "./upgrade-swim-review-storage";
import { appendUntimedMigration, inspectUntimedLedger, untimedReviewMigrations } from "./untimed-swim-review-storage";
import { validateDatabaseUrl } from "./prepare-swim-review";

const previous = {
  run: "34746629650", sha: "daec45dbae033abbca94cd2180378c2a124f96e4",
  id: "dpl_699GApEwBMqPgJqSWqcfqM6FbRxM", url: "hybrid-training-app-mqjcrxvru-drrowdevs-projects.vercel.app",
  start: Date.parse("2026-09-13T08:06:20Z"), end: Date.parse("2026-09-13T08:09:17Z"),
} as const;
export const UNTIMED_FLAG_RECEIPT = {
  SWIM_POOL_EDITING_ENABLED: "u4GSfz0fYEObC9Lw", SWIM_PRIVATE_COURSE_ENABLED: "XNKcwWs49wJC08nz",
  SWIM_IMPORT_ENABLED: "DgJigT8LfEg45Guz", SWIM_IMPORT_MATCHING_ENABLED: "MgLRqcgTW5NPiudC",
} as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function requireThat(value: unknown): asserts value { if (!value) throw new Error("refused"); }
export function untimedReceipt(project: EnvironmentMetadata[], shared: EnvironmentMetadata[],
  buildShaWindow: { start: number; end: number } = previous) {
  const ids: readonly string[] = Object.values(UNTIMED_FLAG_RECEIPT);
  const flags = project.filter((row) => ids.includes(row.id));
  requireThat(new Set([...project, ...shared].map((row) => row.id)).size === project.length + shared.length &&
    flags.length === 4 && Object.entries(UNTIMED_FLAG_RECEIPT).every(([key, id]) => flags.some((row) =>
      row.id === id && row.key === key && row.type === "encrypted" && row.gitBranch === REVIEW.branch &&
      same(row.target, ["preview"]) && row.createdAt >= previous.start && row.createdAt <= previous.end &&
      row.updatedAt >= row.createdAt && row.updatedAt <= previous.end)));
  acceptedReceipt(project.filter((row) => !ids.includes(row.id)), shared, true, buildShaWindow);
}
export const UNTIMED_REVIEW: RefreshProfile = {
  reference: { sha: "73ef5be96518905a4a96930f2b43d189145a139e", run: "34758418894", kind: "automatic_ci" },
  paths: [
    ".github/workflows/ci.yml", ".github/workflows/swim-import-storage.yml",
    "packages/db/scripts/update-untimed-swim-review.ts", "packages/db/scripts/untimed-swim-review-storage.ts",
    "packages/db/scripts/__tests__/update-untimed-swim-review.test.ts",
    "packages/db/scripts/__tests__/refresh-swim-review.test.ts",
    "packages/db/scripts/refresh-swim-review.ts", "packages/db/scripts/upgrade-swim-review.ts",
    "packages/db/integration-tests/swim-pool-storage.mts",
    "docs/knowledge/log.md", "docs/design/swimming-programme-rebuild.md", "docs/adr/0083-private-swimming-courses.md",
  ],
  operation: "UPDATE_UNTIMED_SWIM_REVIEW", job: "update-untimed-swim-review", scope: "swim-untimed-review-update",
  otherOperations: [...OTHER_OPERATIONS, "REFRESH_SWIM_REVIEW", "REFRESH_SWIM_PLAN_REVIEW", "REFRESH_SWIM_READONLY_REVIEW", "UPGRADE_SWIM_REVIEW"],
  previous, aliasUid: UPGRADE_REVIEW.aliasUid, receipt: untimedReceipt,
};
export function checkUntimedDispatch(inputs: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv) {
  if (inputs?.update_untimed_swim_review === undefined || inputs.update_untimed_swim_review === "false") return false;
  requireThat(inputs.update_untimed_swim_review === "true" &&
    ["true", "false"].includes(String(inputs.review_upgrade_read_only)) && typeof inputs.review_upgrade_read_only === "string" &&
    UNTIMED_REVIEW.otherOperations.every((key) => inputs[key.toLowerCase()] === "false") &&
    Object.keys(inputs).every((key) => ["update_untimed_swim_review", "review_upgrade_read_only", "expected_sha",
      ...UNTIMED_REVIEW.otherOperations.map((name) => name.toLowerCase())].includes(key)) &&
    env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === REVIEW.repository && env.GITHUB_REF_TYPE === "branch" &&
    env.GITHUB_REF === `refs/heads/${REVIEW.branch}` && inputs.expected_sha === env.GITHUB_SHA &&
    typeof inputs.expected_sha === "string" && /^[a-f0-9]{40}$/.test(inputs.expected_sha) &&
    inputs.expected_sha !== UNTIMED_REVIEW.reference.sha);
  return true;
}
const safeCode = z.enum([
  "refused", "deadline", "migration_source", "ledger_shape", "ledger_mismatch", "owner_policies", "writer_role", "capabilities",
  "snapshot_project", "snapshot_team", "snapshot_database", "snapshot_project_env", "snapshot_shared_env",
  "snapshot_auth", "snapshot_settings", "snapshot_previous", "snapshot_alias", "snapshot_storage", "snapshot_receipt",
]);
type Stage = "source" | "credentials" | "snapshot" | "ledger" | "migrations" | "deployment" | "completion" | "close" | "report";
export type UntimedUpdateResult = {
  scope: "swim-untimed-review-update"; testedSha: string | null; project: typeof REVIEW.supabaseId;
  acceptedApplicationSha: string; acceptedApplicationRun: string;
  status: "failed" | "source_pass" | "inspection_pass" | "upgrade_pass"; readOnly: boolean;
  stages: { stage: Stage; status: "passed" | "failed"; code: string }[];
  migrations: { before: 154; after: 155; attempted: boolean; committed: boolean; verified: boolean };
  deployment: Awaited<ReturnType<typeof refresh>> | null;
  partial: boolean; manualReconciliation: boolean; databaseClosed: boolean;
};
function initialResult(env: NodeJS.ProcessEnv): UntimedUpdateResult {
  return {
    scope: "swim-untimed-review-update", testedSha: /^[a-f0-9]{40}$/.test(env.EXPECTED_SHA ?? "") ? env.EXPECTED_SHA! : null,
    project: REVIEW.supabaseId, acceptedApplicationSha: UNTIMED_REVIEW.reference.sha, acceptedApplicationRun: UNTIMED_REVIEW.reference.run,
    status: "failed", readOnly: env.REVIEW_UPGRADE_READ_ONLY !== "false", stages: [],
    migrations: { before: 154, after: 155, attempted: false, committed: false, verified: false },
    deployment: null, partial: false, manualReconciliation: false, databaseClosed: false,
  };
}
type Dependencies = {
  source(): void;
  snapshot(): Promise<Awaited<ReturnType<typeof inspectUpgradeSnapshot>>>;
  inspectLedger(count: 154 | 155): Promise<void>;
  append(guard: () => Promise<void>): Promise<void>;
  deploy(): Promise<Awaited<ReturnType<typeof refresh>>>;
  close(): Promise<void>; now(): number;
};
export async function updateUntimedReview(env: NodeJS.ProcessEnv, deps: Dependencies) {
  const result = initialResult(env);
  const deadline = deps.now() + 18 * 60_000;
  let stage: Stage = "source";
  const source = () => { requireThat(deps.now() < deadline); deps.source(); requireThat(deps.now() < deadline); };
  async function step<T>(name: Stage, action: () => T | Promise<T>) {
    stage = name; requireThat(deps.now() < deadline);
    const value = await action(); requireThat(deps.now() < deadline);
    result.stages.push({ stage, status: "passed", code: "passed" });
    return value;
  }
  try {
    await step("source", () => { source(); refreshContext(env, UNTIMED_REVIEW); });
    requireThat(["true", "false"].includes(env.REVIEW_UPGRADE_READ_ONLY ?? ""));
    await step("credentials", () => {
      validateDatabaseUrl(env.SWIM_REVIEW_DATABASE_URL);
      for (const key of ["VERCEL_REVIEW_TOKEN", "SUPABASE_REVIEW_MANAGEMENT_TOKEN"]) requireThat(/^[A-Za-z0-9_.-]{20,512}$/.test(env[key] ?? ""));
      requireThat(/^sb_publishable_[A-Za-z0-9_-]{20,256}$/.test(env.SWIM_REVIEW_SUPABASE_ANON_KEY ?? "") &&
        /^sb_secret_[A-Za-z0-9_-]{20,256}$/.test(env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY ?? ""));
    });
    const expected = await step("snapshot", async () => {
      const value = await deps.snapshot();
      untimedReceipt(value.project, value.shared);
      return value;
    });
    const guard = async () => { source(); requireThat(same(await deps.snapshot(), expected)); source(); };
    await step("ledger", async () => { await guard(); await deps.inspectLedger(154); });
    if (result.readOnly) { result.status = "inspection_pass"; return result; }
    await step("migrations", async () => {
      await guard(); result.migrations.attempted = true;
      await deps.append(guard); result.migrations.committed = true;
      await deps.inspectLedger(155); await guard(); result.migrations.verified = true;
    });
    await step("deployment", async () => {
      await guard();
      result.deployment = await deps.deploy();
      requireThat(result.deployment.status === "refresh_pass");
    });
    await step("completion", async () => { source(); await deps.inspectLedger(155); });
    result.status = "upgrade_pass";
  } catch (error) {
    const parsed = z.object({ code: safeCode }).safeParse(error);
    result.stages.push({ stage, status: "failed", code: parsed.success ? parsed.data.code : "refused" });
  } finally {
    try { await deps.close(); result.databaseClosed = true; result.stages.push({ stage: "close", status: "passed", code: "passed" }); }
    catch { result.status = "failed"; result.stages.push({ stage: "close", status: "failed", code: "close_failed" }); }
    if (result.status === "failed") {
      result.partial = result.migrations.attempted || result.deployment?.partial === true;
      result.manualReconciliation = result.partial;
    }
  }
  return result;
}
export function untimedUpdateSummary(result: UntimedUpdateResult) {
  return `SWIM_UNTIMED_REVIEW_SUMMARY\n<pre>${JSON.stringify(result).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>\n`;
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
async function main() {
  const env = process.env;
  let result = initialResult(env);
  try {
    const check = refreshArguments(process.argv.slice(2));
    const deadline = Date.now() + (check ? 300_000 : 18 * 60_000);
    const source = () => verifyRefreshSource(env, {
      git: (...args) => {
        requireThat(Date.now() < deadline);
        return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
          timeout: Math.max(1, Math.min(15_000, deadline - Date.now())), stdio: ["ignore", "pipe", "ignore"] }).trim();
      },
      event: () => {
        const path = env.GITHUB_EVENT_PATH;
        requireThat(path && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && lstatSync(path).size <= 2 * 1024 * 1024);
        const event: unknown = JSON.parse(readFileSync(path, "utf8"));
        const { inputs } = z.object({ inputs: z.record(z.unknown()) }).parse(event);
        requireThat(checkUntimedDispatch(inputs, env) && inputs.review_upgrade_read_only === env.REVIEW_UPGRADE_READ_ONLY);
        return event;
      },
      regular: (path) => path.split("/").every((_, index, parts) => {
        const stat = lstatSync(resolve(root, ...parts.slice(0, index + 1)));
        return !stat.isSymbolicLink() && (index === parts.length - 1 ? stat.isFile() : stat.isDirectory());
      }),
    }, UNTIMED_REVIEW);
    source();
    const migrations = untimedReviewMigrations();
    if (check) { result.status = "source_pass"; result.stages.push({ stage: "source", status: "passed", code: "passed" }); }
    else {
      let sql: ReturnType<typeof connectReviewDatabase> | undefined;
      const database = () => sql ??= connectReviewDatabase(env.SWIM_REVIEW_DATABASE_URL);
      const request = upgradeSnapshotTransport(env, deadline, fetch, UNTIMED_REVIEW);
      result = await updateUntimedReview(env, {
        source, snapshot: () => inspectUpgradeSnapshot(request, storageAdapter(env, request), UNTIMED_REVIEW),
        inspectLedger: (count) => inspectUntimedLedger(database(), migrations, count),
        append: (guard) => appendUntimedMigration(database(), migrations, guard),
        close: async () => { if (sql) await sql.end({ timeout: 5 }); }, now: Date.now,
        deploy: () => {
          const transport = refreshTransport(env, deadline, fetch, UNTIMED_REVIEW);
          return refresh(env, { source, request: transport, storage: storageAdapter(env, transport),
            now: Date.now, sleep: (ms) => new Promise((done) => setTimeout(done, ms)) }, UNTIMED_REVIEW);
        },
      });
    }
  } catch { result.stages.push({ stage: "source", status: "failed", code: "refused" }); }
  try { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, untimedUpdateSummary(result)); }
  catch {
    result.status = "failed"; result.stages.push({ stage: "report", status: "failed", code: "report_failed" });
    result.partial = result.migrations.attempted; result.manualReconciliation = result.partial;
  }
  console.log(untimedUpdateSummary(result));
  if (result.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
