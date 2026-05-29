/**
 * Pure helper that derives a short, user-facing modality label
 * (e.g. "Run", "Bike", "Row", "Ski erg", "Swim", "Ruck") for a planned
 * cardio movement.
 *
 * Why a separate helper? `classifyCardioModality` (in
 * `lib/sessions/cardio-swap.ts`) buckets movements into four picker
 * groups: running / cycling / rowing / other. That coarse split is
 * right for swap candidates but loses signal in the session header:
 * "Other" would hide whether the user is meant to swim, ruck, or ski
 * erg. Here we use the same `metadata.modality` field with a richer
 * synonym table, falling back to slug-based hints (treadmill → Run,
 * bike-* → Bike, etc.) for legacy seeds whose metadata never landed.
 *
 * Pure: no DB / React imports. Tested directly.
 */

type Metadata = Record<string, unknown> | null | undefined;

/**
 * Map of canonical `metadata.modality` values (as written by the
 * movement seed) to short display labels. Seed values currently in use:
 * `running`, `cycling`, `rowing`, `ski_erg`, `swimming`, `rucking`,
 * `walking`, `other`.
 */
const MODALITY_DISPLAY: Record<string, string> = {
  running: "Run",
  run: "Run",
  cycling: "Bike",
  bike: "Bike",
  biking: "Bike",
  rowing: "Row",
  row: "Row",
  ski_erg: "Ski erg",
  "ski-erg": "Ski erg",
  ski: "Ski erg",
  swimming: "Swim",
  swim: "Swim",
  rucking: "Ruck",
  ruck: "Ruck",
  walking: "Walk",
  walk: "Walk",
  hiking: "Hike",
  elliptical: "Elliptical",
  stair: "Stairs",
  stairmaster: "Stairs",
  jumping_rope: "Jump rope",
  jump_rope: "Jump rope",
};

/**
 * Best-effort label from movement metadata + slug. Returns null when we
 * truly can't tell (e.g. a custom movement with no metadata + an
 * opaque slug) — the caller suppresses the chip rather than rendering
 * a generic "Other" pill that adds no signal.
 */
export function cardioModalityLabel(
  metadata: Metadata,
  slug: string | null | undefined,
): string | null {
  const m = metadata ?? {};

  const raw = String(m.modality ?? "").trim().toLowerCase();
  if (raw && MODALITY_DISPLAY[raw]) return MODALITY_DISPLAY[raw]!;

  const slugLower = (slug ?? "").toLowerCase();
  if (!slugLower) return null;

  // Slug-based fallback. Order matters: more specific tokens win
  // (ski-erg before "ski", rower before "row").
  if (/(^|[-_])ski[-_]?erg/.test(slugLower)) return "Ski erg";
  if (/(^|[-_])jump[-_]?rope/.test(slugLower)) return "Jump rope";
  if (/(^|[-_])stair/.test(slugLower)) return "Stairs";
  if (/(^|[-_])elliptical/.test(slugLower)) return "Elliptical";
  if (/(^|[-_])swim/.test(slugLower)) return "Swim";
  if (/(^|[-_])ruck/.test(slugLower)) return "Ruck";
  if (/(^|[-_])walk/.test(slugLower)) return "Walk";
  if (/(^|[-_])hike/.test(slugLower)) return "Hike";
  if (/(^|[-_])(run|treadmill|jog|sprint)/.test(slugLower)) return "Run";
  if (/(^|[-_])(bike|cycling|cycle|spin)/.test(slugLower)) return "Bike";
  if (/(^|[-_])(row|erg-row|rower)/.test(slugLower)) return "Row";

  return null;
}
