import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { swimImportMatchingAvailable, loadRecordingMatch } from "@/lib/swim/import-matching";
import { formatSwimTime } from "@/lib/swim/time";
import { formatImportedSwimDistance } from "@/lib/swim/import-presentation";
import { PageHeader } from "@/components/ui/PageHeader";
import { RecordingMatcher } from "@/components/swim/RecordingMatcher";
import { RecordingOutcome } from "@/components/swim/RecordingOutcome";
import { loadSwimImportOutcome, swimImportOutcomesAvailable } from "@/lib/swim/import-outcomes";
import { swimOutcomeForRecording } from "@hta/domain";
import { z } from "zod";
import styles from "@/components/swim/Swim.module.css";
import { parseSwimOrigin } from "@/lib/swim/conditioning-presentation";

export default async function SwimRecordingPage({ params, searchParams }: {
  params: Promise<{ importId: string }>; searchParams?: Promise<{ workout?: string; from?: string }>;
}) {
  const query = await searchParams;
  const workoutId = z.string().uuid().safeParse(query?.workout);
  const origin = parseSwimOrigin(query?.from);
  const context = workoutId.success ? `?workout=${workoutId.data}${origin ? `&from=${origin}` : ""}` : "";
  const back = workoutId.success
    ? { href: `/app/swim/${workoutId.data}${origin ? `?from=${origin}` : ""}`, label: "Workout" }
    : { href: "/app/settings/swimming", label: "Swimming imports" };
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const client = await createClient();
  if (!await swimImportMatchingAvailable(client)) return <p>Recorded swims are not available yet.</p>;
  const view = await loadRecordingMatch(client, user.id, (await params).importId);
  if (!view) notFound();
  const { recording, current, latestId } = view;
  const evidence = recording.evidence;
  const matched = current?.metadata.workout;
  const latest = latestId === recording.id;
  let outcomeSection = null;
  if (current?.workout_id && matched && await swimImportOutcomesAvailable(client)) {
    const [confirmation, workout] = await Promise.all([
      loadSwimImportOutcome(client, user.id, current.workout_id),
      client.from("swim_workouts").select("revision,status,session_id")
        .eq("user_id", user.id).eq("id", current.workout_id).single(),
    ]);
    const parsed = z.object({
      revision: z.number().int().positive(), status: z.string(), session_id: z.string().uuid().nullable(),
    }).safeParse(workout.data);
    if (workout.error || !parsed.success) throw new Error("The workout outcome could not be loaded.");
    const state = swimOutcomeForRecording({
      confirmation: confirmation ? {
        outcome: confirmation.metadata.outcome, matchId: confirmation.match_id,
        workoutRevision: confirmation.metadata.workoutRevision,
      } : null,
      matchId: current.id, matchedImportId: current.import_id, latestImportId: latestId,
      matchedWorkoutRevision: matched.revision, workoutRevision: parsed.data.revision,
    });
    const enabled = latest && current.import_id === recording.id && state.canConfirm &&
      parsed.data.status === "scheduled" && parsed.data.session_id === null &&
      process.env.SWIM_IMPORT_OUTCOMES_ENABLED === "true";
    if (enabled || confirmation?.metadata.outcome != null) {
      outcomeSection = <RecordingOutcome key={`${current.id}:${confirmation?.id ?? "none"}:${parsed.data.revision}`}
        workoutId={current.workout_id} matchId={current.id} workoutRevision={parsed.data.revision}
        expectedOutcomeId={confirmation?.id ?? null} current={state.outcome} enabled={enabled}
        canRemove={confirmation?.metadata.outcome != null} needsReview={state.needsReview} otherMatch={state.otherMatch} />;
    }
  }
  return <main className={styles.page}>
    <PageHeader title="Recorded swim" back={back} />
    <section className={styles.section}>
      <h2>{evidence.environment === "pool" ? "Pool swim" : "Open-water swim"}</h2>
      <time dateTime={evidence.date}>{evidence.date}</time>
      <p className={styles.distance}>{formatImportedSwimDistance(evidence.distanceMetres)}</p>
      <p>Recorded duration: {formatSwimTime(evidence.recordedDurationMs)}</p>
      {!latest && <Link href={`/app/swim/recordings/${latestId}${context}`}>View updated recording</Link>}
    </section>
    {(evidence.environment === "pool" || matched) && <RecordingMatcher
      origin={origin ?? undefined}
      key={`${recording.id}:${current?.id ?? "none"}`}
      importId={recording.id} expectedMatchId={current?.id ?? null}
      enabled={latest && evidence.environment === "pool" && process.env.SWIM_IMPORT_MATCHING_ENABLED === "true"}
      current={matched && current?.workout_id ? {
        importId: current.import_id, workoutId: current.workout_id, title: matched.title, date: matched.date,
      } : null}
    />}
    {outcomeSection}
  </main>;
}
