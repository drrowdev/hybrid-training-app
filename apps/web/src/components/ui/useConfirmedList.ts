"use client";

import { useCallback, useState } from "react";

type Row = { id: string };
export type ConfirmedChanges<T extends Row> = { added: T[]; removed: string[] };

export function reconcileConfirmedChanges<T extends Row>(
  source: T[],
  changes: ConfirmedChanges<T>,
): ConfirmedChanges<T> {
  const ids = new Set(source.map((row) => row.id));
  return {
    added: changes.added.filter((row) => !ids.has(row.id)),
    removed: changes.removed.filter((id) => ids.has(id)),
  };
}

export function confirmedList<T extends Row>(source: T[], changes: ConfirmedChanges<T>): T[] {
  const rows = new Map(changes.added.map((row) => [row.id, row]));
  for (const row of source) rows.set(row.id, row);
  for (const id of changes.removed) rows.delete(id);
  return [...rows.values()];
}

/** Hold only confirmed changes until a server snapshot includes them. */
export function useConfirmedList<T extends Row>(source: T[]) {
  const [state, setState] = useState<{ source: T[]; changes: ConfirmedChanges<T> }>({
    source, changes: { added: [], removed: [] },
  });
  let changes = state.changes;
  if (state.source !== source) {
    changes = reconcileConfirmedChanges(source, changes);
    setState({ source, changes });
  }
  const add = useCallback((row: T) => setState((current) => ({
    ...current, changes: reconcileConfirmedChanges(current.source, {
      ...current.changes, added: [...current.changes.added, row],
    }),
  })), []);
  const remove = useCallback((id: string) => setState((current) => ({
    ...current, changes: reconcileConfirmedChanges(current.source, {
      ...current.changes, removed: [...current.changes.removed, id],
    }),
  })), []);
  const restore = useCallback((id: string) => setState((current) => ({
      ...current, changes: { ...current.changes, removed: current.changes.removed.filter((removed) => removed !== id) },
  })), []);
  return { rows: confirmedList(source, changes), add, remove, restore };
}
