/**
 * CancelWorkoutButton — static render + action-routing smoke tests.
 *
 * Mirrors the AddToWorkout / StravaAutofillBanner pattern: we render
 * the closed state to static markup (the Node-only test env can't
 * exercise click handlers), and we directly invoke the underlying
 * server action mock to prove the wrapper still routes through
 * `deleteSession` (the spec contract — Cancel is a relabel of the
 * same soft-delete primitive).
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const deleteSessionMock = vi.fn(async (fd: FormData) => ({
  ok: true as const,
  sessionId: String(fd.get("id") ?? ""),
  restoreUrl: "/api/sessions/x/restore",
}));

vi.mock("@/lib/sessions/actions", () => ({
  deleteSession: (fd: FormData) => deleteSessionMock(fd),
}));

import { CancelWorkoutButton } from "../CancelWorkoutButton";

describe("CancelWorkoutButton — static render", () => {
  it("renders the cancel-specific menu item label, not delete", () => {
    const html = renderToStaticMarkup(
      <CancelWorkoutButton sessionId="s1" />,
    );
    expect(html).toContain('data-testid="cancel-workout-menu-item"');
    expect(html).toContain("Cancel workout");
    // Confirm modal is not in the DOM until the trigger is clicked.
    expect(html).not.toContain('data-testid="cancel-workout-confirm"');
    expect(html).not.toContain("Cancel this workout?");
  });
});

describe("CancelWorkoutButton — action routing", () => {
  it("calls the existing deleteSession server action with the session id", async () => {
    deleteSessionMock.mockClear();
    const fd = new FormData();
    fd.append("id", "abc-123");
    const { deleteSession } = await import("@/lib/sessions/actions");
    const result = await deleteSession(fd);
    expect(deleteSessionMock).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock.mock.calls[0]?.[0].get("id")).toBe("abc-123");
    expect(result.ok).toBe(true);
  });
});
