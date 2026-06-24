/**
 * Prescription adapter — `@hta/program-core` `SessionPrescription` → the app's
 * `Prescription` JSON (the shape stored in `planned_sessions.prescription` and
 * rendered by Today / the session logger).
 *
 * Pure: the caller injects a `resolveMovement` function (engine movement key →
 * the user's anchored movement) so this module needs no DB. Weights follow
 * Option A — the engine's `percentOfTm` is passed straight through as the app's
 * integer `percentTm`; the platform seeds the user's `tm_percent` to the
 * program's basis at creation so the existing "% of TM" renderer shows the right
 * load (see movement-keys.ts `TM_BASIS_PERCENT_BY_FAMILY`).
 *
 * Strength kinds (warmup / main / amrap / supplemental / assistance) are mapped
 * today. Conditioning / cardio items and standalone notes are reported back as
 * `skipped` (Green Protocol's cardio materialisation is a separate follow-up).
 */
import type { SessionPrescription, PrescribedItem } from "@hta/program-core";
import type { Prescription, PrescriptionItem } from "@hta/db";
import { STRENGTH_KIND_MAP } from "./movement-keys";
import { EXTERNAL_CARDIO_DISPLAY_NOTE } from "@/lib/session/cardio-descriptions";

/** The user's anchored movement for an engine key. */
export interface ResolvedMovement {
  movementId: string;
  slug: string;
  displayName: string;
}

/** Resolve an engine movement key ("squat", "bench", …) to the user's movement. */
export type MovementResolver = (engineKey: string) => ResolvedMovement | undefined;

/**
 * Resolve a category-tagged assistance INTENT slot (5/3/1, ADR 0047) to a
 * concrete movement. `slotIndex` keeps the session's slots independent so they
 * rotate to different movements. Absent ⇒ assistance intent items are skipped.
 */
export type AssistanceResolver = (
  category: string,
  slotIndex: number,
) => ResolvedMovement | undefined;

export interface SkippedItem {
  kind: PrescribedItem["kind"];
  name: string;
  reason: string;
}

export interface AdaptResult {
  prescription: Prescription;
  skipped: SkippedItem[];
}

