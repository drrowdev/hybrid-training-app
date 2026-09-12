import { PageHeader } from "@/components/ui/PageHeader";
import styles from "@/components/swim/Swim.module.css";

export default function SwimLoading() {
  return <main className={styles.page}><PageHeader title="Swimming" /><p role="status" className={styles.muted}>Loading swims…</p></main>;
}
