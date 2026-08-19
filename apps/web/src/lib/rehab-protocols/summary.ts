/**
 * Derived facts about a library protocol.
 *
 * The duration reuses the canonical `estimateSessionMinutes` rather than a
 * second estimator, so a protocol's "~32 min" in Settings is the same number
 * the Today card shows for the same work (AGENTS.md §6.9). That means
 * converting a library item into the `PrescriptionItem` shape first — the same
 * conversion `materialize.ts` performs when it writes rehab into a plan.
 */
import type { PrescriptionItem } from "@hta/db";
import { estimateSessionMinutes } from "@/lib/sessions/estimate-duration";
import type { RehabProtocolItem } from "./queries";

export function toPrescriptionItems(
  items: readonly RehabProtocolItem[],
): PrescriptionItem[] {
  return items.map(
    (item): PrescriptionItem => ({
      movementId: item.movementId,
      movementName: item.movementName,
      kind: "tendon",
      sets: item.sets,
      ...(item.reps != null ? { reps: item.reps } : {}),
      ...(item.holdSeconds != null
        ? { holdSec: { min: item.holdSeconds, max: item.holdSeconds } }
        : {}),
      ...(item.targetWeightKg != null ? { targetWeightKg: item.targetWeightKg } : {}),
      meta: { rehab: true },
    }),
  );
}

export type ProtocolSummary = {
  movementCount: number;
  setCount: number;
  minutes: number | null;
};

export function summariseProtocol(
  items: readonly RehabProtocolItem[],
): ProtocolSummary {
  return {
    // Distinct movements, not rows: a protocol addresses left and right as two
    // rows of the same movement, and "4 movements" should not count that twice.
    movementCount: new Set(items.map((item) => item.movementId)).size,
    setCount: items.reduce((total, item) => total + item.sets, 0),
    minutes: estimateSessionMinutes(toPrescriptionItems(items)),
  };
}

/** "4 movements · 12 sets · ~32 min" */
export function formatProtocolSummary(items: readonly RehabProtocolItem[]): string {
  const { movementCount, setCount, minutes } = summariseProtocol(items);
  return [
    `${movementCount} movement${movementCount === 1 ? "" : "s"}`,
    `${setCount} set${setCount === 1 ? "" : "s"}`,
    minutes != null ? `~${minutes} min` : null,
  ]
    .filter((part): part is string => part != null)
    .join(" · ");
}
