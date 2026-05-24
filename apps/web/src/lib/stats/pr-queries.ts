/**
 * PR queries — fetch logged set history for PR detection on the session page.
 *
 * One round-trip per movement that the session touched: gather every prior
 * main-lift set for the same (user, movement) and run the pure detector.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectPrs, type HistoricalSet, type PrHit, type PrKind } from "@/lib/engine/pr";
import { detectTmAnchoredPr } from "@/lib/engine/tm-anchored-pr";
import type { Prescription, SetKind } from "@hta/db";

export type SessionPrSummary = {
  movementId: string;
  movementDisplayName: string;
  /** The best set logged in this session for this movement (highest e1RM-friendly). */
  bestSet: { weight: number; reps: number; rpe: number | null; performed_at: string };
  /** PR hits triggered by that best set. */
  hits: PrHit[];
};

/**
 * Find PR hits for every movement touched in the given session.
 *
 * For each movement: pick the session's "best" set (heaviest first, then
 * most reps as tiebreaker), then run PR detection against all *prior*
 * completed sets for that movement.
 */
export async function getSessionPrs(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  sessionPerformedAt: string,
): Promise<SessionPrSummary[]> {
  // Step 1: pull this session's sets. Exclude warmups; include only sets
  // with weight + reps (cardio entries have neither).
  const { data: sessionSets } = await supabase
    .from("set_logs")
    .select("set_kind, weight_kg, reps, rpe, movement:movements(id, display_name)")
    .eq("session_id", sessionId)
    .eq("skipped", false)
    .neq("set_kind", "warmup")
    .not("weight_kg", "is", null)
    .not("reps", "is", null)
    .gt("reps", 0);

  if (!sessionSets || sessionSets.length === 0) return [];

  // Step 2: pick the strongest set per movement in this session.
  type Working = { movementId: string; movementDisplayName: string; bestSet: { weight: number; reps: number; rpe: number | null } };
  const bestPerMovement = new Map<string, Working>();
  for (const row of sessionSets as Array<{ set_kind: string; weight_kg: number; reps: number; rpe: number | null; movement: { id: string; display_name: string } | { id: string; display_name: string }[] | null }>) {
    const m = Array.isArray(row.movement) ? row.movement[0] : row.movement;
    if (!m) continue;
    const candidate = { weight: Number(row.weight_kg), reps: Number(row.reps), rpe: row.rpe };
    const existing = bestPerMovement.get(m.id);
    if (!existing) {
      bestPerMovement.set(m.id, {
        movementId: m.id,
        movementDisplayName: m.display_name,
        bestSet: candidate,
      });
      continue;
    }
    // Tiebreak: heaviest weight, then highest reps.
    if (
      candidate.weight > existing.bestSet.weight ||
      (candidate.weight === existing.bestSet.weight && candidate.reps > existing.bestSet.reps)
    ) {
      existing.bestSet = candidate;
    }
  }
  if (bestPerMovement.size === 0) return [];

  // Step 3: for each movement, pull prior sets (sessions performed BEFORE this one).
  const movementIds = Array.from(bestPerMovement.keys());

  // Find all user sessions before this one — short list typically.
  const { data: priorSessions } = await supabase
    .from("sessions")
    .select("id")
    .eq("user_id", userId)
    .lt("performed_at", sessionPerformedAt)
    .is("deleted_at", null);

  const priorIds = (priorSessions ?? []).map((s) => s.id);

  let priorSets: Array<{ movement_id: string; weight_kg: number; reps: number; rpe: number | null; performed_at: string }> = [];
  if (priorIds.length > 0) {
    const { data: rows } = await supabase
      .from("set_logs")
      .select("movement_id, weight_kg, reps, rpe, performed_at:sessions!inner(performed_at)")
      .in("session_id", priorIds)
      .in("movement_id", movementIds)
      .eq("skipped", false)
      .neq("set_kind", "warmup")
      .not("weight_kg", "is", null)
      .not("reps", "is", null)
      .gt("reps", 0);
    priorSets = (rows ?? []).map((r) => {
      const perf = Array.isArray(r.performed_at) ? r.performed_at[0] : r.performed_at;
      return {
        movement_id: r.movement_id,
        weight_kg: Number(r.weight_kg),
        reps: Number(r.reps),
        rpe: r.rpe,
        performed_at: (perf?.performed_at as string) ?? sessionPerformedAt,
      };
    });
  }

  // Step 4: bucket prior sets by movement and run the detector.
  const historyByMovement = new Map<string, HistoricalSet[]>();
  for (const r of priorSets) {
    const arr = historyByMovement.get(r.movement_id) ?? [];
    arr.push({ weight: r.weight_kg, reps: r.reps, rpe: r.rpe, performed_at: r.performed_at });
    historyByMovement.set(r.movement_id, arr);
  }

  const summaries: SessionPrSummary[] = [];
  for (const [movementId, w] of bestPerMovement) {
    const history = historyByMovement.get(movementId) ?? [];
    const result = detectPrs(
      { weight: w.bestSet.weight, reps: w.bestSet.reps, rpe: w.bestSet.rpe },
      history,
    );
    if (result.hits.length === 0) continue;
    summaries.push({
      movementId,
      movementDisplayName: w.movementDisplayName,
      bestSet: { ...w.bestSet, performed_at: sessionPerformedAt },
      hits: result.hits,
    });
  }
  return summaries;
}

