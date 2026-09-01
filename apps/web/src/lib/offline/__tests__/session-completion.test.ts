import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimEntry,
  enqueue,
  hasEarlierPending,
  remove,
  releaseEntry,
} from "../outbox";
import {
  enqueueSessionCompletion,
  runSessionCompletion,
} from "../session-completion";

vi.mock("../outbox", () => ({
  claimEntry: vi.fn(),
  enqueue: vi.fn(),
  hasEarlierPending: vi.fn(),
  remove: vi.fn(),
  releaseEntry: vi.fn(),
}));

const sessionId = "00000000-0000-4000-8000-000000000001";

describe("enqueueSessionCompletion", () => {
  beforeEach(() => {
    vi.mocked(enqueue).mockReset();
    vi.mocked(hasEarlierPending).mockReset();
    vi.mocked(remove).mockReset();
    vi.mocked(claimEntry).mockReset();
    vi.mocked(releaseEntry).mockReset();
    vi.mocked(hasEarlierPending).mockResolvedValue(false);
    vi.mocked(remove).mockResolvedValue(undefined);
    vi.mocked(claimEntry).mockResolvedValue("lease");
    vi.mocked(releaseEntry).mockResolvedValue(undefined);
  });

  it("returns a failure instead of claiming completion when local storage rejects", async () => {
    vi.mocked(enqueue).mockRejectedValue(new Error("IDB unavailable"));

    const result = await enqueueSessionCompletion(sessionId);

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ error: new Error("IDB unavailable") });
  });

  it("returns the stored contract when completion is durable", async () => {
    vi.mocked(enqueue).mockResolvedValue({
      status: "stored",
      entry: {
        id: "00000000-0000-4000-8000-000000000002",
        op: "complete",
        sessionId,
        payload: { sessionId, completionEntryId: "receipt" },
        seq: 1,
        createdAt: 1,
        attempts: 0,
      },
    });

    const result = await enqueueSessionCompletion(sessionId);

    expect(result.status).toBe("stored");
    expect(vi.mocked(enqueue)).toHaveBeenCalledWith(
      expect.objectContaining({
        op: "complete",
        sessionId,
        payload: expect.objectContaining({
          sessionId,
          completionEntryId: expect.any(String),
        }),
      }),
    );
  });

  it("enqueues before an online completion request and retains uncertain results", async () => {
    vi.mocked(enqueue).mockResolvedValue({
      status: "stored",
      entry: {
        id: "00000000-0000-4000-8000-000000000002",
        op: "complete",
        sessionId,
        payload: { sessionId, completionEntryId: "receipt" },
        seq: 1,
        createdAt: 1,
        attempts: 0,
      },
    });
    const action = vi.fn().mockResolvedValue({
      error: "request timed out after the server may have committed",
      errorCode: "transient" as const,
    });

    const result = await runSessionCompletion(sessionId, action);

    expect(result.status).toBe("queued");
    expect(action).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledWith(
      vi.mocked(enqueue).mock.calls[0]?.[0].id,
    );
    expect(vi.mocked(enqueue).mock.invocationCallOrder[0]).toBeLessThan(
      action.mock.invocationCallOrder[0]!,
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not request completion when local durability is unavailable", async () => {
    vi.mocked(enqueue).mockResolvedValue({ status: "unavailable" });
    const action = vi.fn().mockResolvedValue({ ok: true as const });

    const result = await runSessionCompletion(sessionId, action);

    expect(result.status).toBe("failed");
    expect(action).not.toHaveBeenCalled();
  });
});
