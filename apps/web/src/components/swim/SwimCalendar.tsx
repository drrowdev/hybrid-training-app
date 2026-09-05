import Link from "next/link";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getSwimNavigation } from "@/lib/swim/navigation";
import { standaloneSwimCalendar, type StandaloneSwimCalendarItem } from "@/lib/swim/calendar";
import { todayYmd } from "@/lib/dates";
import styles from "./Swim.module.css";

export async function SwimCalendar({ todayOnly = false }: { todayOnly?: boolean }) {
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) return null;
  const navigation = await getSwimNavigation(client, user.id);
  if (!navigation.hasPlans) return null;
  const [{ data: plans, error: planError }, { data: workouts, error: workoutError }, { data: profile, error: profileError }] = await Promise.all([
    client.from("swim_plans").select("id,status").eq("user_id", user.id),
    client.from("swim_workouts").select("id,plan_id,scheduled_date,slot,session_id,status")
      .eq("user_id", user.id).order("scheduled_date"),
    client.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
  ]);
  if (planError || workoutError || profileError) throw new Error("Could not load the swim schedule.", { cause: planError ?? workoutError ?? profileError });
  const sessionIds = (workouts ?? []).flatMap((row) => row.session_id ? [row.session_id] : []);
  const { data: sessions, error: sessionError } = sessionIds.length
    ? await client.from("sessions").select("id").in("id", sessionIds).is("deleted_at", null)
    : { data: [], error: null };
  if (sessionError) throw new Error("Could not load the swim schedule.", { cause: sessionError });
  const visibleSessions = new Set(sessions?.map((row) => row.id));
  const today = todayYmd(profile?.timezone ?? "UTC");
  const entries = standaloneSwimCalendar(plans ?? [], (workouts ?? []).map((row) => ({
    ...row, deleted: !!row.session_id && !visibleSessions.has(row.session_id),
  })) as {
    id: string; plan_id: string; scheduled_date: string; slot: "single" | "am" | "pm";
    session_id: string | null; status: StandaloneSwimCalendarItem["status"];
    deleted: boolean;
  }[]).filter((item) => todayOnly
    ? item.date === today || item.status === "started"
    : item.date >= today || item.status === "started");
  return (
    <section className={styles.section} aria-label="Swimming schedule">
      <div className={styles.actions}><h2>Swimming</h2><Link href="/app/swim" className={styles.secondary}>All swims</Link></div>
      {entries.length > 0 && <ul className={styles.list}>
        {entries.slice(0, todayOnly ? 4 : 12).map((entry) => (
          <li key={entry.id}><Link className={styles.row} href={entry.href}>
            <span><strong>Pool swim</strong><small>{entry.date}{entry.slot !== "single" ? ` · ${entry.slot.toUpperCase()}` : ""}</small></span>
            <span>{entry.status === "completed" ? "Completed" : entry.status === "started" ? "Continue →" : "View →"}</span>
          </Link></li>
        ))}
      </ul>}
    </section>
  );
}
