import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueue } from "../outbox";
import { enqueueSessionCompletion } from "../session-completion";

vi.mock("../outbox", () => ({
  enqueue: vi.fn(),
}));

const sessionId = "00000000-0000-4000-8000-000000000001";

describe("enqueueSessionCompletion", () => {
  beforeEach(() => {
    vi.mocked(enqueue).mockReset();
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
        payload: { sessionId },
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
        payload: { sessionId },
      }),
    );
  });
});
