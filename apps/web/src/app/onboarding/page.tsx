import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { completeOnboarding, skipOnboarding } from "@/lib/onboarding/actions";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, units, training_days_per_week, onboarded_at")
    .eq("id", user.id)
    .maybeSingle();

  // Already onboarded? Skip the wizard and send them straight to the app.
  if (profile?.onboarded_at) redirect("/app");

  return (
    <OnboardingWizard
      initialDisplayName={profile?.display_name ?? ""}
      initialUnits={(profile?.units as "metric" | "imperial") ?? "metric"}
      initialDaysPerWeek={Number(profile?.training_days_per_week ?? 4)}
      completeAction={completeOnboarding}
      skipAction={skipOnboarding}
    />
  );
}
