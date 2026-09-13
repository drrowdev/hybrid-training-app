import { createHash } from "node:crypto";
import { z } from "zod";
import { REVIEW } from "./swim-review-config-plan";
import { UNTIMED_REVIEW, untimedReceipt } from "./update-untimed-swim-review";
import { refreshContext, type RefreshProfile } from "./refresh-swim-review";

const previous = {
  run: "34760308225", sha: "856b9b607c050fa200963e2591837b11209b64ee",
  id: "dpl_6F5LYVwyHNUfWfyoD5temeM8YKUY", url: "hybrid-training-app-am0rpbtkr-drrowdevs-projects.vercel.app",
  start: Date.parse("2026-09-13T13:40:48Z"), end: Date.parse("2026-09-13T13:43:33Z"),
} as const;
export const ACCOUNT_FLOW: RefreshProfile = {
  reference: { sha: previous.sha, run: "34759406630", kind: "automatic_ci" },
  previous, aliasUid: UNTIMED_REVIEW.aliasUid,
  operation: "TEST_SWIM_ACCOUNT_FLOW", job: "test-swim-account-flow", scope: "swim-account-flow",
  otherOperations: [...UNTIMED_REVIEW.otherOperations, "UPDATE_UNTIMED_SWIM_REVIEW"],
  receipt: (project, shared) => untimedReceipt(project, shared, previous),
  paths: [
    ".github/workflows/ci.yml", "packages/db/scripts/swim-account-flow-guards.ts",
    "packages/db/scripts/__tests__/swim-account-flow-guards.test.ts",
    "packages/db/scripts/refresh-swim-review.ts", "packages/db/scripts/update-untimed-swim-review.ts",
    "apps/web/scripts/swim-account-flow.ts", "apps/web/scripts/swim-account-flow-browser.ts",
    "apps/web/package.json", "apps/web/tsconfig.json", "apps/web/tsconfig.account-flow.json",
    "docs/knowledge/log.md", "docs/design/swimming-programme-rebuild.md",
  ],
};
export const ACCOUNT_FLOW_ORIGIN = "http://127.0.0.1:4229";
export const ACCOUNT_FLOW_SUPABASE = `https://${REVIEW.supabaseId}.supabase.co`;
export type AccountSlot = "a" | "b";
export const accountSlots: readonly AccountSlot[] = ["a", "b"];
export class AccountFlowRefusal extends Error {
  constructor(readonly code: string) { super(code); }
}
export function demand(value: unknown, code: string): asserts value {
  if (!value) throw new AccountFlowRefusal(code);
}
export function accountFlowContext(env: NodeJS.ProcessEnv, cleanup = false) {
  const sha = refreshContext(env, ACCOUNT_FLOW);
  demand(/^\d{8,16}$/.test(env.GITHUB_RUN_ID ?? "") &&
    (cleanup ? /^[1-9]\d{0,2}$/.test(env.GITHUB_RUN_ATTEMPT ?? "") : env.GITHUB_RUN_ATTEMPT === "1"), "context");
  return { sha, run: env.GITHUB_RUN_ID! };
}
export function checkAccountFlowDispatch(inputs: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv) {
  if (inputs?.test_swim_account_flow === undefined || inputs.test_swim_account_flow === "false") return false;
  demand(inputs.test_swim_account_flow === "true" && inputs.review_upgrade_read_only === "true" &&
    ACCOUNT_FLOW.otherOperations.every((key) => inputs[key.toLowerCase()] === "false") &&
    Object.keys(inputs).every((key) => ["test_swim_account_flow", "review_upgrade_read_only", "expected_sha",
      ...ACCOUNT_FLOW.otherOperations.map((name) => name.toLowerCase())].includes(key)) &&
    env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === REVIEW.repository && env.GITHUB_REF_TYPE === "branch" &&
    env.GITHUB_REF === `refs/heads/${REVIEW.branch}` && inputs.expected_sha === env.GITHUB_SHA &&
    typeof inputs.expected_sha === "string" && /^[a-f0-9]{40}$/.test(inputs.expected_sha) &&
    inputs.expected_sha !== ACCOUNT_FLOW.reference.sha, "dispatch");
  return true;
}
export function accountIdentity(run: string, sha: string, slot: AccountSlot) {
  demand(/^\d{8,16}$/.test(run) && /^[a-f0-9]{40}$/.test(sha) && accountSlots.includes(slot), "identity");
  const hex = createHash("sha256").update(`hta-swim-account-flow-v1:${REVIEW.supabaseId}:${run}:${sha}:${slot}`).digest("hex");
  return {
    id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
    email: `swim-flow-${run}-${slot}@hta-e2e.invalid`,
    marker: { version: 1, run, sha, slot },
  };
}
export type AccountIdentity = ReturnType<typeof accountIdentity>;
export function verifyAccountIdentity(user: unknown, identity: AccountIdentity) {
  const nested = z.object({ user: z.record(z.unknown()) }).safeParse(user);
  const row = z.object({
    id: z.literal(identity.id), email: z.literal(identity.email), role: z.literal("authenticated"),
    app_metadata: z.object({ hta_swim_account_flow: z.object({
      version: z.literal(1), run: z.literal(identity.marker.run), sha: z.literal(identity.marker.sha),
      slot: z.literal(identity.marker.slot),
    }).strict() }),
  }).safeParse(nested.success ? nested.data.user : user);
  demand(row.success, "account_ownership");
}
export const accountTables = [
  "profiles", "swim_plans", "swim_workouts", "swim_connections", "swim_imports", "swim_import_matches",
] as const;
export function accountAdminRequestAllowed(url: string, method: string, body: unknown,
  identities: readonly AccountIdentity[], cleanup: boolean) {
  const parsed = new URL(url);
  if (parsed.origin !== ACCOUNT_FLOW_SUPABASE || parsed.hash || parsed.username || parsed.password) return false;
  if (method === "POST" && parsed.pathname === "/auth/v1/admin/users" && !parsed.search && !cleanup) {
    const request = z.object({
      id: z.string(), email: z.string(), password: z.string().min(32).max(128),
      email_confirm: z.literal(true), app_metadata: z.object({ hta_swim_account_flow: z.unknown() }).strict(),
    }).strict().safeParse(body);
    return request.success && identities.some((identity) => request.data.id === identity.id &&
      request.data.email === identity.email &&
      JSON.stringify(request.data.app_metadata.hta_swim_account_flow) === JSON.stringify(identity.marker));
  }
  if (["GET", "DELETE"].includes(method) && !parsed.search &&
    identities.some(({ id }) => parsed.pathname === `/auth/v1/admin/users/${id}`)) {
    return body === undefined && (method === "GET" || cleanup);
  }
  const table = parsed.pathname.replace("/rest/v1/", "");
  if (!accountTables.some((allowed) => allowed === table)) return false;
  const column = table === "profiles" ? "id" : "user_id";
  if (!identities.some(({ id }) => parsed.searchParams.get(column) === `eq.${id}`)) return false;
  if (method === "PATCH" && table === "profiles" && !cleanup &&
    [...parsed.searchParams.keys()].join() === column) {
    return z.object({ onboarded_at: z.string().datetime() }).strict().safeParse(body).success;
  }
  return method === "HEAD" && body === undefined && parsed.searchParams.get("select") === "id" &&
    [...parsed.searchParams.keys()].sort().join() === [column, "select"].sort().join();
}
type AccountRequest = (path: string, method: string) => Promise<{ status: number; value: unknown }>;
export async function cleanupAccountFixtures(identities: readonly AccountIdentity[], request: AccountRequest) {
  demand(identities.length === 2 && identities[0]!.id !== identities[1]!.id, "cleanup_context");
  const result = { removed: 0, absent: 0, failed: 0 };
  for (const identity of identities) {
    try {
      const path = `/auth/v1/admin/users/${identity.id}`;
      const existing = await request(path, "GET");
      if (existing.status === 200) {
        verifyAccountIdentity(existing.value, identity);
        const removed = await request(path, "DELETE");
        demand([200, 204].includes(removed.status), "account_delete");
        result.removed++;
      } else demand(existing.status === 404, "account_lookup");
      demand((await request(path, "GET")).status === 404, "account_remaining");
      for (const table of accountTables) {
        const column = table === "profiles" ? "id" : "user_id";
        const rows = await request(`/rest/v1/${table}?select=id&${column}=eq.${identity.id}`, "HEAD");
        demand([200, 206].includes(rows.status) && z.object({ count: z.literal(0) }).safeParse(rows.value).success, "cleanup_rows");
      }
      result.absent++;
    } catch { result.failed++; }
  }
  return result;
}
