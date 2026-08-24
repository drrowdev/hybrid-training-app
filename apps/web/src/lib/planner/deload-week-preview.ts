/**
 * User-initiated deload week — read-only preview (ADR 0049).
 *
 * Resolves the user's active block + current week, mirrors the NEXT programmed
 * week's structure into a 5/3/1-style light recovery week (via the pure
 * `buildDeloadWeek`), and reports where it would be inserted and whether an
 * A-priority event would be pushed by the extra week (warn-only, v1).
 *
 * Read-only: no writes. The insert action recomputes this server-side before
 * mutating (never trusts a client-sent week).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { buildDeloadWeek, type DeloadSessionSpec } from "./deload-week";
import {
  clampRecoveryPercent,
  isOutsideRecommended,
  recoveryPercentScale,
  recoveryWeekPolicyFor,
} from "./recovery-week-policy";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getProgramEngine } from "@/lib/platform/registry";
import { resolveBoundaryAnchor } from "./recovery-anchor";
import { getUserTimezone } from "@/lib/planner/queries";
import { computeActiveBlockFatigue } from "@/lib/planner/block-fatigue";
import { EARLY_DELOAD_THRESHOLD } from "@/lib/planner/fatigue-proxy";

export type DeloadWeekPreview = {
  blockId: string;
  /** The deload is inserted immediately after this (0-based) week index. */
  afterWeek: number;
  /** The week index the inserted deload will occupy. */
  deloadWeekIndex: number;
  /** The recovery-week sessions (already at deload loading). */
  sessions: DeloadSessionSpec[];
  /** True when a future A-priority event falls in the block and would shift by a week. */
  eventWarning: boolean;
  /** The working percentage these sessions were built at. */
  percent: number;
  /** What this program advises, shown next to the control. */
  recommendedPercent?: { min: number; max: number };
  /** True when `percent` sits outside that advice. */
  outsideRecommended: boolean;
  /** This program's recovery week is rest, so there is no percentage to set. */
  restOnly: boolean;
  /** Set when the placement came from a program boundary rather than from today. */
  boundaryKey?: string;
};

export type DeloadPreviewOptions = {
  percent?: number;
  /**
   * Place the week where the program advised, identified by the boundary key the
   * engine raised. Resolved server-side; an unresolvable key yields no preview
   * rather than a week placed at today.
   */
  boundaryKey?: string;
  /**
   * The recommendation that raised the advice. Session refs are
   * instance-independent, so a new deploy of the same template contains
   * byte-identical refs — without this, advice from a finished block would
   * happily resolve against the block that replaced it and schedule the light
   * week six weeks out. The advice only applies to the block that raised it.
   */
  recommendationId?: string;
  /**
   * Put the recovery week before week 1 instead of after the current week. TB3
   * advises deloading between blocks, so a peak week at the end of one plan is
   * followed by a recovery week at the start of the next.
   */
  prepend?: boolean;
};

/** Current 0-based week index of an active block (rolling, clamped to the block). */
function currentWeekIndex(startedOn: string, weeks: number): number {
  const startMs = new Date(startedOn + "T00:00:00").getTime();
  const days = Math.floor((Date.now() - startMs) / 86_400_000);
  return Math.max(0, Math.min(weeks - 1, Math.floor(days / 7)));
}

/** The week a declared boundary sits in, read from the plan as it stands now. */
async function boundaryWeek(
  supabase: SupabaseClient,
  userId: string,
  blockId: string,
  programId: string | null,
  instance: unknown,
  boundaryKey: string,
): Promise<number | null> {
  if (!programId || instance == null) return null;
  const engine = getProgramEngine(programId);
  const boundary = engine
    ?.recoveryBoundaries?.(instance)
    .find((candidate) => candidate.key === boundaryKey);
  if (!boundary) return null;

  const { data: rows } = await supabase
    .from("planned_sessions")
    .select("week_index, prescription")
    .eq("user_id", userId)
    .eq("block_id", blockId);
  const anchor = resolveBoundaryAnchor(
    boundary.refs,
    (rows ?? []).flatMap((r) => {
      const ref = (r.prescription as Prescription | null)?.programRef;
      return ref ? [{ weekIndex: r.week_index as number, programRef: ref }] : [];
    }),
  );
  return anchor?.afterWeek ?? null;
}

