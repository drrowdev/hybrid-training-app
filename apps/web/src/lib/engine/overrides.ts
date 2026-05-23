/**
 * engine/overrides — single home (DC-K3) for the engine override audit
 * log (DC-K4 "override-and-warn, never silent overrule").
 *
 * Every recording path (skipPlannedSession, swapPrescriptionItem,
 * endBlock, future `recordCustomOverride`) funnels through
 * `recordOverrideEvent` here. Reads for the engine page (Section F ·
 * Recent overrides) and for the adherence dashboard's weekday
 * breakdown also live here.
 *
 * Per AGENTS.md schema discipline (plan §6.8) the per-event "context"
 * blob is JSONB — archetype / week_index / weekday / weeks_completed
 * are not observable from the engine and nothing structural removes
 * any one of them.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EngineOverrideContext,
  EngineOverrideEventType,
} from "@hta/db";

export type OverrideEventRow = {
  id: string;
  occurredAt: string;
  eventType: EngineOverrideEventType;
  plannedSessionId: string | null;
  blockId: string | null;
  originalMovementSlug: string | null;
  newMovementSlug: string | null;
  reason: string | null;
  context: EngineOverrideContext | null;
};

export type RecordOverrideInput = {
  userId: string;
  eventType: EngineOverrideEventType;
  occurredAt?: string;
  plannedSessionId?: string | null;
  blockId?: string | null;
  originalMovementSlug?: string | null;
  newMovementSlug?: string | null;
  reason?: string | null;
  context?: EngineOverrideContext | null;
};

/** Matches the DB CHECK constraint `engine_override_events_reason_length`. */
export const OVERRIDE_REASON_MAX = 280;

/**
 * Normalises a user-entered reason. Trims, collapses empty strings to
 * NULL, and truncates to {@link OVERRIDE_REASON_MAX}. Action layers
 * call this rather than enforcing the rules themselves so the contract
 * stays single-sourced.
 */
export function normaliseReason(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, OVERRIDE_REASON_MAX);
}

/**
 * Insert one override event. Returns the row id on success, or null on
 * error / RLS rejection — callers treat the audit write as best-effort
 * so a transient audit failure never blocks the user's primary action
 * (skip / swap / end). The downstream action still wrote its canonical
 * field (skipped_at / archived_at / meta.swappedFrom); the audit row
 * is the supplemental analytics surface.
 */
export async function recordOverrideEvent(
  supabase: SupabaseClient,
  input: RecordOverrideInput,
): Promise<string | null> {
  const row = {
    user_id: input.userId,
    event_type: input.eventType,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    planned_session_id: input.plannedSessionId ?? null,
    block_id: input.blockId ?? null,
    original_movement_slug: input.originalMovementSlug ?? null,
    new_movement_slug: input.newMovementSlug ?? null,
    reason: normaliseReason(input.reason ?? null),
    context: input.context ?? null,
  };
  const { data, error } = await supabase
    .from("engine_override_events")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error || !data) return null;
  return data.id as string;
}

/**
 * Most-recent override events for a user, newest-first.
 */
export async function getRecentOverrides(
  supabase: SupabaseClient,
  userId: string,
  limit = 10,
): Promise<OverrideEventRow[]> {
  const { data } = await supabase
    .from("engine_override_events")
    .select(
      "id, occurred_at, event_type, planned_session_id, block_id, original_movement_slug, new_movement_slug, reason, context",
    )
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(toRow);
}

export type WeekdayOverrideSummary = {
  /** ISO weekday 1=Mon..7=Sun. */
  weekday: number;
  weekdayLabel: string;
  skipCount: number;
  swapCount: number;
  totalCount: number;
};

const WEEKDAY_LABEL: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

/**
 * Count overrides per ISO weekday over a time range. Powers the
 * adherence Phase 4 dashboard's weekday breakdown ("you skip 60% of
 * Sundays").
 *
 * The weekday is read from `context.weekday` when present (every event
 * recorded after this migration carries it). Backfilled rows fall
 * back to deriving the weekday from `occurred_at` so historical data
 * still bucketed sensibly.
 */
export async function summariseOverridesByWeekday(
  supabase: SupabaseClient,
  userId: string,
  range: { fromIso: string; toIso: string },
  eventTypes: EngineOverrideEventType[] = ["skip", "swap"],
): Promise<WeekdayOverrideSummary[]> {
  const { data } = await supabase
    .from("engine_override_events")
    .select("event_type, occurred_at, context")
    .eq("user_id", userId)
    .in("event_type", eventTypes)
    .gte("occurred_at", range.fromIso)
    .lte("occurred_at", range.toIso);

  const summary = new Map<number, WeekdayOverrideSummary>();
  for (let i = 1; i <= 7; i++) {
    summary.set(i, {
      weekday: i,
      weekdayLabel: WEEKDAY_LABEL[i] ?? "?",
      skipCount: 0,
      swapCount: 0,
      totalCount: 0,
    });
  }

  for (const r of data ?? []) {
    const ctx = (r.context as EngineOverrideContext | null) ?? null;
    const weekday = pickWeekday(ctx, r.occurred_at as string);
    const bucket = summary.get(weekday);
    if (!bucket) continue;
    if (r.event_type === "skip") bucket.skipCount += 1;
    else if (r.event_type === "swap") bucket.swapCount += 1;
    bucket.totalCount += 1;
  }

  return Array.from(summary.values());
}

function pickWeekday(
  ctx: EngineOverrideContext | null,
  occurredAt: string,
): number {
  const fromCtx = ctx?.weekday;
  if (typeof fromCtx === "number" && fromCtx >= 1 && fromCtx <= 7) return fromCtx;
  const d = new Date(occurredAt);
  if (Number.isNaN(d.getTime())) return 1;
  // getUTCDay: Sun=0..Sat=6 → ISO Mon=1..Sun=7
  const iso = ((d.getUTCDay() + 6) % 7) + 1;
  return iso;
}

function toRow(raw: Record<string, unknown>): OverrideEventRow {
  return {
    id: raw.id as string,
    occurredAt: raw.occurred_at as string,
    eventType: raw.event_type as EngineOverrideEventType,
    plannedSessionId: (raw.planned_session_id as string | null) ?? null,
    blockId: (raw.block_id as string | null) ?? null,
    originalMovementSlug: (raw.original_movement_slug as string | null) ?? null,
    newMovementSlug: (raw.new_movement_slug as string | null) ?? null,
    reason: (raw.reason as string | null) ?? null,
    context: (raw.context as EngineOverrideContext | null) ?? null,
  };
}

/**
 * Compute the ISO weekday (Mon=1..Sun=7) from a YMD string. Helper
 * shared by recording paths that have a planned-session date in hand
 * but no JS Date object.
 */
export function isoWeekdayFromYmd(ymd: string): number {
  // YMD is 'YYYY-MM-DD'. Treat as UTC noon so DST never tips it.
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return 1;
  return ((d.getUTCDay() + 6) % 7) + 1;
}
