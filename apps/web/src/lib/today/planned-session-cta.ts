export type PlannedSessionCtaInput = {
  plannedId: string;
  completedSessionId: string | null;
  completedAt: string | null;
  deletedCompletedSessionId?: string | null;
};

export type PlannedSessionCta = {
  href: string;
  label:
    | "Start workout →"
    | "Continue workout →"
    | "View workout →"
    | "Restore workout →";
  state: "not_started" | "in_progress" | "completed" | "deleted_completed";
};

export function plannedSessionCta(
  input: PlannedSessionCtaInput,
): PlannedSessionCta {
  if (input.completedSessionId && input.completedAt) {
    return {
      href: `/app/sessions/${input.completedSessionId}`,
      label: "View workout →",
      state: "completed",
    };
  }
  if (input.deletedCompletedSessionId) {
    return {
      href: "/app/settings/trash",
      label: "Restore workout →",
      state: "deleted_completed",
    };
  }
  if (input.completedSessionId) {
    return {
      href: `/app/sessions/${input.completedSessionId}`,
      label: "Continue workout →",
      state: "in_progress",
    };
  }
  return {
    href: `/app/sessions/start/${input.plannedId}`,
    label: "Start workout →",
    state: "not_started",
  };
}
