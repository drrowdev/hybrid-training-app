"use client";

/**
 * Session work-area shell: the "Session in progress" banner up top
 * plus the movement-grouped logging surface below.
 *
 * Originally stitched `<PrescriptionItemsList>` to `<SessionLogClient>`
 * with a tap-to-prefill bridge. That two-component layout is replaced
 * here by `<MovementCardList>` — one collapsible card per movement
 * with an inline focus view, dot strip, and per-set save flow.
 */

import type { Prescription } from "@hta/db";
import type {
  LoggedSet,
  LastSetHint,
  PriorBest,
} from "./SessionLogClient";
import type {
  addStrengthSet as addStrengthSetAction,
  fillSessionFromPlan as fillSessionFromPlanAction,
  swapPrescriptionItem as swapPrescriptionItemAction,
} from "@/lib/sessions/actions";
import { MovementCardList } from "./MovementCardList";
import type { PlateInventoryItem } from "./plate-math";
import type { ResolvedFreestyleMovement } from "@/lib/sessions/freestyle-resolver";
import type { SupersetCardInfo } from "@/lib/sessions/superset-cards";

type AddStrengthSetAction = typeof addStrengthSetAction;
type FillSessionFromPlanAction = typeof fillSessionFromPlanAction;
type SwapAction = typeof swapPrescriptionItemAction;

export function SessionWorkArea({
  sessionId,
  isComplete,
  performedAt,
  sets,
  tmBySlug,
  oneRmBySlug,
  addStrengthSet,
  fillFromPlan,
  hapticsEnabled,
  timerSoundEnabled,
  // `lastSetHints` (prior-session "last time: X kg × Y" for each
  // movement) is computed server-side and threaded to the card list,
  // which surfaces it on accessory cards — the only weight-selection
  // signal there, since accessories have no TM-derived target.
  lastSetHints,
  priorBests,
  // Prescription wiring (null when the session is freestyle / unlinked).
  plannedSessionId,
  prescription,
  swapAction,
  loggedItemIndices,
  skippedItemIndices,
  loggedSetIdByItemIndex,
  barbellKg,
  trapBarKg,
  plateInventory,
  bwGateStateByFamily,
  resolvedFreestyle,
  supersetByMovementId,
  bodyweightMovementIds,
}: {
  sessionId: string;
  isComplete: boolean;
  performedAt: string;
  sets: LoggedSet[];
  tmBySlug: Record<string, number>;
  oneRmBySlug: Record<string, number>;
  addStrengthSet: AddStrengthSetAction;
  fillFromPlan: FillSessionFromPlanAction;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
  lastSetHints: Record<string, LastSetHint>;
  priorBests: Record<string, PriorBest>;
  plannedSessionId: string | null;
  prescription: Prescription | null;
  swapAction: SwapAction;
  loggedItemIndices: number[];
  skippedItemIndices?: number[];
  loggedSetIdByItemIndex: Record<number, string>;
  barbellKg?: number;
  trapBarKg?: number;
  plateInventory?: PlateInventoryItem[];
  bwGateStateByFamily?: Readonly<
    Record<
      string,
      {
        weeksAtNode: number;
        weeksRequired: number;
        tutAccumulated: number;
        tutRequired: number;
        recentOverCompleted: boolean;
      }
    >
  >;
  /**
   * Server-resolved freestyle list (union of session_movements ∪
   * distinct set_logs.movement_id). When omitted the card list falls
   * back to its legacy set_logs-only derivation, which is still
   * correct but loses anything the user added without logging a set.
   */
  resolvedFreestyle?: ReadonlyArray<ResolvedFreestyleMovement>;
  /**
   * ADR 0026 P5b — antagonist-superset membership keyed by accessory
   * movementId, built server-side. Threaded straight through to
   * `MovementCardList`. Omitted / empty = no supersets (solo cards).
   */
  supersetByMovementId?: ReadonlyMap<string, SupersetCardInfo>;
  /**
   * Movement ids whose movement is bodyweight-capable (`body_weight_loaded`):
   * pull-ups, dips, inverted rows, etc. The focus view lets these log at 0 kg
   * added load (bodyweight) instead of demanding a weight. Omitted ⇒ none.
   */
  bodyweightMovementIds?: ReadonlyArray<string>;
}) {
  // `plannedSessionId` and the page-level swap server action aren't
  // surfaced by the card-list layout — they're accepted to preserve the
  // existing prop contract from the server page (and to keep tests that
  // reach into the prop shape happy). `performedAt` is no longer rendered
  // here (the in-progress banner that used it was removed as redundant).
  void plannedSessionId;
  void swapAction;
  void performedAt;
  const loggedSet = new Set<number>(loggedItemIndices);
  const skippedSet = new Set<number>(skippedItemIndices ?? []);
  const priorBestsForCards: Record<
    string,
    { heaviestWeight: number | null; bestE1rm: number | null }
  > = priorBests;

  return (
    <MovementCardList
      sessionId={sessionId}
      isComplete={isComplete}
      prescription={prescription}
      sets={sets}
      tmBySlug={tmBySlug}
      oneRmBySlug={oneRmBySlug}
      loggedItemIndices={loggedSet}
      skippedItemIndices={skippedSet}
      loggedSetIdByItemIndex={loggedSetIdByItemIndex}
      priorBests={priorBestsForCards}
      lastSetHints={lastSetHints}
      addStrengthSet={addStrengthSet}
      fillFromPlan={fillFromPlan}
      hapticsEnabled={hapticsEnabled}
      timerSoundEnabled={timerSoundEnabled}
      barbellKg={barbellKg}
      trapBarKg={trapBarKg}
      plateInventory={plateInventory}
      bwGateStateByFamily={bwGateStateByFamily}
      resolvedFreestyle={resolvedFreestyle}
      supersetByMovementId={supersetByMovementId}
      bodyweightMovementIds={bodyweightMovementIds}
    />
  );
}

