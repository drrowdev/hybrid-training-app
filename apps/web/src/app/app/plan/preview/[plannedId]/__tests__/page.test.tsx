/**
 * Smoke tests for the /app/plan/preview/[plannedId] route.
 *
 * The page itself is a thin async server component: it validates the
 * id, calls `getPlannedSessionById`, and forwards the shaped data to
 * `SessionPreviewBody`. We test the two halves separately —
 *
 *  - PLANNED_ID_REGEX is the bad-id guard at the route boundary, so we
 *    cover the same shape rejected by `/app/sessions/start/[plannedId]`.
 *  - `SessionPreviewBody` renders the read-only details. SSR via
 *    `renderToStaticMarkup` mirrors the existing PlanRedesign smoke
 *    test pattern so a contract change (testids, CTA href, label) is
 *    caught without a Playwright round-trip.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrescriptionItem } from "@hta/db";
import { PLANNED_ID_REGEX } from "@/lib/planner/queries";
import {
  SessionPreviewBody,
  type SessionPreviewInput,
} from "@/components/session/SessionPreviewBody";

function strengthItems(): PrescriptionItem[] {
  return [
    {
      kind: "warmup",
      movementId: "m1",
      movementSlug: "front_squat",
      movementName: "Front Squat",
      reps: 5,
    } as unknown as PrescriptionItem,
    {
      kind: "main",
      movementId: "m1",
      movementSlug: "front_squat",
      movementName: "Front Squat",
      sets: 3,
      reps: 5,
      percentTm: 0.82,
    } as unknown as PrescriptionItem,
    {
      kind: "accessory",
      movementId: "m2",
      movementSlug: "bulgarian_split_squat",
      movementName: "Bulgarian Split Squat",
      sets: 3,
      reps: 10,
    } as unknown as PrescriptionItem,
  ];
}

function fixture(over: Partial<SessionPreviewInput> = {}): SessionPreviewInput {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    title: "VO2 intervals",
    eyebrow: "ENDURANCE FOCUS · WEEK 2 · WED 27 MAY",
    estDurationMin: 55,
    items: strengthItems(),
    ...over,
  };
}

describe("PLANNED_ID_REGEX (preview-route guard)", () => {
  it("accepts a canonical lowercase UUID", () => {
    expect(
      PLANNED_ID_REGEX.test("11111111-2222-3333-4444-555555555555"),
    ).toBe(true);
  });

  it("rejects obviously malformed ids", () => {
    expect(PLANNED_ID_REGEX.test("not-a-uuid")).toBe(false);
    expect(PLANNED_ID_REGEX.test("")).toBe(false);
    expect(PLANNED_ID_REGEX.test("123")).toBe(false);
    // Too long.
    expect(
      PLANNED_ID_REGEX.test("11111111-2222-3333-4444-555555555555-extra"),
    ).toBe(false);
    // Contains a path-traversal char.
    expect(
      PLANNED_ID_REGEX.test("../../../etc/passwd-aaaaaaaaaaaaaaaaaaa"),
    ).toBe(false);
  });
});

describe("SessionPreviewBody (static markup)", () => {
  it("renders the title, eyebrow, meta line, and a Start CTA pointing to /app/sessions/start/<id>", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionPreviewBody, { session: fixture() }),
    );
    expect(html).toContain('data-testid="session-preview-title"');
    expect(html).toContain("VO2 intervals");
    expect(html).toContain('data-testid="session-preview-eyebrow"');
    expect(html).toContain("ENDURANCE FOCUS · WEEK 2 · WED 27 MAY");
    expect(html).toContain('data-testid="session-preview-meta"');
    expect(html).toContain("~55 min");
    expect(html).toContain('data-testid="session-preview-start-cta"');
    expect(html).toContain(
      'href="/app/sessions/start/11111111-2222-3333-4444-555555555555"',
    );
    expect(html).toMatch(/Start session/);
  });

  it("renders the back link to /app", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionPreviewBody, { session: fixture() }),
    );
    expect(html).toContain('data-testid="session-preview-back"');
    expect(html).toContain('href="/app"');
    expect(html).toContain("Back to Today");
  });

  it("renders prescription rows for movement sets and accessories", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionPreviewBody, { session: fixture() }),
    );
    // Main movement section
    expect(html).toMatch(/session-preview-movement-/);
    expect(html).toContain("Front Squat");
    // Accessory pool
    expect(html).toContain('data-testid="session-preview-section-accessories"');
    expect(html).toContain("Bulgarian Split Squat");
  });

  it("renders an explicit empty-state when the session has no prescription items", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionPreviewBody, {
        session: fixture({ items: [], estDurationMin: null }),
      }),
    );
    expect(html).toContain('data-testid="session-preview-empty"');
    expect(html).toContain("No prescription details");
  });
});
