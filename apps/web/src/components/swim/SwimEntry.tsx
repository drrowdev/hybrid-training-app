import Link from "next/link";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getSwimNavigation, swimEntryHref } from "@/lib/swim/navigation";
import styles from "./Swim.module.css";

export async function SwimEntry() {
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) return null;
  const navigation = await getSwimNavigation(client, user.id);
  const href = swimEntryHref(navigation);
  if (!href) return null;
  return (
    <section className={styles.section} aria-label="Swimming">
      <Link href={href} className={styles.row}>
        <strong>Pool swimming</strong>
        <span>{navigation.hasPlans ? "View swims →" : "Set up →"}</span>
      </Link>
    </section>
  );
}
