import { z } from "zod";
import { ACCOUNT_FLOW } from "./swim-account-flow-guards";
import { BASE_SHA, projectIdentity } from "./deploy-swim-review";
import { environmentList, ROUTES } from "./configure-swim-review";
import { refreshContext, type GuardedSourceProfile } from "./refresh-swim-review";
import { REVIEW } from "./swim-review-config-plan";

export const PRODUCTION = {
  project: "grhetczkxawkcfgkwerj", alias: "getsxc.app", main: BASE_SHA,
  mainCount: 146, candidateCount: 155,
} as const;
export const PRODUCTION_READONLY: GuardedSourceProfile = {
  reference: { sha: "912fa419dc101cf7737c8d940c6c76101c03cad0", run: "34765760175", kind: "automatic_ci" },
  operation: "INSPECT_SWIM_PRODUCTION", job: "inspect-swim-production",
  otherOperations: [...ACCOUNT_FLOW.otherOperations, "TEST_SWIM_ACCOUNT_FLOW"],
  paths: [
    ".github/workflows/ci.yml", "packages/db/scripts/refresh-swim-review.ts",
    "packages/db/scripts/swim-production-readonly-guards.ts", "packages/db/scripts/inspect-swim-production.ts",
    "packages/db/scripts/__tests__/swim-production-readonly.test.ts",
    "docs/design/swimming-programme-rebuild.md", "docs/knowledge/log.md",
  ],
};
export class ProductionInspectionRefusal extends Error {
  constructor(readonly code: string, readonly httpStatus?: number) { super(code); }
}
export function requireInspection(value: unknown, code: string): asserts value {
  if (!value) throw new ProductionInspectionRefusal(code);
}
export function productionContext(env: NodeJS.ProcessEnv) {
  const sha = refreshContext(env, PRODUCTION_READONLY);
  requireInspection(env.GITHUB_RUN_ATTEMPT === "1" && /^\d{8,16}$/.test(env.GITHUB_RUN_ID ?? ""), "context");
  return sha;
}
export function productionDispatch(inputs: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv) {
  if (inputs?.inspect_swim_production === undefined || inputs.inspect_swim_production === "false") return false;
  requireInspection(inputs.inspect_swim_production === "true" && inputs.review_upgrade_read_only === "true" &&
    PRODUCTION_READONLY.otherOperations.every((key) => inputs[key.toLowerCase()] === "false") &&
    Object.keys(inputs).every((key) => ["inspect_swim_production", "review_upgrade_read_only", "expected_sha",
      ...PRODUCTION_READONLY.otherOperations.map((key) => key.toLowerCase())].includes(key)) &&
    env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === REVIEW.repository && env.GITHUB_REF_TYPE === "branch" &&
    env.GITHUB_REF === `refs/heads/${REVIEW.branch}` && inputs.expected_sha === env.GITHUB_SHA &&
    typeof inputs.expected_sha === "string" && /^[a-f0-9]{40}$/.test(inputs.expected_sha) &&
    inputs.expected_sha !== PRODUCTION_READONLY.reference.sha, "dispatch");
  return true;
}
export function productionDatabaseUrl(raw: string | undefined) {
  requireInspection(typeof raw === "string" && raw.length <= 4096 && !/[\s\\]/.test(raw), "database_target");
  const url = new URL(raw);
  const direct = url.hostname === `db.${PRODUCTION.project}.supabase.co` && url.username === "postgres" && url.port === "5432";
  const pooled = /^aws-\d-[a-z]+-[a-z]+-\d\.pooler\.supabase\.com$/.test(url.hostname) &&
    url.username === `postgres.${PRODUCTION.project}` && ["5432", "6543"].includes(url.port);
  const password = decodeURIComponent(url.password);
  requireInspection(["postgres:", "postgresql:"].includes(url.protocol) && (direct || pooled) &&
    url.pathname === "/postgres" && !url.hash && ["", "?sslmode=require"].includes(url.search) &&
    password.length >= 12 && password.length <= 1024 && !/[\s\x00-\x1f\x7f]/.test(password), "database_target");
  return raw;
}
export const PRODUCTION_ROUTES = {
  project: ROUTES.project, projectEnv: ROUTES.project_env, sharedEnv: ROUTES.shared_env,
  alias: `https://api.vercel.com/v4/aliases/${PRODUCTION.alias}?teamId=${REVIEW.teamId}`,
} as const;
export function productionDeploymentRoute(id: string) {
  requireInspection(/^dpl_[A-Za-z0-9]{1,128}$/.test(id), "deployment_id");
  return `https://api.vercel.com/v13/deployments/${id}?teamId=${REVIEW.teamId}`;
}
export function productionRequestAllowed(url: string, method: string, body: unknown, deploymentId?: string) {
  const allowed: readonly string[] = [
    ...Object.values(PRODUCTION_ROUTES), ...(deploymentId ? [productionDeploymentRoute(deploymentId)] : []),
  ];
  return method === "GET" && body === undefined && allowed.includes(url);
}
export function productionAlias(raw: unknown) {
  const parsed = z.object({
    alias: z.literal(PRODUCTION.alias), projectId: z.literal(REVIEW.projectId),
    deploymentId: z.string().regex(/^dpl_[A-Za-z0-9]{1,128}$/),
    redirect: z.null().optional(),
  }).safeParse(raw);
  requireInspection(parsed.success, "alias_shape");
  return parsed.data;
}
export function productionDeployment(raw: unknown, id: string) {
  const row = z.object({
    id: z.literal(id), projectId: z.literal(REVIEW.projectId), ownerId: z.literal(REVIEW.teamId),
    target: z.literal("production"), readyState: z.literal("READY"),
    url: z.string().regex(/^hybrid-training-app-[a-z0-9-]+\.vercel\.app$/),
    createdAt: z.number().int().nonnegative(),
    gitSource: z.object({ type: z.literal("github"), sha: z.literal(PRODUCTION.main),
      ref: z.enum(["main", PRODUCTION.main]) }),
    meta: z.object({ githubCommitSha: z.literal(PRODUCTION.main), githubCommitRef: z.literal("main"),
      githubCommitOrg: z.literal("drrowdev"), githubCommitRepo: z.literal("hybrid-training-app") }),
  }).safeParse(raw);
  requireInspection(row.success, "deployment_shape");
  const value = row.data;
  return { id: value.id, sha: PRODUCTION.main, url: value.url, ready: true, target: value.target };
}
const flagKeys = [
  "POOL_SWIMMING_ENABLED", "SWIM_POOL_EDITING_ENABLED", "SWIM_PRIVATE_COURSE_ENABLED",
  "SWIM_IMPORT_ENABLED", "SWIM_IMPORT_MATCHING_ENABLED", "ENABLE_E2E_FIXTURES", "NEXT_PUBLIC_BUILD_SHA",
] as const;
export function productionSettings(project: unknown, projectEnv: unknown, sharedEnv: unknown) {
  const identity = projectIdentity(project);
  const rows = [...environmentList(projectEnv, false), ...environmentList(sharedEnv, true)]
    .filter((row) => row.target.includes("production"));
  requireInspection(rows.every((row) => row.gitBranch === null) &&
    new Set(rows.map((row) => row.id)).size === rows.length &&
    new Set(rows.map((row) => row.key)).size === rows.length, "production_bindings");
  return {
    protection: { sso: identity.sso, password: identity.password, trustedIps: identity.trustedIps },
    flags: flagKeys.map((key) => {
      const row = rows.find((row) => row.key === key);
      return { key, configured: row !== undefined, ...(row ? { id: row.id, type: row.type, updatedAt: row.updatedAt } : {}) };
    }),
    valuesRead: false,
  };
}
type ExpectedMigration = { hash: string; folderMillis: number };
export function productionLedger(raw: unknown, expected: readonly ExpectedMigration[]) {
  requireInspection(expected.length === PRODUCTION.candidateCount, "source_journal");
  const rows = z.array(z.object({
    id: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{64}$/),
    created_at: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
  }).strict()).max(PRODUCTION.candidateCount).safeParse(raw);
  requireInspection(rows.success, "ledger_shape");
  const entries = rows.data;
  requireInspection(entries.length >= PRODUCTION.mainCount, "ledger_count");
  entries.forEach((row, index) => {
    requireInspection(row.hash === expected[index]!.hash, "ledger_hash");
    requireInspection(String(row.created_at) === String(expected[index]!.folderMillis), "ledger_timestamp");
    requireInspection(index === 0 || row.id > entries[index - 1]!.id, "ledger_order");
  });
  return {
    entries: entries.length, mainEntries: PRODUCTION.mainCount, candidateEntries: PRODUCTION.candidateCount,
    canonicalPrefix: true, pending: PRODUCTION.candidateCount - entries.length,
  };
}
