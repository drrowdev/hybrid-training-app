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
  /**
   * Prescribed work still outstanding that the user can't just ignore —
   * excludes warm-ups and optional items. Drives whether the session is
   * presented as "still working" or "ready to finish".
   */
  remainingRequiredSets: number;
  registerStrengthLog: (
    clientId: string,
    prescriptionItemIndex: number | null,
  ) => void;
  rollbackStrengthLog: (clientId: string) => void;
  completionQueued: boolean;
  registerCompletionQueued: (queued: boolean) => void;
};

const Context = createContext<SessionLoggingState | null>(null);

export function SessionLoggingStateProvider({
  initialHasStrengthSets,
  initialUnloggedStrengthCount,
  initialUnloggedRehabIndices = [],
  initialUnloggedRequiredIndices = [],
  children,
}: {
  initialHasStrengthSets: boolean;
  initialUnloggedStrengthCount: number;
  initialUnloggedRehabIndices?: number[];
  initialUnloggedRequiredIndices?: number[];
  children: ReactNode;
}) {
  const [optimisticLogs, setOptimisticLogs] = useState<
    ReadonlyMap<string, number | null>
  >(() => new Map());
  const [completionQueued, setCompletionQueued] = useState(false);

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

  const registerCompletionQueued = useCallback((queued: boolean) => {
    setCompletionQueued(queued);
  }, []);

  const value = useMemo<SessionLoggingState>(() => {
    let prescribedPending = 0;
    let rehabPending = 0;
    let requiredPending = 0;
    const rehabIndices = new Set(initialUnloggedRehabIndices);
    const requiredIndices = new Set(initialUnloggedRequiredIndices);
    for (const prescriptionItemIndex of optimisticLogs.values()) {
      if (prescriptionItemIndex != null) prescribedPending += 1;
      if (
        prescriptionItemIndex != null &&
        rehabIndices.has(prescriptionItemIndex)
      ) {
        rehabPending += 1;
      }
      if (
        prescriptionItemIndex != null &&
        requiredIndices.has(prescriptionItemIndex)
      ) {
        requiredPending += 1;
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
      remainingRequiredSets: Math.max(
        0,
        initialUnloggedRequiredIndices.length - requiredPending,
      ),
      registerStrengthLog,
      rollbackStrengthLog,
      completionQueued,
      registerCompletionQueued,
    };
  }, [
    initialHasStrengthSets,
    initialUnloggedStrengthCount,
    initialUnloggedRehabIndices,
    initialUnloggedRequiredIndices,
    optimisticLogs,
    registerStrengthLog,
    rollbackStrengthLog,
    completionQueued,
    registerCompletionQueued,
  ]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSessionLoggingState(): SessionLoggingState | null {
  return useContext(Context);
}
