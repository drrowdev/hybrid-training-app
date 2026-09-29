/**
 * Quick-workout drafts — a generated workout the user reviews in the Quick
 * workout sheet before any session row exists.
 *
 * Preview actions return a draft without writing; start actions re-resolve the
 * same draft on the server (strength: same variation seed; HYROX: same format)
 * and insert it. The client never supplies prescription items — only the draft
 * identity plus the movements the user removed.
 *
 * Pure: shared by the sheet (to render the edited draft) and the server action
 * (to build the stored prescription) so the two can't drift.
 */
import type { Prescription, PrescriptionItem } from "@hta/db";
import type { ActionFailure } from "@/lib/action-result";
import type { QuickLength } from "@/lib/planner/quick-generate";
import type {
  HyroxQuickFormat,
  HyroxQuickStation,
  QuickHyroxView,
} from "@/lib/planner/quick-hyrox";
import { removeMovementFromPrescription } from "./prescription-mutations";

export type QuickStrengthDraft = {
  length: QuickLength;
  seed: number;
  title: string;
  /** Expanded per-set items exactly as they'd be stored on the session. */
  items: PrescriptionItem[];
};

export type QuickHyroxDraft = {
  length: QuickLength;
  stations: HyroxQuickStation[];
  format: HyroxQuickFormat;
  title: string;
  view: QuickHyroxView;
};

export type QuickPreviewResult<D> = { ok: true; draft: D } | ActionFailure;

/**
 * `draft` is set when the workout resolved differently at start time than it
 * did at review (e.g. new training data landed in between) — the sheet shows
 * the new draft instead of starting something the user never saw.
 */
export type QuickStartResult<D> =
  | { ok: true; sessionId: string }
  | (ActionFailure & { draft?: D });

export const QUICK_DRAFT_MAX_MOVEMENTS = 40;

/** Distinct movement ids in first-appearance order. */
export function quickDraftMovementIds(items: readonly PrescriptionItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (item.movementId && !seen.has(item.movementId)) {
      seen.add(item.movementId);
      out.push(item.movementId);
    }
  }
  return out;
}

/** The draft's prescription with every item of each removed movement dropped. */
export function quickDraftPrescription(
  items: readonly PrescriptionItem[],
  removedMovementIds: readonly string[],
): Prescription {
  let prescription: Prescription = { items: [...items] };
  for (const movementId of removedMovementIds) {
    prescription = removeMovementFromPrescription(prescription, movementId);
  }
  return prescription;
}

export function sameMovementIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
