import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getSwimCapability } from "@/lib/swim/capability";
import { todayYmd } from "@/lib/dates";
import { PageHeader } from "@/components/ui/PageHeader";
import { SetupForm } from "@/components/swim/SetupForm";
import styles from "@/components/swim/Swim.module.css";

export default async function SwimSetupPage() {
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const capability = await getSwimCapability(client);
  const { data: profile } = await client.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
  return (
    <main className={styles.page}>
      <PageHeader title="Set up swimming" back={{ href: "/app/swim", label: "Swimming" }} />
      {capability.storageAvailable && capability.setupEnabled
        ? <SetupForm today={todayYmd(profile?.timezone ?? "UTC")} />
        : <p role="status">Swimming setup is currently unavailable.</p>}
    </main>
  );
}
