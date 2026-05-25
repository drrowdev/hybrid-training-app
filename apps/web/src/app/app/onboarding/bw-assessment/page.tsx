/**
 * Standalone bodyweight assessment route — same step component the
 * onboarding wizard uses, hoisted into a plain settings-style page so
 * users who skipped the assessment (or want to re-calibrate) can run
 * it without flipping the onboarding gate back on.
 *
 * Submitting persists via `submitBwAssessment` (re-used) and the
 * client wrapper navigates back to /app/settings/bodyweight-progression.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BwAssessmentRunner } from "@/components/onboarding/bw-assessment/BwAssessmentRunner";

export default async function BwAssessmentStandalonePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <Link
          href="/app/settings/bodyweight-progression"
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            textDecoration: "none",
          }}
        >
          ← back to bodyweight progression
        </Link>
        <h1 style={{ fontSize: 26, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          Bodyweight assessment
        </h1>
        <p
          style={{
            margin: "6px 0 0",
            color: "var(--cp-text-muted)",
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          Three short pages — rep tests, skill chips, and a hinge-gap
          acknowledgement — seed your starting node per movement family.
          Re-running the assessment overwrites your current nodes and
          zeroes the accumulators.
        </p>
      </header>

      <BwAssessmentRunner />
    </div>
  );
}
