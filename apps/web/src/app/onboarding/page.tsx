import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  saveOnboardingProfile,
  saveOnboardingTms,
  finishOnboarding,
  skipOnboarding,
} from "@/lib/onboarding/actions";
import { submitBwAssessment } from "@/lib/onboarding/bw-assessment";
import { updateEquipmentV2 } from "@/lib/settings/equipment-actions";
import {
  connectStrava,
  importStravaHistoryAction,
} from "@/lib/integrations/strava/actions";
import { OnboardingWizard, STEPS, type RoleCandidates } from "@/components/onboarding/OnboardingWizard";
import {
  STRENGTH_ROLE_CANDIDATES,
  STRENGTH_ROLE_LABELS,
  type StrengthRole,
} from "@/lib/planner/archetypes";
import { needsOnboarding } from "@/lib/onboarding/gate";
import { resolveEquipment } from "@/lib/settings/equipment-presets";

const MAIN_ROLES: StrengthRole[] = ["squat", "horizontal_press", "deadlift", "vertical_press"];

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { count: tmCount }, { data: stravaConnection }] = await Promise.all([
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
    supabase
      .from("strava_connections")
      .select("athlete_id")
      .eq("user_id", user.id)
      .maybeSingle(),
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

  const stravaIsConfigured =
    Boolean(process.env.STRAVA_CLIENT_ID) &&
    Boolean(process.env.STRAVA_CLIENT_SECRET) &&
    Boolean(process.env.STRAVA_REDIRECT_URI);

  // When the OAuth callback bounces back here it appends
  // `?strava_connected=1`. Jump the wizard straight to the Strava
  // step so the import UI is the first thing the user sees on
  // return — their block setup is preserved in the DB by prior
  // steps, but the in-memory `wizardSubmit` is gone, so we still
  // need to walk back through "Build your block" before Confirm.
  // Landing on the Strava step keeps the UX continuous and avoids
  // dumping the user back at Welcome.
  const justConnectedStrava = params.strava_connected === "1";
  const initialStep = justConnectedStrava ? STEPS.indexOf("Connect Strava") : undefined;

  return (
    <OnboardingWizard
      initialDisplayName={profile?.display_name ?? ""}
      initialUnits={(profile?.units as "metric" | "imperial") ?? "metric"}
      initialBodyweightKg={profile?.bodyweight_kg ? Number(profile.bodyweight_kg) : null}
      initialEquipment={initialEquipment}
      hasEquipmentRow={hasEquipmentRow}
      roleCandidates={roleCandidates}
      initialStravaConnected={Boolean(stravaConnection)}
      stravaIsConfigured={stravaIsConfigured}
      initialStep={initialStep}
      saveProfileAction={saveOnboardingProfile}
      saveEquipmentAction={updateEquipmentV2}
      saveTmsAction={saveOnboardingTms}
      submitBwAssessmentAction={submitBwAssessment}
      connectStravaAction={connectStrava}
      importStravaHistoryAction={importStravaHistoryAction}
      finishAction={finishOnboarding}
      skipAction={skipOnboarding}
    />
  );
}
