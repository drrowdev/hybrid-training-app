import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { storageAdapter } from "./configure-swim-review";
import { conditioningAccountProfile, CONDITIONING_DEPLOYED_RECEIPT } from "./swim-conditioning-account-flow-guards";
import { refreshArguments, verifyRefreshSource, type RefreshProfile } from "./refresh-swim-review";
import { inspectUpgradeSnapshot, upgradeSnapshotTransport } from "./upgrade-swim-review";
import { connectReviewDatabase } from "./upgrade-swim-review-storage";
import { validateDatabaseUrl } from "./prepare-swim-review";
import { checkConditioningReviewDispatch } from "./update-conditioning-swim-review";
import { appendIdentityReview, identityReviewMigrations, inspectIdentityReview } from "./conditioning-identity-review-storage";

const deployed = conditioningAccountProfile(CONDITIONING_DEPLOYED_RECEIPT);
export const CONDITIONING_IDENTITY_REPAIR: RefreshProfile = {
  ...deployed,
  reference: { sha: "7824054b6ebbb2bedbdb25449b51e3e3318a1420", run: "34976051107", kind: "automatic_ci" },
  operation: "UPDATE_CONDITIONING_SWIM_REVIEW", job: "update-conditioning-swim-review", scope: "swim-conditioning-review-update",
  otherOperations: [...deployed.otherOperations.filter((key) => key !== "UPDATE_CONDITIONING_SWIM_REVIEW"),
    "TEST_SWIM_CONDITIONING_ACCOUNT_FLOW"],
  paths: [
    ".github/workflows/ci.yml", ".github/workflows/swim-import-storage.yml",
    "packages/db/scripts/repair-conditioning-swim-review.ts", "packages/db/scripts/conditioning-identity-review-storage.ts",
    "packages/db/scripts/__tests__/repair-conditioning-swim-review.test.ts",
    "packages/db/scripts/swim-conditioning-account-flow-guards.ts",
    "packages/db/scripts/update-conditioning-swim-review.ts",
    "packages/db/scripts/__tests__/swim-conditioning-account-flow-guards.test.ts",
    "packages/db/scripts/__tests__/update-conditioning-swim-review.test.ts",
    "packages/db/integration-tests/swim-conditioning-identity.ts",
    "packages/db/integration-tests/swim-pool-storage.mts",
    "apps/web/scripts/swim-conditioning-account-flow.ts",
    "docs/adr/0086-atomic-swim-conditioning.md", "docs/design/swimming-programme-rebuild.md", "docs/knowledge/log.md",
  ],
};
function demand(value: unknown): asserts value { if (!value) throw new Error("refused"); }
export function checkIdentityRepairDispatch(inputs: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv) {
  if (!checkConditioningReviewDispatch(inputs, env)) return false;
  demand(inputs);
  demand(["true", "false"].includes(String(inputs.review_upgrade_read_only)) &&
    typeof inputs.review_upgrade_read_only === "string" && inputs.production_readonly_scope === "preflight" &&
    inputs.expected_sha !== CONDITIONING_IDENTITY_REPAIR.reference.sha && env.GITHUB_RUN_ATTEMPT === "1" &&
    CONDITIONING_IDENTITY_REPAIR.otherOperations.every((key) => inputs[key.toLowerCase()] === "false") &&
    Object.keys(inputs).every((key) => ["update_conditioning_swim_review", "review_upgrade_read_only",
      "production_readonly_scope", "expected_sha", ...CONDITIONING_IDENTITY_REPAIR.otherOperations.map((name) => name.toLowerCase())].includes(key)));
  return true;
}
type Dependencies = {
  source(): void; snapshot(): Promise<unknown>; inspect(count: 158 | 159): Promise<void>;
  append(guard: () => Promise<void>): Promise<void>; close(): Promise<void>;
};
export function initialIdentityRepair(readOnly: boolean) {
  return { status: "failed" as "failed" | "source_pass" | "inspection_pass" | "repair_pass",
    readOnly, attempted: false, committed: false, verified: false,
    databaseClosed: false, manualReconciliation: false,
    stages: [] as { stage: string; status: "passed" | "failed" }[] };
}
export async function repairIdentityReview(readOnly: boolean, deps: Dependencies) {
  const result = initialIdentityRepair(readOnly);
  let stage = "source";
  const step = async (name: string, action: () => Promise<void> | void) => {
    stage = name; await action(); result.stages.push({ stage, status: "passed" });
  };
  try {
    await step("source", deps.source);
    let expected: string;
    await step("snapshot", async () => { expected = JSON.stringify(await deps.snapshot()); });
    const guard = async () => {
      deps.source();
      demand(JSON.stringify(await deps.snapshot()) === expected);
      deps.source();
    };
    await step("ledger", () => deps.inspect(158));
    if (!readOnly) {
      await step("migrations", async () => {
        await guard(); result.attempted = true;
        await deps.append(guard); result.committed = true;
        await deps.inspect(159); await guard(); result.verified = true;
      });
    }
    await step("completion", guard);
    result.status = readOnly ? "inspection_pass" : "repair_pass";
  } catch {
    result.stages.push({ stage, status: "failed" });
    result.manualReconciliation = result.attempted;
  } finally {
    try { await deps.close(); result.databaseClosed = true; }
    catch { result.status = "failed"; result.manualReconciliation = result.attempted;
      result.stages.push({ stage: "close", status: "failed" }); }
  }
  return result;
}
export function reportIdentityRepair(env: NodeJS.ProcessEnv, outcome: ReturnType<typeof initialIdentityRepair>,
  append: (summary: string) => void, emit: (summary: string) => void) {
  const summary = () => `SWIM_CONDITIONING_IDENTITY_REPAIR_SUMMARY\n<pre>${JSON.stringify({
    testedSha: /^[a-f0-9]{40}$/.test(env.EXPECTED_SHA ?? "") ? env.EXPECTED_SHA : null,
    run: /^\d{8,16}$/.test(env.GITHUB_RUN_ID ?? "") ? env.GITHUB_RUN_ID : null,
    scope: "swim-conditioning-identity-repair", project: "whwilnhqfiaquwxgkxwt",
    acceptedSha: CONDITIONING_IDENTITY_REPAIR.reference.sha,
    acceptedReferenceRun: CONDITIONING_IDENTITY_REPAIR.reference.run,
    deployedSha: CONDITIONING_DEPLOYED_RECEIPT.sha, deployment: CONDITIONING_DEPLOYED_RECEIPT.id,
    before: 158, after: outcome.verified ? 159 : null, outcome,
  })}</pre>\n`;
  try { append(summary()); }
  catch {
    outcome.status = "failed"; outcome.manualReconciliation = outcome.attempted;
    outcome.stages.push({ stage: "report", status: "failed" });
  }
  emit(summary());
  return outcome.status !== "failed";
}
async function main() {
  const env = process.env, root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  let outcome = initialIdentityRepair(env.REVIEW_UPGRADE_READ_ONLY === "true");
  let stage = "source";
  try {
    const check = refreshArguments(process.argv.slice(2)), deadline = Date.now() + 10 * 60_000;
    const source = () => {
      demand(Date.now() < deadline);
      return verifyRefreshSource(env, {
        git: (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: Math.min(15_000, deadline - Date.now()),
          maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).trim(),
        event: () => {
          const path = env.GITHUB_EVENT_PATH;
          demand(path && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && lstatSync(path).size <= 2 * 1024 * 1024);
          const event = z.object({ inputs: z.record(z.unknown()) }).parse(JSON.parse(readFileSync(path, "utf8")));
          demand(checkIdentityRepairDispatch(event.inputs, env) && event.inputs.review_upgrade_read_only === env.REVIEW_UPGRADE_READ_ONLY);
          return event;
        },
        regular: (path) => path.split("/").every((_, index, parts) => {
          const stat = lstatSync(resolve(root, ...parts.slice(0, index + 1)));
          return !stat.isSymbolicLink() && (index === parts.length - 1 ? stat.isFile() : stat.isDirectory());
        }),
      }, CONDITIONING_IDENTITY_REPAIR);
    };
    source(); identityReviewMigrations();
    if (check) { outcome.status = "source_pass"; outcome.stages.push({ stage: "source", status: "passed" }); }
    else {
      stage = "credentials";
      validateDatabaseUrl(env.SWIM_REVIEW_DATABASE_URL);
      const request = upgradeSnapshotTransport(env, deadline, fetch, CONDITIONING_IDENTITY_REPAIR);
      let sql: ReturnType<typeof connectReviewDatabase> | undefined;
      const database = () => sql ??= connectReviewDatabase(env.SWIM_REVIEW_DATABASE_URL);
      const result = await repairIdentityReview(env.REVIEW_UPGRADE_READ_ONLY === "true", {
        source,
        snapshot: async () => {
          const snapshot = await inspectUpgradeSnapshot(request, storageAdapter(env, request), CONDITIONING_IDENTITY_REPAIR);
          CONDITIONING_IDENTITY_REPAIR.receipt(snapshot.project, snapshot.shared); return snapshot;
        },
        inspect: (count) => inspectIdentityReview(database(), count),
        append: (guard) => appendIdentityReview(database(), guard),
        close: async () => { if (sql) await sql.end({ timeout: 5 }); },
      });
      outcome = result;
    }
  } catch { outcome.status = "failed"; outcome.stages.push({ stage, status: "failed" }); }
  const passed = reportIdentityRepair(env, outcome, (summary) => {
    demand(env.GITHUB_STEP_SUMMARY); appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  }, console.log);
  if (!passed) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
