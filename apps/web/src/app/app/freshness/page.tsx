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
import { createClient } from "@/lib/supabase/server";
import { getMuscleFreshness } from "@/lib/muscle/muscle-freshness";
import { MuscleGrid16 } from "@/components/muscle-grid/MuscleGrid16";

export const dynamic = "force-dynamic";

export default async function FreshnessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
      <header>
        <Link
          href="/app"
          data-testid="freshness-back"
          style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
        >
          ← today
        </Link>
        <h1 style={{ fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          Muscle freshness
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          16-muscle resolution. Green ≥ 4 days fresh · yellow 2–3 days
          · red &lt; 2 days · grey not yet trained. Hover a muscle for
          the last movements that loaded it.
        </p>
      </header>

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
          View 7-region engine state →
        </Link>
      </footer>
    </div>
  );
}
