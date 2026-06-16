/**
 * F1 — program-aware staples-first ranking for the FOREIGN accessory/assistance
 * injectors (5/3/1, Tactical Barbell, Green Protocol).
 *
 * The foreign injectors used to rotate UNIFORMLY over their eligible pool, so a
 * niche variant (a Meadows / Kroc row, an archer pull-up) was as likely as a
 * universal staple (a chin-up / DB row / cable row). This module replaces that
 * with a gentle bias toward the more FOUNDATIONAL movement, while a per-candidate
 * deterministic jitter still rotates among equally-foundational movements so the
 * same staple isn't nailed every session.
 *
 * Signal — `experienceMin`. The catalog's `stim_to_fatigue_score` is unpopulated,
 * but the experience band already encodes "how niche/advanced a variant is": the
 * universal staples (chin-up, pull-up, BB/DB/cable rows, lat-pulldown, standard
 * curls) sit at `experienceMin = 0`, while the niche variants (Meadows / Kroc row,
 * archer / weighted pull-up, ring dip, paused/Olympic work) sit at
 * `experienceMin >= 2`. Ranking toward the lower band therefore keeps the
 * bread-and-butter movements in the rotation and lets niche variants surface only
 * as the occasional dedup fallback.
 *
 * SCOPE — SELECTION ONLY, and LOADING-NEUTRAL. This decides *which* movement fills
 * a slot. It never touches loading / sets / reps / intensity, which stay engine-
 * owned and program-specific (5/3/1 = 25-50 reps submaximal, TB = 8-15 near
 * failure). Because the signal is the experience band - NOT loadability - it
 * deliberately prefers the bodyweight chin-up (`experienceMin 0`) over the
 * *weighted* pull-up (`experienceMin 2`): a higher experience tier only UNLOCKS
 * movements (the Part B/O2 unlock floor), it never makes a session heavier. This
 * is the explicit anti-requirement vs. the Hybrid generator's ADR-0041
 * "advanced -> prefer the loaded variant", which is NOT ported here. See
 * f1-program-aware-ranking-design.md.
 *
 * Pure: deterministic in (candidates, seed). No DB, no React.
 */
import type { CatalogMovement } from "@/lib/planner/accessory-picker";

/**
 * Foundational-bias weight (CP-1 heuristic). The per-candidate jitter is in
 * [0, 1), so this is the score penalty applied PER experience-band step a
 * movement sits above the most foundational (`experienceMin 0`). At 0.6 a step
 * of 2 (the staple->niche gap, band 0 vs 2) is 1.2 - larger than the jitter range
 * - so a foundational staple reliably out-ranks a niche variant, while among
 * equally-foundational movements selection is pure rotation. Tunable against the
 * golden-output review; revisit with logged selection data.
 */
export const FOREIGN_FOUNDATIONAL_BONUS = 0.6;

// Integer bit-mix mirroring the injectors' own `mixSeed`, for stable rotation.
function mixSeed(seed: number): number {
  let x = seed | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return x < 0 ? x + 0x100000000 : x;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/** Deterministic per-candidate jitter in [0, 1). */
function jitter01(seed: string): number {
  return mixSeed(hashString(seed)) / 0x100000000;
}

/**
 * Pick one movement from `candidates`, biased toward the more FOUNDATIONAL
 * movement (lower `experienceMin`) while a per-candidate jitter rotates among
 * equally-foundational picks. Lowest score wins. Returns `undefined` for an empty
 * list. Selection only - never inspects or changes loading/intensity.
 */
export function pickValueBiased<T extends CatalogMovement>(
  candidates: readonly T[],
  seed: string,
): T | undefined {
  let best: T | undefined;
  let bestScore = Infinity;
  for (const m of candidates) {
    const band = m.experienceMin ?? 0;
    const score = FOREIGN_FOUNDATIONAL_BONUS * band + jitter01(`${seed}:${m.slug}`);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}