/** Plain-English summary chip for a single hit. */
export function formatHitValue(hit: PrHit, kind: PrKind): string {
  switch (kind) {
    case "weight": return `${hit.value} kg`;
    case "reps_at_weight": return `${hit.value} reps`;
    case "e1rm": return `${hit.value} kg est.`;
  }
}

/**
 * Pure TM-anchored PR count for a *completed* session.
 *
 * Counts each ⭐ flag (Weight / Rep / e1RM) raised against the user's
 * saved one-rep max. Mirrors the in-session flash semantics so the
 * "PRs: N" tile on `<PostSessionSummary>` lines up with what the user
 * just saw in real time. Movements with no saved 1RM contribute 0.
 *
 * Rep PR is only counted when the prescription marks the heaviest main
 * set as the top set (last main-kind item per movement) AND the logged
 * reps exceed that item's prescribed reps. Freestyle / unlinked
 * sessions therefore can't fire a Rep PR — same rule as the in-session
 * detector.
 *
 * Pure / synchronous so it lives next to the I/O wrappers but doesn't
 * touch Supabase.
 */
export function countSessionTmAnchoredPrs(
  sets: ReadonlyArray<{
    set_kind: SetKind | string;
    weight_kg: number | string | null;
    reps: number | null;
    rpe: number | string | null;
    movement: { id: string; slug: string };
  }>,
  oneRmBySlug: Record<string, number>,
  prescription: Prescription | null,
): number {
  // Identify the *top* main set per movement from the prescription —
  // the last `kind === "main"` item with a positive rep target. That
  // mirrors `lastMainSlot` in movement-grouping.ts.
  const topByMovementId = new Map<string, { prescribedReps: number }>();
  for (const item of prescription?.items ?? []) {
    if (item.kind !== "main") continue;
    if (typeof item.reps !== "number" || item.reps <= 0) continue;
    // Last write wins — matches "last main slot".
    topByMovementId.set(item.movementId, { prescribedReps: item.reps });
  }

  // For each movement: collapse to the strongest (heaviest, then most
  // reps) set in this session, like getSessionPrs does.
  type Best = {
    weight: number;
    reps: number;
    rpe: number | null;
    kind: SetKind;
    slug: string;
    movementId: string;
  };
  const bestByMovement = new Map<string, Best>();
  for (const s of sets) {
    if (!s.movement?.id) continue;
    const kindStr = String(s.set_kind);
    if (kindStr === "warmup") continue;
    const w = s.weight_kg == null ? NaN : Number(s.weight_kg);
    const r = s.reps == null ? NaN : Number(s.reps);
    if (!Number.isFinite(w) || w <= 0) continue;
    if (!Number.isFinite(r) || r <= 0) continue;
    const rpe = s.rpe == null ? null : Number(s.rpe);
    const candidate: Best = {
      weight: w,
      reps: r,
      rpe: Number.isFinite(rpe as number) ? (rpe as number) : null,
      kind: kindStr as SetKind,
      slug: s.movement.slug,
      movementId: s.movement.id,
    };
    const cur = bestByMovement.get(s.movement.id);
    if (
      !cur ||
      candidate.weight > cur.weight ||
      (candidate.weight === cur.weight && candidate.reps > cur.reps)
    ) {
      bestByMovement.set(s.movement.id, candidate);
    }
  }

  let count = 0;
  for (const best of bestByMovement.values()) {
    const oneRm = oneRmBySlug[best.slug];
    if (oneRm == null) continue;
    const top = topByMovementId.get(best.movementId);
    const flash = detectTmAnchoredPr({
      weightKg: best.weight,
      reps: best.reps,
      rpe: best.rpe,
      kind: best.kind,
      prescribedReps: top?.prescribedReps ?? null,
      isTopSet: top != null,
      tmKg: oneRm,
    });
    if (flash.isWeightPr) count++;
    if (flash.isE1rmPr) count++;
    if (flash.isRepPr) count++;
  }
  return count;
}

/**
 * TM-anchored equivalent of `getSessionPrs` for the in-session 🏆 PR
 * callout card. Same shape as `SessionPrSummary` but PR hits are
 * detected against the user's saved 1RM (and prescription for Rep PR),
 * not historical max from the log. Pure / synchronous.
 */
export type TmAnchoredSessionPrHit = {
  kind: PrKind; // reuses "weight" | "reps_at_weight" | "e1rm" for label compatibility
  value: number;
};

