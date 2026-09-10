import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCardioBlock, addStrengthSet, completeSessionResult, logCardioSession } from "@/lib/sessions/actions";
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
import { flushOutbox, startAutoFlush } from "../flusher";
import type { ActionResult, OutboxEntry } from "../outbox-core";
import type { SwimCompletion } from "@/lib/swim/view-types";
import { swimFixture, userId } from "@/lib/swim/__tests__/fixtures";
import { workoutPresentation } from "@/lib/swim/presentation";

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

const swimWorkout = swimFixture().workouts[0]!;
const swimEntry: OutboxEntry = {
  ...entry, op: "swim_complete", payload: { ...entry.payload, workoutId: swimWorkout.id },
};
const completion: SwimCompletion = {
  receiptId: entry.id, sessionId: entry.sessionId, workoutId: swimWorkout.id, userId,
  view: {
    ...workoutPresentation(swimWorkout.definition.issued),
    id: swimWorkout.id, sessionId: entry.sessionId, revision: 3, status: "completed",
    planStatus: "active", date: swimWorkout.scheduled_date, provisional: false, deleted: false,
    result: { lengths: 12, timeMs: 900123, stroke: "freestyle", notes: "Canonical result" },
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe("flushOutbox", () => {
  let queue: OutboxEntry[];

  beforeEach(() => {
    vi.clearAllMocks();
    queue = [entry];
    vi.mocked(addCardioBlock).mockReset();
    vi.mocked(addStrengthSet).mockReset();
    vi.mocked(completeSessionResult).mockReset();
    vi.mocked(logCardioSession).mockReset();
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

  it.each(["initial", "remaining"] as const)(
    "DC-SW8 drains a new native completion requested after the %s empty snapshot",
    async (boundary) => {
      queue = [];
      const snapshot = deferred<OutboxEntry[]>();
      const snapshotRead = deferred<void>();
      if (boundary === "remaining") vi.mocked(listPending).mockResolvedValueOnce([]);
      vi.mocked(listPending).mockImplementationOnce(() => {
        snapshotRead.resolve();
        return snapshot.promise;
      });
      vi.mocked(completeSwimWorkoutResult).mockResolvedValue({ ok: true, completion });
      const running = flushOutbox();
      await snapshotRead.promise;
      queue.push(swimEntry);
      const submitted = flushOutbox();
      snapshot.resolve([]);

      const results = await Promise.all([running, submitted]);

      expect(queue).toEqual([]);
      expect(completeSwimWorkoutResult).toHaveBeenCalledOnce();
      expect(vi.mocked(claimEntry).mock.calls).toEqual([[entry.id]]);
      expect(vi.mocked(releaseEntry).mock.calls).toEqual([[entry.id, "lease"]]);
      expect(results[0]).toEqual({
        flushed: 1, remaining: 0, dropped: 0, completed: 1,
        completedSessionIds: [entry.sessionId],
        swimCompletions: [completion],
      });
      expect(results[1]).toEqual(results[0]);
      expect(results[0]!.swimCompletions![0]!.view).toBe(completion.view);
      expect(vi.mocked(completeSwimWorkoutResult).mock.calls[0]![0].get("clientLogId")).toBe(entry.id);
    },
  );

  it("DC-SW8 delivers the in-flight completion to a replacement auto-flush subscription", async () => {
    queue = [swimEntry];
    const sending = deferred<void>();
    const response = deferred<Awaited<ReturnType<typeof completeSwimWorkoutResult>>>();
    vi.mocked(completeSwimWorkoutResult).mockImplementation(() => {
      sending.resolve();
      return response.promise;
    });
    vi.useFakeTimers();
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const removeWindow = vi.spyOn(windowTarget, "removeEventListener");
    const removeDocument = vi.spyOn(documentTarget, "removeEventListener");
    vi.stubGlobal("window", Object.assign(windowTarget, { setInterval, clearInterval }));
    vi.stubGlobal("document", documentTarget);
    const oldChange = vi.fn();
    const newChange = vi.fn();
    const running = flushOutbox();
    let stopOld = () => {};
    let stopNew = () => {};
    let joined: ReturnType<typeof flushOutbox> | undefined;
    try {
      await sending.promise;
      stopOld = startAutoFlush(oldChange);
      stopOld();
      stopNew = startAutoFlush(newChange);
      joined = flushOutbox();
      expect(newChange).not.toHaveBeenCalled();
      response.resolve({ ok: true, completion });
      const [result] = await Promise.all([running, joined]);
      expect(oldChange).not.toHaveBeenCalled();
      expect(newChange.mock.calls).toEqual([[{
        flushed: 1, remaining: 0, dropped: 0, completed: 1,
        completedSessionIds: [entry.sessionId],
        swimCompletions: [completion],
      }]]);
      expect(result.completedSessionIds).toEqual([entry.sessionId]);
      expect(result.swimCompletions?.[0]?.view).toBe(completion.view);
      expect(completeSwimWorkoutResult).toHaveBeenCalledOnce();
    } finally {
      response.resolve({ ok: true });
      await Promise.all([running, joined]);
      stopNew();
      expect(removeWindow).toHaveBeenCalledTimes(2);
      expect(removeDocument).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it.each(["returned", "thrown"] as const)(
    "DC-SW8 overlapping requests do not retry a %s transient swim failure or overtake it",
    async (failure) => {
      const swim = { ...entry, op: "swim_complete" as const };
      queue = [swim];
      const sending = deferred<void>();
      const response = deferred<void>();
      vi.mocked(completeSwimWorkoutResult).mockImplementationOnce(async () => {
        sending.resolve();
        await response.promise;
        if (failure === "thrown") throw new Error("network");
        return { error: "network", errorCode: "transient" };
      });
      const running = flushOutbox();
      await sending.promise;
      queue.push({ ...entry, id: "next", seq: 2 });
      const submitted = flushOutbox();
      response.resolve();
      const results = await Promise.all([running, submitted]);
      expect(queue).toEqual([swim, { ...entry, id: "next", seq: 2 }]);
      expect(completeSwimWorkoutResult).toHaveBeenCalledOnce();
      expect(vi.mocked(recordAttempt).mock.calls).toEqual([[entry.id, "network"]]);
      expect(addStrengthSet).not.toHaveBeenCalled();
      expect(results[0]).toEqual({
        flushed: 0, remaining: 2, dropped: 0, completed: 0, completedSessionIds: [],
      });
      expect(results[1]).toEqual(results[0]);

      vi.mocked(completeSwimWorkoutResult).mockResolvedValue({ ok: true });
      vi.mocked(addStrengthSet).mockResolvedValue({ ok: true });
      const retry = await flushOutbox();
      expect(retry).toMatchObject({ flushed: 2, remaining: 0, completed: 1 });
      expect(completeSwimWorkoutResult).toHaveBeenCalledTimes(2);
      expect(vi.mocked(completeSwimWorkoutResult).mock.calls.map(([form]) => form.get("clientLogId")))
        .toEqual([entry.id, entry.id]);
    },
  );

  it("DC-SW8 drains newly queued modalities FIFO after the in-flight head, with one send per lease", async () => {
    const sending = deferred<void>();
    const response = deferred<ActionResult>();
    vi.mocked(addStrengthSet).mockImplementationOnce(() => {
      sending.resolve();
      return response.promise;
    });
    vi.mocked(addCardioBlock).mockResolvedValue({ ok: true });
    vi.mocked(logCardioSession).mockResolvedValue({ ok: true });
    vi.mocked(completeSessionResult).mockResolvedValue({ ok: true });
    vi.mocked(completeSwimWorkoutResult).mockResolvedValue({ ok: true });
    const running = flushOutbox();
    await sending.promise;
    const added = (["cardio", "cardio_session", "complete", "swim_complete"] as const)
      .map((op, index) => ({
        ...entry, op, id: `00000000-0000-4000-8000-00000000000${index + 3}`,
        sessionId: `session-${index}`, seq: index + 2,
      }));
    queue.push(...added);
    const overlaps = [flushOutbox(), flushOutbox()];
    expect(claimEntry).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(completeSwimWorkoutResult).not.toHaveBeenCalled();
    response.resolve({ ok: true });
    const results = await Promise.all([running, ...overlaps]);

    expect(queue).toEqual([]);
    for (const result of results) expect(result).toEqual({
      flushed: 5, remaining: 0, dropped: 0, completed: 2,
      completedSessionIds: [added[2]!.sessionId, added[3]!.sessionId],
    });
    const ids = [entry, ...added].map(({ id }) => id);
    expect(vi.mocked(claimEntry).mock.calls).toEqual(ids.map((id) => [id]));
    expect(vi.mocked(remove).mock.calls).toEqual(ids.map((id) => [id]));
    expect(vi.mocked(releaseEntry).mock.calls).toEqual(ids.map((id) => [id, "lease"]));
    const actions = [addStrengthSet, addCardioBlock, logCardioSession, completeSessionResult, completeSwimWorkoutResult];
    actions.forEach((action, index) => {
      expect(action).toHaveBeenCalledOnce();
      const sent = vi.mocked(action).mock.invocationCallOrder[0]!;
      expect(sent).toBeGreaterThan(vi.mocked(claimEntry).mock.invocationCallOrder[index]!);
      expect(sent).toBeLessThan(vi.mocked(releaseEntry).mock.invocationCallOrder[index]!);
      if (index > 0) expect(vi.mocked(claimEntry).mock.invocationCallOrder[index]!)
        .toBeGreaterThan(vi.mocked(releaseEntry).mock.invocationCallOrder[index - 1]!);
    });
  });

  it("DC-SW8 stops an overlapping fresh snapshot at a transient failure without retrying it", async () => {
    queue = [];
    const snapshot = deferred<OutboxEntry[]>();
    vi.mocked(listPending).mockReturnValueOnce(snapshot.promise);
    vi.mocked(completeSwimWorkoutResult).mockResolvedValue({ error: "network", errorCode: "transient" });
    const running = flushOutbox();
    queue.push({ ...entry, op: "swim_complete" }, { ...entry, id: "next", seq: 2 });
    const overlaps = [flushOutbox(), flushOutbox()];
    snapshot.resolve([]);
    const results = await Promise.all([running, ...overlaps]);
    expect(completeSwimWorkoutResult).toHaveBeenCalledOnce();
    expect(recordAttempt).toHaveBeenCalledOnce();
    expect(addStrengthSet).not.toHaveBeenCalled();
    expect(queue).toHaveLength(2);
    for (const result of results) expect(result).toEqual({
      flushed: 0, remaining: 2, dropped: 0, completed: 0, completedSessionIds: [],
    });
  });

  it("does not turn overlapping requests into a retry of another tab's occupied head lease", async () => {
    const claim = deferred<string | null>();
    const claiming = deferred<void>();
    vi.mocked(claimEntry).mockImplementationOnce(() => {
      claiming.resolve();
      return claim.promise;
    });
    const running = flushOutbox();
    await claiming.promise;
    queue.push({ ...entry, op: "swim_complete", id: "next", seq: 2 });
    const submitted = flushOutbox();
    claim.resolve(null);
    const results = await Promise.all([running, submitted]);
    expect(claimEntry).toHaveBeenCalledOnce();
    expect(releaseEntry).not.toHaveBeenCalled();
    expect(addStrengthSet).not.toHaveBeenCalled();
    expect(completeSwimWorkoutResult).not.toHaveBeenCalled();
    for (const result of results) expect(result).toEqual({
      flushed: 0, remaining: 2, dropped: 0, completed: 0, completedSessionIds: [],
    });
  });

  it.each(["offline", "unavailable"] as const)("leaves work queued when %s and permits a later online trigger", async (condition) => {
    queue = [swimEntry];
    vi.stubGlobal("navigator", { onLine: condition !== "offline" });
    vi.mocked(outboxAvailable).mockReturnValue(condition !== "unavailable");
    try {
      expect(await flushOutbox()).toEqual({
        flushed: 0, remaining: condition === "offline" ? 1 : 0,
        dropped: 0, completed: 0, completedSessionIds: [],
      });
      expect(queue).toHaveLength(1);
      expect(claimEntry).not.toHaveBeenCalled();
      expect(completeSwimWorkoutResult).not.toHaveBeenCalled();
      vi.stubGlobal("navigator", { onLine: true });
      vi.mocked(outboxAvailable).mockReturnValue(true);
      vi.mocked(completeSwimWorkoutResult).mockResolvedValue({ ok: true, completion });
      expect(await flushOutbox()).toMatchObject({ flushed: 1, remaining: 0, completed: 1, swimCompletions: [completion] });
      expect(vi.mocked(completeSwimWorkoutResult).mock.calls[0]![0].get("clientLogId")).toBe(entry.id);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(["absent", "receipt", "session", "workout"] as const)(
    "DC-SW8 does not invent a confirmation for a committed count-only or mismatched response: %s",
    async (failure) => {
      queue = [swimEntry];
      const confirmation = { ...completion };
      if (failure === "receipt") confirmation.receiptId = "other";
      if (failure === "session") confirmation.sessionId = "other";
      if (failure === "workout") confirmation.workoutId = "other";
      vi.mocked(completeSwimWorkoutResult).mockResolvedValue({
        ok: true, ...(failure === "absent" ? {} : { completion: confirmation }),
      });
      const result = await flushOutbox();
      expect(result.completedSessionIds).toEqual([entry.sessionId]);
      expect(result).not.toHaveProperty("swimCompletions");
      expect(queue).toEqual([]);
      await flushOutbox();
      expect(completeSwimWorkoutResult).toHaveBeenCalledOnce();
      expect(recordAttempt).not.toHaveBeenCalled();
      expect(deadLetter).not.toHaveBeenCalled();
    },
  );

  it("DC-SW8 propagates a post-commit reload warning without replaying the write", async () => {
    queue = [swimEntry];
    const confirmed = { ...completion, view: undefined, warning: "Reload the page to continue." };
    vi.mocked(completeSwimWorkoutResult).mockResolvedValue({ ok: true, completion: confirmed });
    expect(await flushOutbox()).toMatchObject({ completed: 1, swimCompletions: [confirmed] });
    expect(await flushOutbox()).toMatchObject({ completed: 0 });
    expect(completeSwimWorkoutResult).toHaveBeenCalledOnce();
    expect(recordAttempt).not.toHaveBeenCalled();
  });

  it("shares a storage failure with overlapping callers and releases the drain for a later trigger", async () => {
    const snapshot = deferred<OutboxEntry[]>();
    const failure = new Error("storage unavailable");
    vi.mocked(listPending).mockImplementationOnce(async () => {
      await snapshot.promise;
      throw failure;
    });
    const running = flushOutbox();
    const submitted = flushOutbox();
    const outcomes = Promise.allSettled([running, submitted]);
    snapshot.resolve([]);
    expect(await outcomes).toEqual([
      { status: "rejected", reason: failure }, { status: "rejected", reason: failure },
    ]);
    expect(claimEntry).not.toHaveBeenCalled();
    vi.mocked(addStrengthSet).mockResolvedValue({ ok: true });
    expect(await flushOutbox()).toMatchObject({ flushed: 1, remaining: 0 });
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
