"use client";

/**
 * Client wrapper for the standalone bodyweight assessment route.
 *
 * The assessment step itself is a client component already used inside
 * the onboarding wizard. Here we re-use it verbatim, providing:
 *   - The submit action import (server action lives in
 *     `@/lib/onboarding/bw-assessment`).
 *   - An `onComplete` callback that returns the user to the settings
 *     page where they came from. The server action revalidates that
 *     route, so the fresh `bw_progress` rows show up immediately.
 */
import { useRouter } from "next/navigation";
import { BwAssessmentStep } from "@/components/onboarding/bw-assessment/BwAssessmentStep";
import { submitBwAssessment } from "@/lib/onboarding/bw-assessment";

export function BwAssessmentRunner() {
  const router = useRouter();
  return (
    <BwAssessmentStep
      submitAction={submitBwAssessment}
      onComplete={() => {
        router.push("/app/settings/bodyweight-progression");
        router.refresh();
      }}
    />
  );
}
