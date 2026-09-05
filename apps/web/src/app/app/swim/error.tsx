"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import styles from "@/components/swim/Swim.module.css";

export default function SwimError({ reset }: { reset: () => void }) {
  return (
    <main className={styles.page}>
      <PageHeader title="Swimming" />
      <p role="alert">Could not load your swims. Check your connection and try again.</p>
      <div className={styles.actions}>
        <button className={styles.button} onClick={reset}>Try again</button>
        <Link href="/app" className={styles.secondary}>Today</Link>
      </div>
    </main>
  );
}
