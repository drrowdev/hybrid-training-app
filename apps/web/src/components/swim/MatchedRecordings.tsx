import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWorkoutRecordingMatches } from "@/lib/swim/import-matching";
import { formatImportedSwimDistance } from "@/lib/swim/import-presentation";
import styles from "./Swim.module.css";
import type { SwimOrigin } from "@/lib/swim/conditioning-presentation";

export async function MatchedRecordings({ client, userId, workoutId, revision, origin }: {
  client: SupabaseClient; userId: string; workoutId: string; revision: number; origin?: SwimOrigin;
}) {
  const matches = await loadWorkoutRecordingMatches(client, userId, workoutId);
  if (!matches.length) return null;
  return <section className={styles.section}>
    <h2>Matched recordings</h2>
    <ul className={styles.list}>{matches.map((match) => <li key={match.id}>
      <Link className={styles.row} href={`/app/swim/recordings/${match.import_id}?workout=${workoutId}${origin ? `&from=${origin}` : ""}`}>
        <span>{match.date} · {formatImportedSwimDistance(match.distance)}
          {match.metadata.workout?.revision !== revision && <small>Workout changed since this match.</small>}
        </span>
        <span>View</span>
      </Link>
    </li>)}</ul>
    {matches.length === 20 && <Link href="/app/settings/swimming">More recordings</Link>}
  </section>;
}
