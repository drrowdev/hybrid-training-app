import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { storageAdapter } from "./configure-swim-review";
import { REVIEW } from "./swim-review-config-plan";
import { refresh, refreshArguments, refreshTransport, verifyRefreshSource, type RefreshProfile } from "./refresh-swim-review";
import {
  initialUpgradeResult, upgradeFlagTransport, upgradeReview, upgradeSnapshotTransport, upgradeSummary, type UpgradeConfiguration,
} from "./upgrade-swim-review";
import { ACCOUNT_FLOW } from "./swim-account-flow-guards";
import { untimedReceipt } from "./update-untimed-swim-review";
import { connectReviewDatabase } from "./upgrade-swim-review-storage";
import { appendConditioningMigrations, conditioningReviewMigrations, inspectConditioningLedger } from "./conditioning-swim-review-storage";

export const CONDITIONING_REVIEW_FLAGS = ["SWIM_CONDITIONING_ENABLED", "SWIM_IMPORT_OUTCOMES_ENABLED"] as const;
export const CONDITIONING_REVIEW: RefreshProfile = {
  reference: { sha: "410ea93c4ac1be4b300cd1ca8c1e6de605fe1d6d", run: "34947730470", kind: "automatic_ci" },
  expectedMain: "8d4311987ccc2ab8858a87bc3153db2396bc69ed",
  previous: ACCOUNT_FLOW.previous, aliasUid: ACCOUNT_FLOW.aliasUid,
  operation: "UPDATE_CONDITIONING_SWIM_REVIEW", job: "update-conditioning-swim-review", scope: "swim-conditioning-review-update",
  otherOperations: [...ACCOUNT_FLOW.otherOperations, "TEST_SWIM_ACCOUNT_FLOW", "INSPECT_SWIM_PRODUCTION",
    "UPDATE_SWIM_PRODUCTION", "ACCEPT_LEGACY_SWIM_HISTORY", "ACTIVATE_SWIM_PRODUCTION"],
  receipt: (project, shared) => untimedReceipt(project, shared, ACCOUNT_FLOW.previous),
  paths: [
    ".github/workflows/ci.yml", ".github/workflows/swim-import-storage.yml",
    "packages/db/scripts/update-conditioning-swim-review.ts", "packages/db/scripts/conditioning-swim-review-storage.ts",
    "packages/db/scripts/__tests__/update-conditioning-swim-review.test.ts",
    "packages/db/scripts/__tests__/upgrade-swim-review.test.ts",
    "packages/db/scripts/__tests__/update-untimed-swim-review.test.ts",
    "packages/db/scripts/__tests__/swim-account-flow-guards.test.ts",
    "packages/db/scripts/upgrade-swim-review.ts", "packages/db/scripts/refresh-swim-review.ts",
    "packages/db/integration-tests/swim-pool-storage.mts",
    "docs/knowledge/log.md", "docs/design/swimming-programme-rebuild.md",
  ],
};
export const CONDITIONING_UPGRADE: UpgradeConfiguration = {
  profile: CONDITIONING_REVIEW, scope: "swim-conditioning-review-update", flags: CONDITIONING_REVIEW_FLAGS,
  before: 155, after: 158,
};
function demand(value: unknown): asserts value { if (!value) throw new Error("refused"); }
export function checkConditioningReviewDispatch(inputs: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv) {
  if (inputs?.update_conditioning_swim_review === undefined || inputs.update_conditioning_swim_review === "false") return false;
  demand(inputs.update_conditioning_swim_review === "true" &&
    typeof inputs.review_upgrade_read_only === "string" && ["true", "false"].includes(inputs.review_upgrade_read_only) &&
    inputs.production_readonly_scope === "preflight" &&
    CONDITIONING_REVIEW.otherOperations.every((key) => inputs[key.toLowerCase()] === "false") &&
    Object.keys(inputs).every((key) => ["update_conditioning_swim_review", "review_upgrade_read_only",
      "production_readonly_scope", "expected_sha", ...CONDITIONING_REVIEW.otherOperations.map((name) => name.toLowerCase())].includes(key)) &&
    env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === REVIEW.repository && env.GITHUB_REF_TYPE === "branch" &&
    env.GITHUB_REF === `refs/heads/${REVIEW.branch}` && inputs.expected_sha === env.GITHUB_SHA &&
    typeof inputs.expected_sha === "string" && /^[a-f0-9]{40}$/.test(inputs.expected_sha) &&
    inputs.expected_sha !== CONDITIONING_REVIEW.reference.sha && env.GITHUB_RUN_ATTEMPT === "1");
  return true;
}
export const conditioningReviewSummary = (result: ReturnType<typeof initialUpgradeResult>) =>
  upgradeSummary(result).replace("SWIM_REVIEW_UPGRADE_SUMMARY", "SWIM_CONDITIONING_REVIEW_SUMMARY");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
