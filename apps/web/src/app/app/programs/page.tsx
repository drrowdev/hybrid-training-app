import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/dates";
import { getActiveBlock } from "@/lib/planner/queries";
import { loadAvailableTrainingSchedule } from "@/lib/schedule/storage";
import { getSwimNavigation, swimEntryHref } from "@/lib/swim/navigation";
import { TrainingWeek } from "@/components/program/TrainingWeek";
import styles from "@/components/program/ProgramBuilder.module.css";

const ACTIVITIES = [
  { id: "strength", name: "Strength", detail: "Lifts, accessories and rehab" },
  { id: "running", name: "Running", detail: "Runs and intervals" },
  { id: "hybrid", name: "Hybrid", detail: "A complete mixed training week" },
] as const;

export default async function ProgramsPage({ searchParams }: { searchParams: Promise<{ activity?: string }> }) {
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const client = await createClient();
  const params = await searchParams;
  const focused = ACTIVITIES.find((activity) => activity.id === params.activity);
  const [active, snapshot, swimming, profile] = await Promise.all([
    getActiveBlock(), loadAvailableTrainingSchedule(client), getSwimNavigation(client, user.id),
    client.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
  ]);
  if (profile.error) throw new Error("Could not load your training settings.");
  const swimHref = swimEntryHref(swimming);
  const ownsFocused = active && (!focused || active.programFamily === focused.id ||
    (focused.id === "strength" && ["531", "tactical-barbell"].includes(active.programFamily ?? "")) ||
    (focused.id === "hybrid" && ["hybrid", "hyrox", "tactical-barbell-green"].includes(active.programFamily ?? "")));
  const entries = focused ? snapshot?.entries.filter((entry) => entry.source === "primary" && entry.programId === active?.id && ownsFocused) : snapshot?.entries;
  return <div className={styles.builder}>
    <header className={styles.header}><div><div className={styles.eyebrow}>Training</div><h1>{focused?.name ?? "Programs"}</h1></div>
      <div className={styles.actions}><Link className={styles.button} href="/app/plan/history">Program history</Link><Link className={`${styles.button} ${styles.primary}`} href={`/app/program/build${focused ? `?activity=${focused.id}` : ""}`}>New program</Link></div></header>
    <nav className={styles.actions} aria-label="Activities">
      <Link className={styles.button} href="/app/programs" aria-current={!focused ? "page" : undefined}>All programs</Link>
      {ACTIVITIES.map((activity) => <Link key={activity.id} className={styles.button} href={`/app/programs?activity=${activity.id}`} aria-current={focused?.id === activity.id ? "page" : undefined}>{activity.name}</Link>)}
      {swimHref && <Link className={styles.button} href={swimHref}>Swimming</Link>}
    </nav>
    {ownsFocused && active && <section className={styles.panel}><div className={styles.row}><div><h2>{active.notes ?? focused?.name ?? "Current program"}</h2>
      <p className={styles.muted}>{active.startedOn} · {active.weeks} weeks</p></div>
      <div className={styles.actions}><Link className={styles.button} href="/app/plan">Open program</Link>
        {active.programId === "authored" && <Link className={styles.button} href={`/app/program/build?edit=${active.id}`}>Edit program</Link>}</div></div></section>}
    {(!focused || !ownsFocused) && <section className={styles.cards}>
      {ACTIVITIES.filter((activity) => !focused || activity.id === focused.id).map((activity) => <Link key={activity.id} className={styles.card} href={`/app/program/build?activity=${activity.id}`}>
        <strong>{activity.name}</strong><span className={styles.muted}>{activity.detail}</span><span>Build a program</span>
      </Link>)}
      {(!focused || focused.id !== "running") && <Link className={styles.card} href="/app/program"><strong>Program templates</strong><span className={styles.muted}>Choose a supported training schedule and progression</span></Link>}
      {!focused && swimHref && <Link className={styles.card} href={swimHref}><strong>Swimming</strong><span className={styles.muted}>{swimming.hasPlans ? "Open swimming programs" : "Set up swimming"}</span></Link>}
    </section>}
    {entries && <TrainingWeek entries={entries} today={todayYmd(profile.data?.timezone ?? "UTC")} authoredBlockId={active?.programId === "authored" ? active.id : undefined} />}
    <nav className={styles.actions} aria-label="Training tools">
      <Link className={styles.button} href="/app/stats">Stats</Link><Link className={styles.button} href="/app/sessions">History</Link>
      <Link className={styles.button} href="/app/settings/rehab-protocols">Rehab protocols</Link><Link className={styles.button} href="/app/recovery/injuries">Limitations</Link>
      {focused?.id === "strength" && <Link className={styles.button} href="/app/settings/training-maxes">Training maxes</Link>}
    </nav>
  </div>;
}
