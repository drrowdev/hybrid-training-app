import { describe, expect, it } from "vitest";
import { resolveLinkedSession } from "@/lib/sessions/linked-session-state";

describe("resolveLinkedSession", () => {
  it("keeps active unfinished and completed links", () => {
    expect(
      resolveLinkedSession("session", {
        id: "session",
        completedAt: null,
        deletedAt: null,
      }),
    ).toEqual({
      completedSessionId: "session",
      completedAt: null,
      deletedCompletedSessionId: null,
    });
    expect(
      resolveLinkedSession("session", {
        id: "session",
        completedAt: "2026-08-10T10:18:56.099Z",
        deletedAt: null,
      }),
    ).toEqual({
      completedSessionId: "session",
      completedAt: "2026-08-10T10:18:56.099Z",
      deletedCompletedSessionId: null,
    });
  });

  it("treats a missing or soft-deleted linked session as not started", () => {
    expect(resolveLinkedSession("missing", null)).toEqual({
      completedSessionId: null,
      completedAt: null,
      deletedCompletedSessionId: null,
    });
    expect(
      resolveLinkedSession("cancelled", {
        id: "cancelled",
        completedAt: null,
        deletedAt: "2026-08-10T09:23:52.772Z",
      }),
    ).toEqual({
      completedSessionId: null,
      completedAt: null,
      deletedCompletedSessionId: null,
    });
  });

  it("surfaces a deleted completed link for explicit Trash restoration", () => {
    expect(
      resolveLinkedSession("deleted-completed", {
        id: "deleted-completed",
        completedAt: "2026-08-10T10:18:56.099Z",
        deletedAt: "2026-08-10T10:30:00.000Z",
      }),
    ).toEqual({
      completedSessionId: null,
      completedAt: null,
      deletedCompletedSessionId: "deleted-completed",
    });
  });
});