function composeNotes(item: PrescribedItem): string | undefined {
  const parts: string[] = [];
  // Preserve a rep range that the app's single `reps` field can't express.
  if (item.repsLabel && item.repsLabel !== String(item.reps)) parts.push(item.repsLabel);
  if (item.note) parts.push(item.note);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Adapt one engine `SessionPrescription` into an app `Prescription`. Items whose
 * movement key can't be resolved, and non-strength items, are returned in
 * `skipped` rather than silently dropped.
 */
export function adaptSessionPrescription(
  prescription: SessionPrescription,
  resolveMovement: MovementResolver,
  resolveAssistance?: AssistanceResolver,
  /**
   * The noun for a main lift's "% of working-max" intensity label. Programs that
   * load straight off the true 1RM (Tactical Barbell, Green Protocol, HYROX —
   * their seeded `tm_percent` is 100) want "1RM"; 5/3/1, which loads off a real
   * Training Max, wants "TM". Stamped onto main / back-off items so every surface
   * (plan drawer, preview) labels the basis correctly — the live logger already
   * derives this from TM == 1RM. Defaults to "TM" (the prior hard-coded label).
   */
  mainLiftBasisLabel: "TM" | "1RM" = "TM",
): AdaptResult {
  const items: PrescriptionItem[] = [];
  const skipped: SkippedItem[] = [];
  let assistanceSlot = 0;

  for (const it of prescription.items) {
    // ADR 0047 — a 5/3/1 assistance INTENT slot (category-tagged, no movementId).
    // Resolve it to a concrete accessory when a resolver is supplied; otherwise
    // skip it (the engine-only PR ships before the resolver is wired).
    if (it.kind === "assistance" && it.movementId == null && it.assistanceCategory) {
      const resolved = resolveAssistance?.(it.assistanceCategory, assistanceSlot++);
      if (!resolved) {
        skipped.push({
          kind: it.kind,
          name: it.name,
          reason: resolveAssistance
            ? `no assistance movement for category '${it.assistanceCategory}'`
            : "item has no movement key",
        });
        continue;
      }
      const range =
        it.repsMax != null && it.repsMax !== it.reps ? `${it.reps}\u2013${it.repsMax}` : undefined;
      // Surface the engine's accessory cue when present (HYROX carries prescribed
      // by distance, single-leg "per leg", etc.), combined with the rep range.
      // Falls back to the bare range for engines (5/3/1) that emit no note.
      const notes = it.note
        ? range
          ? `${range} \u00b7 ${it.note}`
          : it.note
        : range;
      // Expand into ONE loggable item per set. The logger renders one slot per
      // prescription item, so a single `sets: N` accessory only offered ONE
      // loggable set ("1 × 6") while the plan/preview surfaces — which read the
      // `sets` field or collapse identical one-set items — showed "N × 6". The
      // canonical shape (mirrored by the main-lift expansion below and
      // `collapseIdenticalSetItems`) is one item per set; the plan card, drawer,
      // and preview all collapse them back to "N × reps" for display.
      const accSets = Math.max(1, it.sets ?? 1);
      const accItem: PrescriptionItem = {
        movementId: resolved.movementId,
        movementSlug: resolved.slug,
        movementName: resolved.displayName,
        kind: "accessory",
        sets: 1,
        ...(it.reps !== undefined ? { reps: it.reps } : {}),
        // Distance-prescribed carries → app `distanceM` so the row renders
        // "3 × 40–60 m" instead of the `reps ?? 10` rep fallback.
        ...(it.distanceRangeM ? { distanceM: it.distanceRangeM } : {}),
        ...(notes ? { notes } : {}),
      };
      for (let s = 0; s < accSets; s++) items.push({ ...accItem });
      continue;
    }

    const appKind = STRENGTH_KIND_MAP[it.kind];
    if (!appKind) {
      // Conditioning / cardio → a display-only external cardio item. Green
      // Protocol's cardio is fulfilled by the logged run (Strava etc.), not an
      // in-app set-by-set workout (see green-cardio-materialisation-design.md),
      // so it maps to the app's `cardio_external` kind — the day is reserved and
      // the engine's target is shown, but the actual load comes from the logged
      // activity. movementId "" is the app's cardio_external sentinel.
      if (it.kind === "cardio" || it.kind === "conditioning") {
        const cardio: PrescriptionItem = {
          movementId: "",
          kind: "cardio_external",
          movementName: it.name,
          intensityLabel: it.name,
        };
        if (it.durationSec != null && it.durationSec > 0) {
          cardio.durationMin = Math.round(it.durationSec / 60);
        }
        // The engine note IS the "how to do it" prescription (HYROX intervals /
        // circuits / compromised runs, Green's LSD, etc.) — surface it as the
        // card description. Only when there's no prescription note do we fall
        // back to the generic "log it from your tracker" hint, so the card never
        // shows both a real protocol and the contradictory display-only line.
        if (it.note) {
          cardio.notes = it.note;
        } else {
          cardio.protocolNote = EXTERNAL_CARDIO_DISPLAY_NOTE;
        }
        // Structured presentation (summary / format / per-station loads / effort)
        // — the clean, sectioned render used across all surfaces. Additive: when
        // absent the card falls back to `notes`.
        if (it.cardioPlan) cardio.cardioPlan = it.cardioPlan;
        items.push(cardio);
        continue;
      }
      // Fold a standalone note into the previous item; otherwise skip-report.
      if (it.kind === "note" && items.length > 0 && it.note) {
        const prev = items[items.length - 1]!;
        prev.notes = prev.notes ? `${prev.notes} · ${it.note}` : it.note;
      } else {
        skipped.push({ kind: it.kind, name: it.name, reason: `unsupported kind '${it.kind}'` });
      }
      continue;
    }

    const engineKey = it.movementId;
    const resolved = engineKey ? resolveMovement(engineKey) : undefined;
    if (!resolved) {
      skipped.push({
        kind: it.kind,
        name: it.name,
        reason: engineKey ? `no anchored movement for key '${engineKey}'` : "item has no movement key",
      });
      continue;
    }

    const notes = composeNotes(it);
    const setCount = it.sets ?? 1;
    const appItem: PrescriptionItem = {
      movementId: resolved.movementId,
      movementSlug: resolved.slug,
      movementName: resolved.displayName,
      kind: appKind,
      sets: setCount,
      ...(it.reps !== undefined ? { reps: it.reps } : {}),
      ...(it.percentOfTm !== undefined ? { percentTm: Math.round(it.percentOfTm * 100) } : {}),
      // Label the working-max basis on the main / supplemental rows so the plan
      // drawer + preview read "72% 1RM" for HYROX/TB/GP (which load off the 1RM)
      // and "72% TM" for 5/3/1 — matching the live logger.
      ...((appKind === "main" || appKind === "back_off") && it.percentOfTm !== undefined
        ? { intensityLabel: `${Math.round(it.percentOfTm * 100)}% ${mainLiftBasisLabel}` }
        : {}),
      // Warm-ups resolve to a concrete kg (the engine ramps off the top working
      // weight) but carry no % of TM, so without this they rendered "—kg".
      // Surface the absolute target so the logger prescribes a real warm-up load.
      ...(appKind === "warmup" && it.weightKg != null && it.weightKg > 0
        ? { targetWeightKg: it.weightKg }
        : {}),
      ...(it.kind === "amrap" || it.isAmrap ? { isAmrap: true } : {}),
      ...(notes ? { notes } : {}),
    };

    // The logger renders ONE loggable slot per prescription item. Engines that
    // emit a working lift as a single item with `sets > 1` (e.g. Tactical
    // Barbell's 3–5×5, or a same-weight 5×10 supplemental) therefore collapsed
    // to a single loggable set. Expand those into one single-set item per set so
    // every prescribed working set is loggable — matching how 5/3/1 already
    // emits its (different-weight) main sets one-per-item. Hard-set count is
    // preserved (N items × 1 = 1 item × N), so load/modality classification is
    // unchanged. Warm-ups and accessories keep their single-item `sets` shape.
    const isWorkingMulti =
      (appKind === "main" || appKind === "back_off" || appKind === "accessory") &&
      setCount > 1;
    if (isWorkingMulti) {
      for (let s = 0; s < setCount; s++) {
        items.push({ ...appItem, sets: 1 });
      }
    } else {
      items.push(appItem);
    }
  }

  return { prescription: { items }, skipped };
}
