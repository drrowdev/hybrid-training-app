import { describe, expect, it } from "vitest";
import { plannedSessionCta } from "./planned-session-cta";

describe("plannedSessionCta", () => {
  it("starts an unlinked planned session", () => {
    expect(
      plannedSessionCta({
        plannedId: "planned",
        completedSessionId: null,
        completedAt: null,
      }),
    ).toEqual({
      href: "/app/sessions/start/planned",
      label: "Start workout →",
      state: "not_started",
    });
  });

  it("continues only a valid unfinished linked session", () => {
    expect(
      plannedSessionCta({
        plannedId: "planned",
        completedSessionId: "session",
        completedAt: null,
      }),
    ).toMatchObject({
      href: "/app/sessions/session",
      label: "Continue workout →",
      state: "in_progress",
    });
  });

  it("offers View workout after completion", () => {
    expect(
      plannedSessionCta({
        plannedId: "planned",
        completedSessionId: "session",
        completedAt: "2026-08-10T10:18:56.099Z",
      }),
    ).toMatchObject({
      href: "/app/sessions/session",
      label: "View workout →",
      state: "completed",
    });
  });

  it("routes deleted completed workouts to explicit restoration", () => {
    expect(
      plannedSessionCta({
        plannedId: "planned",
        completedSessionId: null,
        completedAt: null,
        deletedCompletedSessionId: "deleted",
      }),
    ).toEqual({
      href: "/app/settings/trash",
      label: "Restore workout →",
      state: "deleted_completed",
    });
  });
});
