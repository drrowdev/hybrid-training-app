/**
 * Offline outbox — IndexedDB adapter (browser-only).
 *
 * Durable FIFO queue for offline workout logging. Persists `OutboxEntry` rows
 * so logged sets survive signal loss and app kill, and replays them when
 * connectivity returns (see `./flusher`). Reads are empty when IndexedDB is
 * unavailable (SSR, private-mode quirks); writes return an explicit
 * unavailable/failed status so callers never mistake a missing queue entry
 * for durable local storage.
 *
 * Pure helpers (ordering, payload (de)serialization, retry classification) live
 * in `./outbox-core` and are unit-tested under the node environment; this file
 * is the thin storage shell.
 */

import {
  nextSeq,
  sortBySeq,
  type OutboxEntry,
  type OutboxOp,
} from "./outbox-core";

const DB_NAME = "hta-offline";
const DB_VERSION = 1;
const STORE = "outbox";
let dbPromise: Promise<IDBDatabase> | null = null;
let lastSeq = 0;

function hasIDB(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("by_session", "sessionId", { unique: false });
        store.createIndex("by_seq", "seq", { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        lastSeq = 0;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("indexedDB open failed"));
    };
  });
  return dbPromise;
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
  const all = await reqToPromise(txStore(db, "readonly").getAll());
  return sortBySeq(all as OutboxEntry[]);
}

export type EnqueueInput = {
  id: string;
  op: OutboxOp;
  sessionId: string;
  payload: Record<string, string>;
  metadata?: OutboxEntry["metadata"];
};

export type EnqueueResult =
  | { status: "stored"; entry: OutboxEntry }
  | { status: "unavailable" }
  | { status: "failed"; error: Error };

/**
 * Append an op to the outbox (or overwrite the same id — keyPath collisions are
 * a replay of the same logical write, which is fine). The result explicitly
 * tells callers whether the write is durable locally, unavailable, or failed.
 */
export async function enqueue(input: EnqueueInput): Promise<EnqueueResult> {
  if (!hasIDB()) return { status: "unavailable" };
  try {
    const db = await openDb();
    // One readwrite transaction is serialised across tabs by IndexedDB. Reading
    // the highest sequence from the index and then writing in that same
    // transaction preserves global FIFO without deserialising the full queue.
    const entry = await new Promise<OutboxEntry>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const cursorReq = store.index("by_seq").openKeyCursor(null, "prev");
      let nextEntry: OutboxEntry | null = null;

      cursorReq.onsuccess = () => {
        const storedMax =
          typeof cursorReq.result?.key === "number" ? cursorReq.result.key : 0;
        const now = Date.now();
        lastSeq = nextSeq([lastSeq, storedMax], now);
        nextEntry = {
          id: input.id,
          op: input.op,
          sessionId: input.sessionId,
          seq: lastSeq,
          payload: input.payload,
          metadata: input.metadata,
          createdAt: now,
          attempts: 0,
        };
        store.put(nextEntry);
      };
      cursorReq.onerror = () => {
        tx.abort();
        reject(
          cursorReq.error ?? new Error("indexedDB sequence read failed"),
        );
      };
      tx.oncomplete = () => {
        if (nextEntry) resolve(nextEntry);
        else reject(new Error("indexedDB enqueue failed"));
      };
      tx.onerror = () =>
        reject(tx.error ?? new Error("indexedDB enqueue failed"));
      tx.onabort = () =>
        reject(tx.error ?? new Error("indexedDB enqueue aborted"));
    });
    return { status: "stored", entry };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/** All pending entries, FIFO. Empty when IndexedDB is unavailable. */
export async function listPending(): Promise<OutboxEntry[]> {
  return readAll();
}

/** Whether an older durable operation is still waiting ahead of this one. */
export async function hasEarlierPending(seq: number): Promise<boolean> {
  return (await listPending()).some((entry) => entry.seq < seq);
}

/** Pending entries for one session, FIFO. */
export async function listForSession(sessionId: string): Promise<OutboxEntry[]> {
  if (!hasIDB()) return [];
  const db = await openDb();
  const rows = await reqToPromise(
    txStore(db, "readonly").index("by_session").getAll(sessionId),
  );
  return sortBySeq(rows as OutboxEntry[]);
}

/** Count pending writes for one session without deserialising the queue. */
export async function countForSession(sessionId: string): Promise<number> {
  if (!hasIDB()) return 0;
  const db = await openDb();
  return reqToPromise(
    txStore(db, "readonly").index("by_session").count(sessionId),
  );
}

/** Remove an entry once it has been confirmed persisted (or permanently
 * dropped after a validation rejection). */
export async function remove(id: string): Promise<void> {
  if (!hasIDB()) return;
  const db = await openDb();
  await reqToPromise(txStore(db, "readwrite").delete(id));
}

/** Remove a confirmed write and return the remaining count in one transaction. */
export async function removeAndCountForSession(
  id: string,
  sessionId: string,
): Promise<number> {
  if (!hasIDB()) return 0;
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let remaining = 0;
    const removeReq = store.delete(id);
    removeReq.onsuccess = () => {
      // Queue the count only after WebKit has acknowledged the delete request,
      // then resolve after the whole transaction commits.
      const countReq = store.index("by_session").count(sessionId);
      countReq.onsuccess = () => {
        remaining = countReq.result;
      };
      countReq.onerror = () => {
        tx.abort();
      };
    };
    removeReq.onerror = () => {
      tx.abort();
    };
    tx.oncomplete = () => resolve(remaining);
    tx.onerror = () =>
      reject(tx.error ?? new Error("indexedDB remove/count failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("indexedDB remove/count aborted"));
  });
}

/** Record a failed attempt (transient/network) so retries can back off and the
 * UI can surface a stuck entry. */
export async function recordAttempt(id: string, error: string): Promise<void> {
  if (!hasIDB()) return;
  const db = await openDb();
  const store = txStore(db, "readwrite");
  const entry = (await reqToPromise(store.get(id))) as OutboxEntry | undefined;
  if (!entry) return;
  entry.attempts += 1;
  entry.lastError = error;
  await reqToPromise(store.put(entry));
}

/** True when IndexedDB is usable in this runtime. */
export function outboxAvailable(): boolean {
  return hasIDB();
}
