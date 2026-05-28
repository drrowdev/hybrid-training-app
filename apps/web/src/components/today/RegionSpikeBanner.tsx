import { REGION_LABELS, type Region } from "@/lib/settings/limitations-constants";
import type { RegionSpike } from "@/lib/engine/region-spike-detector";

/**
 * Soft, read-only Today-page warning when one or more body regions are
 * carrying acutely higher load than the user's own 4-week baseline.
 *
 * Behaviour
 * ─────────
 *  - `spikes` empty → renders nothing (no DOM).
 *  - 1+ spike → renders a single warning line for the WORST region
 *    (largest `spikePct`). Any additional spiking regions are listed
 *    on the `title` attribute for hover, so the banner stays one line.
 *
 * Important: this is informational only. No prescription change, no
 * planner mutation, no enforcement. The user can ignore it.
 *
 * Threshold lives in `region-spike-detector.ts` (CP-3 heuristic, 25%).
 */
export function RegionSpikeBanner({ spikes }: { spikes: ReadonlyArray<RegionSpike> }) {
  if (spikes.length === 0) return null;
  const worst = spikes[0]!;
  const rest = spikes.slice(1);
  const worstLabel = friendlyRegion(worst.region);
  const worstPct = Math.round(worst.spikePct * 100);

  const titleAttr =
    rest.length > 0
      ? `Other regions above baseline: ${rest
          .map((s) => `${friendlyRegion(s.region)} +${Math.round(s.spikePct * 100)}%`)
          .join(", ")}`
      : undefined;

  return (
    <div
      data-testid="region-spike-banner"
      role="status"
      title={titleAttr}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        border: "1px solid var(--cp-warning)",
        background: "color-mix(in srgb, var(--cp-warning) 10%, transparent)",
        borderRadius: 10,
        fontSize: 13,
        color: "var(--cp-text)",
      }}
    >
      <span aria-hidden style={{ fontSize: 14 }}>⚠️</span>
      <span>
        Your <strong>{worstLabel}</strong> load is up <strong>{worstPct}%</strong> this week —
        consider holding pace.
      </span>
    </div>
  );
}

function friendlyRegion(region: string): string {
  if (region in REGION_LABELS) return REGION_LABELS[region as Region];
  return region;
}
