/**
 * Standalone bodyweight assessment route — same step component the
 * onboarding wizard uses, hoisted into a plain settings-style page so
 * users who skipped the assessment (or want to re-calibrate) can run
 * it without flipping the onboarding gate back on.
 *
 * Submitting persists via `submitBwAssessment` (re-used) and the
 * client wrapper navigates back to /app/settings/bodyweight-progression.
 */
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { BwAssessmentRunner } from "@/components/onboarding/bw-assessment/BwAssessmentRunner";

export default async function BwAssessmentStandalonePage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <PageHeader
        back={{
          href: "/app/settings/bodyweight-progression",
          label: "Bodyweight progression",
        }}
        title="Bodyweight assessment"
        subtitle="Three short pages — rep tests, skill chips, and a hinge-gap acknowledgement — seed your starting node per movement family. Re-running the assessment overwrites your current nodes and zeroes the accumulators."
      />

      <BwAssessmentRunner />
    </div>
  );
}
