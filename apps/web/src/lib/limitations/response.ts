/**
 * ADR 0014 — mid-block limitation response (deterministic core).
 *
 * When a user adds or edits a limitation *during* an active block, the
 * already-materialized future sessions still carry movements that load
 * the newly-flagged region / muscle / movement. This module scans those
 * un-started sessions and produces a concrete remediation plan:
 *
 *   - swap  — a discretionary item (accessory / tendon / power) that
 *             offends is replaced by a limitation-safe movement hitting
 *             the same training target (picker-style derivation). Sets ×
 *             reps and all effort cues are preserved; only the movement
 *             identity changes.
 *   - drop  — a discretionary offender with no safe like-for-like
 *             replacement is removed (better to do less than to load a
 *             flagged tissue).
 *   - warn  — a main / back-off / warm-up offender is surfaced but never
 *             auto-changed. Load / ROM / grip on a primary lift is a
 *             clinician call, not something a deterministic engine should
 *             silently rewrite.
 *
 * Pure and deterministic: the same (sessions, catalog, context) always
 * yields the same plan. The server glue (`./offer.ts`) loads the inputs;
 * the accept action (`./actions.ts`) re-derives the plan and persists the
 * swap / drop updates via `applyPrescriptionUpdates`.
 *
 * This is load management, not medical care — the UI frames it as such
 * and points the user to a clinician.
 */
import type { Prescription, PrescriptionItem, PrescriptionItemKind } from "@hta/db";
import type { CatalogMovement } from "@/lib/planner/accessory-picker";
import {
  loadsBlockedMuscle,
  loadsBlockedRegion,
} from "@/lib/planner/accessory-picker";
import {
  isEquipmentAvailable,
  resolveRequiredEquipment,
} from "@/lib/planner/equipment-requirements";
import type { Equipment } from "@/lib/settings/equipment-schema";
import type { LimitationsContext } from "@/lib/planner/limitations-context";
import type { RemainingSession } from "@/lib/planner/remaining-sessions";
import { limitationItemKey } from "./item-key";

/** Max alternative swap targets offered per movement (the user picks one). */
const MAX_ALTERNATIVES = 5;

/** Discretionary kinds we will auto-swap or auto-drop. */
const SWAPPABLE_KINDS: ReadonlySet<PrescriptionItemKind> = new Set([
  "accessory",
  "tendon",
  "power_potentiation",
]);

/** Main-lift family — offenders here are warn-only (never auto-changed). */
const PROTECTED_KINDS: ReadonlySet<PrescriptionItemKind> = new Set([
  "main",
  "back_off",
  "warmup",
]);

export type LimitationOffenceReason =
  | "movement_flagged"
  | "blocked_region"
  | "blocked_muscle";

/** A candidate swap target the user can choose between. */
export type LimitationSwapTarget = {
  movementId: string;
  movementSlug: string;
  name: string;
};

export type LimitationSwap = {
  sessionId: string;
  weekIndex: number;
  dayIndex: number;
  sessionTitle: string;
  itemIndex: number;
  reason: LimitationOffenceReason;
  fromMovementId: string;
  fromName: string;
  /** Default (top-ranked) target. Also alternatives[0]. */
  toMovementId: string;
  toMovementSlug: string;
  toName: string;
  /**
   * Ranked, limitation-safe + equipment-available alternatives the user may
   * pick from (default first). Session-agnostic, so every occurrence of the
   * same offending movement offers the same choice.
   */
  alternatives: LimitationSwapTarget[];
};

export type LimitationDrop = {
  sessionId: string;
  weekIndex: number;
  dayIndex: number;
  sessionTitle: string;
  itemIndex: number;
  reason: LimitationOffenceReason;
  fromMovementId: string;
  fromName: string;
};

export type LimitationWarn = {
  sessionId: string;
  weekIndex: number;
  dayIndex: number;
  sessionTitle: string;
  itemIndex: number;
  kind: PrescriptionItemKind;
  reason: LimitationOffenceReason;
  fromMovementId: string;
  fromName: string;
};

export type LimitationResponsePlan = {
  swaps: LimitationSwap[];
  drops: LimitationDrop[];
  warns: LimitationWarn[];
  /** Sessions whose prescription changed (swaps + drops applied), ready to persist. */
  updates: Array<{ id: string; prescription: Prescription }>;
};

