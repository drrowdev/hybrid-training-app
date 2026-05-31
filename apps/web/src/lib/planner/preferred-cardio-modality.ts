/**
 * ADR 0017 — ranked cardio-modality preference resolution (pure).
 *
 * Running is the archetype default for every cardio day. This module
 * substitutes the prescribed (running) cardio movement for a movement in
 * the user's preferred modality, holding the prescribed intensity
 * (`cardioKind`) constant, at block-creation time.
 *
 * Why intensity-preserving: the cardio session's load is driven by the
 * day's `cardioKind` + duration + HR cap (all from the archetype), not by
 * which modality vehicle is used. The modality-weighted concurrent scalar
 * (`computeConcurrentScalar`) reads *logged* sessions for analytics and is
 * not part of `buildPrescription`, so swapping the prescribed modality is
 * load-neutral for the strength prescription. See ADR 0017.
 *
 * Fallback (ADR 0017 model A — ranked allow-list → running):
 *   For each modality in the user's ordered preference list, use the first
 *   that has a catalog movement of the prescribed `cardioKind` that the
 *   user can perform (owned equipment + experience tier). If none qualify,
 *   keep the archetype default (running) — the only modality with a full
 *   intensity ladder.
 *
 * Coverage (catalog as of ADR 0017): running / cycling / rowing cover all
 * four kinds (z2 / threshold / vo2 / alactic); swimming / rucking / sled /
 * elliptical / stair are z2-only; ski_erg has no zoned entries. So a
 * swim-preferring user gets swims on easy days and falls back on interval
 * days — by design.
 *
 * Pure: no DB / React imports. The DB-backed catalog is assembled by the
 * caller (see `loadCardioCatalog` in `actions.ts`). Tested directly.
 */

import type { CardioKind } from "@/lib/sessions/cardio-swap";
import { movementMatchesEquipment } from "@/lib/sessions/cardio-swap";
import type { CardioMachineType } from "@/lib/settings/equipment-schema";

/**
 * Canonical modality vocabulary the planner can substitute toward. Mirrors
 * the `metadata.modality` values written by the movement seed (after
 * normalization) and the CHECK constraint on
 * `profiles.preferred_cardio_modalities` (migration 0081).
 */
export type PreferredCardioModality =
  | "running"
  | "cycling"
  | "rowing"
  | "swimming"
  | "rucking"
  | "sled"
  | "elliptical"
  | "stair"
  | "ski_erg";

export const PREFERRED_CARDIO_MODALITIES: readonly PreferredCardioModality[] = [
  "running",
  "cycling",
  "rowing",
  "swimming",
  "rucking",
  "sled",
  "elliptical",
  "stair",
  "ski_erg",
];

const MODALITY_SET = new Set<string>(PREFERRED_CARDIO_MODALITIES);

/**
 * Short display labels for the preference UI.
 */
export const PREFERRED_CARDIO_MODALITY_LABEL: Record<
  PreferredCardioModality,
  string
> = {
  running: "Running",
  cycling: "Cycling",
  rowing: "Rowing",
  swimming: "Swimming",
  rucking: "Rucking",
  sled: "Sled",
  elliptical: "Elliptical",
  stair: "Stair climber",
  ski_erg: "Ski erg",
};

/**
 * Normalize a raw `metadata.modality` value (or a stored preference token)
 * to the canonical vocabulary. Returns null for modalities the planner
 * cannot substitute toward (e.g. `jump-rope`, `other`), so they're simply
 * never selected.
 */
export function normalizeCardioModality(
  raw: unknown,
): PreferredCardioModality | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (!s) return null;
  if (s === "running" || s === "run") return "running";
  if (s === "cycling" || s === "bike" || s === "biking" || s === "cycle")
    return "cycling";
  if (s === "rowing" || s === "row") return "rowing";
  if (s === "swimming" || s === "swim") return "swimming";
  if (s === "rucking" || s === "ruck") return "rucking";
  if (s === "sled") return "sled";
  if (s === "elliptical") return "elliptical";
  if (s === "stair" || s === "stairs" || s === "stairmaster") return "stair";
  if (s === "ski_erg" || s === "skierg" || s === "ski") return "ski_erg";
  return null;
}

