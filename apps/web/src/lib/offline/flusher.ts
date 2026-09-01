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
  logCardioSession,
} from "@/lib/sessions/actions";
import {
  claimEntry,
  deadLetter,
  listPending,
  recordAttempt,
  remove,
  releaseEntry,
  outboxAvailable,
} from "./outbox";
import {
  classifyActionResult,
  isUuid,
  payloadToFormData,
  type ActionResult,
  type OutboxEntry,
} from "./outbox-core";

export type FlushResult = {
  flushed: number;
  remaining: number;
  dropped: number;
  completed: number;
  completedSessionIds: string[];
};

let flushing = false;

async function runEntry(
  entry: OutboxEntry,
): Promise<{
  result?: ActionResult;
  threw: boolean;
}> {
  try {
    if (entry.op === "set") {
      const result = await addStrengthSet(payloadToFormData(entry.payload));
      return { result, threw: false };
    }
    if (entry.op === "cardio") {
      const result = await addCardioBlock(payloadToFormData(entry.payload));
      return { result, threw: false };
    }
    if (entry.op === "cardio_session") {
      const result = await logCardioSession(payloadToFormData(entry.payload));
      return { result, threw: false };
    }
    // complete — redirect-free core; payload carries sessionId + optional notes.
    const result = await completeSessionResult(
      entry.payload.sessionId ?? entry.sessionId,
      entry.payload.notes ?? null,
      isUuid(entry.id) ? entry.id : null,
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
    return {
      flushed: 0,
      remaining,
      dropped: 0,
      completed: 0,
      completedSessionIds: [],
    };
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      flushed: 0,
      remaining: (await listPending()).length,
      dropped: 0,
      completed: 0,
      completedSessionIds: [],
    };
  }

  flushing = true;
  let flushed = 0;
  let dropped = 0;
  let completed = 0;
  const completedSessionIds: string[] = [];
  try {
    const pending = await listPending(); // FIFO
    for (const entry of pending) {
      const leaseToken = await claimEntry(entry.id);
      // An active lease means another tab is sending this head. Do not overtake
      // it or FIFO ordering can be broken across tabs.
      if (!leaseToken) break;
      try {
        const { result, threw } = await runEntry(entry);
        const outcome = classifyActionResult(result, threw);
        if (outcome === "done") {
          await remove(entry.id);
          flushed += 1;
          if (entry.op === "complete") {
            completed += 1;
            completedSessionIds.push(entry.sessionId);
          }
        } else if (outcome === "drop") {
          // Explicit validation rejection — discard so it can't wedge the queue.
          await remove(entry.id);
          dropped += 1;
        } else if (outcome === "dead_letter") {
          // Ownership/not-found failures cannot recover by retrying. Keep the
          // row inspectable but skip it so later sessions still make progress.
          await deadLetter(entry.id, result?.error ?? "permanent failure");
          dropped += 1;
        } else {
          // Transient (offline / network). Record + STOP to preserve FIFO order
          // unless this row has exhausted its bounded retry budget.
          const attempt = await recordAttempt(
            entry.id,
            result?.error ?? "network",
          );
          if (attempt.deadLettered) dropped += 1;
          else break;
        }
      } finally {
        await releaseEntry(entry.id, leaseToken);
      }
    }
    const remaining = (await listPending()).length;
    return { flushed, remaining, dropped, completed, completedSessionIds };
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
