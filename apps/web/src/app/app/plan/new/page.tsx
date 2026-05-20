import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createBlock } from "@/lib/planner/actions";
import { ARCHETYPES, requiredLiftSlugs } from "@/lib/planner/archetypes";
import { todayYmd } from "@/lib/planner/queries";
import { getTrainingMaxContext } from "@/lib/training-maxes/queries";
import {
  ArchetypePicker,
  type ArchetypeOption,
} from "@/components/planner/ArchetypePicker";

export default async function NewBlockPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Resolve display names for every slug used as a strength lift across all archetypes.
  const allLiftSlugs = Array.from(
    new Set(Object.values(ARCHETYPES).flatMap((a) => requiredLiftSlugs(a))),
  );
  const { data: liftMovements } = await supabase
    .from("movements")
    .select("id, slug, display_name")
    .in("slug", allLiftSlugs)
    .is("user_id", null);

  const liftBySlug = new Map((liftMovements ?? []).map((m) => [m.slug, m]));
  const tmCtx = await getTrainingMaxContext();

  const options: ArchetypeOption[] = Object.values(ARCHETYPES).map((a) => {
    const lifts = requiredLiftSlugs(a);
    const missing = lifts
      .filter((slug) => !tmCtx.bySlug.has(slug))
      .map((slug) => liftBySlug.get(slug)?.display_name ?? slug);
    return {
      id: a.id,
      name: a.name,
      oneLiner: a.oneLiner,
      weeks: a.weeks,
      daysCount: a.days.length,
      weekLabels: a.weekProfiles.map((w) => w.intensityLabel),
      tmReady: missing.length === 0,
      missingLifts: missing,
    };
  });

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <Link href="/app/plan" style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}>
          ← plan
        </Link>
        <h1 style={{ fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>Start a block</h1>
        <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          Pick an archetype that matches your current priority. The planner generates 4 weeks of sessions
          with concrete prescriptions; you log what you actually do.
        </p>
      </header>

      <ArchetypePicker
        options={options}
        defaultStartedOn={todayYmd()}
        action={createBlock}
      />
    </div>
  );
}
