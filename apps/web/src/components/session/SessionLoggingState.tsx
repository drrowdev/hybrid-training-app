"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type SessionLoggingState = {
  hasStrengthSets: boolean;
  remainingPlannedSets: number;
  remainingRehabSets: number;
  registerStrengthLog: (
    clientId: string,
    prescriptionItemIndex: number | null,
  ) => void;
  rollbackStrengthLog: (clientId: string) => void;
};

const Context = createContext<SessionLoggingState | null>(null);

export function SessionLoggingStateProvider({
  initialHasStrengthSets,
  initialUnloggedStrengthCount,
  initialUnloggedRehabIndices = [],
  children,
}: {
  initialHasStrengthSets: boolean;
  initialUnloggedStrengthCount: number;
  initialUnloggedRehabIndices?: number[];
  children: ReactNode;
}) {
  const [optimisticLogs, setOptimisticLogs] = useState<
    ReadonlyMap<string, number | null>
  >(() => new Map());

  const registerStrengthLog = useCallback(
    (clientId: string, prescriptionItemIndex: number | null) => {
      setOptimisticLogs((current) => {
        if (current.has(clientId)) return current;
        const next = new Map(current);
        next.set(clientId, prescriptionItemIndex);
        return next;
      });
    },
    [],
  );

  const rollbackStrengthLog = useCallback((clientId: string) => {
    setOptimisticLogs((current) => {
      if (!current.has(clientId)) return current;
      const next = new Map(current);
      next.delete(clientId);
      return next;
    });
  }, []);

  const value = useMemo<SessionLoggingState>(() => {
    let prescribedPending = 0;
    let rehabPending = 0;
    const rehabIndices = new Set(initialUnloggedRehabIndices);
    for (const prescriptionItemIndex of optimisticLogs.values()) {
      if (prescriptionItemIndex != null) prescribedPending += 1;
      if (
        prescriptionItemIndex != null &&
        rehabIndices.has(prescriptionItemIndex)
      ) {
        rehabPending += 1;
      }
    }
    return {
      hasStrengthSets: initialHasStrengthSets || optimisticLogs.size > 0,
      remainingPlannedSets: Math.max(
        0,
        initialUnloggedStrengthCount - prescribedPending,
      ),
      remainingRehabSets: Math.max(
        0,
        initialUnloggedRehabIndices.length - rehabPending,
      ),
      registerStrengthLog,
      rollbackStrengthLog,
    };
  }, [
    initialHasStrengthSets,
    initialUnloggedStrengthCount,
    initialUnloggedRehabIndices,
    optimisticLogs,
    registerStrengthLog,
    rollbackStrengthLog,
  ]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSessionLoggingState(): SessionLoggingState | null {
  return useContext(Context);
}
