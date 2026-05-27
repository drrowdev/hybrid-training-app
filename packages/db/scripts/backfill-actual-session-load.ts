/**
 * backfill-actual-session-load.ts
 *
 * One-off backfill for Finding 1 (engine-actual-vs-prescribed audit).
 * For every `planned_sessions` row whose linked session is completed,
 * recompute `effective_stress_load` + `session_modality` from the
 * LOGGED set_logs + cardio_logs instead of the plan-time prescribed
 * stamp.
 *
 * Idempotent — re-running yields the same value because the inputs
 * (logged sets, logged cardio) don't change.
 *
 * Backward-compat: planned_sessions with zero logged sets AND zero
 * cardio_logs are SKIPPED (preserves the prescribed ESL for "session
 * marked complete but never logged" rows). This matches the runtime
 * behaviour in `recompute-actual-session-load.ts`.
 *
 * NOT auto-run. Invoke manually after the PR merges:
 *   pnpm --filter @hta/db tsx scripts/backfill-actual-session-load.ts
 *
 * Required env:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * The compute logic mirrors
 * `apps/web/src/lib/engine/actual-session-load.ts`. We duplicate it
 * inline rather than importing across packages because tsx in this
 * monorepo doesn't resolve the `@/` alias from packages/db (same
 * reason `backfill-hr-zones.ts` inlines its zone math). Tests in
 * apps/web pin the runtime path; tests in this package pin the
 * backfill path.
 */
import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---- Compute logic (mirror of actual-session-load.ts) -----------------

type SessionModality =
  | "pure_strength"
  | "pure_hypertrophy"
  | "pure_z2_aerobic"
  | "pure_hiit"
  | "mixed_modal"
  | "skill_focused"
  | "restorative";

const MODALITY_STRESS_MULTIPLIER: Record<SessionModality, number> = {
  pure_strength: 1.0,
  pure_hypertrophy: 1.0,
  pure_z2_aerobic: 0.4,
  pure_hiit: 1.3,
  mixed_modal: 1.25,
  skill_focused: 1.2,
  restorative: 0.2,
};

type ClassifiedCardioKind =
  | "cardio_z2"
  | "cardio_threshold"
  | "cardio_vo2"
  | "cardio_alactic"
  | "cardio_mixed";

function cardioEslFromKind(
  kind: ClassifiedCardioKind,
  durationMin: number,
): number {
  switch (kind) {
    case "cardio_z2":
      return 0.5 * durationMin;
    case "cardio_threshold":
      return 1.3 * durationMin;
    case "cardio_vo2":
      return 2.0 * durationMin;
    case "cardio_alactic":
      return 1.0 * durationMin;
    case "cardio_mixed":
      return 1.0 * durationMin;
  }
}

const KNOWN_CARDIO_KINDS = new Set<ClassifiedCardioKind>([
  "cardio_z2",
  "cardio_threshold",
  "cardio_vo2",
  "cardio_alactic",
  "cardio_mixed",
]);

function cardioMode(
  inferredKind: string | null,
  modality: string,
): "z2" | "hiit" | "mixed" {
  if (inferredKind === "cardio_z2") return "z2";
  if (
    inferredKind === "cardio_vo2" ||
    inferredKind === "cardio_alactic" ||
    inferredKind === "cardio_threshold"
  ) {
    return "hiit";
  }
  if (inferredKind === "cardio_mixed") return "mixed";
  const m = (modality || "").toLowerCase();
  if (m.includes("z2") || m.includes("easy") || m.includes("zone 2")) return "z2";
  if (
    m.includes("hiit") ||
    m.includes("vo2") ||
    m.includes("intervals") ||
    m.includes("sprint") ||
    m.includes("alactic")
  ) {
    return "hiit";
  }
  return "mixed";
}

function internalCardioModalityMultiplier(
  mode: "z2" | "hiit" | "mixed",
): number {
  if (mode === "z2") return MODALITY_STRESS_MULTIPLIER.pure_z2_aerobic;
  if (mode === "hiit") return MODALITY_STRESS_MULTIPLIER.pure_hiit;
  return MODALITY_STRESS_MULTIPLIER.mixed_modal;
}

export type SetLogRow = {
  movementId: string;
  setKind: string;
  isSkipped: boolean;
};

export type CardioLogRow = {
  modality: string;
  durationSec: number;
  inferredKind: string | null;
};

const STRENGTH_BUCKET: Record<string, "main" | "back_off" | "accessory" | null> = {
  warmup: null,
  main: "main",
  back_off: "back_off",
  accessory: "accessory",
  tendon: "accessory",
};

/**
 * Classifier — simplified copy of the rules in
 * `apps/web/src/lib/planner/session-modality.ts`. Same rule order,
 * same multipliers. Touch with care; the apps/web tests pin the
 * canonical version.
 */
