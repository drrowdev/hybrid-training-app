/**
 * askWhySessionId — pick the id the "Ask why" coach entry point should
 * seed its chat context with for a planned training day.
 *
 * `getSessionDetail` resolves either a real `sessions.id` or a
 * `planned_sessions.id`, so we prefer the linked session once the day
 * has been started (`completedSessionId`) — that's the row carrying the
 * user's actual logged sets — and fall back to the planned id otherwise.
 */
export function askWhySessionId(planned: {
  id: string;
  completedSessionId: string | null;
}): string {
  return planned.completedSessionId ?? planned.id;
}
