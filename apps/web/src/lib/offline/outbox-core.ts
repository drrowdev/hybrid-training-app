/**
 * Offline outbox — pure core (no IndexedDB, no DOM).
 *
 * The durable queue that backs offline workout logging. Every mutating op (set
 * log, cardio block, session finish) is recorded here BEFORE its network call
 * so it survives signal loss and app kill, then replays FIFO when connectivity
 * returns. This module holds only the pure data shapes + helpers so they can be
 * unit-tested under the `node` vitest environment; the IndexedDB adapter that
 * persists them lives in `./outbox` (browser-only).
 *
 * Idempotency: `set` / `cardio` entries use the server-side `client_log_id`
 * (migration 0097) as their `id`, so a retried flush is a no-op insert. A
 * New `complete` entries have their own durable UUID, which the completion
 * boundary stores as its receipt on the first successful transition. Older
 * non-UUID completion entries remain replayable without a stored receipt.
 * `cardio_session` entries use the same server-side key.
 */

export type OutboxOp = "set" | "cardio" | "cardio_session" | "complete";

export type ActionErrorCode =
  | "validation"
  | "auth"
  | "forbidden"
  | "not_found"
  | "transient";

export type ActionResult = {
  ok?: true;
  error?: string;
  errorCode?: ActionErrorCode;
};

export type OutboxEntry = {
  /** Primary key. For set/cardio this is the `client_log_id` (uuid); new
   * complete entries use a generated uuid, while older entries may not. */
  id: string;
  op: OutboxOp;
  sessionId: string;
  /** Monotonic FIFO ordering — replay must preserve set_index order. */
  seq: number;
  /** Server-action FormData as a plain string map (FormData isn't structured-
   * cloneable into IndexedDB reliably across engines). */
  payload: Record<string, string>;
  /** Optional display metadata needed to render a queued freestyle set. */
  metadata?: {
    movementSlug?: string;
    movementDisplayName?: string;
    movementPrimaryRegion?: string;
  };
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** Terminal entries remain inspectable but never block active FIFO replay. */
  status?: "pending" | "dead_lettered";
  deadLetterReason?: string;
  /** Cross-tab replay lease. */
  leaseToken?: string;
  leaseExpiresAt?: number;
};

/** Create a UUID-shaped durable queue id even in a WebView without randomUUID. */
export function createOutboxEntryId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** A flaky connection cannot retry one poison row forever. */
export const MAX_REPLAY_ATTEMPTS = 5;

/** Next monotonic sequence number — strictly greater than any existing one and
 * never below wall-clock ms, so ordering is stable across reloads. */
export function nextSeq(existingSeqs: readonly number[], now: number): number {
  let max = now;
  for (const s of existingSeqs) if (s >= max) max = s + 1;
  return max;
}

/** FIFO order. Stable on (seq, createdAt, id) so ties never reorder. */
export function sortBySeq(entries: readonly OutboxEntry[]): OutboxEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.seq - b.seq || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Entries for one session, FIFO. */
export function entriesForSession(
  entries: readonly OutboxEntry[],
  sessionId: string,
): OutboxEntry[] {
  return sortBySeq(entries.filter((e) => e.sessionId === sessionId));
}

/** How a failed flush attempt should be treated. */
export type FlushOutcome = "done" | "retry" | "drop" | "dead_letter";

export function classifyActionResult(
  result: ActionResult | undefined,
  threw: boolean,
): FlushOutcome {
  if (threw) return "retry"; // network/offline — keep queued
  if (!result) return "retry"; // no server acknowledgement — keep queued
  if (result?.error) {
    if (result.errorCode === "validation") return "drop";
    if (
      result.errorCode === "not_found" ||
      result.errorCode === "forbidden"
    ) {
      return "dead_letter";
    }
    return "retry";
  }
  return result.ok === true ? "done" : "retry";
}

/** Exponential backoff (ms) with a ceiling, for spacing retried flushes while
 * the session page stays open. The online/visibility triggers flush
 * immediately; this only paces the in-page interval retries. */
export function backoffMs(attempts: number): number {
  const base = 2000;
  const max = 60_000;
  return Math.min(max, base * 2 ** Math.max(0, attempts - 1));
}

/** Build a FormData for a server action from a stored payload map. */
export function payloadToFormData(payload: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(payload)) fd.append(k, v);
  return fd;
}

/** Snapshot a FormData into a plain string map for durable storage. Non-string
 * (File) parts are skipped — log payloads are all scalar fields. */
export function formDataToPayload(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Count of unsynced entries, for the status indicator. */
export function pendingCount(entries: readonly OutboxEntry[]): number {
  return entries.length;
}
