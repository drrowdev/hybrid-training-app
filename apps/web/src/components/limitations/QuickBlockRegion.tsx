import { addLimitation } from "@/lib/limitations/actions";
import { REGIONS, REGION_LABELS, type Region } from "@/lib/settings/limitations-constants";

/**
 * Compact "block a region" control for the Limitations page.
 *
 * Replaces the old set-and-forget toggle surface (deleted with
 * /app/settings/limitations). Submitting creates a region-only
 * limitation via the shared `addLimitation` action — the same row shape
 * the planner already reads (region → blockedRegions). Severity defaults
 * to moderate; the user can refine or resolve it in the list below.
 *
 * Regions that already have an active limitation are excluded so the
 * control can't create duplicates; it hides entirely once every region
 * is covered.
 */
export function QuickBlockRegion({
  activeRegions,
}: {
  activeRegions: ReadonlyArray<string>;
}) {
  const blocked = new Set(activeRegions);
  const available = REGIONS.filter((r) => !blocked.has(r)) as Region[];
  if (available.length === 0) return null;

  return (
    <section
      className="cp-card"
      data-testid="quick-block-region"
      style={{ padding: 16, display: "grid", gap: 10 }}
    >
      <header style={{ display: "grid", gap: 2 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Quickly block a region</h2>
        <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
          Stops the engine programming around the whole region. For a specific
          injury with muscles or movements, use “Add limitation”.
        </p>
      </header>
      <form
        action={addLimitation}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
      >
        <input type="hidden" name="severity" value="moderate" />
        <label className="sr-only" htmlFor="quick-block-region-select">
          Region to block
        </label>
        <select
          id="quick-block-region-select"
          name="region"
          defaultValue={available[0]}
          style={{ minWidth: 200 }}
        >
          {available.map((r) => (
            <option key={r} value={r}>
              {REGION_LABELS[r]}
            </option>
          ))}
        </select>
        <button type="submit" className="cp-btn">
          Block region
        </button>
      </form>
    </section>
  );
}
