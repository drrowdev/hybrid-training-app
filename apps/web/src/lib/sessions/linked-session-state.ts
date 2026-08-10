export type LinkedSessionSnapshot = {
  id: string;
  completedAt: string | null;
  deletedAt: string | null;
};

export type LinkedSessionRelation =
  | {
      deleted_at: string | null;
      completed_at?: string | null;
    }
  | Array<{
      deleted_at: string | null;
      completed_at?: string | null;
    }>
  | null
  | undefined;

export function resolveLinkedSessionRelation(
  linkedId: string | null,
  relation: LinkedSessionRelation,
) {
  const session = Array.isArray(relation) ? relation[0] : relation;
  return resolveLinkedSession(
    linkedId,
    session && linkedId
      ? {
          id: linkedId,
          completedAt: session.completed_at ?? null,
          deletedAt: session.deleted_at,
        }
      : null,
  );
}

export function isUnstartedLinkedSession(
  linkedId: string | null,
  relation: LinkedSessionRelation,
): boolean {
  const resolved = resolveLinkedSessionRelation(linkedId, relation);
  return (
    resolved.completedSessionId == null &&
    resolved.deletedCompletedSessionId == null
  );
}

export function resolveLinkedSession(
  linkedId: string | null,
  snapshot: LinkedSessionSnapshot | null | undefined,
): {
  completedSessionId: string | null;
  completedAt: string | null;
  deletedCompletedSessionId: string | null;
} {
  if (!linkedId || !snapshot) {
    return {
      completedSessionId: null,
      completedAt: null,
      deletedCompletedSessionId: null,
    };
  }
  if (snapshot.deletedAt != null) {
    return {
      completedSessionId: null,
      completedAt: null,
      deletedCompletedSessionId:
        snapshot.completedAt != null ? snapshot.id : null,
    };
  }
  return {
    completedSessionId: snapshot.id,
    completedAt: snapshot.completedAt,
    deletedCompletedSessionId: null,
  };
}
