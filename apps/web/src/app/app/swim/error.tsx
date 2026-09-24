"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import styles from "@/components/swim/Swim.module.css";

export default function SwimError({ reset }: { reset: () => void }) {
  return (
    <main className={styles.page}>
      <PageHeader title="Swimming" />
      <p role="alert">Couldn&apos;t load your swims. Try again.</p>
      <div className={styles.actions}>
        <button className={styles.button} onClick={reset}>Try again</button>
        <Link href="/app" className={styles.secondary}>Today</Link>
      </div>
    </main>
  );
}
