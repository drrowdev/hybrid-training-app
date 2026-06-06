/**
 * ADR 0031 (Phase 2) — autoregulated deload-skip: PURE logic + types.
 *
 * Kept free of I/O (no Supabase / server imports) so the eligibility gate is
 * unit-testable, mirroring the `autoreg-volume.ts` (pure) ↔ `autoreg-offer.ts`
 * (I/O) split. The I/O wrappers live in `deload-skip-offer.ts` (read) and
 * `deload-skip-actions.ts` (write).
 */
import { ARCHETYPES } from "@/lib/planner/archetypes";
import type { ArchetypeId } from "@/lib/planner/archetypes";

/** Recent logged weeks that must ALL classify as recovered to offer a skip. */
export const DELOAD_SKIP_RECOVERED_WEEKS = 2; // [DEF→cal] CP-2 — conservative

export type DeloadSkipOffer = {
  blockId: string;
  archetype: string;
  deloadWeekIndex: number;
  /** How many recent logged weeks were required to be recovered. */
  recoveredWeeks: number;
  /** Un-started deload-week sessions that would convert to loading weeks. */
  sessionCount: number;
};

/** Deload week index for a block, or null when the archetype has no deload. */
export function deloadWeekIndexFor(archetype: string, weeks: number): number | null {
  const known = ARCHETYPES[archetype as Exclude<ArchetypeId, "custom">];
  if (known) {
    const deload = known.weekProfiles.find((w) => w.intensityLabel === "Deload");
    return deload ? deload.weekIndex : null;
  }
  // Custom blocks always append the deload as the last week.
  return archetype === "custom" ? Math.max(0, weeks - 1) : null;
}

/**
 * Pure eligibility gate — the offer surfaces iff all hold:
 *   - the block has a deload week;
 *   - the user is in it or the week before;
 *   - it still has un-started, not-already-skipped sessions;
 *   - no reactive auto-deload fired this block;
 *   - the most-recent `DELOAD_SKIP_RECOVERED_WEEKS` logged weeks all recovered.
 */
export function isDeloadSkipEligible(args: {
  deloadWeekIndex: number | null;
  currentWeekIndex: number;
  skippableSessionCount: number;
  reactiveDeloadCount: number;
  /** `isRecovered` flags for logged weeks, most-recent-first. */
  recentLoggedRecovered: readonly boolean[];
}): boolean {
  if (args.deloadWeekIndex == null) return false;
  if (args.currentWeekIndex < args.deloadWeekIndex - 1) return false;
  if (args.skippableSessionCount === 0) return false;
  if (args.reactiveDeloadCount > 0) return false;
  if (args.recentLoggedRecovered.length < DELOAD_SKIP_RECOVERED_WEEKS) return false;
  return args.recentLoggedRecovered.slice(0, DELOAD_SKIP_RECOVERED_WEEKS).every(Boolean);
}
