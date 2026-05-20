import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createBlock } from "@/lib/planner/actions";
import {
  ARCHETYPES,
  STRENGTH_ROLE_LABELS,
  daysForFrequency,
  minDaysForArchetype,
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("training_days_per_week")
    .eq("id", user.id)
    .maybeSingle();
  const defaultDaysPerWeek = Number(profile?.training_days_per_week ?? 4);

  const options: ArchetypeOption[] = Object.values(ARCHETYPES).map((a) => {
    const minDays = minDaysForArchetype(a);
    const maxDays = a.days.length;

    // Resolve strength roles using the user's chosen variant.
    const rolesNeeded = new Map<StrengthRole, { satisfied: boolean; chosen?: string }>();
    for (const day of a.days) {
      if (day.kind !== "strength") continue;
      const chosen = day.candidateSlugs.find((s) => tmCtx.bySlug.has(s));
      const existing = rolesNeeded.get(day.role);
      if (!existing) {
        rolesNeeded.set(day.role, { satisfied: !!chosen, chosen: chosen ?? undefined });
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
      minDays,
      maxDays,
      weekLabels: a.weekProfiles.map((w) => w.intensityLabel),
      tmReady: missingRoles.length === 0,
      missingRoles,
      chosenLifts,
    };
  });

  // Build a preview of which days run at each frequency so the wizard can
  // show "5 d/wk → 4 strength + 1 cardio" style labels.
  const dayPreviewByArchetype = Object.fromEntries(
    Object.values(ARCHETYPES).map((a) => {
      const previews: Record<number, { strength: number; cardio: number }> = {};
      for (let d = minDaysForArchetype(a); d <= a.days.length; d++) {
        const active = daysForFrequency(a, d);
        previews[d] = {
          strength: active.filter((x) => x.kind === "strength").length,
          cardio: active.filter((x) => x.kind === "cardio").length,
        };
      }
      return [a.id, previews];
    }),
  );

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <Link href="/app/plan" style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}>
          ← plan
        </Link>
        <h1 style={{ fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>Start a block</h1>
        <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          Pick how many days you can train this block, then pick an archetype. The planner
          uses whichever lift <em>variant</em>{" "}
          you&apos;ve set a TM for (back squat, front squat, trap-bar deadlift, push press —
          your choice per role).
        </p>
      </header>

      <ArchetypePicker
        options={options}
        defaultStartedOn={todayYmd()}
        defaultDaysPerWeek={defaultDaysPerWeek}
        dayPreviewByArchetype={dayPreviewByArchetype}
        action={createBlock}
      />

      <section
        className="cp-card"
        style={{
          padding: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>None of these fit?</div>
          <div style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 2 }}>
            Build a custom block day-by-day from the same primitives the presets use.
          </div>
        </div>
        <Link href="/app/plan/new/custom" className="cp-btn">
          Build a custom block →
        </Link>
      </section>
    </div>
  );
}
