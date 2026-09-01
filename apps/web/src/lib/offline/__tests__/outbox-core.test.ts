import { describe, it, expect } from "vitest";
import {
  backoffMs,
  classifyActionResult,
  createOutboxEntryId,
  entriesForSession,
  formDataToPayload,
  isUuid,
  nextSeq,
  payloadToFormData,
  sortBySeq,
  MAX_REPLAY_ATTEMPTS,
  type OutboxEntry,
} from "../outbox-core";

function entry(over: Partial<OutboxEntry> & { id: string }): OutboxEntry {
  return {
    id: over.id,
    op: over.op ?? "set",
    sessionId: over.sessionId ?? "s1",
    seq: over.seq ?? 0,
    payload: over.payload ?? {},
    createdAt: over.createdAt ?? 0,
    attempts: over.attempts ?? 0,
    lastError: over.lastError,
    status: over.status,
    deadLetterReason: over.deadLetterReason,
  };
}

describe("nextSeq", () => {
  it("is at least the wall clock when the queue is empty", () => {
    expect(nextSeq([], 1000)).toBe(1000);
  });

  describe("createOutboxEntryId", () => {
    it("always returns an RFC 4122 v4 id for durable server receipts", () => {
      expect(createOutboxEntryId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe("isUuid", () => {
    it("accepts UUID-shaped completion receipts and rejects legacy ids", () => {
      expect(isUuid("00000000-0000-4000-8000-000000000001")).toBe(true);
      expect(isUuid("complete-1700000000000")).toBe(false);
    });
  });
  it("is strictly greater than any existing seq", () => {
    expect(nextSeq([1000, 1005, 1002], 1000)).toBe(1006);
  });
  it("uses now when it already exceeds existing seqs", () => {
    expect(nextSeq([10, 20], 1000)).toBe(1000);
  });
});

describe("sortBySeq / entriesForSession", () => {
  it("orders FIFO by seq then createdAt then id", () => {
    const out = sortBySeq([
      entry({ id: "b", seq: 2 }),
      entry({ id: "a", seq: 1 }),
      entry({ id: "c", seq: 2, createdAt: 5 }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
  it("filters to one session and preserves FIFO", () => {
    const out = entriesForSession(
      [
        entry({ id: "a", sessionId: "s1", seq: 3 }),
        entry({ id: "b", sessionId: "s2", seq: 1 }),
        entry({ id: "c", sessionId: "s1", seq: 2 }),
      ],
      "s1",
    );
    expect(out.map((e) => e.id)).toEqual(["c", "a"]);
  });
});

describe("classifyActionResult", () => {
  it("retries when the action threw (offline/network)", () => {
    expect(classifyActionResult(undefined, true)).toBe("retry");
  });
  it("drops only when the server explicitly returned a validation error", () => {
    expect(
      classifyActionResult({ error: "Invalid input", errorCode: "validation" }, false),
    ).toBe("drop");
  });
  it("keeps an unclassified returned error queued", () => {
    expect(classifyActionResult({ error: "temporary Supabase error" }, false)).toBe(
      "retry",
    );
  });
  it("keeps a typed transient error queued", () => {
    expect(
      classifyActionResult(
        { error: "session refresh required", errorCode: "transient" },
        false,
      ),
    ).toBe("retry");
  });
  it("dead-letters ownership and missing-session failures", () => {
    expect(
      classifyActionResult(
        { error: "Not your session.", errorCode: "forbidden" },
        false,
      ),
    ).toBe("dead_letter");
    expect(
      classifyActionResult(
        { error: "Session not found.", errorCode: "not_found" },
        false,
      ),
    ).toBe("dead_letter");
  });
  it("keeps authentication failures retryable for session refresh", () => {
    expect(
      classifyActionResult({ error: "Not signed in.", errorCode: "auth" }, false),
    ).toBe("retry");
  });
  it("is done on a clean ok result", () => {
    expect(classifyActionResult({ ok: true }, false)).toBe("done");
  });
  it("keeps an unacknowledged result queued", () => {
    expect(classifyActionResult({}, false)).toBe("retry");
    expect(classifyActionResult(undefined, false)).toBe("retry");
  });
});

describe("backoffMs", () => {
  it("grows exponentially from a 2s base and caps at 60s", () => {
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(10)).toBe(60_000);
  });

  describe("bounded replay", () => {
    it("exposes a finite retry budget", () => {
      expect(MAX_REPLAY_ATTEMPTS).toBe(5);
    });
  });
  it("never returns below the base for attempt 0", () => {
    expect(backoffMs(0)).toBe(2000);
  });
});

describe("payload <-> FormData round-trip", () => {
  it("preserves all scalar fields", () => {
    const fd = new FormData();
    fd.append("sessionId", "abc");
    fd.append("reps", "8");
    fd.append("clientLogId", "uuid-1");
    const payload = formDataToPayload(fd);
    expect(payload).toEqual({ sessionId: "abc", reps: "8", clientLogId: "uuid-1" });

    const rebuilt = payloadToFormData(payload);
    expect(rebuilt.get("sessionId")).toBe("abc");
    expect(rebuilt.get("reps")).toBe("8");
    expect(rebuilt.get("clientLogId")).toBe("uuid-1");
  });
});
