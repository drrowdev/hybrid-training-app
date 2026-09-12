import { notFound, redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getSwimCapability } from "@/lib/swim/capability";
import { loadSwimWorkoutView } from "@/lib/swim/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorkoutScreen } from "@/components/swim/WorkoutScreen";
import styles from "@/components/swim/Swim.module.css";

export default async function SwimWorkoutPage({ params }: {
  params: Promise<{ workoutId: string }>; searchParams: Promise<{ edit?: string }>;
}) {
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const capability = await getSwimCapability(client);
  if (!capability.storageAvailable) return (
    <main className={styles.page}><PageHeader title="Swimming" back={{ href: "/app/swim", label: "Swimming" }} /><p role="status">Swimming is currently unavailable.</p></main>
  );
  const { workoutId } = await params;
  const view = await loadSwimWorkoutView(client, user.id, workoutId);
  if (!view) notFound();
  return (
    <main className={styles.page}>
      <PageHeader title={view.title} back={{ href: "/app/swim", label: "Swimming" }} />
      <WorkoutScreen key={`${view.id}:${view.revision}`} workout={view} />
    </main>
  );
}
