/**
 * Smoke render tests for the LiveCardioTracker.
 *
 * Under the node test environment we statically render the component (no
 * effects, no browser APIs fire), so these assert the initial markup of
 * each entry mode:
 *   - default: the "Start live tracking" choice screen with an indoor
 *     toggle and a manual-fallback link;
 *   - stravaApplied: collapses straight to the CardioLogForm (no live
 *     option), because Strava data is already authoritative.
 *
 * The capture arithmetic is covered exhaustively in
 * `lib/cardio/__tests__/live-tracker.test.ts`.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveCardioTracker } from "../LiveCardioTracker";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const noopAction = (async () => ({ ok: true as const })) as unknown as Parameters<
  typeof LiveCardioTracker
>[0]["action"];

const baseProps = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  prescribedDurationMin: 30,
  movementId: null,
  modality: "run",
  units: "metric" as const,
  action: noopAction,
};

describe("LiveCardioTracker", () => {
  it("renders the live-tracking choice screen by default", () => {
    const html = renderToStaticMarkup(<LiveCardioTracker {...baseProps} />);
    expect(html).toContain("live-cardio-choice");
    expect(html).toContain("live-cardio-start");
    expect(html).toContain("live-cardio-indoor");
    expect(html).toContain("live-cardio-manual");
    expect(html).toContain("Start live tracking");
  });

  it("does not show the live clock before starting", () => {
    const html = renderToStaticMarkup(<LiveCardioTracker {...baseProps} />);
    expect(html).not.toContain("live-cardio-tracking");
    expect(html).not.toContain("live-cardio-clock");
  });

  it("collapses to the manual cardio form when Strava-applied", () => {
    const html = renderToStaticMarkup(
      <LiveCardioTracker {...baseProps} stravaApplied />,
    );
    expect(html).not.toContain("live-cardio-choice");
    expect(html).toContain("cardio-log-form");
  });
});
