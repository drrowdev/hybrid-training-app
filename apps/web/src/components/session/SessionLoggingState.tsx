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
  registerStrengthLog: (clientId: string, prescribed: boolean) => void;
  rollbackStrengthLog: (clientId: string) => void;
};

const Context = createContext<SessionLoggingState | null>(null);

export function SessionLoggingStateProvider({
  initialHasStrengthSets,
  initialUnloggedStrengthCount,
  children,
}: {
  initialHasStrengthSets: boolean;
  initialUnloggedStrengthCount: number;
  children: ReactNode;
}) {
  const [optimisticLogs, setOptimisticLogs] = useState<
    ReadonlyMap<string, boolean>
  >(() => new Map());

  const registerStrengthLog = useCallback(
    (clientId: string, prescribed: boolean) => {
      setOptimisticLogs((current) => {
        if (current.has(clientId)) return current;
        const next = new Map(current);
        next.set(clientId, prescribed);
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
    for (const prescribed of optimisticLogs.values()) {
      if (prescribed) prescribedPending += 1;
    }
    return {
      hasStrengthSets: initialHasStrengthSets || optimisticLogs.size > 0,
      remainingPlannedSets: Math.max(
        0,
        initialUnloggedStrengthCount - prescribedPending,
      ),
      registerStrengthLog,
      rollbackStrengthLog,
    };
  }, [
    initialHasStrengthSets,
    initialUnloggedStrengthCount,
    optimisticLogs,
    registerStrengthLog,
    rollbackStrengthLog,
  ]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSessionLoggingState(): SessionLoggingState | null {
  return useContext(Context);
}
