"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useConfirmedList } from "@/components/ui/useConfirmedList";
import { RESTORED_EVENT_NAME, type UndoTarget } from "@/components/trash/UndoBanner";
import styles from "./ProgramBuilder.module.css";

const ConfirmDeletion = createContext<((id: string) => void) | null>(null);
export const useConfirmBlockDeletion = () => useContext(ConfirmDeletion);

type Group = { key: string; label: string; rows: { id: string; content: ReactNode }[] };

export function BlockHistoryList({ groups, empty }: { groups: Group[]; empty: ReactNode }) {
  const source = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const { rows, remove, restore } = useConfirmedList(source);
  const visible = new Set(rows.map((row) => row.id));
  useEffect(() => {
    const onRestore = (event: Event) => {
      const target = (event as CustomEvent<UndoTarget>).detail;
      if (target.kind === "block") restore(target.id);
    };
    window.addEventListener(RESTORED_EVENT_NAME, onRestore);
    return () => window.removeEventListener(RESTORED_EVENT_NAME, onRestore);
  }, [restore]);

  return <ConfirmDeletion.Provider value={remove}>
    {rows.length === 0 ? empty : <div data-testid="plan-history-list" style={{ display: "grid", gap: 14 }}>
      {groups.map((group) => {
        const remaining = group.rows.filter((row) => visible.has(row.id));
        if (remaining.length === 0) return null;
        return <section key={group.key} data-testid="plan-history-month-group" data-month={group.key}>
          <h2 data-testid="plan-history-month-header" style={{
            position: "sticky", top: 0, zIndex: 1, margin: 0, padding: "8px 4px",
            fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
            color: "var(--cp-text-muted)", background: "var(--cp-bg)", borderBottom: "1px solid var(--cp-border)",
          }}>{group.label}</h2>
          <ul className={styles.historyList}>{remaining.map((row) => <li key={row.id}>{row.content}</li>)}</ul>
        </section>;
      })}
    </div>}
  </ConfirmDeletion.Provider>;
}