const EMPTY_PLAN: LimitationResponsePlan = {
  swaps: [],
  drops: [],
  warns: [],
  updates: [],
};

/**
 * Why (if at all) a movement is disallowed under the given context.
 * `blockedMovementIds` is unconditional; region drops ignore the
 * allow-list; muscle drops are bypassed by the allow-list — mirroring the
 * generation-time picker exactly.
 */
function offenceFor(
  mv: CatalogMovement | undefined,
  movementId: string,
  ctx: LimitationsContext,
): LimitationOffenceReason | null {
  if (ctx.blockedMovementIds.has(movementId)) return "movement_flagged";
  if (!mv) return null;
  if (loadsBlockedRegion(mv, ctx.blockedRegions)) return "blocked_region";
  if (loadsBlockedMuscle(mv, ctx.blockedMuscles, ctx.allowedMovementIds)) {
    return "blocked_muscle";
  }
  return null;
}

/** True when the catalog movement is safe to prescribe under `ctx`. */
function isSafe(mv: CatalogMovement, ctx: LimitationsContext): boolean {
  return offenceFor(mv, mv.id, ctx) === null;
}

/**
 * Patterns that are NEVER a like-for-like replacement for a discretionary
 * strength accessory: conditioning (cardio) and explosive/skill work
 * (plyometric / olympic / drill). Swapping a flagged accessory for "Spin Class"
 * or "Depth Jump" is nonsensical — especially when the user is working around an
 * injury — so they're excluded from the candidate pool.
 */
const REPLACEMENT_EXCLUDED_PATTERNS: ReadonlySet<string> = new Set([
  "cardio",
  "plyometric",
  "olympic",
  "drill",
]);

/**
 * Rank limitation-safe replacements for an offending discretionary movement,
 * best-first. Candidates must share a training target (muscle / role), be
 * limitation-safe, be an accessory-appropriate pattern, and — when an equipment
 * profile is supplied — be doable with the user's gear (so we never recommend a
 * Leg Extension to someone with no machines). Same body region + pattern +
 * supported variants score higher. Deterministic: ties break on movement id.
 *
 * `isSupported` is a soft SCORING preference, NOT a hard filter — most of the
 * catalog (all free-weight + bodyweight movements) is `isSupported=false`, so
 * gating on it eliminated every otherwise-perfect candidate.
 */
export function deriveReplacements(
  offending: CatalogMovement,
  catalog: ReadonlyArray<CatalogMovement>,
  ctx: LimitationsContext,
  opts: {
    equipment?: Equipment;
    excludeMovementIds?: ReadonlySet<string>;
    limit?: number;
  } = {},
): CatalogMovement[] {
  const { equipment, excludeMovementIds, limit = MAX_ALTERNATIVES } = opts;
  const scored: Array<{ mv: CatalogMovement; score: number }> = [];
  for (const cand of catalog) {
    if (cand.id === offending.id) continue;
    if (excludeMovementIds?.has(cand.id)) continue;
    if (cand.pattern && REPLACEMENT_EXCLUDED_PATTERNS.has(cand.pattern)) continue;
    if (!isSafe(cand, ctx)) continue;
    if (
      equipment &&
      !isEquipmentAvailable(resolveRequiredEquipment(cand), equipment)
    ) {
      continue;
    }

    const sharedMuscles = cand.primaryMuscles.filter((m) =>
      offending.primaryMuscles.includes(m),
    ).length;
    const sharedBulletproof = cand.bulletproofRoles.filter((r) =>
      offending.bulletproofRoles.includes(r),
    ).length;
    const sharedFunctional = cand.functionalRoles.filter((r) =>
      offending.functionalRoles.includes(r),
    ).length;

    // A meaningful like-for-like must share at least one muscle or role.
    if (sharedMuscles === 0 && sharedBulletproof === 0 && sharedFunctional === 0) {
      continue;
    }

    let score = sharedMuscles * 3 + sharedBulletproof * 2 + sharedFunctional;
    // Same body region (e.g. knee→knee) and pattern (squat→squat) keep the swap
    // mechanically similar to what was prescribed.
    if (cand.primaryRegion === offending.primaryRegion) score += 2;
    if (cand.pattern && offending.pattern && cand.pattern === offending.pattern) {
      score += 1;
    }
    // Under concurrent stress a supported / fixed-path variant is mildly
    // preferred (DC-O5) — a tie-breaker bonus, not a gate.
    if (cand.isSupported) score += 1;

    scored.push({ mv: cand, score });
  }
  scored.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.mv.id < b.mv.id ? -1 : 1,
  );
  return scored.slice(0, limit).map((s) => s.mv);
}

