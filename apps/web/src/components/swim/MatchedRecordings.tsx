import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWorkoutRecordingMatches } from "@/lib/swim/import-matching";
import { formatImportedSwimDistance } from "@/lib/swim/import-presentation";
import { swimRecordingHref, type SwimOrigin } from "@/lib/swim/return-context";
import styles from "./Swim.module.css";

export async function MatchedRecordings({ client, userId, workoutId, revision, origin }: {
  client: SupabaseClient; userId: string; workoutId: string; revision: number; origin?: SwimOrigin;
}) {
  const matches = await loadWorkoutRecordingMatches(client, userId, workoutId);
  if (!matches.length) return null;
  return <section className={styles.section}>
    <h2>Matched recordings</h2>
    <ul className={styles.list}>{matches.map((match) => <li key={match.id}>
      <Link className={styles.row} href={swimRecordingHref(match.import_id, origin, workoutId)}>
        <span>{match.date} · {formatImportedSwimDistance(match.distance)}
          {match.metadata.workout?.revision !== revision && <small>Workout changed since this match.</small>}
        </span>
        <span>View</span>
      </Link>
    </li>)}</ul>
    {matches.length === 20 && <Link href="/app/settings/swimming">More recordings</Link>}
  </section>;
}
