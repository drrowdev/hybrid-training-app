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
  MAX_REPLAY_ATTEMPTS,
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

function isActive(entry: OutboxEntry): boolean {
  return entry.status !== "dead_lettered";
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
  return (await readAll()).filter(isActive);
}

/** Terminal rows kept for the sync badge and support diagnostics. */
export async function listDeadLettered(): Promise<OutboxEntry[]> {
  return (await readAll()).filter((entry) => !isActive(entry));
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
  return sortBySeq((rows as OutboxEntry[]).filter(isActive));
}

/** Terminal rows for one session, kept out of the active logging surface. */
export async function listDeadLetteredForSession(
  sessionId: string,
): Promise<OutboxEntry[]> {
  if (!hasIDB()) return [];
  const db = await openDb();
  const rows = await reqToPromise(
    txStore(db, "readonly").index("by_session").getAll(sessionId),
  );
  return sortBySeq(
    (rows as OutboxEntry[]).filter((entry) => !isActive(entry)),
  );
}

/** Count pending writes for one session without deserialising the queue. */
export async function countForSession(sessionId: string): Promise<number> {
  if (!hasIDB()) return 0;
  const db = await openDb();
  const rows = await reqToPromise(
    txStore(db, "readonly").index("by_session").getAll(sessionId),
  );
  return (rows as OutboxEntry[]).filter(isActive).length;
}

/**
 * Claim one row before its network call. The claim is persisted in the same
 * IndexedDB transaction that reads the row, so a foreground action and a
 * flusher in different tabs cannot send the same entry concurrently.
 */
export async function claimEntry(id: string): Promise<string | null> {
  if (!hasIDB()) return null;
  const db = await openDb();
  return new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let token: string | null = null;
    const request = store.get(id);
    request.onsuccess = () => {
      const entry = request.result as OutboxEntry | undefined;
      if (!entry || !isActive(entry)) return;
      const now = Date.now();
      if (
        entry.leaseToken &&
        typeof entry.leaseExpiresAt === "number" &&
        entry.leaseExpiresAt > now
      ) {
        return;
      }
      token = `${now}-${Math.random().toString(36).slice(2)}`;
      entry.leaseToken = token;
      entry.leaseExpiresAt = now + 60_000;
      store.put(entry);
    };
    request.onerror = () => tx.abort();
    tx.oncomplete = () => resolve(token);
    tx.onerror = () =>
      reject(tx.error ?? new Error("indexedDB claim failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("indexedDB claim aborted"));
  });
}

/** Release a claim only when the caller still owns its token. */
export async function releaseEntry(id: string, token: string): Promise<void> {
  if (!hasIDB()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const entry = request.result as OutboxEntry | undefined;
      if (entry?.leaseToken === token) {
        delete entry.leaseToken;
        delete entry.leaseExpiresAt;
        store.put(entry);
      }
    };
    request.onerror = () => tx.abort();
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("indexedDB release failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("indexedDB release aborted"));
  });
}

/** Mark a terminal failure without deleting its audit trail. */
export async function deadLetter(id: string, reason: string): Promise<void> {
  if (!hasIDB()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const entry = request.result as OutboxEntry | undefined;
      if (!entry) return;
      entry.status = "dead_lettered";
      entry.deadLetterReason = reason;
      entry.lastError = reason;
      delete entry.leaseToken;
      delete entry.leaseExpiresAt;
      store.put(entry);
    };
    request.onerror = () => tx.abort();
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("indexedDB dead-letter failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("indexedDB dead-letter aborted"));
  });
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
      const countReq = store.index("by_session").getAll(sessionId);
      countReq.onsuccess = () => {
        remaining = (countReq.result as OutboxEntry[]).filter(isActive).length;
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

/** Record a failed attempt and dead-letter after the bounded retry limit. */
export async function recordAttempt(
  id: string,
  error: string,
): Promise<{ deadLettered: boolean }> {
  if (!hasIDB()) return { deadLettered: false };
  const db = await openDb();
  return new Promise<{ deadLettered: boolean }>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let deadLettered = false;
    const request = store.get(id);
    request.onsuccess = () => {
      const entry = request.result as OutboxEntry | undefined;
      if (!entry || !isActive(entry)) return;
      entry.attempts += 1;
      entry.lastError = error;
      if (entry.attempts >= MAX_REPLAY_ATTEMPTS) {
        entry.status = "dead_lettered";
        entry.deadLetterReason = error;
        delete entry.leaseToken;
        delete entry.leaseExpiresAt;
        deadLettered = true;
      }
      store.put(entry);
    };
    request.onerror = () => tx.abort();
    tx.oncomplete = () => resolve({ deadLettered });
    tx.onerror = () =>
      reject(tx.error ?? new Error("indexedDB attempt recording failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("indexedDB attempt recording aborted"));
  });
}

/** True when IndexedDB is usable in this runtime. */
export function outboxAvailable(): boolean {
  return hasIDB();
}
