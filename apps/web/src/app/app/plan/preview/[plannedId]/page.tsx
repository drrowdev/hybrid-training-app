/**
 * Read-only preview of a single planned session.
 *
 * Reached from the Today hero's secondary CTA ("Preview workout") so
 * the user can see sets / reps / movements / accessories before they
 * commit to "Start workout →". Loads the planned session via the
 * shared `getPlannedSessionById` helper (RLS-scoped), then hands the
 * shaped data to the pure `SessionPreviewBody` component. Bad ids or
 * rows the caller can't see both fall through to `notFound()` so the
 * surface can't be used to probe for foreign session ids.
 */
import { notFound } from "next/navigation";
import { getPlannedSessionById, PLANNED_ID_REGEX } from "@/lib/planner/queries";
import {
  SessionPreviewBody,
  type SessionPreviewInput,
} from "@/components/session/SessionPreviewBody";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  formatEyebrowDate,
  type ProfileForFormat,
} from "@/lib/format/datetime";

/**
 * Mirror of the Plan-page duration heuristic: sum cardio `durationMin`
 * and add a flat 5 min per strength item. Pure cosmetic — see
 * `apps/web/src/app/app/plan/page.tsx` for the original. Duplicated
 * here rather than re-exported so the Plan page doesn't have to
 * publish an internal helper just for this preview surface.
 */
function estimateDurationMin(
  items: SessionPreviewInput["items"],
): number | null {
  let dur: number | null = null;
  for (const it of items) {
    if (it.kind?.startsWith("cardio_") && it.durationMin) {
      dur = (dur ?? 0) + it.durationMin;
    }
  }
  const strengthCount = items.filter(
    (i) => !(i.kind ?? "").startsWith("cardio_"),
  ).length;
  if (strengthCount > 0) dur = (dur ?? 0) + strengthCount * 5;
  return dur;
}

export default async function PreviewWorkoutPage({
  params,
}: {
  params: Promise<{ plannedId: string }>;
}) {
  const { plannedId } = await params;
  if (!PLANNED_ID_REGEX.test(plannedId)) notFound();

  const planned = await getPlannedSessionById(plannedId);
  if (!planned) notFound();

  // Resolve eyebrow using the caller's date_format / timezone profile
  // so "WED 27 MAY" vs "WED MAY 27" matches every other date label
  // they see in the app.
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  let formatProfile: ProfileForFormat = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("timezone, time_format, date_format")
      .eq("id", user.id)
      .maybeSingle();
    if (profile) {
      formatProfile = {
        timezone: profile.timezone ?? null,
        time_format: profile.time_format ?? null,
        date_format: profile.date_format ?? null,
      };
    }
  }

  // `formatEyebrowDate` accepts a Date or ISO string. The planned
  // `date` is a YYYY-MM-DD — anchor it at noon UTC so timezone
  // rounding can't flip the weekday on either side of midnight.
  const eyebrowDate = `${planned.date}T12:00:00Z`;
  const datePart = formatEyebrowDate(eyebrowDate, formatProfile);
  const eyebrow = `${planned.archetypeName.toUpperCase()} · WEEK ${planned.weekIndex + 1} · ${datePart}`;

  const items = planned.prescription.items ?? [];
  const input: SessionPreviewInput = {
    id: planned.id,
    title: planned.title,
    eyebrow,
    estDurationMin: estimateDurationMin(items),
    items,
  };

  return <SessionPreviewBody session={input} />;
}
