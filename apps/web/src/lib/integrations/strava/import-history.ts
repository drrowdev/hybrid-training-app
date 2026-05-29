/**
 * Historical Strava import — user-triggered backfill of activities
 * inside an explicit date range. Distinct from `syncStrava` (the
 * "since last_synced_at" bulk path) and `syncStravaSingle` (the
 * webhook one-shot):
 *
 *   - Caller chooses the window (start/end) instead of starting from
 *     `last_synced_at`. Useful during onboarding and for re-importing
 *     a month after a watch firmware glitch.
 *   - Returns a structured summary the UI renders as a transparency
 *     breakdown (imported / skipped buckets / matched to plans).
 *   - On rate-limit (Strava 429) we back off + retry, then surface
 *     what we did manage to import so the user can re-run for the
 *     remainder tomorrow.
 *   - Optionally walks `planned_sessions` within ±90 min of each
 *     newly-imported activity and links them, subject to the PR #208
 *     hybrid completion guard (don't auto-complete a planned hybrid
 *     session that still has unlogged prescribed strength).
 *
 * Hard cap at 365 days because Strava enforces app-wide rate limits
 * (100 reqs / 15 min, 1000 reqs / day). A naive "import everything"
 * call easily exhausts that for active athletes; we keep v1 narrow
 * and let the user re-run for older ranges. Documented in the
 * user-visible error message.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  listActivitiesInRange,
  refreshAccessToken,
  StravaRateLimitError,
  type FetchPageOptions,
  type StravaActivity,
} from "./client";
import { mapStravaActivity, categorizeSkip, type SkipCategory } from "./mapping";
import { writeStravaActivity } from "./write-activity";
import { recomputeRegionState } from "@/lib/engine/region-ledger";
import { getUserTimezone, dayDate } from "@/lib/planner/queries";
import { readZoneConfig } from "@/lib/stats/hr-zones";

const TOKEN_REFRESH_SAFETY_S = 60;
const MAX_RANGE_DAYS = 365;
export const IMPORT_HISTORY_MAX_RANGE_DAYS = MAX_RANGE_DAYS;

const isoDateLike = z
  .string()
  .min(1)
  .refine((s) => Number.isFinite(Date.parse(s)), { message: "Invalid date" });

export const ImportInputSchema = z
  .object({
    startDate: isoDateLike,
    endDate: isoDateLike.optional(),
    autoLinkToPlanned: z.boolean().optional(),
  })
  .strict();

export type ImportInput = z.infer<typeof ImportInputSchema>;

export type ImportSummary = {
  imported: number;
  skipped: {
    strength: number;
    sport: number;
    other: number;
    duplicates: number;
    unknown: number;
  };
  matchedToPlanned: number;
  errors: Array<{ activityId: number; message: string }>;
};

export type ImportResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string };

/**
 * Strength prescription kinds — must stay in sync with the PR #208
 * hybrid guard in `lib/sessions/actions.ts` (STRENGTH_KINDS).
 * Duplicated locally so this module doesn't pull in the server-action
 * module (which would create a circular import via classify-cardio).
 */
const STRENGTH_PRESCRIPTION_KINDS: ReadonlySet<string> = new Set([
  "warmup",
  "main",
  "back_off",
  "accessory",
  "tendon",
  "power_potentiation",
]);

type ConnectionRow = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  last_synced_at: string | null;
};

type ImportedActivity = {
  sessionId: string;
  modality: string;
  performedAt: string;
  stravaActivityId: number;
};

/**
 * Internals exposed for unit tests. Production callers should use the
 * server-action wrapper in `actions.ts`.
 */
export type ImportDeps = {
  /** Override fetch options (retries / sleep) for tests. */
  fetchOptions?: FetchPageOptions;
  /** Inject a clock for deterministic windows in tests. */
  now?: () => Date;
  /** Override the page size — kept for symmetry; default 30. */
  perPage?: number;
};

