import { notFound, redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getSwimCapability } from "@/lib/swim/capability";
import { loadSwimWorkoutView } from "@/lib/swim/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorkoutScreen } from "@/components/swim/WorkoutScreen";
import { MatchedRecordings } from "@/components/swim/MatchedRecordings";
import styles from "@/components/swim/Swim.module.css";
import { swimReturnDestination } from "@/lib/swim/conditioning-presentation";
import { loadConditioningSwims } from "@/lib/swim/conditioning-view";

export default async function SwimWorkoutPage({ params, searchParams }: {
  params: Promise<{ workoutId: string }>; searchParams: Promise<{ edit?: string; from?: string }>;
}) {
  const from = (await searchParams).from;
  const origin = from === "today" || from === "plan" || from === "history" ? from : undefined;
  const back = swimReturnDestination(origin);
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const capability = await getSwimCapability(client);
  if (!capability.storageAvailable) return (
    <main className={styles.page}><PageHeader title="Swimming" back={back} /><p role="status">Swimming is currently unavailable.</p></main>
  );
  const { workoutId } = await params;
  const view = await loadSwimWorkoutView(client, user.id, workoutId);
  if (!view) notFound();
  const swim = (await loadConditioningSwims(client, user.id, [workoutId], "id")).get(workoutId);
  return (
    <main className={styles.page}>
      <PageHeader title={view.title} back={back} />
      <WorkoutScreen key={`${view.id}:${view.revision}`} workout={view} conditioning={swim} />
      <MatchedRecordings client={client} userId={user.id} workoutId={view.id} revision={view.revision} origin={origin} />
    </main>
  );
}
