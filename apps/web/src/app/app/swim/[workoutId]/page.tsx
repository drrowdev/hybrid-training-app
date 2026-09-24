import { notFound, redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getSwimCapability } from "@/lib/swim/capability";
import { loadSwimWorkoutView } from "@/lib/swim/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorkoutScreen } from "@/components/swim/WorkoutScreen";
import { MatchedRecordings } from "@/components/swim/MatchedRecordings";
import { SwimRehabWorkouts } from "@/components/swim/SwimRehabWorkouts";
import { loadSwimRehabWorkouts } from "@/lib/swim/rehab-workouts";
import { parseSwimOrigin, swimReturnDestination } from "@/lib/swim/return-context";
import styles from "@/components/swim/Swim.module.css";

export default async function SwimWorkoutPage({ params, searchParams }: {
  params: Promise<{ workoutId: string }>; searchParams: Promise<{ edit?: string; from?: string }>;
}) {
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const origin = parseSwimOrigin((await searchParams).from);
  const back = swimReturnDestination(origin);
  const capability = await getSwimCapability(client);
  if (!capability.storageAvailable) return (
    <main className={styles.page}><PageHeader title="Swimming" back={back} /><p role="status">Swimming isn&apos;t available right now.</p></main>
  );
  const { workoutId } = await params;
  const view = await loadSwimWorkoutView(client, user.id, workoutId);
  if (!view) notFound();
  const rehab = await loadSwimRehabWorkouts(client, user.id, workoutId);
  return (
    <main className={styles.page}>
      <PageHeader title={view.title} back={back} />
      <WorkoutScreen key={`${view.id}:${view.revision}`} workout={view} />
      {rehab && <SwimRehabWorkouts key={`${rehab.workoutId}:${rehab.revision}`} context={rehab} />}
      <MatchedRecordings client={client} userId={user.id} workoutId={view.id} revision={view.revision} origin={origin} />
    </main>
  );
}
