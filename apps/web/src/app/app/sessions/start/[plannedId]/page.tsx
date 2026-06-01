import { redirect } from "next/navigation";
import { startSessionDirect } from "@/lib/planner/actions";

/**
 * Auto-start a planned session and redirect to the session log.
 *
 * The pre-workout fatigue + soreness interstitial was removed; the
 * follow-up Today-page wellness check-in card has since also been
 * retired (see chore/retire-wellness-checkin). This page exists so
 * every existing `Link` href of the form
 * `/app/sessions/start/[plannedId]` keeps working without a code-wide
 * rewrite: a GET hits this Server Component, which materialises the
 * planned session via `startSessionDirect` and `redirect()`s straight
 * to `/app/sessions/[newSessionId]`. No UI is ever rendered.
 */
export default async function StartSessionPage({
  params,
}: {
  params: Promise<{ plannedId: string }>;
}) {
  const { plannedId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(plannedId)) redirect("/app");
  // `startSessionDirect` always redirects — either to the linked
  // session (idempotent re-entry) or to the newly created one.
  // `skipRevalidate` because this runs DURING RENDER, where
  // `revalidatePath` is unsupported in Next 16 (it throws). `/app` and
  // `/app/plan` are cookie-dynamic, so the next navigation re-renders
  // fresh without an explicit revalidate.
  await startSessionDirect(plannedId, { skipRevalidate: true });
}
