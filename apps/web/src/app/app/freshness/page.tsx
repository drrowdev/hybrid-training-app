import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { recomputeRegionStateAction } from "@/lib/sessions/actions";
import {
  freshnessColor,
  freshnessPct,
  getRegionFreshness,
} from "@/lib/engine/freshness";

export default async function FreshnessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rows = await getRegionFreshness();
  const hasData = rows.some((r) => r.atl > 0 || r.ctl > 0);

  return (
    <main className="min-h-screen px-6 py-8 max-w-2xl mx-auto space-y-6">
      <header className="space-y-1">
        <Link href="/app" className="text-xs text-foreground/50 hover:text-foreground">
          ← back
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Region freshness</h1>
        <p className="text-xs text-foreground/60">
          Each region&apos;s current load relative to its 28-day baseline (DC-C14).
          1.0 = fully fresh, 0.0 = heavily loaded recently.
        </p>
      </header>

      {!hasData ? (
        <section className="rounded-lg border border-foreground/10 p-6 text-center space-y-3">
          <p className="text-sm text-foreground/70">
            No region data yet. Log a session and mark it complete — freshness
            materialises on session completion.
          </p>
          <form action={recomputeRegionStateAction}>
            <button
              type="submit"
              className="rounded-md border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5"
            >
              Recompute now
            </button>
          </form>
        </section>
      ) : (
        <>
          <ul className="space-y-3">
            {rows.map((r) => {
              const pct = Math.round(r.freshness * 100);
              return (
                <li key={r.region} className="rounded-lg border border-foreground/10 p-4 space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">{r.label}</span>
                    <span className="font-mono text-xs text-foreground/60">
                      {freshnessPct(r.freshness)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-foreground/5 overflow-hidden">
                    <div
                      className={`h-full ${freshnessColor(r.freshness)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-xs text-foreground/50 flex flex-wrap gap-x-4 gap-y-1 font-mono">
                    <span>ATL {r.atl.toFixed(1)}</span>
                    <span>CTL {r.ctl.toFixed(1)}</span>
                    <span>baseline {r.baseline.toFixed(1)}</span>
                    {r.lastLoadDate && <span>last {r.lastLoadDate}</span>}
                  </div>
                </li>
              );
            })}
          </ul>

          <details className="text-xs text-foreground/50">
            <summary className="cursor-pointer hover:text-foreground">
              What do these numbers mean?
            </summary>
            <div className="mt-3 space-y-2">
              <p>
                <strong>ATL</strong> (acute training load) — 7-day EWMA of
                region-attributed session load. How loaded the region is right
                now.
              </p>
              <p>
                <strong>CTL</strong> (chronic training load) — 28-day EWMA.
                The region&apos;s rolling tolerance.
              </p>
              <p>
                <strong>Baseline</strong> — currently set to CTL × 1.0 as a
                cold-start proxy per DC-C9. Will become the median of the last
                3 recovered weeks once the recovered-week qualification ships
                (Phase 2).
              </p>
              <p>
                <strong>Freshness</strong> = clamp(1 − ATL / baseline, 0, 1).
              </p>
            </div>
          </details>

          <form action={recomputeRegionStateAction}>
            <button
              type="submit"
              className="text-xs text-foreground/50 hover:text-foreground"
            >
              Recompute from logged sessions
            </button>
          </form>
        </>
      )}
    </main>
  );
}
