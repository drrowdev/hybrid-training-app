import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboxEntry } from "../outbox-core";

const { completeSessionResult, state } = vi.hoisted(() => ({
  completeSessionResult: vi.fn(),
  state: {
    entries: [] as OutboxEntry[],
    removed: [] as string[],
  },
}));

vi.mock("@/lib/sessions/actions", () => ({
  addStrengthSet: vi.fn(),
  addCardioBlock: vi.fn(),
  completeSessionResult,
}));

vi.mock("../outbox", () => ({
  listPending: async () => state.entries,
  remove: async (id: string) => {
    state.removed.push(id);
    state.entries = state.entries.filter((entry) => entry.id !== id);
  },
  recordAttempt: vi.fn(),
  outboxAvailable: () => true,
}));

import { flushOutbox } from "../flusher";

describe("flushOutbox legacy completion upgrade", () => {
  beforeEach(() => {
    state.entries = [
      {
        id: "complete-1712345678901",
        op: "complete",
        sessionId: "00000000-0000-4000-8000-000000000010",
        seq: 1,
        payload: { sessionId: "00000000-0000-4000-8000-000000000010" },
        createdAt: 1_712_345_678_901,
        attempts: 0,
      },
    ];
    state.removed.length = 0;
    completeSessionResult.mockReset();
  });

  it("keeps a legacy completion until the successful atomic completion result", async () => {
    completeSessionResult.mockImplementation(async () => {
      expect(state.entries).toHaveLength(1);
      expect(state.removed).toEqual([]);
      return { ok: true };
    });

    await expect(flushOutbox()).resolves.toEqual({
      flushed: 1,
      remaining: 0,
      dropped: 0,
    });

    expect(completeSessionResult).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000010",
      null,
      "complete-1712345678901",
    );
    expect(state.removed).toEqual(["complete-1712345678901"]);
  });
});
