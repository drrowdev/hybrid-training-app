import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  saveOnboardingProfile,
  saveOnboardingTms,
  finishOnboarding,
  skipOnboarding,
} from "@/lib/onboarding/actions";
import { updateEquipmentV2 } from "@/lib/settings/equipment-actions";
import { OnboardingWizard, type RoleCandidates } from "@/components/onboarding/OnboardingWizard";
import {
  STRENGTH_ROLE_CANDIDATES,
  STRENGTH_ROLE_LABELS,
  type StrengthRole,
} from "@/lib/planner/archetypes";
import { needsOnboarding } from "@/lib/onboarding/gate";
import { resolveEquipment } from "@/lib/settings/equipment-presets";

const MAIN_ROLES: StrengthRole[] = ["squat", "horizontal_press", "deadlift", "vertical_press"];

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { count: tmCount }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "display_name, units, bodyweight_kg, onboarded_at, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg",
      )
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("training_maxes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  // If the user is already done, don't trap them in onboarding.
  if (
    !needsOnboarding({
      hasAnyTm: (tmCount ?? 0) > 0,
      onboardedAt: profile?.onboarded_at ?? null,
    })
  ) {
    redirect("/app");
  }

  // Catalog: every candidate movement for the four main roles, so the
  // wizard can render the same per-role variant picker the Settings →
  // Training maxes page uses.
  const allSlugs = MAIN_ROLES.flatMap((r) => STRENGTH_ROLE_CANDIDATES[r]);
  const { data: movements } = await supabase
    .from("movements")
    .select("id, slug, display_name")
    .in("slug", allSlugs)
    .is("user_id", null);
  const movementBySlug = new Map((movements ?? []).map((m) => [m.slug, m]));

  const roleCandidates: RoleCandidates[] = MAIN_ROLES.map((role) => ({
    role,
    label: STRENGTH_ROLE_LABELS[role],
    candidates: STRENGTH_ROLE_CANDIDATES[role]
      .map((slug) => movementBySlug.get(slug))
      .filter((m): m is { id: string; slug: string; display_name: string } => !!m)
      .map((m) => ({ slug: m.slug, displayName: m.display_name })),
  }));

  const hasEquipmentRow = profile?.equipment != null && typeof profile.equipment === "object";
  const initialEquipment = resolveEquipment(profile ?? null);

  return (
    <OnboardingWizard
      initialDisplayName={profile?.display_name ?? ""}
      initialUnits={(profile?.units as "metric" | "imperial") ?? "metric"}
      initialBodyweightKg={profile?.bodyweight_kg ? Number(profile.bodyweight_kg) : null}
      initialEquipment={initialEquipment}
      hasEquipmentRow={hasEquipmentRow}
      roleCandidates={roleCandidates}
      saveProfileAction={saveOnboardingProfile}
      saveEquipmentAction={updateEquipmentV2}
      saveTmsAction={saveOnboardingTms}
      finishAction={finishOnboarding}
      skipAction={skipOnboarding}
    />
  );
}
