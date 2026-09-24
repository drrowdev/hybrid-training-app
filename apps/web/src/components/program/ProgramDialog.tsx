"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./ProgramBuilder.module.css";

export function ProgramDialog({ title, children, onClose, onBack, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; onBack?: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return <dialog ref={ref} className={styles.programDialog} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget || busy) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className={styles.dialogHeader}>
      {onBack && <button className={styles.dialogIconButton} onClick={onBack} disabled={busy} aria-label="Back"><ProgramIcon kind="back" /></button>}
      <h2 id={titleId}>{title}</h2>
      <button className={styles.dialogIconButton} onClick={onClose} disabled={busy} aria-label="Close"><ProgramIcon kind="close" /></button>
    </header>
    {children}
  </dialog>;
}

export function ProgramConfirmation({ name, ending = false, pending, error, onCancel, onConfirm }: {
  name: string; ending?: boolean; pending: boolean; error?: string | null; onCancel: () => void; onConfirm: () => void;
}) {
  return <ProgramDialog title={`${ending ? "End" : "Replace"} ${name}?`} onClose={onCancel} busy={pending}>
    <p className={styles.confirmCopy}>{ending ? "It moves to Program history." : `${name} ends and moves to Program history.`}</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.confirmActions}>
      <button type="button" className={styles.button} disabled={pending} onClick={onCancel}>Cancel</button>
      <button type="button" className={`${styles.button} ${ending ? styles.danger : styles.primary}`} disabled={pending} onClick={onConfirm}>
        {ending ? "End program" : "Replace program"}
      </button>
    </div>
  </ProgramDialog>;
}

export function ProgramIcon({ kind }: { kind: "strength" | "running" | "swimming" | "hybrid" | "program" | "lock" | "chevron" | "swap" | "plus" | "back" | "close" }) {
  const paths = {
    strength: <><path d="m6 6 12 12M3 8l5-5M16 21l5-5M2 5l3-3M19 22l3-3" /></>,
    running: <><circle cx="15" cy="4" r="2" /><path d="m12 8 4 4 4 1M5 10l5-3 3 2-3 6 4 3v4M10 15l-4 5H2" /></>,
    swimming: <><circle cx="17" cy="7" r="2" /><path d="m4 13 5-5 5 5M9 8l3-4 3 1M2 17q3-3 5 0t5 0 5 0 5 0M2 21q3-3 5 0t5 0 5 0 5 0" /></>,
    hybrid: <><path d="M4 7h6l4 10h6M4 17h6l4-10h6M17 4l3 3-3 3M17 14l3 3-3 3" /></>,
    program: <><rect x="4" y="4" width="16" height="17" rx="2" /><path d="M8 2v4M16 2v4M8 11h8M8 16h5" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    swap: <path d="M3 7h18l-4-4M21 17H3l4 4" />,
    plus: <path d="M12 5v14M5 12h14" />,
    back: <path d="m14 5-7 7 7 7" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}
