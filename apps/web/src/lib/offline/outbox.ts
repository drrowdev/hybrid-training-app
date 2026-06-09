/**
 * Offline outbox — IndexedDB adapter (browser-only).
 *
 * Durable FIFO queue for offline workout logging. Persists `OutboxEntry` rows
 * so logged sets survive signal loss and app kill, and replays them when
 * connectivity returns (see `./flusher`). All methods are no-ops / empty when
 * IndexedDB is unavailable (SSR, private-mode quirks) so callers can always
 * fall through to the plain online path.
 *
 * Pure helpers (ordering, payload (de)serialization, retry classification) live
 * in `./outbox-core` and are unit-tested under the node environment; this file
 * is the thin storage shell.
 */

import {
  entriesForSession,
  nextSeq,
  sortBySeq,
  type OutboxEntry,
  type OutboxOp,
} from "./outbox-core";

const DB_NAME = "hta-offline";
const DB_VERSION = 1;
const STORE = "outbox";

function hasIDB(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("by_session", "sessionId", { unique: false });
        store.createIndex("by_seq", "seq", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
  });
}

async function readAll(): Promise<OutboxEntry[]> {
  if (!hasIDB()) return [];
  const db = await openDb();
  try {
    const all = await reqToPromise(txStore(db, "readonly").getAll());
    return sortBySeq(all as OutboxEntry[]);
  } finally {
    db.close();
  }
}

export type EnqueueInput = {
  id: string;
  op: OutboxOp;
  sessionId: string;
  payload: Record<string, string>;
};

/**
 * Append an op to the outbox (or overwrite the same id — keyPath collisions are
 * a replay of the same logical write, which is fine). Returns the stored entry,
 * or null when IndexedDB is unavailable so the caller can fall back to the
 * plain online path.
 */
export async function enqueue(input: EnqueueInput): Promise<OutboxEntry | null> {
  if (!hasIDB()) return null;
  const db = await openDb();
  try {
    const existing = (await reqToPromise(
      txStore(db, "readonly").getAll(),
    )) as OutboxEntry[];
    const now = Date.now();
    const entry: OutboxEntry = {
      id: input.id,
      op: input.op,
      sessionId: input.sessionId,
      seq: nextSeq(
        existing.map((e) => e.seq),
        now,
      ),
      payload: input.payload,
      createdAt: now,
      attempts: 0,
    };
    await reqToPromise(txStore(db, "readwrite").put(entry));
    return entry;
  } finally {
    db.close();
  }
}

/** All pending entries, FIFO. Empty when IndexedDB is unavailable. */
export async function listPending(): Promise<OutboxEntry[]> {
  return readAll();
}

/** Pending entries for one session, FIFO. */
export async function listForSession(sessionId: string): Promise<OutboxEntry[]> {
  return entriesForSession(await readAll(), sessionId);
}

/** Remove an entry once it has been confirmed persisted (or permanently
 * dropped after a validation rejection). */
export async function remove(id: string): Promise<void> {
  if (!hasIDB()) return;
  const db = await openDb();
  try {
    await reqToPromise(txStore(db, "readwrite").delete(id));
  } finally {
    db.close();
  }
}

/** Record a failed attempt (transient/network) so retries can back off and the
 * UI can surface a stuck entry. */
export async function recordAttempt(id: string, error: string): Promise<void> {
  if (!hasIDB()) return;
  const db = await openDb();
  try {
    const store = txStore(db, "readwrite");
    const entry = (await reqToPromise(store.get(id))) as OutboxEntry | undefined;
    if (!entry) return;
    entry.attempts += 1;
    entry.lastError = error;
    await reqToPromise(store.put(entry));
  } finally {
    db.close();
  }
}

/** True when IndexedDB is usable in this runtime. */
export function outboxAvailable(): boolean {
  return hasIDB();
}
