import { beforeEach, describe, expect, it, vi } from "vitest";
import { addStrengthSet, completeSessionResult } from "@/lib/sessions/actions";
import { completeSwimWorkoutResult } from "@/lib/swim/actions";
import {
  claimEntry,
  deadLetter,
  listPending,
  outboxAvailable,
  recordAttempt,
  remove,
  releaseEntry,
} from "../outbox";
import { flushOutbox } from "../flusher";
import type { OutboxEntry } from "../outbox-core";

vi.mock("@/lib/sessions/actions", () => ({
  addCardioBlock: vi.fn(),
  addStrengthSet: vi.fn(),
  completeSessionResult: vi.fn(),
  logCardioSession: vi.fn(),
}));
vi.mock("@/lib/swim/actions", () => ({
  completeSwimWorkoutResult: vi.fn(),
}));

vi.mock("../outbox", () => ({
  claimEntry: vi.fn(),
  deadLetter: vi.fn(),
  listPending: vi.fn(),
  outboxAvailable: vi.fn(),
  recordAttempt: vi.fn(),
  remove: vi.fn(),
  releaseEntry: vi.fn(),
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
    vi.clearAllMocks();
    queue = [entry];
    vi.mocked(addStrengthSet).mockReset();
    vi.mocked(completeSessionResult).mockReset();
    vi.mocked(completeSwimWorkoutResult).mockReset();
    vi.mocked(listPending).mockImplementation(async () => [...queue]);
    vi.mocked(outboxAvailable).mockReturnValue(true);
    vi.mocked(claimEntry).mockResolvedValue("lease");
    vi.mocked(deadLetter).mockImplementation(async (id) => {
      queue = queue.filter((item) => item.id !== id);
    });
    vi.mocked(recordAttempt).mockReset();
    vi.mocked(recordAttempt).mockResolvedValue({ deadLettered: false });
    vi.mocked(remove).mockImplementation(async (id) => {
      queue = queue.filter((item) => item.id !== id);
    });
    vi.mocked(releaseEntry).mockResolvedValue(undefined);
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
      completedSessionIds: [],
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
      completedSessionIds: [],
    });
    expect(remove).toHaveBeenCalledWith(entry.id);
  });

  it("counts and removes a completion only after the server confirms it", async () => {
    queue = [
      {
        ...entry,
        op: "complete",
        payload: {
          sessionId: entry.sessionId,
          completionEntryId: entry.id,
        },
      },
    ];
    vi.mocked(completeSessionResult).mockResolvedValue({ ok: true });

    const result = await flushOutbox();

    expect(result).toEqual({
      flushed: 1,
      remaining: 0,
      dropped: 0,
      completed: 1,
      completedSessionIds: [entry.sessionId],
    });
    expect(remove).toHaveBeenCalledWith(entry.id);
    expect(completeSessionResult).toHaveBeenCalledWith(
      entry.sessionId,
      null,
      entry.id,
    );
  });

  it("replays legacy completion ids without forwarding an invalid receipt", async () => {
    queue = [
      {
        ...entry,
        id: "complete-1700000000000",
        op: "complete",
        payload: { sessionId: entry.sessionId },
      },
    ];
    vi.mocked(completeSessionResult).mockResolvedValue({ ok: true });

    const result = await flushOutbox();

    expect(result.completedSessionIds).toEqual([entry.sessionId]);
    expect(completeSessionResult).toHaveBeenCalledWith(
      entry.sessionId,
      null,
      null,
    );
    expect(remove).toHaveBeenCalledWith("complete-1700000000000");
  });

  it("ADR0079 replays native swimming actuals with the durable receipt and reports completion", async () => {
    queue = [{
      ...entry,
      op: "swim_complete",
      payload: { workoutId: "swim-id", result: '{"totalLengths":12}', sessionId: entry.sessionId },
    }];
    vi.mocked(completeSwimWorkoutResult).mockResolvedValue({ ok: true });
    const result = await flushOutbox();
    const payload = vi.mocked(completeSwimWorkoutResult).mock.calls[0]![0];
    expect(payload.get("clientLogId")).toBe(entry.id);
    expect(payload.get("result")).toBe('{"totalLengths":12}');
    expect(result.completedSessionIds).toEqual([entry.sessionId]);
    expect(completeSessionResult).not.toHaveBeenCalled();
  });

  it("ADR0079 an uncertain swim response keeps its exact payload ahead of later work", async () => {
    const swim = { ...entry, op: "swim_complete" as const, payload: { result: '{"totalLengths":12}' } };
    queue = [swim, { ...entry, id: "next", seq: 2 }];
    vi.mocked(completeSwimWorkoutResult).mockRejectedValue(new Error("network lost after commit"));
    await flushOutbox();
    expect(queue[0]).toEqual(swim);
    expect(addStrengthSet).not.toHaveBeenCalled();
    vi.mocked(completeSwimWorkoutResult).mockResolvedValue({ ok: true });
    vi.mocked(addStrengthSet).mockResolvedValue({ ok: true });
    const result = await flushOutbox();
    expect(result.flushed).toBe(2);
    expect(result.completedSessionIds).toEqual([entry.sessionId]);
  });

  it("keeps rejected native swim entries inspectable while later non-swim work continues", async () => {
    queue = [
      { ...entry, op: "swim_complete" },
      { ...entry, id: "00000000-0000-4000-8000-000000000003", seq: 2 },
    ];
    vi.mocked(completeSwimWorkoutResult).mockResolvedValue({ error: "Split lengths exceed your total.", errorCode: "validation" });
    vi.mocked(addStrengthSet).mockResolvedValue({ ok: true });
    const result = await flushOutbox();
    expect(result).toMatchObject({ dropped: 1, flushed: 1, remaining: 0, completed: 0 });
    expect(deadLetter).toHaveBeenCalledWith(entry.id, "Split lengths exceed your total.");
    expect(remove).not.toHaveBeenCalledWith(entry.id);
  });

  it("skips a terminal poison head and continues the global FIFO", async () => {
    const nextEntry = {
      ...entry,
      id: "00000000-0000-4000-8000-000000000003",
      seq: 2,
    };
    queue = [entry, nextEntry];
    vi.mocked(addStrengthSet)
      .mockResolvedValueOnce({
        error: "Not your session.",
        errorCode: "forbidden",
      })
      .mockResolvedValueOnce({ ok: true });

    const result = await flushOutbox();

    expect(result).toEqual({
      flushed: 1,
      remaining: 0,
      dropped: 1,
      completed: 0,
      completedSessionIds: [],
    });
    expect(deadLetter).toHaveBeenCalledWith(entry.id, "Not your session.");
    expect(addStrengthSet).toHaveBeenCalledTimes(2);
  });

  it("does not overtake a FIFO head leased by another tab", async () => {
    const nextEntry = {
      ...entry,
      id: "00000000-0000-4000-8000-000000000003",
      seq: 2,
    };
    queue = [entry, nextEntry];
    vi.mocked(claimEntry).mockResolvedValueOnce(null);

    const result = await flushOutbox();

    expect(result).toEqual({
      flushed: 0,
      remaining: 2,
      dropped: 0,
      completed: 0,
      completedSessionIds: [],
    });
    expect(addStrengthSet).not.toHaveBeenCalled();
  });

  it("dead-letters an exhausted transient head and still flushes later work", async () => {
    const nextEntry = {
      ...entry,
      id: "00000000-0000-4000-8000-000000000003",
      seq: 2,
    };
    queue = [{ ...entry, attempts: 4 }, nextEntry];
    vi.mocked(addStrengthSet)
      .mockResolvedValueOnce({
        error: "temporary service failure",
        errorCode: "transient",
      })
      .mockResolvedValueOnce({ ok: true });
    vi.mocked(recordAttempt).mockImplementationOnce(async (id) => {
      queue = queue.filter((item) => item.id !== id);
      return { deadLettered: true };
    });

    const result = await flushOutbox();

    expect(result).toEqual({
      flushed: 1,
      remaining: 0,
      dropped: 1,
      completed: 0,
      completedSessionIds: [],
    });
    expect(addStrengthSet).toHaveBeenCalledTimes(2);
  });
});
