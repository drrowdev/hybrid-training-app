import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getSwimCapability } from "@/lib/swim/capability";
import { todayYmd } from "@/lib/dates";
import { PageHeader } from "@/components/ui/PageHeader";
import { SetupForm } from "@/components/swim/SetupForm";
import styles from "@/components/swim/Swim.module.css";
import { loadAvailableTrainingSchedule } from "@/lib/schedule/storage";
import { privateSwimCourseAvailable } from "@/lib/swim/course-capability";
import Link from "next/link";
import { z } from "zod";

export default async function SwimSetupPage({ searchParams }: { searchParams: Promise<{ replace?: string }> }) {
  const params = await searchParams;
  const replacePlanId = params.replace ? z.string().uuid().parse(params.replace) : undefined;
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const capability = await getSwimCapability(client);
  const schedule = capability.storageAvailable && capability.setupEnabled ? await loadAvailableTrainingSchedule(client) : null;
  const { data: profile } = await client.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
  return (
    <main className={styles.page}>
      <PageHeader title="New swimming program" back={{ href: "/app/programs", label: "Programs" }} />
      {capability.storageAvailable && capability.setupEnabled && await privateSwimCourseAvailable(client) &&
        <div className={styles.actions}><Link className={styles.secondary} href={replacePlanId ? `/app/swim/import?replace=${replacePlanId}` : "/app/swim/import"}>Import a swimming plan</Link></div>}
      {schedule
        ? <SetupForm today={todayYmd(profile?.timezone ?? "UTC")} schedule={schedule.entries} replacePlanId={replacePlanId} />
        : <p role="status">Swimming setup isn&apos;t available right now.</p>}
    </main>
  );
}
