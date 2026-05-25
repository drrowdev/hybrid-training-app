/**
 * Onboarding gate — pure decision logic for whether an authenticated user
 * needs to be redirected to /onboarding before they can use /app/**.
 *
 * Kept side-effect-free so the gate is unit-testable; the actual redirect
 * lives in apps/web/src/app/app/layout.tsx.
 *
 * Spec contract (from the onboarding rebuild brief):
 *
 *   1. A brand-new account that has no TMs and no completed-onboarding
 *      marker is sent through the wizard.
 *   2. Skipping is fine — gate fires again on the next visit. So the
 *      `onboarded_at` flag is ONLY set when the user actually finished
 *      the wizard (created their first block), not when they bailed.
 *   3. A returning user with TMs (or an explicit completion marker) is
 *      never sent through onboarding again.
 *   4. Equipment configuration is collected inside the wizard for fresh
 *      users (post-onboarding step), but a NULL `profiles.equipment`
 *      row on an already-onboarded account does NOT re-route them
 *      back through the wizard — `resolveEquipment` falls back to the
 *      commercial-gym default at read time. Equipment is therefore
 *      intentionally NOT part of the gate signal set.
 *
 * Signal: any of the following marks the user as "done":
 *   - profile.onboardedAt is non-null (explicit completion)
 *   - the user has at least one training_max row (catches grandfathered
 *     users / migrated accounts where onboarded_at wasn't set)
 */

export type GateInput = {
  /** True when at least one training_max row exists for the user. */
  hasAnyTm: boolean;
  /** `profiles.onboarded_at` timestamp, or null if never set. */
  onboardedAt: string | null;
};

/** Return true when the gate must redirect the user to /onboarding. */
export function needsOnboarding(input: GateInput): boolean {
  if (input.onboardedAt) return false;
  if (input.hasAnyTm) return false;
  return true;
}

// ── Profile update mapper (pure, used by the saveOnboardingProfile action) ─

export type OnboardingProfileInput = {
  displayName?: string | null;
  units?: "metric" | "imperial";
  trainingExperience?:
    | "beginner_lt_6m"
    | "novice_6m_2y"
    | "intermediate_2y_5y"
    | "advanced_5y_10y"
    | "highly_advanced_10y_plus";
  bodyweightKg?: number;
};

export type ProfileUpdate = {
  display_name?: string | null;
  units?: "metric" | "imperial";
  training_experience?:
    | "beginner_lt_6m"
    | "novice_6m_2y"
    | "intermediate_2y_5y"
    | "advanced_5y_10y"
    | "highly_advanced_10y_plus";
  bodyweight_kg?: number;
};

/**
 * Map the wizard's typed payload to the database-column shape used by the
 * `profiles` table update. Empty input → empty object (skip the update).
 * Empty display_name string is normalised to null so we don't accidentally
 * persist whitespace.
 */
export function buildProfileUpdate(input: OnboardingProfileInput): ProfileUpdate {
  const update: ProfileUpdate = {};
  if (input.displayName !== undefined) {
    const trimmed = (input.displayName ?? "").trim();
    update.display_name = trimmed ? trimmed : null;
  }
  if (input.units !== undefined) update.units = input.units;
  if (input.trainingExperience !== undefined) update.training_experience = input.trainingExperience;
  if (input.bodyweightKg !== undefined) update.bodyweight_kg = input.bodyweightKg;
  return update;
}
