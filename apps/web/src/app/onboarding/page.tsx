import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { completeOnboarding, skipOnboarding } from "@/lib/onboarding/actions";
import { OnboardingWizard, type RoleCandidates } from "@/components/onboarding/OnboardingWizard";
import { STRENGTH_ROLE_CANDIDATES, STRENGTH_ROLE_LABELS, type StrengthRole } from "@/lib/planner/archetypes";

const MAIN_ROLES: StrengthRole[] = ["squat", "horizontal_press", "deadlift", "vertical_press"];

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, units, training_days_per_week, allows_two_a_days, onboarded_at")
    .eq("id", user.id)
    .maybeSingle();

  // Already onboarded? Skip the wizard and send them straight to the app.
  if (profile?.onboarded_at) redirect("/app");

  // Pull every candidate movement for the four main roles so the wizard can
  // offer the same per-role dropdown the Settings → Training maxes page does.
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

  return (
    <OnboardingWizard
      initialDisplayName={profile?.display_name ?? ""}
      initialUnits={(profile?.units as "metric" | "imperial") ?? "metric"}
      initialDaysPerWeek={Number(profile?.training_days_per_week ?? 4)}
      initialAllowsTwoADays={Boolean(profile?.allows_two_a_days ?? false)}
      roleCandidates={roleCandidates}
      completeAction={completeOnboarding}
      skipAction={skipOnboarding}
    />
  );
}
