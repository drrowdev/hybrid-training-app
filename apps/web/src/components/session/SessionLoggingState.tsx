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
  hasCardioLogs: boolean;
  loggedCardioItemIndices: ReadonlySet<number>;
  registerCardioLog: (clientId: string, prescriptionItemIndex: number) => void;
  rollbackCardioLog: (clientId: string) => void;
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
  initialLoggedStrengthClientIds = [],
  initialLoggedCardioItemIndices = [],
  initialUnloggedStrengthCount,
  initialUnloggedRehabIndices = [],
  initialUnloggedRequiredIndices = [],
  children,
}: {
  initialHasStrengthSets: boolean;
  initialLoggedStrengthClientIds?: readonly string[];
  initialLoggedCardioItemIndices?: number[];
  initialUnloggedStrengthCount: number;
  initialUnloggedRehabIndices?: number[];
  initialUnloggedRequiredIndices?: number[];
  children: ReactNode;
}) {
  const [optimisticLogs, setOptimisticLogs] = useState<
    ReadonlyMap<string, number | null>
  >(() => new Map());
  const [completionQueued, setCompletionQueued] = useState(false);
  const [cardioLogs, setCardioLogs] = useState<ReadonlyMap<string, number>>(() => new Map());
  const pendingStrengthLogs = useMemo(() => {
    const acknowledged = new Set(initialLoggedStrengthClientIds);
    const pending = new Map([...optimisticLogs].filter(([id]) => !acknowledged.has(id)));
    return pending.size === optimisticLogs.size ? optimisticLogs : pending;
  }, [initialLoggedStrengthClientIds, optimisticLogs]);
  const pendingCardioLogs = useMemo(() => {
    const acknowledged = new Set(initialLoggedCardioItemIndices);
    const pending = new Map([...cardioLogs].filter(([, index]) => !acknowledged.has(index)));
    return pending.size === cardioLogs.size ? cardioLogs : pending;
  }, [initialLoggedCardioItemIndices, cardioLogs]);
  // Acknowledge observed writes without remounting the live logger or forgetting
  // writes that a delayed snapshot predates. Later deletion must not revive them.
  if (pendingStrengthLogs !== optimisticLogs) setOptimisticLogs(pendingStrengthLogs);
  if (pendingCardioLogs !== cardioLogs) setCardioLogs(pendingCardioLogs);
  const registerCardioLog = useCallback((clientId: string, prescriptionItemIndex: number) => {
    setCardioLogs((current) => current.has(clientId) ? current : new Map(current).set(clientId, prescriptionItemIndex));
  }, []);
  const rollbackCardioLog = useCallback((clientId: string) => {
    setCardioLogs((current) => {
      if (!current.has(clientId)) return current;
      const next = new Map(current); next.delete(clientId); return next;
    });
  }, []);

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
    for (const prescriptionItemIndex of new Set(pendingStrengthLogs.values())) {
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
    const loggedCardioItemIndices = new Set([...initialLoggedCardioItemIndices, ...pendingCardioLogs.values()]);
    for (const index of loggedCardioItemIndices) {
      if (requiredIndices.has(index)) requiredPending += 1;
    }
    return {
      hasStrengthSets: initialHasStrengthSets || pendingStrengthLogs.size > 0,
      hasCardioLogs: loggedCardioItemIndices.size > 0,
      loggedCardioItemIndices, registerCardioLog, rollbackCardioLog,
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
    initialLoggedCardioItemIndices,
    pendingCardioLogs, registerCardioLog, rollbackCardioLog,
    initialUnloggedStrengthCount,
    initialUnloggedRehabIndices,
    initialUnloggedRequiredIndices,
    pendingStrengthLogs,
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
