"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSwimRehabAttachments } from "@/lib/swim/rehab-actions";
import type { SwimRehabAttachments } from "@/lib/swim/rehab-attachments";
import styles from "./Swim.module.css";

export function SwimRehabEditor({ context }: { context: SwimRehabAttachments }) {
  const router = useRouter();
  const [selected, setSelected] = useState(context.attachedIds);
  const [saved, setSaved] = useState(context.attachedIds);
  const [revision, setRevision] = useState<string | null>(context.revision);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const request = useRef<string | null>(null);
  const inFlight = useRef(false);
  const changed = selected.length !== saved.length || selected.some((id) => !saved.includes(id));
  const protocols = context.editable ? context.protocols : context.protocols.filter((protocol) => saved.includes(protocol.id));
  if (!context.editable && protocols.length === 0) return null;
  return <section id="rehab" className={styles.section} aria-label="Rehab">
    <h2>Rehab</h2>
    {context.editable ? <form className={styles.form} onSubmit={(event) => {
      event.preventDefault();
      if (inFlight.current) return;
      if (!revision) { setError("Couldn't refresh this program. Try again."); router.refresh(); return; }
      inFlight.current = true;
      const requestId = request.current ??= crypto.randomUUID();
      setError(null); setWarning(null);
      startTransition(async () => {
        try {
          const result = await saveSwimRehabAttachments({
            planId: context.planId, protocolIds: selected, revision, requestId,
          });
          if (result.error || !result.ok || !result.protocolIds) {
            setError(result.error ?? "Couldn't save your rehab attachments. Try again.");
            return;
          }
          setSelected(result.protocolIds); setSaved(result.protocolIds); setRevision(null);
          setWarning(result.warning ?? null); request.current = null;
          router.refresh();
        } catch { setError("Couldn't save your rehab attachments. Try again."); }
        finally { inFlight.current = false; }
      });
    }}>
      {protocols.length > 0 ? <fieldset className={styles.formFields} disabled={pending}>
        <legend>Attached protocols</legend>
        {protocols.map((protocol) => <label key={protocol.id} className={styles.choice}>
          <input type="checkbox" checked={selected.includes(protocol.id)} onChange={(event) => {
            request.current = null;
            setSelected(event.target.checked ? [...selected, protocol.id] : selected.filter((id) => id !== protocol.id));
            setError(null);
          }} />
          <span className={styles.rehabName}>{protocol.name}</span>
        </label>)}
      </fieldset> : <p className={styles.muted}>No rehab protocols yet.</p>}
      <div className={styles.actions}>
        {changed && <>
          <button className={styles.button} disabled={pending || !revision}>{pending ? "Saving…" : "Save changes"}</button>
          <button type="button" className={styles.secondary} disabled={pending} onClick={() => {
            setSelected(saved); setError(null); request.current = null;
          }}>Cancel</button>
        </>}
        <Link href="/app/settings/rehab-protocols" className={styles.secondary}>Rehab library</Link>
      </div>
    </form> : <ul className={styles.list}>{protocols.map((protocol) => <li key={protocol.id} className={`${styles.row} ${styles.rehabName}`}>{protocol.name}</li>)}</ul>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {warning && <p role="status" className={styles.warning}>{warning}</p>}
  </section>;
}