function reclassify(
  setLogs: ReadonlyArray<SetLogRow>,
  cardioLogs: ReadonlyArray<CardioLogRow>,
): SessionModality {
  // Build the synthetic movement list — one entry per
  // (movement_id, set_kind) group, one entry per cardio block.
  const byMovKind = new Map<string, { bucket: "main" | "back_off" | "accessory"; n: number }>();
  for (const s of setLogs) {
    if (s.isSkipped || s.setKind === "warmup") continue;
    const bucket = STRENGTH_BUCKET[s.setKind];
    if (!bucket) continue;
    const key = `${s.movementId}::${s.setKind}`;
    const cur = byMovKind.get(key);
    if (cur) cur.n += 1;
    else byMovKind.set(key, { bucket, n: 1 });
  }

  let strSets = 0;
  let totalSets = 0;
  let hasAnyMainBucket = false;
  let allMainBucketsAreStrengthArchetype = true;
  let hasOnlyMainBuckets = true;
  for (const [, g] of byMovKind) {
    totalSets += g.n;
    if (g.bucket === "main" || g.bucket === "back_off") {
      strSets += g.n;
      hasAnyMainBucket = true;
    } else {
      hasOnlyMainBuckets = false;
    }
  }
  void allMainBucketsAreStrengthArchetype; // synthetic movements always strength_anchor

  let cardioMin = 0;
  let hasHiit = false;
  let onlyCardioMeaningful = totalSets === 0 && cardioLogs.length > 0;
  for (const c of cardioLogs) {
    const min = Math.max(0, Math.round(c.durationSec / 60));
    if (min <= 0) continue;
    cardioMin += min;
    const mode = cardioMode(c.inferredKind, c.modality);
    if (mode === "hiit") hasHiit = true;
  }

  // Rule 1: restorative.
  if (totalSets <= 4 && !hasAnyMainBucket && !hasHiit && cardioMin < 10) {
    return "restorative";
  }
  // Rule 2: pure_z2_aerobic — only cardio, every block is z2 (or mixed > 30 min).
  if (onlyCardioMeaningful && strSets === 0) {
    const allZ2 = cardioLogs.every((c) => {
      const min = Math.max(0, Math.round(c.durationSec / 60));
      if (min <= 0) return true;
      const mode = cardioMode(c.inferredKind, c.modality);
      if (mode === "z2") return true;
      if (mode === "mixed" && min > 30) return true;
      return false;
    });
    if (allZ2 && !hasHiit) return "pure_z2_aerobic";
  }
  // Rule 3: pure_hiit.
  if ((onlyCardioMeaningful && hasHiit) || (cardioMin > 0 && strSets === 0 && hasHiit)) {
    return "pure_hiit";
  }
  // Rule 5: mixed_modal.
  if (strSets >= 3 && cardioMin >= 10) {
    return "mixed_modal";
  }
  // Rule 6: pure_strength — only main/back_off buckets, no cardio.
  if (cardioMin === 0 && strSets > 0 && hasOnlyMainBuckets) {
    return "pure_strength";
  }
  // Rule 7: pure_hypertrophy.
  if (cardioMin < 10 && strSets > 0) {
    return "pure_hypertrophy";
  }
  // Rule 8 fallback.
  return cardioMin > 0 ? "mixed_modal" : "pure_hypertrophy";
}

export type ComputedLoad = {
  effectiveStressLoad: number;
  sessionModality: SessionModality;
  hardSets: number;
};

export function computeActualSessionLoad(
  setLogs: ReadonlyArray<SetLogRow>,
  cardioLogs: ReadonlyArray<CardioLogRow>,
): ComputedLoad {
  const sessionModality = reclassify(setLogs, cardioLogs);

  let hardSets = 0;
  for (const s of setLogs) {
    if (s.isSkipped || s.setKind === "warmup") continue;
    hardSets += 1;
  }
  const strengthEsl = hardSets * (MODALITY_STRESS_MULTIPLIER[sessionModality] ?? 1.0);

  let cardioEsl = 0;
  for (const c of cardioLogs) {
    const durationMin = Math.max(0, c.durationSec / 60);
    if (durationMin <= 0) continue;
    if (
      typeof c.inferredKind === "string" &&
      KNOWN_CARDIO_KINDS.has(c.inferredKind as ClassifiedCardioKind)
    ) {
      cardioEsl += cardioEslFromKind(
        c.inferredKind as ClassifiedCardioKind,
        Math.max(1, Math.round(durationMin)),
      );
    } else {
      cardioEsl += durationMin * internalCardioModalityMultiplier(cardioMode(null, c.modality));
    }
  }

  return {
    effectiveStressLoad: Math.round((strengthEsl + cardioEsl) * 100) / 100,
    sessionModality,
    hardSets,
  };
}

// ---- Backfill orchestration ------------------------------------------

