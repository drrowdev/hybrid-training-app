export type SwimDraft = {
  checked: string[];
  lengths: string;
  time: string;
  rpe: string;
  notes: string;
  reason: string;
  splits: string;
  queuedId?: string;
  acceptedId?: string;
  stroke?: string;
  equipment?: string[];
  pool?: string;
  poolNumerator?: string;
  poolDenominator?: string;
  poolUnit?: string;
};

export function swimDraftKey(userId: string, workoutId: string): string {
  return `hta:swim:${userId}:${workoutId}`;
}

export function persistSwimDraft(
  storage: Pick<Storage, "setItem" | "removeItem">,
  key: string,
  draft: SwimDraft,
  hasServerResult: boolean,
): void {
  if (hasServerResult) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(draft));
}

export function readSwimDraft(value: string | null): SwimDraft | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const draft = parsed as Partial<SwimDraft>;
    if (!Array.isArray(draft.checked) || !draft.checked.every((id) => typeof id === "string")) return null;
    for (const key of ["lengths", "time", "rpe", "notes", "reason", "splits"] as const) {
      if (typeof draft[key] !== "string") return null;
    }
    if (draft.queuedId !== undefined && typeof draft.queuedId !== "string") return null;
    if (draft.acceptedId !== undefined && typeof draft.acceptedId !== "string") return null;
    for (const key of ["stroke", "pool", "poolNumerator", "poolDenominator", "poolUnit"] as const) {
      if (draft[key] !== undefined && typeof draft[key] !== "string") return null;
    }
    if (draft.equipment !== undefined && (!Array.isArray(draft.equipment) || !draft.equipment.every((piece) => typeof piece === "string"))) return null;
    return draft as SwimDraft;
  } catch {
    return null;
  }
}
