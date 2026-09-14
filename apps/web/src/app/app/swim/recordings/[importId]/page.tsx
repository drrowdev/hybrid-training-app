import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { swimImportMatchingAvailable, loadRecordingMatch } from "@/lib/swim/import-matching";
import { formatSwimTime } from "@/lib/swim/time";
import { formatImportedSwimDistance } from "@/lib/swim/import-presentation";
import { PageHeader } from "@/components/ui/PageHeader";
import { RecordingMatcher } from "@/components/swim/RecordingMatcher";
import styles from "@/components/swim/Swim.module.css";

export default async function SwimRecordingPage({ params }: { params: Promise<{ importId: string }> }) {
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
  return <main className={styles.page}>
    <PageHeader title="Recorded swim" back={{ href: "/app/settings/swimming", label: "Swimming imports" }} />
    <section className={styles.section}>
      <h2>{evidence.environment === "pool" ? "Pool swim" : "Open-water swim"}</h2>
      <time dateTime={evidence.date}>{evidence.date}</time>
      <p className={styles.distance}>{formatImportedSwimDistance(evidence.distanceMetres)}</p>
      <p>Recorded duration: {formatSwimTime(evidence.recordedDurationMs)}</p>
      {!latest && <Link href={`/app/swim/recordings/${latestId}`}>View updated recording</Link>}
    </section>
    {(evidence.environment === "pool" || matched) && <RecordingMatcher
      key={`${recording.id}:${current?.id ?? "none"}`}
      importId={recording.id} expectedMatchId={current?.id ?? null}
      enabled={latest && evidence.environment === "pool" && process.env.SWIM_IMPORT_MATCHING_ENABLED === "true"}
      current={matched && current?.workout_id ? {
        importId: current.import_id, workoutId: current.workout_id, title: matched.title, date: matched.date,
      } : null}
    />}
  </main>;
}
