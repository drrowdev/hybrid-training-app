import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  upsertTrainingMax,
  deleteTrainingMax,
  setDefaultTmPercent,
  lockTrainingMaxAsEntered,
} from "@/lib/training-maxes/actions";
import { getTmSourceSet, getTrainingMaxContext, type TmSourceSet } from "@/lib/training-maxes/queries";
import {
  ARCHETYPES,
  STRENGTH_ROLE_LABELS,
  STRENGTH_ROLE_CANDIDATES,
  type StrengthRole,
} from "@/lib/planner/archetypes";
import { getActiveBlock } from "@/lib/planner/queries";
import {
  hasLoadableMainLift,
  resolveEquipment,
} from "@/lib/settings/equipment-presets";
import { TmSection, type PickerGroup, type RoleGroupInput } from "@/components/training-maxes/TmSection";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricHelp } from "@/components/ui/MetricHelp";
import Link from "next/link";
export default async function TrainingMaxesPage() {
  const supabase = await createClient();
  const ctx = await getTrainingMaxContext();
  const existingMovementIds = new Set(ctx.rows.map((r) => r.movementId));

  const {
    data: { user },
  } = await getAuthUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("equipment, barbell_kg, trap_bar_kg, plate_inventory_kg")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };
  const equipment = resolveEquipment(profile);
  const bodyweightOnly = !hasLoadableMainLift(equipment);

  const block = await getActiveBlock();
  const archetype = block ? ARCHETYPES[block.archetype as keyof typeof ARCHETYPES] : undefined;
  const requiredRoles: StrengthRole[] = archetype
    ? Array.from(
        new Set(
          archetype.days
            .filter((d) => d.kind === "strength")
            .map((d) => (d as { role: StrengthRole }).role),
        ),
      )
    : (["squat", "horizontal_press", "deadlift", "vertical_press"] as StrengthRole[]);

  const allCandidateSlugs = Array.from(
    new Set(requiredRoles.flatMap((r) => STRENGTH_ROLE_CANDIDATES[r] ?? [])),
  );
  const { data: candidateMovements } = await supabase
    .from("movements")
    .select("id, slug, display_name, pattern")
    .in("slug", allCandidateSlugs)
    .is("user_id", null);
  const candidateBySlug = new Map((candidateMovements ?? []).map((m) => [m.slug, m]));

  const requiredGroups: RoleGroupInput[] = await Promise.all(
    requiredRoles.map(async (role) => {
      const candidates = STRENGTH_ROLE_CANDIDATES[role]
        .map((slug) => candidateBySlug.get(slug))
        .filter((m): m is { id: string; slug: string; display_name: string; pattern: string } => !!m)
        .map((m) => ({ id: m.id, slug: m.slug, display_name: m.display_name }));
      const setRow = ctx.rows.find((r) => STRENGTH_ROLE_CANDIDATES[role].includes(r.movementSlug));
      const setRowSourceSet = setRow ? await getTmSourceSet(setRow) : null;
      return {
        role,
        label: STRENGTH_ROLE_LABELS[role],
        candidates,
        setRow,
        setRowSourceSet,
      };
    }),
  );

  const requiredSlugSet = new Set(requiredGroups.flatMap((g) => g.candidates.map((c) => c.slug)));
  const otherRows = ctx.rows.filter((r) => !requiredSlugSet.has(r.movementSlug));
  const otherRowSourceSets: Record<string, TmSourceSet | null> = {};
  await Promise.all(
    otherRows.map(async (r) => {
      otherRowSourceSets[r.id] = await getTmSourceSet(r);
    }),
  );

  const { data: compounds } = await supabase
    .from("movements")
    .select("id, slug, display_name, pattern")
    .eq("is_compound", true)
    .is("user_id", null)
    .order("pattern")
    .order("display_name")
    .limit(120);

  const patternLabels: Record<string, string> = {
    squat: "Squat patterns",
    hinge: "Hinge / deadlift patterns",
    press: "Press patterns",
    pull: "Pull patterns",
    carry: "Carries",
    olympic: "Olympic lifts",
  };

  const grouped = new Map<string, { id: string; display_name: string }[]>();
  for (const m of compounds ?? []) {
    if (existingMovementIds.has(m.id)) continue;
    const arr = grouped.get(m.pattern) ?? [];
    arr.push({ id: m.id, display_name: m.display_name });
    grouped.set(m.pattern, arr);
  }
  const pickerGroups: PickerGroup[] = Array.from(grouped.entries()).map(([pattern, items]) => ({
    label: patternLabels[pattern] ?? pattern,
    items,
  }));

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <PageHeader
        back={{ href: "/app/settings", label: "Settings" }}
        title="Training maxes"
      />
      {bodyweightOnly ? (
        <p
          data-testid="training-maxes-bodyweight-note"
          style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 14, lineHeight: 1.55 }}
        >
          Training maxes are 1-rep estimates for your main lifts. You&apos;re on a
          bodyweight-only setup, so there&apos;s no main lift to attach a number to yet.
          If you add a barbell or dumbbells in{" "}
          <Link href="/app/settings/equipment" style={{ color: "var(--cp-accent)" }}>
            Settings → Equipment
          </Link>{" "}
          later, this page becomes useful again.
        </p>
      ) : (
        <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 14 }}>
          Enter your 1RM for each main lift. The app applies a default TM% to compute the
          working <em>training max</em>
          <MetricHelp term="training_max" variant="why" placement="bottom" />{" "}
          used by the planner. Pick whichever variant of squat,
          bench, deadlift, or overhead press you actually train — back squat, front squat,
          trap-bar deadlift, push press, etc. are all valid.
        </p>
      )}

      <TmSection
        initialDefaultPercent={ctx.defaultPercent}
        requiredGroups={requiredGroups}
        otherRows={otherRows}
        otherRowSourceSets={otherRowSourceSets}
        pickerGroups={pickerGroups}
        hasActiveBlock={!!archetype}
        upsertAction={upsertTrainingMax}
        setDefaultAction={setDefaultTmPercent}
        deleteAction={deleteTrainingMax}
        lockAction={lockTrainingMaxAsEntered}
      />
    </div>
  );
}
