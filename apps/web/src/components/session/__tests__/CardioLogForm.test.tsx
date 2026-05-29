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

  it("places Duration + RPE on the same row with a streamlined wrapper — Fix 5", () => {
    const html = renderToStaticMarkup(
      <CardioLogForm
        sessionId="00000000-0000-0000-0000-000000000001"
        prescribedDurationMin={35}
        movementId={null}
        modality="other"
        units="metric"
        action={noopAction}
      />,
    );
    // Both inputs live inside the same row wrapper (a CSS-grid
    // 2-column container that collapses to 1 column under 480px).
    expect(html).toContain('data-testid="cardio-log-duration-rpe-row"');
    const rowIdx = html.indexOf('data-testid="cardio-log-duration-rpe-row"');
    const durIdx = html.indexOf('data-testid="cardio-log-duration"');
    const rpeIdx = html.indexOf('data-testid="cardio-log-rpe"');
    expect(rowIdx).toBeGreaterThan(-1);
    expect(durIdx).toBeGreaterThan(rowIdx);
    expect(rpeIdx).toBeGreaterThan(durIdx);
    // Inline media query for mobile stacking is present in the form.
    expect(html).toMatch(/@media\s*\(max-width:\s*479px\)/);
  });

  it("keeps HR + distance hidden behind the More details expander by default — Fix 5", () => {
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
    // HR + distance inputs are inside a <details> wrapper that does
    // NOT have `open` set in initial SSR — they exist in markup but
    // are collapsed.
    expect(html).toContain('data-testid="cardio-log-more-details"');
    expect(html).toMatch(/<details[^>]*data-testid="cardio-log-more-details"(?![^>]*\bopen\b)/);
    expect(html).toMatch(/\+ More details \(HR, distance\)/);
  });

  it("drops the verbose subtitle and replaces the big yes/no toggle with a small skip link — Fix 5", () => {
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
    expect(html).not.toMatch(/wrap up the session/i);
    expect(html).toContain('data-testid="cardio-log-toggle-skip"');
    expect(html).toMatch(/>\s*Skip instead\s*</);
  });
});
