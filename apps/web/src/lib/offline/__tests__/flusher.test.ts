import { beforeEach, describe, expect, it, vi } from "vitest";
import { addStrengthSet, completeSessionResult } from "@/lib/sessions/actions";
import {
  listPending,
  outboxAvailable,
  recordAttempt,
  remove,
} from "../outbox";
import { flushOutbox } from "../flusher";
import type { OutboxEntry } from "../outbox-core";

vi.mock("@/lib/sessions/actions", () => ({
  addCardioBlock: vi.fn(),
  addStrengthSet: vi.fn(),
  completeSessionResult: vi.fn(),
  logCardioSession: vi.fn(),
}));

vi.mock("../outbox", () => ({
  listPending: vi.fn(),
  outboxAvailable: vi.fn(),
  recordAttempt: vi.fn(),
  remove: vi.fn(),
}));

const entry: OutboxEntry = {
  id: "00000000-0000-4000-8000-000000000001",
  op: "set",
  sessionId: "00000000-0000-4000-8000-000000000002",
  seq: 1,
  payload: { sessionId: "00000000-0000-4000-8000-000000000002" },
  createdAt: 1,
  attempts: 0,
};

describe("flushOutbox", () => {
  let queue: OutboxEntry[];

  beforeEach(() => {
    queue = [entry];
    vi.mocked(addStrengthSet).mockReset();
    vi.mocked(listPending).mockImplementation(async () => [...queue]);
    vi.mocked(outboxAvailable).mockReturnValue(true);
    vi.mocked(recordAttempt).mockReset();
    vi.mocked(remove).mockImplementation(async (id) => {
      queue = queue.filter((item) => item.id !== id);
    });
  });

  it("keeps a transient returned error queued and stops the FIFO drain", async () => {
    vi.mocked(addStrengthSet).mockResolvedValue({
      error: "temporary Supabase failure",
      errorCode: "transient",
    });

    const result = await flushOutbox();

    expect(result).toEqual({
      flushed: 0,
      remaining: 1,
      dropped: 0,
      completed: 0,
    });
    expect(recordAttempt).toHaveBeenCalledWith(
      entry.id,
      "temporary Supabase failure",
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("drops only explicitly invalid entries and reports the drop", async () => {
    vi.mocked(addStrengthSet).mockResolvedValue({
      error: "Invalid reps",
      errorCode: "validation",
    });

    const result = await flushOutbox();

    expect(result).toEqual({
      flushed: 0,
      remaining: 0,
      dropped: 1,
      completed: 0,
    });
    expect(remove).toHaveBeenCalledWith(entry.id);
  });

  it("counts and removes a completion only after the server confirms it", async () => {
    queue = [
      {
        ...entry,
        op: "complete",
        payload: { sessionId: entry.sessionId },
      },
    ];
    vi.mocked(completeSessionResult).mockResolvedValue({ ok: true });

    const result = await flushOutbox();

    expect(result).toEqual({
      flushed: 1,
      remaining: 0,
      dropped: 0,
      completed: 1,
    });
    expect(remove).toHaveBeenCalledWith(entry.id);
  });
});