/**
 * Validate + de-dupe a stored preference array, preserving rank order and
 * dropping unknown tokens. Used by the server action and the resolver.
 */
export function sanitizePreferredModalities(
  raw: readonly unknown[] | null | undefined,
): PreferredCardioModality[] {
  if (!raw || raw.length === 0) return [];
  const out: PreferredCardioModality[] = [];
  const seen = new Set<PreferredCardioModality>();
  for (const item of raw) {
    const token = String(item ?? "").trim().toLowerCase();
    if (!MODALITY_SET.has(token)) continue;
    const m = token as PreferredCardioModality;
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

/** A catalog cardio movement, pre-classified for substitution. */
export type CardioCatalogEntry = {
  slug: string;
  /** Normalized modality, or null for un-substitutable modalities. */
  modality: PreferredCardioModality | null;
  /** Intensity bucket inferred from seed metadata. */
  cardioKind: CardioKind;
  /** Raw `equipment` slug (for owned-gear reconciliation). */
  equipment: string | null;
  /** Minimum experience tier the movement requires, if any. */
  experienceMin: number | null;
};

export type ResolvedCardioModality = {
  /** The slug to prescribe (the default when no substitution applies). */
  slug: string;
  /** True only when a different-modality movement was selected. */
  substituted: boolean;
  /** The chosen modality, or null when falling back to the default. */
  modality: PreferredCardioModality | null;
};

function tierOk(experienceMin: number | null, userTier: number | null): boolean {
  if (userTier == null) return true;
  if (experienceMin == null) return true;
  return experienceMin <= userTier;
}

/**
 * Resolve the cardio slug to prescribe given the user's ranked modality
 * preference. Returns the default slug unchanged when:
 *   - the preference list is empty (the byte-identical default path), or
 *   - the prescribed kind is `cardio_other` (no reliable target), or
 *   - the top-ranked *feasible* modality already equals the default's
 *     modality (keeps the exact archetype-chosen slug), or
 *   - no preferred modality has a feasible same-kind movement (fall back).
 *
 * Determinism: among equally-ranked candidates, the lowest slug wins, so a
 * given (user, archetype, tier, equipment) always rebuilds identically.
 */
export function resolvePreferredCardioModality(args: {
  defaultSlug: string;
  cardioKind: CardioKind;
  preferred: readonly unknown[] | null | undefined;
  ownedCardio: readonly CardioMachineType[];
  userTier: number | null;
  catalog: readonly CardioCatalogEntry[];
}): ResolvedCardioModality {
  const { defaultSlug, cardioKind, ownedCardio, userTier, catalog } = args;

  const preferred = sanitizePreferredModalities(args.preferred);
  // Invariant: empty preference reproduces the pre-ADR-0017 prescription.
  if (preferred.length === 0) {
    return { slug: defaultSlug, substituted: false, modality: null };
  }
  // `cardio_other` is never an archetype target kind; never substitute it.
  if (cardioKind === "cardio_other") {
    return { slug: defaultSlug, substituted: false, modality: null };
  }

  const defaultModality =
    catalog.find((c) => c.slug === defaultSlug)?.modality ?? null;

  for (const pref of preferred) {
    const candidates = catalog
      .filter(
        (c) =>
          c.modality === pref &&
          c.cardioKind === cardioKind &&
          movementMatchesEquipment(c.equipment, ownedCardio) &&
          tierOk(c.experienceMin, userTier),
      )
      .map((c) => c.slug)
      .sort();

    if (candidates.length === 0) continue;

    // The archetype already prescribes the user's top feasible modality —
    // keep its exact slug (no pointless reshuffle, preserves determinism
    // against the curated default).
    if (pref === defaultModality) {
      return { slug: defaultSlug, substituted: false, modality: pref };
    }
    return { slug: candidates[0]!, substituted: true, modality: pref };
  }

  // No preferred modality is feasible for this kind — fall back to default.
  return { slug: defaultSlug, substituted: false, modality: null };
}
