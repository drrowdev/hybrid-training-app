/**
 * Pure predicate for the in-session header action surface.
 *
 * Decides whether to show the "Cancel workout" escape hatch (truly
 * empty in-progress session) or the regular "Delete session" button
 * (anything else — completed, or partially logged). See
 * `apps/web/src/components/session/CancelWorkoutButton.tsx` for the
 * UX rationale.
 *
 * Definition of "empty": zero set logs, zero cardio logs, and the
 * session has not been completed. If ANY of those is false, the user
 * has invested state in the session and the cancel-without-saving
 * copy is wrong — fall back to Delete.
 */
export type SessionEmptyInputs = {
  completedAt: string | null | undefined;
  setLogCount: number;
  cardioLogCount: number;
};

export function isEmptyInProgressSession(input: SessionEmptyInputs): boolean {
  return (
    !input.completedAt &&
    input.setLogCount === 0 &&
    input.cardioLogCount === 0
  );
}

/**
 * Predicate for the "Pick movements to start logging" empty-state
 * card that's shown on a fresh Quick Strength session.
 *
 * We render the empty state ONLY when:
 *   - The session is in progress (not complete)
 *   - There are no logged sets and no cardio blocks
 *   - There's NO planned prescription — this disambiguates a Quick
 *     Strength session (which has no plan, so the user genuinely
 *     needs the hint) from a planned session that the user just
 *     opened (which already has cards rendered from the prescription
 *     and so doesn't need an empty-state nudge).
 */
export type StrengthEmptyStateInputs = SessionEmptyInputs & {
  hasPrescription: boolean;
};

export function shouldShowStrengthEmptyState(
  input: StrengthEmptyStateInputs,
): boolean {
  return (
    isEmptyInProgressSession(input) && !input.hasPrescription
  );
}
