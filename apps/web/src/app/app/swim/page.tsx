import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getSwimCapability } from "@/lib/swim/capability";
import { listSwimPlans } from "@/lib/swim/storage";
import { loadSwimHubView } from "@/lib/swim/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { SwimHub } from "@/components/swim/SwimHub";
import styles from "@/components/swim/Swim.module.css";

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
  return (
    <main className={styles.page}>
      <PageHeader title="Swimming" back={{ href: "/app/plan", label: "Plan" }}
        actions={capability.setupEnabled && !plans.some((plan) => plan.status === "active")
          ? <Link href="/app/swim/setup" className={styles.button}>Set up swimming</Link> : undefined} />
      {!capability.storageAvailable && <p role="status">Swimming is currently unavailable.</p>}
      {capability.storageAvailable && !view && <section className={styles.section}>
        <h2>No swim plan yet</h2>
        {!capability.setupEnabled && <p className={styles.muted}>Swimming setup is currently unavailable.</p>}
      </section>}
      {plans.length > 1 && <nav className={styles.actions} aria-label="Swim plans">
        {plans.map((plan) => <Link key={plan.id} href={`/app/swim?plan=${plan.id}`} className={styles.secondary} aria-current={plan.id === selected?.id ? "page" : undefined}>
          {plan.started_on} · {({ active: "Active", paused: "Paused", finished: "Finished", archived: "Archived" })[plan.status]}
        </Link>)}
      </nav>}
      {view && <SwimHub key={view.id} plan={view} />}
    </main>
  );
}
