/**
 * /app/stats/adherence — Phase 4 adherence dashboard.
 *
 * Five sections, mobile-first stack:
 *
 *   A1 Weekly completion — stacked bars per ISO week (logged / skipped /
 *      missed). Headline chart. Subtitle pins the methodology rule that
 *      "skipped counts as missed" for the running % we surface to the
 *      right of each bar.
 *   A2 Weekday breakdown — 7 columns Mon-Sun, each showing the weekday
 *      completion % (color-coded ≥80 / 50-79 / <50) and a stacked mini
 *      bar in absolute counts.
 *   A3 Per-archetype completion — sorted by block count desc.
 *   A4 Skip notes — last 10 skipped sessions surfaced with the planned
 *      title (`planned_sessions` has no per-skip note column today so
 *      we render the "without notes" fallback the brief calls out).
 *   A5 Streaks — current + longest, computed by `computeStreaks`.
 *
 * Range toggle differs from Phase 1-3 on purpose: adherence buckets are
 * more natural in weeks (12w / 26w / all). The parser
 * (`parseAdherenceRange`) lives next to the data helpers so the
 * convention stays local to this surface.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import {
  getAdherenceDashboard,
} from "@/lib/stats/adherence-detail";
import { getAdherenceForWindow } from "@/lib/stats/adherence";
import {
  parseAdherenceRange,
  type AdherenceRange,
} from "@/lib/stats/adherence-range";
import {
  AdherenceRangeView,
  type AdherenceByRange,
} from "@/components/stats/AdherenceRangeView";
import { AdherenceBreakdownCard } from "@/components/stats/AdherenceBreakdownCard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function StatsAdherencePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const params = await searchParams;
  const range = parseAdherenceRange(params.range);

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const tz = profile?.timezone ?? (await getUserTimezone(user.id));

  // Pre-fetch the dashboard for every range in one Promise.all so the
  // client toggle flips locally. Audit F3 measured 1.3–1.4s per click
  // under the old `<Link href="?range=…">` pattern.
  const RANGES: AdherenceRange[] = ["12w", "26w", "all"];
  const [d12w, d26w, dAll, breakdown] = await Promise.all([
    getAdherenceDashboard(supabase, user.id, tz, "12w"),
    getAdherenceDashboard(supabase, user.id, tz, "26w"),
    getAdherenceDashboard(supabase, user.id, tz, "all"),
    getAdherenceForWindow(supabase, user.id, tz, null),
  ]);
  void RANGES;

  const byRange: AdherenceByRange = {
    "12w": d12w,
    "26w": d26w,
    all: dAll,
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <PageHeader
        back={{ href: "/app/stats", label: "Stats" }}
        title="Consistency"
        subtitle="Sessions completed vs planned, the weekdays you train best, and how skipped sessions accumulate. Skipped counts as missed for every % we report."
      />

      {/* Range toggle + range-dependent cards are client-owned so
          flipping range is a state swap instead of a 1.3–1.4s server
          round-trip (audit F3). */}
      <AdherenceRangeView initialRange={range} byRange={byRange} />

      <AdherenceBreakdownCard result={breakdown} />

      <footer
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 12,
          marginTop: 4,
        }}
      >
        <Link
          href="/app/stats/blocks"
          data-testid="stats-adherence-blocks-link"
          style={{ color: "var(--cp-accent)", fontSize: 13, textDecoration: "none" }}
        >
          View block analytics →
        </Link>
      </footer>
    </div>
  );
}