/**
 * Single best limitation-safe replacement (or null). Thin wrapper over
 * `deriveReplacements` retained for the generation-time callers and tests.
 */
export function deriveReplacement(
  offending: CatalogMovement,
  catalog: ReadonlyArray<CatalogMovement>,
  ctx: LimitationsContext,
  sessionMovementIds: ReadonlySet<string>,
): CatalogMovement | null {
  return (
    deriveReplacements(offending, catalog, ctx, {
      excludeMovementIds: sessionMovementIds,
    })[0] ?? null
  );
}

/**
 * Build the full remediation plan across every un-started session.
 * Pure — no IO. Returns an empty plan when nothing offends.
 */
export function buildLimitationResponse(
  sessions: ReadonlyArray<RemainingSession>,
  catalog: ReadonlyArray<CatalogMovement>,
  ctx: LimitationsContext,
  equipment?: Equipment,
): LimitationResponsePlan {
  const hasLimits =
    ctx.blockedRegions.size > 0 ||
    ctx.blockedMuscles.size > 0 ||
    ctx.blockedMovementIds.size > 0;
  if (!hasLimits) return EMPTY_PLAN;

  const byId = new Map<string, CatalogMovement>();
  for (const m of catalog) byId.set(m.id, m);

  const swaps: LimitationSwap[] = [];
  const drops: LimitationDrop[] = [];
  const warns: LimitationWarn[] = [];
  const updates: Array<{ id: string; prescription: Prescription }> = [];

  // Alternatives are session-agnostic + equipment-filtered, so every occurrence
  // of the same offending movement offers the same ranked choice. Memoised.
  const altCache = new Map<string, LimitationSwapTarget[]>();
  const alternativesFor = (mv: CatalogMovement): LimitationSwapTarget[] => {
    const cached = altCache.get(mv.id);
    if (cached) return cached;
    const ranked = deriveReplacements(mv, catalog, ctx, { equipment }).map(
      (r) => ({ movementId: r.id, movementSlug: r.slug, name: r.displayName }),
    );
    altCache.set(mv.id, ranked);
    return ranked;
  };

  for (const session of sessions) {
    const items = session.prescription.items ?? [];
    let changed = false;
    const nextItems: PrescriptionItem[] = [];

    items.forEach((item, itemIndex) => {
      const mv = byId.get(item.movementId);
      const reason = offenceFor(mv, item.movementId, ctx);
      const fromName = item.movementName ?? mv?.displayName ?? item.movementId;

      if (reason === null) {
        nextItems.push(item);
        return;
      }

      if (PROTECTED_KINDS.has(item.kind)) {
        warns.push({
          sessionId: session.id,
          weekIndex: session.weekIndex,
          dayIndex: session.dayIndex,
          sessionTitle: session.title,
          itemIndex,
          kind: item.kind,
          reason,
          fromMovementId: item.movementId,
          fromName,
        });
        nextItems.push(item); // warn-only: leave the main lift untouched.
        return;
      }

      if (!SWAPPABLE_KINDS.has(item.kind)) {
        // Cardio / external / other — leave as-is, no remediation defined.
        nextItems.push(item);
        return;
      }

      const alternatives = mv ? alternativesFor(mv) : [];
      const top = alternatives[0];

      if (top) {
        swaps.push({
          sessionId: session.id,
          weekIndex: session.weekIndex,
          dayIndex: session.dayIndex,
          sessionTitle: session.title,
          itemIndex,
          reason,
          fromMovementId: item.movementId,
          fromName,
          toMovementId: top.movementId,
          toMovementSlug: top.movementSlug,
          toName: top.name,
          alternatives,
        });
        nextItems.push({
          ...item,
          movementId: top.movementId,
          movementSlug: top.movementSlug,
          movementName: top.name,
        });
        changed = true;
        return;
      }

      // No safe like-for-like — drop the discretionary item.
      drops.push({
        sessionId: session.id,
        weekIndex: session.weekIndex,
        dayIndex: session.dayIndex,
        sessionTitle: session.title,
        itemIndex,
        reason,
        fromMovementId: item.movementId,
        fromName,
      });
      changed = true;
    });

    if (changed) {
      updates.push({
        id: session.id,
        prescription: { ...session.prescription, items: nextItems },
      });
    }
  }

  return { swaps, drops, warns, updates };
}

