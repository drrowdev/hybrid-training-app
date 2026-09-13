import { z } from "zod";
import { refreshContext, type GuardedSourceProfile } from "./refresh-swim-review";
import { PRODUCTION_READONLY, productionSettings, requireInspection } from "./swim-production-readonly-guards";
import { REVIEW } from "./swim-review-config-plan";

export const PRODUCTION_UPDATE: GuardedSourceProfile = {
  reference: { sha: "08f89f05255c2f53072d5b7b936920df481595bc", run: "34771687862", kind: "automatic_ci" },
  operation: "UPDATE_SWIM_PRODUCTION", job: "update-swim-production", mainOnly: true,
  otherOperations: [...PRODUCTION_READONLY.otherOperations.filter((key) => key !== "UPDATE_SWIM_PRODUCTION"), "INSPECT_SWIM_PRODUCTION"],
  paths: PRODUCTION_READONLY.paths,
};
export function productionUpdateContext(env: NodeJS.ProcessEnv) {
  const sha = refreshContext(env, PRODUCTION_UPDATE);
  requireInspection(env.ACCEPT_LEGACY_SWIM_HISTORY === "true" && env.GITHUB_RUN_ATTEMPT === "1" &&
    /^\d{8,16}$/.test(env.GITHUB_RUN_ID ?? ""), "legacy_approval");
  return sha;
}
export function productionUpdateDispatch(inputs: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv) {
  if (inputs?.update_swim_production === undefined || inputs.update_swim_production === "false") {
    requireInspection(inputs?.accept_legacy_swim_history === undefined || inputs.accept_legacy_swim_history === "false", "legacy_approval");
    return false;
  }
  requireInspection(inputs.update_swim_production === "true" && inputs.accept_legacy_swim_history === "true" &&
    inputs.review_upgrade_read_only === "true" && inputs.production_readonly_scope === "preflight" &&
    typeof inputs.expected_sha === "string" && /^[a-f0-9]{40}$/.test(inputs.expected_sha) &&
    inputs.expected_sha === env.GITHUB_SHA && inputs.expected_sha !== PRODUCTION_UPDATE.reference.sha &&
    env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === REVIEW.repository && env.GITHUB_REF_TYPE === "branch" && env.GITHUB_REF === "refs/heads/main" &&
    PRODUCTION_UPDATE.otherOperations.every((key) => inputs[key.toLowerCase()] === "false") &&
    Object.keys(inputs).every((key) => ["update_swim_production", "accept_legacy_swim_history",
      "expected_sha", "review_upgrade_read_only", "production_readonly_scope",
      ...PRODUCTION_UPDATE.otherOperations.map((key) => key.toLowerCase())].includes(key)), "dispatch");
  return true;
}
export function requireSwimmingDisabled(value: ReturnType<typeof productionSettings>) {
  requireInspection(value.valuesRead === false &&
    value.flags.slice(0, 6).every((entry) => entry.configured === false), "production_flags");
}
export function productionGitHubDeploymentsRoute(sha: string) {
  requireInspection(/^[a-f0-9]{40}$/.test(sha), "deployment_shape");
  return `https://api.github.com/repos/${REVIEW.repository}/deployments?sha=${sha}&environment=Production&per_page=20`;
}
export function productionGitHubStatusRoute(id: number) {
  requireInspection(Number.isSafeInteger(id) && id > 0, "deployment_shape");
  return `https://api.github.com/repos/${REVIEW.repository}/deployments/${id}/statuses?per_page=20`;
}
export function productionVercelDeploymentIds(raw: unknown, sha: string) {
  const parsed = z.array(z.object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), sha: z.literal(sha),
    environment: z.literal("Production"), creator: z.object({ login: z.string(), type: z.string() }),
  })).max(20).safeParse(raw);
  requireInspection(parsed.success, "deployment_shape");
  const rows = parsed.data.filter((entry) => entry.creator.login === "vercel[bot]" && entry.creator.type === "Bot");
  requireInspection(rows.length > 0 && rows.length <= 10 && new Set(rows.map((entry) => entry.id)).size === rows.length, "deployment_evidence");
  return rows.map((entry) => entry.id);
}
export function successfulProductionStatus(raw: unknown) {
  const parsed = z.array(z.object({
    state: z.enum(["success", "failure", "error", "pending", "queued", "in_progress", "inactive"]),
  })).max(20).safeParse(raw);
  requireInspection(parsed.success, "deployment_shape");
  return parsed.data.some((entry) => entry.state === "success");
}
