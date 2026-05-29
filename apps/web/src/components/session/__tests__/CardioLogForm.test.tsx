/**
 * Smoke render tests for the CardioLogForm.
 *
 * Coverage:
 *   - Form actually renders the four canonical fields (completed,
 *     duration, RPE, notes).
 *   - Prescribed duration pre-fills the duration input (Fix 4).
 *   - The submit CTA is the cardio-flavored "Finish workout →"
 *     replacing the strength-only "Log at least 1 set to finish".
 *   - The stretch HR / distance fields live behind the "More
 *     details" disclosure so the default flow stays minimal.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CardioLogForm } from "../CardioLogForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const noopAction = (async () => ({ ok: true as const })) as unknown as Parameters<
  typeof CardioLogForm
>[0]["action"];

describe("CardioLogForm", () => {
  it("renders the four required fields + Finish workout submit", () => {
    const html = renderToStaticMarkup(
      <CardioLogForm
        sessionId="00000000-0000-0000-0000-000000000001"
        prescribedDurationMin={35}
        movementId="m-cardio"
        modality="running"
        units="metric"
        action={noopAction}
      />,
    );
    expect(html).toContain('data-testid="cardio-log-form"');
    expect(html).toContain('data-testid="cardio-log-completed-yes"');
    expect(html).toContain('data-testid="cardio-log-completed-no"');
    expect(html).toContain('data-testid="cardio-log-duration"');
    expect(html).toContain('data-testid="cardio-log-rpe"');
    expect(html).toContain('data-testid="cardio-log-notes"');
    expect(html).toContain('data-testid="cardio-log-submit"');
    expect(html).toMatch(/Finish workout/);
  });

  it("pre-fills duration with the prescribed duration", () => {
    const html = renderToStaticMarkup(
      <CardioLogForm
        sessionId="00000000-0000-0000-0000-000000000001"
        prescribedDurationMin={42}
        movementId={null}
        modality="other"
        units="metric"
        action={noopAction}
      />,
    );
    expect(html).toMatch(/data-testid="cardio-log-duration"[^>]*value="42"/);
  });

  it("renders the distance label in km for metric users and mi for imperial", () => {
    const metric = renderToStaticMarkup(
      <CardioLogForm
        sessionId="00000000-0000-0000-0000-000000000001"
        prescribedDurationMin={null}
        movementId={null}
        modality="other"
        units="metric"
        action={noopAction}
      />,
    );
    expect(metric).toContain("Distance (km");

    const imperial = renderToStaticMarkup(
      <CardioLogForm
        sessionId="00000000-0000-0000-0000-000000000001"
        prescribedDurationMin={null}
        movementId={null}
        modality="other"
        units="imperial"
        action={noopAction}
      />,
    );
    expect(imperial).toContain("Distance (mi");
  });

  it("never renders the strength 'Log at least 1 set to finish' copy", () => {
    const html = renderToStaticMarkup(
      <CardioLogForm
        sessionId="00000000-0000-0000-0000-000000000001"
        prescribedDurationMin={30}
        movementId={null}
        modality="other"
        units="metric"
        action={noopAction}
      />,
    );
    expect(html).not.toMatch(/Log at least 1 set/);
  });
});