export async function importStravaHistory(
  supabase: SupabaseClient,
  userId: string,
  input: ImportInput,
  deps: ImportDeps = {},
): Promise<ImportResult> {
  const parsed = ImportInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const now = deps.now ? deps.now() : new Date();

  const startMs = Date.parse(parsed.data.startDate);
  const endMs = parsed.data.endDate ? Date.parse(parsed.data.endDate) : now.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { ok: false, error: "Invalid date" };
  }
  if (startMs >= endMs) {
    return { ok: false, error: "startDate must be before endDate" };
  }
  const rangeMs = now.getTime() - startMs;
  if (rangeMs > MAX_RANGE_DAYS * 86_400_000) {
    return {
      ok: false,
      error:
        "Import range is capped at 365 days. For older imports, use a narrower date range or re-run tomorrow.",
    };
  }

  // Resolve the Strava connection + refresh token if needed.
  const { data: conn, error: ce } = await supabase
    .from("strava_connections")
    .select("user_id, access_token, refresh_token, expires_at, last_synced_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (ce) return { ok: false, error: ce.message };
  if (!conn) return { ok: false, error: "Not connected to Strava." };
  const connection = conn as ConnectionRow;

  let accessToken = connection.access_token;
  const expiresAtMs = new Date(connection.expires_at).getTime();
  if (expiresAtMs - Date.now() < TOKEN_REFRESH_SAFETY_S * 1000) {
    try {
      const refreshed = await refreshAccessToken(connection.refresh_token);
      accessToken = refreshed.accessToken;
      await supabase
        .from("strava_connections")
        .update({
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken,
          expires_at: refreshed.expiresAt.toISOString(),
        })
        .eq("user_id", userId);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  // Page through the requested range. Catch rate-limit specifically so
  // we can surface a graceful partial result.
  const summary: ImportSummary = {
    imported: 0,
    skipped: { strength: 0, sport: 0, other: 0, duplicates: 0, unknown: 0 },
    matchedToPlanned: 0,
    errors: [],
  };
  const afterEpoch = Math.floor(startMs / 1000);
  const beforeEpoch = Math.floor(endMs / 1000);

  let activities: StravaActivity[] = [];
  try {
    activities = await listActivitiesInRange(
      accessToken,
      { afterEpoch, beforeEpoch, perPage: deps.perPage ?? 30 },
      deps.fetchOptions,
    );
  } catch (e) {
    if (e instanceof StravaRateLimitError) {
      summary.errors.push({
        activityId: 0,
        message:
          "Strava rate limit reached before we could finish. Try a narrower date range or re-run tomorrow.",
      });
      return { ok: true, summary };
    }
    return { ok: false, error: (e as Error).message };
  }

  // Load the HR-zone config + timezone once.
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("intake")
    .eq("id", userId)
    .maybeSingle();
  const bands = readZoneConfig(
    (profileRow?.intake as Record<string, unknown> | null) ?? null,
  );
  const userTimezone = await getUserTimezone(userId);

  const newlyImported: ImportedActivity[] = [];
  let latestImportedAt: string | null = null;

  for (const activity of activities) {
    const mapping = mapStravaActivity(activity.sport_type, activity.type);
    if (!mapping) {
      const category: SkipCategory = categorizeSkip(activity.sport_type, activity.type);
      summary.skipped[category]++;
      continue;
    }

    try {
      const result = await writeStravaActivity({
        supabase,
        userId,
        activity,
        bands,
        userTimezone,
      });
      if (result.status === "imported") {
        summary.imported++;
        newlyImported.push({
          sessionId: result.sessionId,
          modality: result.modality,
          performedAt: result.performedAt,
          stravaActivityId: activity.id,
        });
        if (!latestImportedAt || result.performedAt > latestImportedAt) {
          latestImportedAt = result.performedAt;
        }
      } else if (result.status === "duplicate") {
        summary.skipped.duplicates++;
      } else {
        // Unmappable / no_row — should already have been caught by the
        // mapping check above, but fold defensively into "unknown".
        summary.skipped.unknown++;
      }
    } catch (e) {
      summary.errors.push({
        activityId: activity.id,
        message: (e as Error).message.slice(0, 200),
      });
    }
  }

  // Auto-link to planned sessions in the same window, respecting the
  // hybrid completion guard.
  const autoLink = parsed.data.autoLinkToPlanned ?? true;
  if (autoLink && newlyImported.length > 0) {
    summary.matchedToPlanned = await autoLinkImported(
      supabase,
      userId,
      newlyImported,
      userTimezone,
    );
  }

  // Update last_synced_at only if the import covered a later range than
  // the existing value — so webhooks keep their existing watermark
  // when we backfill OLD history.
  if (latestImportedAt) {
    const existing = connection.last_synced_at
      ? Date.parse(connection.last_synced_at)
      : 0;
    if (Date.parse(latestImportedAt) > existing) {
      await supabase
        .from("strava_connections")
        .update({ last_synced_at: latestImportedAt, last_sync_error: null })
        .eq("user_id", userId);
    }
  }

  // Refresh region ledger when anything actually landed.
  if (summary.imported > 0) {
    try {
      await recomputeRegionState(supabase, userId, userTimezone);
    } catch (e) {
      console.error("recomputeRegionState after history import failed:", e);
    }
  }

  return { ok: true, summary };
}

type PlannedRow = {
  id: string;
  week_index: number;
  day_index: number;
  prescription: { items?: Array<{ kind?: string }> } | null;
  completed_session_id: string | null;
  training_blocks: { started_on: string } | { started_on: string }[] | null;
};

/**
 * YYYY-MM-DD for an ISO timestamp in the user's IANA tz. Used to align
 * an imported activity's calendar day with `dayDate(block.started_on,
 * week, day)` from the planner — matches the same logic
 * `classifyAndLinkExternalCardio` uses.
 */
function ymdInTz(isoTs: string, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date(isoTs));
  } catch {
    return isoTs.slice(0, 10);
  }
}