export type TmAnchoredSessionPrSummary = {
  movementId: string;
  movementDisplayName: string;
  bestSet: { weight: number; reps: number; rpe: number | null };
  hits: TmAnchoredSessionPrHit[];
};

export function getSessionTmAnchoredPrSummaries(
  sets: ReadonlyArray<{
    set_kind: SetKind | string;
    weight_kg: number | string | null;
    reps: number | null;
    rpe: number | string | null;
    movement: { id: string; slug: string; display_name: string };
  }>,
  oneRmBySlug: Record<string, number>,
  prescription: Prescription | null,
): TmAnchoredSessionPrSummary[] {
  const topByMovementId = new Map<string, { prescribedReps: number }>();
  for (const item of prescription?.items ?? []) {
    if (item.kind !== "main") continue;
    if (typeof item.reps !== "number" || item.reps <= 0) continue;
    topByMovementId.set(item.movementId, { prescribedReps: item.reps });
  }

  type Best = {
    weight: number;
    reps: number;
    rpe: number | null;
    kind: SetKind;
    slug: string;
    movementId: string;
    displayName: string;
  };
  const bestByMovement = new Map<string, Best>();
  for (const s of sets) {
    if (!s.movement?.id) continue;
    const kindStr = String(s.set_kind);
    if (kindStr === "warmup") continue;
    const w = s.weight_kg == null ? NaN : Number(s.weight_kg);
    const r = s.reps == null ? NaN : Number(s.reps);
    if (!Number.isFinite(w) || w <= 0) continue;
    if (!Number.isFinite(r) || r <= 0) continue;
    const rpe = s.rpe == null ? null : Number(s.rpe);
    const candidate: Best = {
      weight: w,
      reps: r,
      rpe: Number.isFinite(rpe as number) ? (rpe as number) : null,
      kind: kindStr as SetKind,
      slug: s.movement.slug,
      movementId: s.movement.id,
      displayName: s.movement.display_name,
    };
    const cur = bestByMovement.get(s.movement.id);
    if (
      !cur ||
      candidate.weight > cur.weight ||
      (candidate.weight === cur.weight && candidate.reps > cur.reps)
    ) {
      bestByMovement.set(s.movement.id, candidate);
    }
  }

  const out: TmAnchoredSessionPrSummary[] = [];
  for (const best of bestByMovement.values()) {
    const oneRm = oneRmBySlug[best.slug];
    if (oneRm == null) continue;
    const top = topByMovementId.get(best.movementId);
    const flash = detectTmAnchoredPr({
      weightKg: best.weight,
      reps: best.reps,
      rpe: best.rpe,
      kind: best.kind,
      prescribedReps: top?.prescribedReps ?? null,
      isTopSet: top != null,
      tmKg: oneRm,
    });
    const hits: TmAnchoredSessionPrHit[] = [];
    if (flash.isWeightPr) hits.push({ kind: "weight", value: best.weight });
    if (flash.isRepPr) hits.push({ kind: "reps_at_weight", value: best.reps });
    if (flash.isE1rmPr && flash.e1rmKg != null) {
      hits.push({ kind: "e1rm", value: Math.round(flash.e1rmKg * 10) / 10 });
    }
    if (hits.length > 0) {
      out.push({
        movementId: best.movementId,
        movementDisplayName: best.displayName,
        bestSet: { weight: best.weight, reps: best.reps, rpe: best.rpe },
        hits,
      });
    }
  }
  return out;
}

export type RecentPr = {
  sessionId: string;
  sessionPerformedAt: string;
  movementId: string;
  movementSlug: string;
  movementDisplayName: string;
  hit: PrHit;
};

/**
 * Walk recent completed sessions newest-first and collect PR hits across
 * all movements. Returns up to `limit` PRs from the most-recent sessions.
 *
 * Implementation is O(sessions × movements-touched); fine for a stats page
 * tile that surfaces the latest dozen PRs.
 */
export async function getRecentPrs(
  supabase: SupabaseClient,
  userId: string,
  limit = 12,
): Promise<RecentPr[]> {
  const { data: completed } = await supabase
    .from("sessions")
    .select("id, performed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .is("deleted_at", null)
    .order("performed_at", { ascending: false })
    .limit(30); // scan the last 30 completed sessions

  const result: RecentPr[] = [];
  for (const s of completed ?? []) {
    if (result.length >= limit) break;
    const summaries = await getSessionPrs(supabase, userId, s.id, s.performed_at);
    for (const sm of summaries) {
      for (const hit of sm.hits) {
        // Need movement_slug for the link; one more cheap lookup.
        const { data: mv } = await supabase
          .from("movements")
          .select("slug")
          .eq("id", sm.movementId)
          .maybeSingle();
        result.push({
          sessionId: s.id,
          sessionPerformedAt: s.performed_at,
          movementId: sm.movementId,
          movementSlug: mv?.slug ?? "",
          movementDisplayName: sm.movementDisplayName,
          hit,
        });
        if (result.length >= limit) break;
      }
      if (result.length >= limit) break;
    }
  }
  return result;
}
