import { createClientId } from "./client-id";
import { enqueue, type EnqueueInput, type EnqueueResult } from "./outbox";
import {
  runDurableAction,
  type DurableActionResult,
} from "./durable-action";
import type { ActionResult } from "./outbox-core";

export function sessionCompletionInput(sessionId: string): EnqueueInput {
  const completionEntryId = createClientId();
  return {
    id: completionEntryId,
    op: "complete",
    sessionId,
    payload: { sessionId, completionEntryId },
  };
}

export function runSessionCompletion<T extends ActionResult>(
  sessionId: string,
  action: (completionEntryId: string) => Promise<T>,
): Promise<DurableActionResult<T>> {
  const input = sessionCompletionInput(sessionId);
  return runDurableAction(input, () => action(input.id), {
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
