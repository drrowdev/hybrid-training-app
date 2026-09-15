import { z } from "zod";
import type { RefreshProfile } from "./refresh-swim-review";
import { CONDITIONING_REVIEW, CONDITIONING_REVIEW_FLAGS } from "./update-conditioning-swim-review";
import { untimedReceipt } from "./update-untimed-swim-review";
import { accountAbsenceQuery, accountTables, demand, type AccountIdentity } from "./swim-account-flow-guards";
import { REVIEW } from "./swim-review-config-plan";

export const CONDITIONING_ACCOUNT_REFERENCE = {
  sha: "9d42be34302fd194e8fca0224db9fea88226fd8e", run: "34950063605", kind: "automatic_ci",
} as const;
export const conditioningRequestDiagnosticSchema = z.object({
  operation: z.enum(["replay", "save", "context"]), status: z.number().int().min(100).max(599),
  code: z.union([z.enum(["ok", "other", "unreadable"]),
    z.string().regex(/^(?:[0-9][0-9A-Z][0-9A-Z]{3}|(?:P0|XX|HV|F0)[0-9A-Z]{3}|PGRST[0-9]{3})$/)]),
  authorization: z.union([
    z.enum(["owner_check", "unknown"]),
    z.string().regex(/^(?:table|rls):(profiles|movements|training_maxes|training_blocks|planned_sessions|program_instances|swim_plans|swim_workouts|swim_conditioning_saves|swim_conditioning_bindings|swim_import_outcomes)$/),
    z.string().regex(/^function:(uid|swim_conditioning_replay|deploy_program_with_swimming|deploy_program_instance_atomically|swim_create_plan|swim_local_today|swim_validate_plan|swim_validate_plan_binding|swim_validate_workout|swim_validate_state_append|set_updated_at)$/),
    z.string().regex(/^schema:(public|auth|pg_catalog)$/),
  ]).optional(),
}).strict().refine((value) => (value.code === "42501") === (value.authorization !== undefined));
export function conditioningFixtureSchedule(today: string) {
  z.string().date().parse(today);
  const todayDay = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  // Two weekly swims need a later, still-future rest day for the same-week edit.
  // Late-week fixtures use one swim; no course spills beyond the primary block.
  const swimDays = todayDay <= 3 ? [todayDay, todayDay + 2] : [todayDay];
  const remaining = Array.from({ length: 7 }, (_, day) => day).filter((day) => !swimDays.includes(day));
  const strengthDays = remaining.slice(0, 3);
  const restDays = remaining.slice(3);
  const editFrom = swimDays.at(-1)!;
  const editTo = swimDays.length === 2 ? restDays.find((day) => day > todayDay) : restDays[0];
  demand(editTo !== undefined, "fixture_schedule");
  return { today, todayDay, swimDays, strengthDays, editFrom, editTo, workoutCount: swimDays.length * 6 };
}
export function conditioningSaveDiagnostic(alerts: readonly string[]) {
  if (!alerts.length) return "no_alert";
  const text = alerts.join("\n");
  if (text.includes("not confirmed")) return "unconfirmed";
  if (text.includes("not available") || text.includes("unavailable")) return "unavailable";
  if (text.includes("does not fit")) return "course_fit";
  if (text.includes("plan changed")) return "changed";
  if (text.includes("could not be saved")) return "save_refused";
  if (text.includes("training maxes") || text.includes("1-rep max")) return "benchmarks";
  if (text.includes("Review the swims")) return "review_required";
  return "unclassified_alert";
}
const operations = [...CONDITIONING_REVIEW.otherOperations, "UPDATE_CONDITIONING_SWIM_REVIEW"];
const updateReceipt = z.object({
  run: z.string().regex(/^\d{8,16}$/), sha: z.literal(CONDITIONING_ACCOUNT_REFERENCE.sha),
  id: z.string().regex(/^dpl_[A-Za-z0-9]{8,128}$/),
  url: z.string().regex(/^hybrid-training-app-[a-z0-9-]+\.vercel\.app$/),
  start: z.number().int().positive(), end: z.number().int().positive(),
  flags: z.object({
    SWIM_CONDITIONING_ENABLED: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
    SWIM_IMPORT_OUTCOMES_ENABLED: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  }).strict(),
}).strict();
export type ConditioningReviewReceipt = z.infer<typeof updateReceipt>;
export function conditioningAccountProfile(value: ConditioningReviewReceipt): RefreshProfile {
  const receipt = updateReceipt.parse(value), ids = Object.values(receipt.flags);
  demand(receipt.end >= receipt.start && receipt.end - receipt.start <= 20 * 60_000 && new Set(ids).size === 2, "review_receipt");
  const { flags, ...previous } = receipt;
  return {
    reference: CONDITIONING_ACCOUNT_REFERENCE, expectedMain: CONDITIONING_REVIEW.expectedMain,
    previous, aliasUid: CONDITIONING_REVIEW.aliasUid,
    operation: "TEST_SWIM_CONDITIONING_ACCOUNT_FLOW", job: "test-swim-conditioning-account-flow",
    scope: "swim-conditioning-account-flow", otherOperations: operations,
    paths: [
      ".github/workflows/ci.yml", "packages/db/scripts/refresh-swim-review.ts",
      "packages/db/scripts/swim-account-flow-guards.ts", "packages/db/scripts/swim-conditioning-account-flow-guards.ts",
      "packages/db/scripts/__tests__/swim-conditioning-account-flow-guards.test.ts",
      "packages/db/scripts/__tests__/swim-account-flow-guards.test.ts",
      "packages/db/scripts/__tests__/update-conditioning-swim-review.test.ts",
      "packages/db/integration-tests/swim-pool-storage.mts",
      "apps/web/scripts/swim-account-flow.ts", "apps/web/scripts/swim-account-flow-browser.ts",
      "apps/web/scripts/swim-conditioning-account-flow.ts", "apps/web/scripts/swim-conditioning-account-flow-browser.ts",
      "apps/web/scripts/swim-conditioning-account-flow-observer.mjs",
      "packages/db/scripts/__tests__/swim-conditioning-account-flow-observer.test.ts",
      "apps/web/src/lib/swim/__tests__/conditioning-account-schedule.test.ts",
      "apps/web/tsconfig.account-flow.json", "apps/web/tsconfig.json",
      "docs/design/swimming-programme-rebuild.md", "docs/knowledge/log.md",
    ],
    receipt: (project, shared) => {
      const installed = project.filter((row) => ids.includes(row.id));
      demand(installed.length === 2 && new Set([...project, ...shared].map((row) => row.id)).size === project.length + shared.length &&
        CONDITIONING_REVIEW_FLAGS.every((key) => installed.some((row) => row.key === key && row.id === flags[key] &&
          row.type === "encrypted" && row.gitBranch === REVIEW.branch &&
          row.target.length === 1 && row.target[0] === "preview" &&
          row.createdAt >= receipt.start && row.createdAt <= receipt.end &&
          row.updatedAt >= row.createdAt && row.updatedAt <= receipt.end)), "review_receipt");
      untimedReceipt(project.filter((row) => !ids.includes(row.id)), shared, previous);
    },
  };
}
export function checkConditioningAccountDispatch(inputs: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv) {
  if (inputs?.test_swim_conditioning_account_flow === undefined || inputs.test_swim_conditioning_account_flow === "false") return false;
  demand(inputs.test_swim_conditioning_account_flow === "true" && inputs.review_upgrade_read_only === "true" &&
    inputs.production_readonly_scope === "preflight" && operations.every((key) => inputs[key.toLowerCase()] === "false") &&
    Object.keys(inputs).every((key) => ["test_swim_conditioning_account_flow", "review_upgrade_read_only",
      "production_readonly_scope", "expected_sha", ...operations.map((name) => name.toLowerCase())].includes(key)) &&
    env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === REVIEW.repository && env.GITHUB_REF_TYPE === "branch" &&
    env.GITHUB_REF === `refs/heads/${REVIEW.branch}` && inputs.expected_sha === env.GITHUB_SHA &&
    typeof inputs.expected_sha === "string" && /^[a-f0-9]{40}$/.test(inputs.expected_sha) &&
    inputs.expected_sha !== CONDITIONING_ACCOUNT_REFERENCE.sha, "dispatch");
  return true;
}
export const conditioningAccountTables = [...accountTables, "swim_import_outcomes", "swim_conditioning_bindings",
  "swim_conditioning_saves", "training_blocks", "program_instances", "planned_sessions", "training_maxes",
  "sessions", "cardio_logs"] as const;
export function conditioningAccountAbsenceQuery(identity: AccountIdentity) {
  const original = accountAbsenceQuery(identity);
  return {
    query: `SELECT ${conditioningAccountTables.map((table) =>
      table === "cardio_logs"
        ? "NOT EXISTS (SELECT 1 FROM public.cardio_logs c JOIN public.sessions s ON s.id = c.session_id WHERE s.user_id = $1::uuid)"
        : `NOT EXISTS (SELECT 1 FROM public.${table} WHERE ${table === "profiles" ? "id" : "user_id"} = $1::uuid)`,
    ).join(" AND ")} AS empty`,
    parameters: original.parameters,
  };
}