/** Result of narrowing a full plan to a user-selected subset of items. */
export type SelectedLimitationUpdates = {
  updates: Array<{ id: string; prescription: Prescription }>;
  swapped: number;
  dropped: number;
};

/**
 * Narrow a full remediation plan to the swaps/drops the user actually
 * approved, and rebuild the affected sessions' prescriptions from their
 * ORIGINAL items applying only those approved changes.
 *
 * Pure and deterministic. The server re-derives `plan` from live state
 * (never trusting the client) and passes the user's checked keys here as a
 * filter — unknown / stale keys are silently ignored, so a client can only
 * ever ask for a SUBSET of what the engine independently decided is safe.
 *
 * Reconstruction is from `session.prescription.items` (the same array the
 * plan's `itemIndex` values index into), so a deselected swap/drop simply
 * leaves its original item in place. Replacements are always limitation-safe
 * while every swapped/dropped offender is unsafe, so a kept offender can
 * never collide with another row's chosen replacement.
 */
export function buildSelectedUpdates(
  sessions: ReadonlyArray<RemainingSession>,
  plan: LimitationResponsePlan,
  selectedKeys: ReadonlySet<string>,
  /**
   * Optional per-offending-movement target override (fromMovementId →
   * chosen toMovementId). A choice is honoured ONLY when it appears in that
   * swap's re-derived `alternatives` — so the client can never inject an
   * unsafe / unavailable movement; it can only pick among what the engine
   * independently offered. Unknown choices fall back to the default target.
   */
  choices: ReadonlyMap<string, string> = new Map(),
): SelectedLimitationUpdates {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const swapsBySession = new Map<string, Map<number, LimitationSwap>>();
  const dropsBySession = new Map<string, Set<number>>();
  let swapped = 0;
  let dropped = 0;

  for (const s of plan.swaps) {
    if (!selectedKeys.has(limitationItemKey(s.sessionId, s.itemIndex))) continue;
    let perSession = swapsBySession.get(s.sessionId);
    if (!perSession) {
      perSession = new Map();
      swapsBySession.set(s.sessionId, perSession);
    }
    perSession.set(s.itemIndex, s);
    swapped += 1;
  }
  for (const d of plan.drops) {
    if (!selectedKeys.has(limitationItemKey(d.sessionId, d.itemIndex))) continue;
    let perSession = dropsBySession.get(d.sessionId);
    if (!perSession) {
      perSession = new Set();
      dropsBySession.set(d.sessionId, perSession);
    }
    perSession.add(d.itemIndex);
    dropped += 1;
  }

  const updates: Array<{ id: string; prescription: Prescription }> = [];
  const touchedSessionIds = new Set<string>([
    ...swapsBySession.keys(),
    ...dropsBySession.keys(),
  ]);

  for (const sessionId of touchedSessionIds) {
    const session = sessionById.get(sessionId);
    if (!session) continue;
    const sessionSwaps: Map<number, LimitationSwap> =
      swapsBySession.get(sessionId) ?? new Map();
    const sessionDrops: Set<number> =
      dropsBySession.get(sessionId) ?? new Set<number>();
    const items = session.prescription.items ?? [];
    const nextItems: PrescriptionItem[] = [];

    items.forEach((item, itemIndex) => {
      if (sessionDrops.has(itemIndex)) return; // approved drop — remove it.
      const swap = sessionSwaps.get(itemIndex);
      if (swap) {
        // Resolve the target: a user choice is honoured only if it's one of the
        // engine-offered alternatives for this offending movement.
        const chosenId = choices.get(swap.fromMovementId);
        const chosen =
          chosenId != null
            ? swap.alternatives.find((a) => a.movementId === chosenId)
            : undefined;
        const target = chosen ?? {
          movementId: swap.toMovementId,
          movementSlug: swap.toMovementSlug,
          name: swap.toName,
        };
        nextItems.push({
          ...item,
          movementId: target.movementId,
          movementSlug: target.movementSlug,
          movementName: target.name,
        });
        return;
      }
      nextItems.push(item);
    });

    updates.push({
      id: sessionId,
      prescription: { ...session.prescription, items: nextItems },
    });
  }

  return { updates, swapped, dropped };
}