export async function getDeloadWeekPreview(
  supabase: SupabaseClient,
  userId: string,
  options: DeloadPreviewOptions = {},
): Promise<DeloadWeekPreview | null> {
  const { percent: chosenPercent, boundaryKey, recommendationId, prepend } = options;
  const { data: block } = await supabase
    .from("training_blocks")
    .select("id, started_on, weeks, program_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!block) return null;

  // Program advice belongs to the block that raised it. A block the lifter has
  // moved on from cannot place a week in the one that replaced it.
  if (boundaryKey && recommendationId) {
    const { data: rec } = await supabase
      .from("program_recommendations")
      .select("block_id, occurrence_key")
      .eq("id", recommendationId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .maybeSingle();
    if (!rec || rec.block_id !== block.id || rec.occurrence_key !== boundaryKey) {
      return null;
    }
  } else if (boundaryKey) {
    return null;
  }

  // The recovery week's CONTENT belongs to the program, not to this file.
  const { data: pi } = await supabase
    .from("program_instances")
    .select("instance")
    .eq("block_id", block.id)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  const basePolicy = recoveryWeekPolicyFor(block.program_id as string | null);
  const percent = basePolicy.restOnly
    ? basePolicy.topPercent
    : clampRecoveryPercent(chosenPercent ?? basePolicy.topPercent);
  const policy = { ...basePolicy, topPercent: percent };
  const percentScale = recoveryPercentScale(policy, pi?.instance ?? null);

  const weeks = block.weeks as number;
  // Where the week goes: before week 1 when leading a new block, otherwise the
  // program's boundary if it named one, otherwise after the week the lifter is
  // in. Mirror the NEXT programmed week's structure (clamped to the last week
  // when there is nothing after it).
  const anchored = boundaryKey
    ? await boundaryWeek(
        supabase,
        userId,
        block.id as string,
        block.program_id as string | null,
        pi?.instance ?? null,
        boundaryKey,
      )
    : null;
  if (boundaryKey && anchored === null) return null;
  const afterWeek = prepend
    ? -1
    : (anchored ?? currentWeekIndex(block.started_on as string, weeks));
  const mirrorWeek = Math.min(afterWeek + 1, weeks - 1);

  const { data: rows } = await supabase
    .from("planned_sessions")
    .select("day_index, slot, title, session_modality, prescription")
    .eq("user_id", userId)
    .eq("block_id", block.id)
    .eq("week_index", mirrorWeek);
  if (!rows || rows.length === 0) return null;

  const sessions = buildDeloadWeek(
    rows.map((r) => ({
      dayIndex: r.day_index as number,
      slot: (r.slot as string) ?? "single",
      title: (r.title as string | null) ?? null,
      sessionModality: (r.session_modality as string | null) ?? null,
      prescription: (r.prescription as Prescription | null) ?? null,
    })),
    policy,
    percentScale,
  );
  if (sessions.length === 0) return null;

  // Warn (don't block) when a future A-event would be pushed by the extra week.
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: evt } = await supabase
    .from("events")
    .select("id")
    .eq("user_id", userId)
    .eq("priority", "A")
    .gte("event_date", todayIso)
    .limit(1)
    .maybeSingle();

  return {
    blockId: block.id as string,
    afterWeek,
    deloadWeekIndex: afterWeek + 1,
    sessions,
    eventWarning: !!evt,
    percent,
    ...(policy.recommendedPercent
      ? { recommendedPercent: policy.recommendedPercent }
      : {}),
    outsideRecommended:
      !policy.restOnly && isOutsideRecommended(policy, percent),
    restOnly: policy.restOnly === true,
    ...(boundaryKey ? { boundaryKey } : {}),
  };
}

/**
 * Whether to PROACTIVELY surface the recovery-week nudge (vs. the always-present
 * quiet control). Fires only when the user shows real accumulated fatigue, using
 * the SAME proxy + threshold as the early-deload recommendation
 * (`EARLY_DELOAD_THRESHOLD`). `dataSufficient` (≥3 logged weeks) gates out fresh
 * blocks, so a brand-new block never nags. Suppressed right after a deload.
 *
 * Self-contained server read; returns false when there's no active block.
 */
export async function getDeloadWeekFatigueSignal(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return false;

  const { data: block } = await supabase
    .from("training_blocks")
    .select("id, archetype, started_on, weeks")
    .eq("user_id", user.id)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!block) return false;

  const tz = await getUserTimezone();
  const fatigue = await computeActiveBlockFatigue(
    supabase,
    user.id,
    {
      id: block.id as string,
      archetype: (block.archetype as string | null) ?? null,
      started_on: block.started_on as string,
      weeks: block.weeks as number,
    },
    tz,
  );
  return (
    fatigue.dataSufficient &&
    !fatigue.recentDeloadThisBlock &&
    fatigue.proxy >= EARLY_DELOAD_THRESHOLD
  );
}
