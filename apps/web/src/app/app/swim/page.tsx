import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getSwimCapability } from "@/lib/swim/capability";
import { listSwimPlans } from "@/lib/swim/storage";
import { loadSwimHubView } from "@/lib/swim/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { SwimHub } from "@/components/swim/SwimHub";
import { SwimRehabEditor } from "@/components/swim/SwimRehabEditor";
import { loadSwimRehabAttachments } from "@/lib/swim/rehab-attachments";
import styles from "@/components/swim/Swim.module.css";
import { getActiveBlocks } from "@/lib/planner/queries";
import { blockOverviewItems, swimOverviewItems } from "@/lib/programs/overview";

export default async function SwimPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const capability = await getSwimCapability(client);
  const plans = capability.storageAvailable ? (await listSwimPlans(client)).filter((plan) => plan.user_id === user.id) : [];
  const query = await searchParams;
  const selected = (query.plan ? plans.find((plan) => plan.id === query.plan) : null) ??
    plans.find((plan) => plan.status === "active") ?? plans[0];
  const view = selected ? await loadSwimHubView(client, user.id, selected) : null;
  const rehab = selected ? await loadSwimRehabAttachments(client, user.id, selected) : null;
  const [blocks, swimPrograms] = await Promise.all([
    getActiveBlocks(), capability.storageAvailable ? swimOverviewItems(client, user.id, plans) : [],
  ]);
  return (
    <main className={`${styles.page} ${styles.hubPage}`}>
      {!view && <PageHeader title="Swimming" back={{ href: "/app/programs", label: "Programs" }}
        actions={capability.setupEnabled && !plans.some((plan) => plan.status === "active")
          ? <Link href="/app/swim/setup" className={styles.button}>Set up swimming</Link> : undefined} />}
      {!capability.storageAvailable && <p role="status">Swimming isn&apos;t available right now.</p>}
      {capability.storageAvailable && !view && <section className={styles.section}>
        <h2>No swim plan yet</h2>
        {!capability.setupEnabled && <p className={styles.muted}>Swimming setup isn&apos;t available right now.</p>}
      </section>}
      {view && <SwimHub key={view.id} plan={view} setupEnabled={capability.setupEnabled}
        programs={[...blockOverviewItems(blocks), ...swimPrograms]}
        plans={plans.map((plan) => ({ id: plan.id, startedOn: plan.started_on, status: plan.status }))} />}
      {rehab && <SwimRehabEditor key={`${rehab.planId}:${rehab.revision}`} context={rehab} />}
    </main>
  );
}
