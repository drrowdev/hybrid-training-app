/**
 * Settings index — Training maxes + Bodyweight progression cards.
 *
 * Pure presentational component split out of `page.tsx` so the
 * card-visibility logic is renderable in unit tests without spinning
 * up the full Supabase server-component pipeline.
 *
 * Visibility rules (mirrored in the test suite):
 *   - `isBodyweightOnly`               → only the BW progression card.
 *   - not BW-only, no `bw_progress`    → only the Training maxes card.
 *   - not BW-only, has `bw_progress`   → both cards (mixed users who
 *                                         completed the BW assessment
 *                                         before switching kit).
 *
 * Markup matches the surrounding `/app/settings` cards: same
 * `<section>` wrapper, same Tailwind utility classes, same
 * right-edge "→" affordance.
 */
import Link from "next/link";
import type { ReactElement } from "react";

export function TrainingProgressionCards({
  isBodyweightOnly,
  hasBwProgress,
}: {
  isBodyweightOnly: boolean;
  hasBwProgress: boolean;
}): ReactElement {
  const showTrainingMaxes = !isBodyweightOnly;
  const showBwProgression = isBodyweightOnly || hasBwProgress;

  return (
    <>
      {showTrainingMaxes && (
        <section className="space-y-3" data-testid="settings-training-maxes-card">
          <h2 className="text-lg font-medium">1-rep maxes</h2>
          <p className="text-xs text-foreground/60">
            Your 1RM per main lift. Your active program uses these to set your
            working weights.
          </p>
          <Link
            href="/app/settings/training-maxes"
            className="inline-flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 w-full hover:bg-foreground/5"
          >
            <span className="text-sm">Manage 1-rep maxes</span>
            <span className="text-xs text-foreground/60">→</span>
          </Link>
        </section>
      )}

      {showBwProgression && (
        <section className="space-y-3" data-testid="settings-bw-progression-card">
          <h2 className="text-lg font-medium">Bodyweight progression</h2>
          <p className="text-xs text-foreground/60">
            Your current level per family, accumulated time under tension, recent
            progressions, and recommendations. Tap to review or adjust.
          </p>
          <Link
            href="/app/settings/bodyweight-progression"
            data-testid="settings-bw-progression-link"
            className="inline-flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 w-full hover:bg-foreground/5"
          >
            <span className="text-sm">Bodyweight progression</span>
            <span className="text-xs text-foreground/60">View →</span>
          </Link>
        </section>
      )}
    </>
  );
}
