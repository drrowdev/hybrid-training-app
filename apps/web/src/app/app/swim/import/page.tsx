import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getSwimCapability } from "@/lib/swim/capability";
import { privateSwimCourseAvailable } from "@/lib/swim/course-capability";
import { swimToday } from "@/lib/swim/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { CourseImportForm } from "@/components/swim/CourseImportForm";
import styles from "@/components/swim/Swim.module.css";

export default async function SwimImportPage() {
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const client = await createClient();
  const capability = await getSwimCapability(client);
  const enabled = capability.storageAvailable && capability.setupEnabled && await privateSwimCourseAvailable(client);
  return <main className={styles.page}>
    <PageHeader title="Import swimming plan" back={{ href: "/app/swim/setup", label: "Swimming setup" }} />
    {enabled ? <CourseImportForm today={(await swimToday(client, user.id)).today} />
      : <p role="status">Plan imports are currently unavailable.</p>}
  </main>;
}
