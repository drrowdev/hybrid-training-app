import { createClientId } from "./client-id";
import { enqueue, type EnqueueInput, type EnqueueResult } from "./outbox";
import {
  runDurableAction,
  type DurableActionResult,
} from "./durable-action";
import type { ActionResult } from "./outbox-core";

export function sessionCompletionInput(sessionId: string): EnqueueInput {
  return {
    id: createClientId(),
    op: "complete",
    sessionId,
    payload: { sessionId },
  };
}

export function runSessionCompletion<T extends ActionResult>(
  sessionId: string,
  action: () => Promise<T>,
): Promise<DurableActionResult<T>> {
  return runDurableAction(sessionCompletionInput(sessionId), action, {
    requireDurableEnqueue: true,
  });
}

/** Store completion intent before attempting a finish request. */
export async function enqueueSessionCompletion(
  sessionId: string,
): Promise<EnqueueResult> {
  try {
    return await enqueue(sessionCompletionInput(sessionId));
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
