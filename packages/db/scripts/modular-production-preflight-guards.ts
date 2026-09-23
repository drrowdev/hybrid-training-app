import { z } from "zod";
import { productionSettings, requireInspection } from "./swim-production-readonly-guards";
import { environmentList } from "./configure-swim-review";
import { productionHistoryFingerprint, productionHistoryRows, PRODUCTION_SWIM_BASELINE } from "./swim-production-reconciliation";
import { REVIEW } from "./swim-review-config-plan";

export const MODULAR_PREFLIGHT = {
  main: "d10e413727af4fd14481500298416bc7dd8310e3",
  branch: "drrowdev-modular-programs-implementation",
  sourceCount: 156,
  scope: "modular_preflight",
  job: "inspect-modular-production",
} as const;

export const MODULAR_DISABLED_OPERATIONS = [
  "migrate_production", "allow_undeployed", "swim_acceptance", "prepare_swim_review",
  "inspect_swim_review", "configure_swim_review", "inspect_swim_review_auth", "deploy_swim_review",
  "inspect_swim_review_deployment", "provision_swim_review_owner", "refresh_swim_review",
  "refresh_swim_plan_review", "refresh_swim_readonly_review", "upgrade_swim_review",
  "update_untimed_swim_review", "test_swim_account_flow", "update_swim_production",
  "accept_legacy_swim_history", "update_modular_production",
] as const;

export function modularPreflightDispatch(inputs: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv) {
  if (inputs?.production_readonly_scope !== MODULAR_PREFLIGHT.scope) return false;
  requireInspection(inputs.inspect_swim_production === "true" && inputs.review_upgrade_read_only === "true" &&
    MODULAR_DISABLED_OPERATIONS.every((key) => inputs[key] === "false") &&
    Object.keys(inputs).every((key) => [
      "inspect_swim_production", "review_upgrade_read_only", "production_readonly_scope", "expected_sha",
      ...MODULAR_DISABLED_OPERATIONS,
    ].includes(key)) &&
    env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === REVIEW.repository && env.GITHUB_REF_TYPE === "branch" &&
    env.GITHUB_REF === `refs/heads/${MODULAR_PREFLIGHT.branch}` &&
    typeof inputs.expected_sha === "string" && /^[a-f0-9]{40}$/.test(inputs.expected_sha) &&
    inputs.expected_sha === env.GITHUB_SHA && inputs.expected_sha !== MODULAR_PREFLIGHT.main, "dispatch");
  return true;
}

export function modularPreflightContext(inputs: Record<string, unknown>, env: NodeJS.ProcessEnv) {
  requireInspection(modularPreflightDispatch(inputs, env) &&
    env.EXPECTED_SHA === inputs.expected_sha && env.GITHUB_JOB === MODULAR_PREFLIGHT.job &&
    env.GITHUB_RUN_ATTEMPT === "1" && /^\d{8,16}$/.test(env.GITHUB_RUN_ID ?? ""), "context");
  return String(inputs.expected_sha);
}

export function modularProductionSettings(project: unknown, projectEnv: unknown, sharedEnv: unknown) {
  const settings = productionSettings(project, projectEnv, sharedEnv);
  const key = "SWIM_IMPORT_OUTCOMES_ENABLED";
  const row = [...environmentList(projectEnv, false), ...environmentList(sharedEnv, true)]
    .find((entry) => entry.key === key && entry.target.includes("production"));
  return {
    ...settings,
    outcomeFlag: {
      key, configured: row !== undefined,
      ...(row ? { id: row.id, type: row.type, updatedAt: row.updatedAt } : {}),
    },
  };
}

const migration = z.object({
  tag: z.string().regex(/^\d{4}_[A-Za-z0-9_-]+$/),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  folderMillis: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type ModularMigration = z.infer<typeof migration>;

export function modularMigrationInventory(raw: unknown, source: readonly ModularMigration[],
  baseline: { entries: number; fingerprint: string } = PRODUCTION_SWIM_BASELINE) {
  const migrations = z.array(migration).min(MODULAR_PREFLIGHT.sourceCount).max(164).parse(source);
  requireInspection(migrations.every((entry, index) => Number(entry.tag.slice(0, 4)) === index &&
    (index === 0 || entry.folderMillis > migrations[index - 1]!.folderMillis)) &&
    new Set(migrations.map((entry) => entry.hash)).size === migrations.length &&
    baseline.entries === 203 && /^[a-f0-9]{64}$/.test(baseline.fingerprint), "source_journal");
  const entries = productionHistoryRows(raw);
  requireInspection(entries.length < 512 && entries.length >= baseline.entries + 9 &&
    entries.every((entry, index) => index === 0 || entry.id > entries[index - 1]!.id), "ledger_shape");
  const retained = entries.slice(0, baseline.entries);
  requireInspection(productionHistoryFingerprint(retained) === baseline.fingerprint, "legacy_history_changed");
  const retainedHashes = new Set(retained.map((entry) => entry.hash));
  requireInspection(migrations.slice(0, 146).every((entry) => retainedHashes.has(entry.hash)) &&
    migrations.slice(146).every((entry) => !retainedHashes.has(entry.hash)), "legacy_membership");
  const appended = entries.slice(baseline.entries);
  requireInspection(appended.length <= migrations.length - 146 && appended.every((entry, index) =>
    entry.hash === migrations[146 + index]!.hash &&
    String(entry.created_at) === String(migrations[146 + index]!.folderMillis)), "ledger_append_changed");
  const stamps = entries.map((entry) => {
    requireInspection(typeof entry.created_at === "string" && /^\d{1,16}$/.test(entry.created_at) ||
      typeof entry.created_at === "number" && Number.isSafeInteger(entry.created_at) && entry.created_at >= 0,
    "ledger_timestamp");
    return BigInt(entry.created_at);
  });
  const latest = stamps.reduce((highest, value) => value > highest ? value : highest, 0n);
  const pending = migrations.slice(146 + appended.length);
  requireInspection(pending.every((entry) => BigInt(entry.folderMillis) > latest), "pending_timestamp");
  return {
    entries: entries.length,
    fingerprint: productionHistoryFingerprint(entries),
    retainedEntries: baseline.entries,
    legacyHistoryUnchanged: true,
    canonicalAppendedEntries: appended.length,
    sourceEntries: migrations.length,
    currentMainEntries: MODULAR_PREFLIGHT.sourceCount,
    pending: pending.map(({ tag, hash, folderMillis }) => ({ tag, hash, folderMillis })),
    migrationAuthorized: false,
  };
}