export type PlannedToBackfill = {
  planned_session_id: string;
  completed_session_id: string;
  current_esl: number | null;
  current_modality: string | null;
};

async function fetchCandidates(
  supabase: SupabaseClient,
): Promise<PlannedToBackfill[]> {
  // Page through everything completed. Supabase caps at 1000 rows; we
  // walk in chunks of 500 keyed by id so the result set is stable.
  const out: PlannedToBackfill[] = [];
  const PAGE = 500;
  let cursor = "00000000-0000-0000-0000-000000000000";
  // Loop until we get fewer than PAGE rows back.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("planned_sessions")
      .select(
        "id, completed_session_id, effective_stress_load, session_modality",
      )
      .not("completed_session_id", "is", null)
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`planned_sessions fetch: ${error.message}`);
    const rows = (data ?? []) as Array<{
      id: string;
      completed_session_id: string;
      effective_stress_load: number | string | null;
      session_modality: string | null;
    }>;
    if (rows.length === 0) break;
    for (const r of rows) {
      out.push({
        planned_session_id: r.id,
        completed_session_id: r.completed_session_id,
        current_esl: r.effective_stress_load == null ? null : Number(r.effective_stress_load),
        current_modality: r.session_modality,
      });
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchLogsForSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<{ setLogs: SetLogRow[]; cardioLogs: CardioLogRow[] }> {
  const [{ data: sets, error: se }, { data: cardio, error: ce }] = await Promise.all([
    supabase
      .from("set_logs")
      .select("movement_id, set_kind, skipped")
      .eq("session_id", sessionId),
    supabase
      .from("cardio_logs")
      .select("modality, duration_sec, inferred_kind")
      .eq("session_id", sessionId),
  ]);
  if (se) throw new Error(`set_logs fetch: ${se.message}`);
  if (ce) throw new Error(`cardio_logs fetch: ${ce.message}`);
  return {
    setLogs: ((sets ?? []) as Array<{
      movement_id: string;
      set_kind: string;
      skipped: boolean | null;
    }>).map((r) => ({
      movementId: r.movement_id,
      setKind: r.set_kind,
      isSkipped: r.skipped === true,
    })),
    cardioLogs: ((cardio ?? []) as Array<{
      modality: string | null;
      duration_sec: number;
      inferred_kind: string | null;
    }>).map((r) => ({
      modality: r.modality ?? "",
      durationSec: r.duration_sec,
      inferredKind: r.inferred_kind,
    })),
  };
}

export type BackfillStats = {
  scanned: number;
  skippedEmpty: number;
  updated: number;
  unchanged: number;
  failed: number;
};

export async function runBackfill(
  supabase: SupabaseClient,
  opts: { logger?: (msg: string) => void } = {},
): Promise<BackfillStats> {
  const log = opts.logger ?? ((m: string) => console.log(m));
  const stats: BackfillStats = {
    scanned: 0,
    skippedEmpty: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
  };

  const candidates = await fetchCandidates(supabase);
  log(`[backfill-actual-session-load] candidates: ${candidates.length}`);

  for (const c of candidates) {
    stats.scanned += 1;
    try {
      const { setLogs, cardioLogs } = await fetchLogsForSession(
        supabase,
        c.completed_session_id,
      );
      // Preserve prescribed ESL when there's literally nothing logged.
      if (setLogs.length === 0 && cardioLogs.length === 0) {
        stats.skippedEmpty += 1;
        continue;
      }
      const out = computeActualSessionLoad(setLogs, cardioLogs);
      const same =
        c.current_esl != null &&
        Math.abs(c.current_esl - out.effectiveStressLoad) < 0.005 &&
        c.current_modality === out.sessionModality;
      if (same) {
        stats.unchanged += 1;
      } else {
        const { error } = await supabase
          .from("planned_sessions")
          .update({
            effective_stress_load: out.effectiveStressLoad,
            session_modality: out.sessionModality,
          })
          .eq("id", c.planned_session_id);
        if (error) {
          log(
            `[backfill-actual-session-load] update ${c.planned_session_id} failed: ${error.message}`,
          );
          stats.failed += 1;
          continue;
        }
        stats.updated += 1;
      }
    } catch (e) {
      log(`[backfill-actual-session-load] ${c.planned_session_id} threw: ${String(e)}`);
      stats.failed += 1;
    }
    if (stats.scanned % 100 === 0) {
      log(
        `[backfill-actual-session-load] progress: scanned=${stats.scanned} updated=${stats.updated} skipped=${stats.skippedEmpty} unchanged=${stats.unchanged} failed=${stats.failed}`,
      );
    }
  }

  log(
    `[backfill-actual-session-load] DONE scanned=${stats.scanned} updated=${stats.updated} skipped=${stats.skippedEmpty} unchanged=${stats.unchanged} failed=${stats.failed}`,
  );
  return stats;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  const supabase = createClient(url, key);
  await runBackfill(supabase);
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
