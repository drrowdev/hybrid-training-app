import Link from "next/link";
import {
  freshnessColor,
  freshnessPct,
  getRegionFreshness,
  type FreshnessRow,
} from "@/lib/engine/freshness";

/**
 * Compact region-freshness widget for the /app home page.
 * Shows the 3 most-loaded regions; "see all" links to /app/freshness.
 */
export async function FreshnessWidget() {
  const rows = await getRegionFreshness();
  const hasData = rows.length > 0 && rows.some((r) => r.atl > 0 || r.ctl > 0);

  return (
    <section className="rounded-lg border border-foreground/10 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-base font-medium">Region freshness</h2>
          <p className="text-xs text-foreground/60">
            How loaded each region is right now (DC-C14).
          </p>
        </div>
        <Link
          href="/app/freshness"
          className="text-xs text-foreground/50 hover:text-foreground"
        >
          see all →
        </Link>
      </div>

      {!hasData && (
        <p className="text-sm text-foreground/50">
          No data yet. Log a session and mark it complete — freshness updates
          on session completion.
        </p>
      )}

      {hasData && (
        <ul className="space-y-2">
          {rows.slice(0, 3).map((r) => (
            <Bar key={r.region} row={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Bar({ row }: { row: FreshnessRow }) {
  const pct = Math.round(row.freshness * 100);
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span>{row.label}</span>
        <span className="font-mono text-xs text-foreground/60">
          {freshnessPct(row.freshness)}
          {row.lastLoadDate && ` · last load ${row.lastLoadDate}`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-foreground/5 overflow-hidden">
        <div
          className={`h-full ${freshnessColor(row.freshness)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}
