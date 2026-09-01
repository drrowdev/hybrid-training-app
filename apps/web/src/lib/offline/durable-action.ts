import { classifyActionResult, type ActionResult, type OutboxEntry } from "./outbox-core";
import {
  enqueue,
  hasEarlierPending,
  remove,
  type EnqueueInput,
  type EnqueueResult,
} from "./outbox";

export type DurableActionResult<T extends ActionResult> =
  | {
      status: "server";
      result: T;
      entry: OutboxEntry | null;
      cleanupError?: Error;
    }
  | { status: "queued"; result?: T; entry: OutboxEntry }
  | { status: "failed"; result?: T; error?: Error };

export type DurableActionOptions = {
  /**
   * Some mutations, such as session completion, must never be sent without a
   * local recovery record because an uncertain response can include side
   * effects that cannot be safely repeated from the UI.
   */
  requireDurableEnqueue?: boolean;
};

/**
 * Persist an operation before attempting its server action. A stored entry
 * makes thrown and transient returned errors safe to acknowledge locally;
 * without it, only a successful server response may be reported as success.
 */
export async function runDurableAction<T extends ActionResult>(
  input: EnqueueInput,
  action: () => Promise<T>,
  options: DurableActionOptions = {},
): Promise<DurableActionResult<T>> {
  let stored: EnqueueResult;
  try {
    stored = await enqueue(input);
  } catch (error) {
    stored = {
      status: "failed",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  const entry = stored.status === "stored" ? stored.entry : null;

  if (!entry && options.requireDurableEnqueue) {
    return {
      status: "failed",
      error:
        stored.status === "failed"
          ? stored.error
          : new Error("Could not save the operation on this device."),
    };
  }

  if (entry) {
    let waitForEarlier = true;
    try {
      waitForEarlier = await hasEarlierPending(entry.seq);
    } catch {
      // Do not overtake an older operation when queue inspection is uncertain.
    }
    if (waitForEarlier) return { status: "queued", entry };
  }

  let result: T;
  try {
    result = await action();
  } catch (error) {
    if (entry) return { status: "queued", entry };
    return {
      status: "failed",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  const outcome = classifyActionResult(result, false);
  if (outcome === "retry" && entry) {
    return { status: "queued", result, entry };
  }
  if (outcome === "drop") {
    if (entry) await remove(entry.id);
    return { status: "failed", result };
  }
  if (entry) {
    // A successful server write is authoritative even if local cleanup fails;
    // idempotent replay will safely converge on a later flush.
    let cleanupError: Error | undefined;
    try {
      await remove(entry.id);
    } catch (error) {
      cleanupError = error instanceof Error ? error : new Error(String(error));
    }
    return { status: "server", result, entry, cleanupError };
  }
  if (outcome === "retry") return { status: "failed", result };
  return { status: "server", result, entry };
}
