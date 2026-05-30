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
