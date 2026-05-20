import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createBlock } from "@/lib/planner/actions";
import {
  ARCHETYPES,
  STRENGTH_ROLE_LABELS,
  type StrengthRole,
} from "@/lib/planner/archetypes";
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

  const tmCtx = await getTrainingMaxContext();

  // Build a slug → role index across all archetypes so we can detect "user has a TM for some candidate".
  const allCandidateSlugs = new Set<string>();
  for (const a of Object.values(ARCHETYPES)) {
    for (const day of a.days) {
      if (day.kind === "strength") day.candidateSlugs.forEach((s) => allCandidateSlugs.add(s));
    }
  }

  const options: ArchetypeOption[] = Object.values(ARCHETYPES).map((a) => {
    // For each strength role the archetype needs, check if any candidate slug has a TM.
    const rolesNeeded = new Map<StrengthRole, { satisfied: boolean; chosen?: string }>();
    for (const day of a.days) {
      if (day.kind !== "strength") continue;
      const chosen = day.candidateSlugs.find((s) => tmCtx.bySlug.has(s));
      const existing = rolesNeeded.get(day.role);
      if (!existing) {
        rolesNeeded.set(day.role, {
          satisfied: !!chosen,
          chosen: chosen ?? undefined,
        });
      } else if (chosen && !existing.satisfied) {
        rolesNeeded.set(day.role, { satisfied: true, chosen });
      }
    }
    const missingRoles = Array.from(rolesNeeded.entries())
      .filter(([, v]) => !v.satisfied)
      .map(([role]) => STRENGTH_ROLE_LABELS[role]);
    const chosenLifts = Array.from(rolesNeeded.entries())
      .filter(([, v]) => v.satisfied && v.chosen)
      .map(([role, v]) => {
        // pretty display: look up the movement display name from the TM context.
        const row = tmCtx.rows.find((r) => r.movementSlug === v.chosen);
        return {
          role: STRENGTH_ROLE_LABELS[role],
          movement: row?.movementName ?? v.chosen!,
        };
      });
    return {
      id: a.id,
      name: a.name,
      oneLiner: a.oneLiner,
      weeks: a.weeks,
      daysCount: a.days.length,
      weekLabels: a.weekProfiles.map((w) => w.intensityLabel),
      tmReady: missingRoles.length === 0,
      missingRoles,
      chosenLifts,
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
          Pick an archetype. The planner uses whichever lift <em>variant</em> you&apos;ve set a TM for
          (back squat, front squat, trap-bar deadlift, push press — your choice per role).
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
