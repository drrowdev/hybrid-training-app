"use client";

/**
 * Offline outbox flusher (browser-only).
 *
 * Drains the IndexedDB outbox FIFO, replaying each queued op through its
 * existing server action. Ordering is preserved (set_index correctness depends
 * on it), so a single transient failure STOPS the drain — the remaining entries
 * stay queued and retry on the next trigger rather than flushing out of order.
 *
 * Triggers (registered by `startAutoFlush`): the `online` event, tab/app
 * foreground (`visibilitychange`), and a light interval while a session page is
 * mounted. iOS WKWebView has no Background Sync API, so there is no true
 * background flush — we flush whenever the app is foregrounded and online.
 */

import {
  addStrengthSet,
  addCardioBlock,
  completeSessionResult,
} from "@/lib/sessions/actions";
import {
  listPending,
  recordAttempt,
  remove,
  outboxAvailable,
} from "./outbox";
import {
  classifyActionResult,
  payloadToFormData,
  type OutboxEntry,
} from "./outbox-core";

export type FlushResult = { flushed: number; remaining: number; dropped: number };

let flushing = false;

async function runEntry(
  entry: OutboxEntry,
): Promise<{ result?: { ok?: true; error?: string }; threw: boolean }> {
  try {
    if (entry.op === "set") {
      const result = await addStrengthSet(payloadToFormData(entry.payload));
      return { result, threw: false };
    }
    if (entry.op === "cardio") {
      const result = await addCardioBlock(payloadToFormData(entry.payload));
      return { result, threw: false };
    }
    // complete — redirect-free core; payload carries sessionId + optional notes.
    const result = await completeSessionResult(
      entry.payload.sessionId ?? entry.sessionId,
      entry.payload.notes ?? null,
    );
    return { result, threw: false };
  } catch {
    return { threw: true };
  }
}

/**
 * Drain the outbox FIFO. Returns counts. Concurrency-guarded — overlapping
 * triggers (online + visibility firing together) collapse into one drain.
 */
export async function flushOutbox(): Promise<FlushResult> {
  if (!outboxAvailable() || flushing) {
    const remaining = outboxAvailable() ? (await listPending()).length : 0;
    return { flushed: 0, remaining, dropped: 0 };
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { flushed: 0, remaining: (await listPending()).length, dropped: 0 };
  }

  flushing = true;
  let flushed = 0;
  let dropped = 0;
  try {
    const pending = await listPending(); // FIFO
    for (const entry of pending) {
      const { result, threw } = await runEntry(entry);
      const outcome = classifyActionResult(result, threw);
      if (outcome === "done") {
        await remove(entry.id);
        flushed += 1;
      } else if (outcome === "drop") {
        // Permanent validation rejection — discard so it can't wedge the queue.
        await remove(entry.id);
        dropped += 1;
      } else {
        // Transient (offline / network). Record + STOP to preserve FIFO order.
        await recordAttempt(entry.id, result?.error ?? "network");
        break;
      }
    }
    const remaining = (await listPending()).length;
    return { flushed, remaining, dropped };
  } finally {
    flushing = false;
  }
}

/**
 * Register flush triggers. Returns a cleanup function. Safe to call from a
 * client component mount; no-ops on the server or when IndexedDB is missing.
 */
export function startAutoFlush(
  onChange?: (result: FlushResult) => void,
  intervalMs = 15000,
): () => void {
  if (typeof window === "undefined" || !outboxAvailable()) return () => {};

  let stopped = false;
  const tick = () => {
    void flushOutbox().then((r) => {
      if (!stopped) onChange?.(r);
    });
  };

  const onOnline = () => tick();
  const onVisible = () => {
    if (document.visibilityState === "visible") tick();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  const interval = window.setInterval(tick, intervalMs);

  // Kick once on mount so a relaunch-with-signal drains immediately.
  tick();

  return () => {
    stopped = true;
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(interval);
  };
}
