"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startSwimRehab } from "@/lib/swim/rehab-actions";
import type { SwimRehabWorkoutContext } from "@/lib/swim/rehab-workouts";
import styles from "./Swim.module.css";

export function SwimRehabWorkouts({ context }: { context: SwimRehabWorkoutContext }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<Record<string, string>>({});
  const requests = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  if (!context.entries.length) return null;
  const start = (protocolId: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const requestId = requests.current.get(protocolId) ?? crypto.randomUUID();
    requests.current.set(protocolId, requestId);
    setError(null);
    startTransition(async () => {
      try {
        const result = await startSwimRehab({
          workoutId: context.workoutId, protocolId, revision: context.revision, requestId,
        });
        if (!result.ok || !result.sessionId) {
          setError(result.error ?? "Couldn't start your rehab workout. Try again.");
          return;
        }
        const sessionId = result.sessionId;
        setStarted((previous) => ({ ...previous, [protocolId]: sessionId }));
        router.push(`/app/sessions/${sessionId}`);
      } catch { setError("Couldn't open your rehab workout. Try again."); }
      finally { inFlight.current = false; }
    });
  };
  return <section className={styles.section} aria-label="Rehab workouts">
    <h2>Rehab</h2>
    <ul className={styles.list}>{context.entries.map((entry) => {
      const sessionId = started[entry.protocolId] ?? entry.sessionId;
      return <li className={`${styles.row} ${styles.rehabRow}`} key={entry.protocolId}>
        <div><strong>{entry.name}</strong>
          {entry.status === "completed" && <div className={styles.muted}>Completed</div>}
          {entry.status === "removed" && <div className={styles.muted}>Permanently removed</div>}
        </div>
        {entry.status === "deleted" ? <Link href="/app/trash" className={styles.secondary}>Restore from Trash</Link>
          : sessionId ? <Link href={`/app/sessions/${sessionId}`} className={styles.secondary}>
            {entry.status === "completed" ? "View rehab" : "Continue rehab"}
          </Link>
          : entry.status === "available" && context.canStart
            ? <button className={styles.secondary} disabled={pending} aria-label={`Start ${entry.name}`}
              onClick={() => start(entry.protocolId)}>Start rehab</button> : null}
      </li>;
    })}</ul>
    {error && <div><p role="alert" className={styles.error}>{error}</p>
      <button className={styles.secondary} disabled={pending} onClick={() => router.refresh()}>Reload workout</button>
    </div>}
  </section>;
}
