import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDurableAction } from "../durable-action";
import { enqueue, hasEarlierPending, remove } from "../outbox";

vi.mock("../outbox", () => ({
  enqueue: vi.fn(),
  hasEarlierPending: vi.fn(),
  remove: vi.fn(),
}));

const input = {
  id: "00000000-0000-4000-8000-000000000001",
  op: "set" as const,
  sessionId: "00000000-0000-4000-8000-000000000002",
  payload: { sessionId: "00000000-0000-4000-8000-000000000002" },
};

const entry = {
  ...input,
  seq: 1,
  createdAt: 1,
  attempts: 0,
};

describe("runDurableAction", () => {
  beforeEach(() => {
    vi.mocked(enqueue).mockReset();
    vi.mocked(hasEarlierPending).mockReset();
    vi.mocked(remove).mockReset();
    vi.mocked(hasEarlierPending).mockResolvedValue(false);
    vi.mocked(remove).mockResolvedValue(undefined);
  });

  it("does not claim success when both local durability and the network fail", async () => {
    vi.mocked(enqueue).mockResolvedValue({ status: "failed", error: new Error("IDB failed") });

    const result = await runDurableAction(input, async () => {
      throw new Error("network failed");
    });

    expect(result.status).toBe("failed");
  });

  it("keeps a transient returned error in a durable queue", async () => {
    vi.mocked(enqueue).mockResolvedValue({ status: "stored", entry });

    const result = await runDurableAction(input, async () => ({
      error: "temporary service failure",
      errorCode: "transient" as const,
    }));

    expect(result.status).toBe("queued");
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not overtake an older queued operation", async () => {
    vi.mocked(enqueue).mockResolvedValue({ status: "stored", entry });
    vi.mocked(hasEarlierPending).mockResolvedValue(true);
    const action = vi.fn().mockResolvedValue({ ok: true as const });

    const result = await runDurableAction(input, action);

    expect(result.status).toBe("queued");
    expect(action).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps an uncertain cardio response queued for idempotent replay", async () => {
    vi.mocked(enqueue).mockResolvedValue({
      status: "stored",
      entry: { ...entry, op: "cardio_session" },
    });

    const result = await runDurableAction(
      { ...input, op: "cardio_session" },
      async () => ({
        error: "request timed out after the server may have committed",
        errorCode: "transient" as const,
      }),
    );

    expect(result.status).toBe("queued");
    expect(remove).not.toHaveBeenCalled();
  });
});
