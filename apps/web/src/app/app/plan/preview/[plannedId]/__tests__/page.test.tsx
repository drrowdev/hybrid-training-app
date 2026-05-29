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
    expect(html).toMatch(/Start workout/);
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

  it("never renders internal slot codes (W1 / S1 / C1 / A1 / T1 / H1) as visible labels", () => {
    // Engine vocabulary leak guard. The preview body MUST surface
    // human-readable labels ("Set 1", "Warm-up", movement names) — never
    // raw slot codes from the prescription pipeline.
    const items: PrescriptionItem[] = [
      ...strengthItems(),
      {
        kind: "tendon",
        movementId: "m-tendon",
        movementName: "Tibialis raise",
        sets: 3,
        reps: 15,
      } as unknown as PrescriptionItem,
      {
        kind: "cardio_vo2",
        movementId: "m-cardio",
        movementName: "VO2 Intervals",
        durationMin: 35,
        protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
        hrCap: "90–95% HRmax during work",
      } as unknown as PrescriptionItem,
    ];
    const html = renderToStaticMarkup(
      React.createElement(SessionPreviewBody, { session: fixture({ items }) }),
    );
    // The single most important assertion: no "C1" before VO2.
    expect(html).not.toMatch(/>\s*C1\s*</);
    expect(html).not.toMatch(/>\s*C2\s*</);
    expect(html).not.toMatch(/>\s*A1\s*</);
    expect(html).not.toMatch(/>\s*T1\s*</);
    expect(html).not.toMatch(/>\s*H1\s*</);
    // Warm-up rows in v1 also showed "W1" — must be gone.
    expect(html).not.toMatch(/>\s*W1\s*</);
    expect(html).not.toMatch(/>\s*S1\s*</);
  });

  it("renders cardio items as a structured card with Intervals / Intensity / Recovery rows (no Duration row — page meta covers it)", () => {
    const items: PrescriptionItem[] = [
      {
        kind: "cardio_vo2",
        movementId: "m-cardio",
        movementName: "VO2 Intervals",
        durationMin: 35,
        protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
        hrCap: "90–95% HRmax during work",
      } as unknown as PrescriptionItem,
    ];
    const html = renderToStaticMarkup(
      React.createElement(SessionPreviewBody, { session: fixture({ items }) }),
    );
    expect(html).toContain('data-testid="session-preview-cardio-0"');
    // Labeled rows (the readability win) — assert each label appears.
    expect(html).toContain("Intervals");
    expect(html).toMatch(/4\s*[×x]\s*4\s*min/);
    expect(html).toContain("Intensity");
    expect(html).toContain("90–95% HRmax");
    expect(html).toContain("Recovery");
    expect(html).toMatch(/3\s*min\s*easy\s*recovery/);
    // Per-row testids (regression guard: a future change that collapses
    // the structured view back into a single line would drop these).
    expect(html).toContain('session-preview-cardio-0-row-intervals');
    expect(html).toContain('session-preview-cardio-0-row-intensity');
    expect(html).toContain('session-preview-cardio-0-row-recovery');
    // Fix 3: Duration row is removed (the page meta "~35 min" above
    // already shows it) — guard against regression.
    expect(html).not.toContain('session-preview-cardio-0-row-duration');
  });

  it("falls back to a Protocol row when the cardio note doesn't match the intervals/intensity/recovery pattern", () => {
    const items: PrescriptionItem[] = [
      {
        kind: "cardio_alactic",
        movementId: "m-cardio",
        movementName: "Hill sprints",
        durationMin: 10,
        protocolNote: "6–10 × 10–15s near-max hill sprints, walk back down for recovery (~90–120s)",
      } as unknown as PrescriptionItem,
    ];
    const html = renderToStaticMarkup(
      React.createElement(SessionPreviewBody, { session: fixture({ items }) }),
    );
    expect(html).toContain("Hill sprints");
    expect(html).toContain("Intervals");
    // "walk back down for recovery" is recognised as the Recovery row.
    expect(html).toContain("Recovery");
  });

  /* ------------------------------------------------------------------ */
  /* Fix 3 — dedup heuristics (no duplicate name/duration/cardioKind)   */
  /* ------------------------------------------------------------------ */

  it("single-movement cardio session: drops the movement-name heading inside the card (page title already shows it)", () => {
    const items: PrescriptionItem[] = [
      {
        kind: "cardio_vo2",
        movementId: "m-cardio",
        movementName: "VO2 Intervals",
        durationMin: 35,
        protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
      } as unknown as PrescriptionItem,
    ];
    const html = renderToStaticMarkup(
      React.createElement(SessionPreviewBody, {
        session: fixture({ title: "VO2 intervals", items }),
      }),
    );
    // The page <h1> stays.
    expect(html).toContain('data-testid="session-preview-title"');
    // But the card body must NOT also render an <h3>VO2 Intervals</h3>.
    expect(html).not.toMatch(/<h3[^>]*>\s*VO2 Intervals[^<]*<\/h3>/);
    // The CARDIO eyebrow inside the card is still there.
    expect(html).toContain('data-testid="session-preview-cardio-0"');
    expect(html).toContain(">CARDIO<");
  });

  it("cardio card never renders a standalone 'VO2' (or other intensityLabel) sub-line between heading and rows", () => {
    const items: PrescriptionItem[] = [
      {
        kind: "cardio_vo2",
        movementId: "m-cardio",
        movementName: "VO2 Intervals",
        durationMin: 35,
        protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
        intensityLabel: "VO2",
      } as unknown as PrescriptionItem,
    ];
    const html = renderToStaticMarkup(
      React.createElement(SessionPreviewBody, {
        session: fixture({ title: "VO2 intervals", items }),
      }),
    );
    // The bare "VO2" (cardioKind) label must not appear as its own
    // sub-line. Other VO2 mentions inside the page title / protocol
    // rows are fine; the regression guard is the standalone block.
    expect(html).not.toMatch(/<div[^>]*>\s*VO2\s*<\/div>/);
  });

  it("strips ' — 4×4' style protocol shorthand from the cardio card heading", () => {
    const items: PrescriptionItem[] = [
      {
        kind: "cardio_vo2",
        movementId: "m-cardio-a",
        movementName: "VO2 Intervals",
        durationMin: 20,
        protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
      } as unknown as PrescriptionItem,
      {
        kind: "cardio_z2",
        movementId: "m-cardio-b",
        movementName: "Z2 base — 30 min",
        durationMin: 30,
        hrCap: "Z2",
      } as unknown as PrescriptionItem,
    ];
    const html = renderToStaticMarkup(
      React.createElement(SessionPreviewBody, {
        session: fixture({ title: "Conditioning", items }),
      }),
    );
    // Two cardio cards now → headings are kept (no single-headline
    // dedup applies), but the shorthand suffix on the Z2 name must be
    // stripped.
    expect(html).toMatch(/<h3[^>]*>\s*Z2 base\s*<\/h3>/);
    expect(html).not.toMatch(/Z2 base — 30 min/);
  });

  it("multi-movement strength session: per-movement headings ARE present (regression guard against over-aggressive dedup)", () => {
    const items: PrescriptionItem[] = [
      {
        kind: "main",
        movementId: "m-squat",
        movementSlug: "front_squat",
        movementName: "Front Squat",
        sets: 3,
        reps: 5,
        percentTm: 80,
      } as unknown as PrescriptionItem,
      {
        kind: "main",
        movementId: "m-ohp",
        movementSlug: "overhead_press",
        movementName: "Overhead Press",
        sets: 3,
        reps: 5,
        percentTm: 75,
      } as unknown as PrescriptionItem,
    ];
    const html = renderToStaticMarkup(
      React.createElement(SessionPreviewBody, {
        session: fixture({ title: "Strength A", items }),
      }),
    );
    expect(html).toMatch(/<h3[^>]*>\s*Front Squat\s*<\/h3>/);
    expect(html).toMatch(/<h3[^>]*>\s*Overhead Press\s*<\/h3>/);
  });
});
