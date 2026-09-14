/**
 * /app/freshness — 16-muscle freshness body diagram.
 *
 * Previously this route was a redirect to /app/stats/engine; now it
 * serves as the dedicated read surface for the muscle grid added in
 * PR feat/muscle-grid-16. The legacy 7-region engine view stays at
 * /app/stats/engine.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getMuscleFreshness } from "@/lib/muscle/muscle-freshness";
import { MuscleGrid16 } from "@/components/muscle-grid/MuscleGrid16";
import { MetricHelp } from "@/components/ui/MetricHelp";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function FreshnessPage() {
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
  const tz = profile?.timezone ?? "UTC";

  const rows = await getMuscleFreshness(supabase, user.id, { tz });

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <PageHeader
        back={{ href: "/app", label: "Today" }}
        title={
          <>
            Muscle freshness
            <MetricHelp term="muscle_freshness" />
          </>
        }
        subtitle="Days since last load: green ≥ 4 · yellow 2–3 · red < 2 · grey no recorded load."
      />

      <section
        data-testid="freshness-grid-card"
        style={{
          padding: 16,
          border: "1px solid var(--cp-border)",
          borderRadius: 10,
          background: "var(--cp-surface)",
        }}
      >
        <MuscleGrid16 rows={rows} />
      </section>

      <footer>
        <Link
          href="/app/stats/engine"
          data-testid="freshness-engine-link"
          style={{ color: "var(--cp-accent)", fontSize: 13, textDecoration: "none" }}
        >
          Regional training load →
        </Link>
      </footer>
    </div>
  );
}