/**
 * For each newly-imported activity, look up planned_sessions for the
 * user whose computed calendar date (block.started_on + week + day)
 * matches the activity's local date, then link / honor the hybrid
 * guard.
 *
 * Why calendar-day match instead of clock-time ±90 min: planned_sessions
 * don't carry a clock time — they're (week_index, day_index) inside a
 * training block. The ±90 min from `match.ts` applies to existing
 * `cardio_logs` rows (which DO have `performed_at`). The autofill
 * banner reuses that for "Strava activity already imported → match
 * to the session I'm logging now" — the import path here matches the
 * reverse direction (Strava activity → planned slot), which is
 * inherently date-only granularity.
 *
 * Returns the count of planned sessions actually linked.
 */
async function autoLinkImported(
  supabase: SupabaseClient,
  userId: string,
  imported: ImportedActivity[],
  userTimezone: string,
): Promise<number> {
  if (imported.length === 0) return 0;

  const { data: candidates, error: cErr } = await supabase
    .from("planned_sessions")
    .select(
      "id, week_index, day_index, prescription, completed_session_id, training_blocks!inner(started_on, user_id, deleted_at, status)",
    )
    .eq("user_id", userId)
    .eq("training_blocks.user_id", userId)
    .is("training_blocks.deleted_at", null)
    .is("completed_session_id", null)
    .is("skipped_at", null);
  if (cErr) return 0;

  const rows = (candidates ?? []) as unknown as PlannedRow[];
  if (rows.length === 0) return 0;

  // Group planned rows by their derived calendar date for O(1) lookup.
  const byDate = new Map<string, PlannedRow[]>();
  for (const row of rows) {
    const block = Array.isArray(row.training_blocks)
      ? row.training_blocks[0]
      : row.training_blocks;
    if (!block) continue;
    const ymd = dayDate(block.started_on, row.week_index, row.day_index);
    const bucket = byDate.get(ymd) ?? [];
    bucket.push(row);
    byDate.set(ymd, bucket);
  }

  let linked = 0;
  const usedPlanned = new Set<string>();

  for (const activity of imported) {
    const ymd = ymdInTz(activity.performedAt, userTimezone);
    const bucket = byDate.get(ymd);
    if (!bucket || bucket.length === 0) continue;

    // Prefer a planned row that isn't yet claimed by another activity
    // in this same import batch.
    const target = bucket.find((r) => !usedPlanned.has(r.id));
    if (!target) continue;

    const hasStrength = (target.prescription?.items ?? []).some((it) =>
      typeof it?.kind === "string" && STRENGTH_PRESCRIPTION_KINDS.has(it.kind),
    );
    if (hasStrength) {
      // Hybrid completion guard — see PR #208. Don't auto-complete
      // the planned hybrid session; the user must log strength
      // separately. The cardio_log persists either way.
      usedPlanned.add(target.id);
      continue;
    }

    const { error: updErr } = await supabase
      .from("planned_sessions")
      .update({ completed_session_id: activity.sessionId })
      .eq("id", target.id);
    if (!updErr) {
      linked++;
      usedPlanned.add(target.id);
    }
  }
  return linked;
}