async function main() {
  const env = process.env;
  let result = initialUpgradeResult(env, CONDITIONING_UPGRADE);
  try {
    const check = refreshArguments(process.argv.slice(2));
    const deadline = Date.now() + (check ? 300_000 : 18 * 60_000);
    const source = () => verifyRefreshSource(env, {
      git: (...args) => {
        demand(Date.now() < deadline);
        return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
          timeout: Math.max(1, Math.min(15_000, deadline - Date.now())), stdio: ["ignore", "pipe", "ignore"] }).trim();
      },
      event: () => {
        const path = env.GITHUB_EVENT_PATH;
        demand(path && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && lstatSync(path).size <= 2 * 1024 * 1024);
        const event = z.object({ inputs: z.record(z.unknown()) }).parse(JSON.parse(readFileSync(path, "utf8")));
        demand(checkConditioningReviewDispatch(event.inputs, env) && event.inputs.review_upgrade_read_only === env.REVIEW_UPGRADE_READ_ONLY);
        return event;
      },
      regular: (path) => path.split("/").every((_, index, parts) => {
        const stat = lstatSync(resolve(root, ...parts.slice(0, index + 1)));
        return !stat.isSymbolicLink() && (index === parts.length - 1 ? stat.isFile() : stat.isDirectory());
      }),
    }, CONDITIONING_REVIEW);
    source();
    const migrations = conditioningReviewMigrations();
    if (check) { result.status = "source_pass"; result.stages.push({ stage: "source", status: "passed", code: "passed" }); }
    else {
      let sql: ReturnType<typeof connectReviewDatabase> | undefined;
      const database = () => sql ??= connectReviewDatabase(env.SWIM_REVIEW_DATABASE_URL);
      const request = upgradeSnapshotTransport(env, deadline, fetch, CONDITIONING_REVIEW);
      result = await upgradeReview(env, {
        source, request, createFlags: upgradeFlagTransport(env, deadline, fetch, CONDITIONING_REVIEW, CONDITIONING_REVIEW_FLAGS),
        storage: storageAdapter(env, request), now: Date.now,
        inspectLedger: (count) => inspectConditioningLedger(database(), migrations, count),
        append: (guard) => appendConditioningMigrations(database(), migrations, guard),
        close: async () => { if (sql) await sql.end({ timeout: 5 }); },
        deploy: (profile) => {
          const transport = refreshTransport(env, deadline, fetch, profile);
          return refresh(env, { source, request: transport, storage: storageAdapter(env, transport),
            now: Date.now, sleep: (ms) => new Promise((done) => setTimeout(done, ms)) }, profile);
        },
      }, CONDITIONING_UPGRADE);
    }
  } catch { result.stages.push({ stage: "source", status: "failed", code: "refused" }); }
  try { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, conditioningReviewSummary(result)); }
  catch {
    result.status = "failed"; result.stages.push({ stage: "report", status: "failed", code: "report_failed" });
    result.partial = result.migrations.attempted || result.flags.attempted || result.deployment?.partial === true;
    result.manualReconciliation = result.partial;
  }
  console.log(conditioningReviewSummary(result));
  if (result.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
