/**
 * Stable identity for a single swap/drop within a limitation-response plan.
 *
 * Lives in its own dependency-free module so both the server (re-derive +
 * persist) and the client review card can produce identical keys without
 * the card pulling any server-only code into the browser bundle.
 *
 * A `(sessionId, itemIndex)` pair is unique across the whole plan: itemIndex
 * is the position of the offending item inside its session's prescription,
 * and a session id appears once. `#` never occurs in a UUID, so the join is
 * unambiguous.
 */
export function limitationItemKey(sessionId: string, itemIndex: number): string {
  return `${sessionId}#${itemIndex}`;
}
