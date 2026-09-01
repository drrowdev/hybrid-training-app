import { createClientId } from "./client-id";
import { enqueue, type EnqueueResult } from "./outbox";

/** Store completion intent before confirming an offline finish. */
export async function enqueueSessionCompletion(
  sessionId: string,
): Promise<EnqueueResult> {
  try {
    return await enqueue({
      id: createClientId(),
      op: "complete",
      sessionId,
      payload: { sessionId },
    });
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
