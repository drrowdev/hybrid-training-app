import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getSwimCapability } from "@/lib/swim/capability";
import { privateSwimCourseAvailable } from "@/lib/swim/course-capability";
import { swimToday } from "@/lib/swim/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { CourseImportForm } from "@/components/swim/CourseImportForm";
import styles from "@/components/swim/Swim.module.css";
import { loadAvailableTrainingSchedule } from "@/lib/schedule/storage";
import { z } from "zod";

export default async function SwimImportPage({ searchParams }: { searchParams: Promise<{ replace?: string }> }) {
  const params = await searchParams;
  const replacePlanId = params.replace ? z.string().uuid().parse(params.replace) : undefined;
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const client = await createClient();
  const capability = await getSwimCapability(client);
  const enabled = capability.storageAvailable && capability.setupEnabled && await privateSwimCourseAvailable(client);
  const schedule = enabled ? await loadAvailableTrainingSchedule(client) : null;
  return <main className={styles.page}>
    <PageHeader title="Import swimming plan" back={{ href: "/app/swim/setup", label: "Swimming setup" }} />
    {enabled && schedule ? <CourseImportForm today={(await swimToday(client, user.id)).today} schedule={schedule.entries} replacePlanId={replacePlanId} />
      : <p role="status">Plan imports aren&apos;t available right now.</p>}
  </main>;
}
