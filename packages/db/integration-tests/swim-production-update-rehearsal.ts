import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import {
  appendProductionSwimming, productionSwimmingMigrations, validateProductionSwimAppend, verifyProductionSwimBefore,
  PRODUCTION_UPDATE_LEDGER_QUERY, PRODUCTION_SWIM_TAGS, type ProductionUpdateProgress, type CompletionAclProgress,
} from "../scripts/swim-production-update-storage";
import { productionHistoryFingerprint } from "../scripts/swim-production-reconciliation";
import { POST_UPDATE_CATALOG_SQL, productionCompletionCatalog } from "../scripts/swim-production-post-update";
import { verifyActivationStorage } from "../scripts/activate-swim-production";

const progress = (): ProductionUpdateProgress => ({
  attemptedMigrations: 0, stagedMigrations: 0, commitAttempted: false, commitConfirmed: false,
});
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function rehearseProductionSwimmingUpdate(database: postgres.Sql, stage: (name: string) => void) {
  stage("production-updater-rehearsal-guard");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_JOB, "pool-storage");
  const url = new URL(process.env.SWIM_POOL_TEST_DATABASE_URL ?? "");
  assert.equal(url.origin, "null");
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/swim_pool_test");
  assert.equal(url.username, "postgres");
  assert.equal(url.password + url.search + url.hash, "");
  assert.equal(url.port, "5432");
  assert.deepEqual(database.options.host, ["127.0.0.1"]);
  assert.equal(database.options.database, "swim_pool_test");
  stage("production-updater-rehearsal-fixtures");
  const migrations = productionSwimmingMigrations();
  const original = Array.from(await database.unsafe(PRODUCTION_UPDATE_LEDGER_QUERY));
  assert.equal(original.length, 146);
  const originalFingerprint = productionHistoryFingerprint(original);
  const originalLastId = Number(original[original.length - 1]!.id);
  await database.begin(verifyProductionSwimBefore);
  const user = randomUUID();
  await database`INSERT INTO auth.users(id) VALUES (${user})`;
  await database`INSERT INTO public.profiles(id,display_name,timezone) VALUES (${user},'Synthetic updater fixture','UTC')
    ON CONFLICT(id) DO UPDATE SET display_name='Synthetic updater fixture',timezone='UTC'`;
  const userSnapshot = await database`SELECT to_jsonb(p) AS profile FROM public.profiles p WHERE id=${user}`;

  stage("production-updater-synthetic-legacy-baseline");
  for (let index = 0; index < 4; index += 1) {
    await database`INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
      VALUES (${migrations[index]!.hash},${migrations[index]!.folderMillis - 1})`;
  }
  const variants = Array.from({ length: 43 }, (_, index) =>
    digest(migrations[index]!.sql.join("--> statement-breakpoint").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n")));
  for (let index = 0; index < 50; index += 1) {
    await database`INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
      VALUES (${variants[index % 43]!},${migrations[index % 43]!.folderMillis})`;
  }
  for (const hash of [digest("synthetic-unmatched-one"), digest("synthetic-unmatched-two"), "synthetic-noncanonical"]) {
    await database`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES (${hash},${migrations[145]!.folderMillis})`;
  }
  const legacy = Array.from(await database.unsafe(PRODUCTION_UPDATE_LEDGER_QUERY));
  assert.equal(legacy.length, 203);
  const baseline = { entries: 203 as const, fingerprint: productionHistoryFingerprint(legacy) };
  const lastLegacyId = Number(legacy[legacy.length - 1]!.id);
  const unchanged = async () => {
    assert.equal(productionHistoryFingerprint(Array.from(await database.unsafe(PRODUCTION_UPDATE_LEDGER_QUERY))), baseline.fingerprint);
    await database.begin(verifyProductionSwimBefore);
    assert.deepEqual(await database`SELECT to_jsonb(p) AS profile FROM public.profiles p WHERE id=${user}`, userSnapshot);
  };
  const unusedDown = async () => {
    for (const tag of [...PRODUCTION_SWIM_TAGS].reverse()) {
      const connection = await database.reserve();
      try { await connection.unsafe(readFileSync(new URL(`../rollbacks/${tag}.down.sql`, import.meta.url), "utf8")); }
      catch (error) { await connection.unsafe("ROLLBACK"); throw error; }
      finally { connection.release(); }
    }
  };

  stage("production-updater-changed-baseline-refusal");
  const refused = progress();
  await assert.rejects(appendProductionSwimming(database, migrations, async () => {}, refused,
    { entries: 203, fingerprint: "f".repeat(64) }), /baseline_fingerprint/);
  assert.equal(refused.attemptedMigrations, 0);
  await unchanged();

  stage("production-updater-mid-batch-rollback");
  const partial = progress();
  let calls = 0;
  await assert.rejects(appendProductionSwimming(database, migrations, async (phase) => {
    if (phase === "migration" && ++calls === 3) throw new Error("synthetic_mid_batch");
  }, partial, baseline), /synthetic_mid_batch/);
  assert.equal(partial.stagedMigrations, 2);
  assert.equal(partial.commitConfirmed, false);
  await unchanged();

  stage("production-updater-sql-failure-rollback");
  let acquired!: () => void, release!: () => void;
  const locked = new Promise<void>((resolve) => { acquired = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const lock = database.begin(async (tx) => {
    await tx.unsafe("LOCK TABLE public.sessions IN ACCESS EXCLUSIVE MODE");
    acquired(); await released;
  });
  const sqlFailure = progress();
  try {
    await Promise.race([locked, lock.then(() => { throw new Error("synthetic_lock_not_acquired"); })]);
    await assert.rejects(appendProductionSwimming(database, migrations, async () => {}, sqlFailure, baseline),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "55P03");
  } finally { release(); await lock; }
  assert.equal(sqlFailure.commitConfirmed, false);
  await unchanged();

  stage("production-updater-precommit-rollback");
  const beforeCommit = progress();
  await assert.rejects(appendProductionSwimming(database, migrations, async (phase) => {
    if (phase === "before_commit") throw new Error("synthetic_before_commit");
  }, beforeCommit, baseline), /synthetic_before_commit/);
  assert.equal(beforeCommit.stagedMigrations, 9);
  assert.equal(beforeCommit.commitAttempted, false);
  await unchanged();

  stage("production-updater-postcommit-failure-and-replay-refusal");
  const afterCommit = progress();
  await assert.rejects(appendProductionSwimming(database, migrations, async (phase) => {
    if (phase === "after_commit") throw new Error("synthetic_after_commit");
  }, afterCommit, baseline), /synthetic_after_commit/);
  assert.equal(afterCommit.commitConfirmed, true);
  validateProductionSwimAppend(Array.from(await database.unsafe(PRODUCTION_UPDATE_LEDGER_QUERY)), migrations, baseline);
  const replay = progress();
  await assert.rejects(appendProductionSwimming(database, migrations, async () => {}, replay, baseline), /baseline_fingerprint/);
  assert.equal(replay.attemptedMigrations, 0);
  await unusedDown();
  // Only this guarded, disposable fixture restores its artificial ledger. Never reset its sequence.
  await database`DELETE FROM drizzle.__drizzle_migrations WHERE id>${lastLegacyId}`;
  await unchanged();

  stage("production-updater-commit-and-retention");
  const committed = progress();
  assert.deepEqual(await appendProductionSwimming(database, migrations, async () => {}, committed, baseline),
    { entries: 212, retainedEntries: 203, appendedEntries: 9 });
  assert.equal(committed.commitConfirmed, true);
  assert.equal(committed.stagedMigrations, 9);
  assert.deepEqual(await database`SELECT to_jsonb(p) AS profile FROM public.profiles p WHERE id=${user}`, userSnapshot);
  await unusedDown();
  await database`DELETE FROM drizzle.__drizzle_migrations WHERE id>${lastLegacyId}`;
  await unchanged();

  stage("production-updater-equivalent-acl-refusal");
  await database.unsafe("REVOKE EXECUTE ON FUNCTION public.complete_training_session_with_transition(uuid,text,uuid) FROM anon, PUBLIC");
  const deniedAcl = productionCompletionCatalog(Array.from(await database.unsafe(POST_UPDATE_CATALOG_SQL)));
  assert.equal(deniedAcl.shared_privileges![3], false);
  const refusedAcl: CompletionAclProgress = { attempted: false, staged: false, verified: false };
  await assert.rejects(appendProductionSwimming(database, migrations, async () => {}, progress(), baseline, refusedAcl),
    /completion_acl_state/);
  assert.equal(refusedAcl.attempted, false);
  await unchanged();
  assert.deepEqual(productionCompletionCatalog(Array.from(await database.unsafe(POST_UPDATE_CATALOG_SQL))), deniedAcl);
  await database.unsafe("GRANT EXECUTE ON FUNCTION public.complete_training_session_with_transition(uuid,text,uuid) TO PUBLIC");
  const inherited = productionCompletionCatalog(Array.from(await database.unsafe(POST_UPDATE_CATALOG_SQL)));
  assert.equal(inherited.shared_acl_counts[3], 0);
  assert.equal(inherited.shared_privileges![3], true);

  stage("production-updater-equivalent-acl-rollback");
  const rolledBackAcl: CompletionAclProgress = { attempted: false, staged: false, verified: false };
  const rolledBackProgress = progress();
  await assert.rejects(appendProductionSwimming(database, migrations, async (phase) => {
    if (phase === "before_commit") throw new Error("synthetic_acl_before_commit");
  }, rolledBackProgress, baseline, rolledBackAcl), /synthetic_acl_before_commit/);
  assert.deepEqual(rolledBackAcl, { attempted: true, staged: true, verified: true });
  assert.equal(rolledBackProgress.commitAttempted, false);
  await unchanged();
  const restoredAcl = productionCompletionCatalog(Array.from(await database.unsafe(POST_UPDATE_CATALOG_SQL)));
  assert.deepEqual(restoredAcl, inherited);

  stage("production-updater-equivalent-acl-commit");
  const committedAcl: CompletionAclProgress = { attempted: false, staged: false, verified: false };
  const fixedProgress = progress();
  assert.deepEqual(await appendProductionSwimming(database, migrations, async () => {}, fixedProgress, baseline, committedAcl),
    { entries: 212, retainedEntries: 203, appendedEntries: 9 });
  assert.deepEqual(committedAcl, { attempted: true, staged: true, verified: true });
  assert.equal(fixedProgress.commitConfirmed, true);
  const finalAcl = productionCompletionCatalog(Array.from(await database.unsafe(POST_UPDATE_CATALOG_SQL)));
  assert.deepEqual(finalAcl.shared_acl_counts, [1, 1, 1, 0, 0, 1, 0]);
  assert.deepEqual(finalAcl.shared_privileges, [true, true, true, false]);
  assert.equal(finalAcl.shared_acl_options, true);
  assert.deepEqual(await database`SELECT to_jsonb(p) AS profile FROM public.profiles p WHERE id=${user}`, userSnapshot);
  stage("production-activation-readonly-storage");
  await database.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", (tx) => verifyActivationStorage(tx, baseline));
  await assert.rejects(database.begin((tx) => verifyActivationStorage(tx, baseline)), /activation_readonly/);
  assert.deepEqual(await database`SELECT to_jsonb(p) AS profile FROM public.profiles p WHERE id=${user}`, userSnapshot);
  await unusedDown();
  await database`DELETE FROM drizzle.__drizzle_migrations WHERE id>${originalLastId}`;
  assert.equal(productionHistoryFingerprint(Array.from(await database.unsafe(PRODUCTION_UPDATE_LEDGER_QUERY))), originalFingerprint);
  await database.begin(verifyProductionSwimBefore);
  await database`DELETE FROM public.profiles WHERE id=${user}`;
  await database`DELETE FROM auth.users WHERE id=${user}`;
  assert.equal((await database`SELECT count(*)::integer AS count FROM auth.users WHERE id=${user}`)[0]!.count, 0);
}
