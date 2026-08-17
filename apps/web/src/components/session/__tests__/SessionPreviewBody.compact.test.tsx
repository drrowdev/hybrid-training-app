/**
 * Smoke + regression coverage for the `compact` variant of
 * SessionPreviewBody, which is the Today hero's at-a-glance preview
 * (replaces the deleted bespoke `TodayHeroSummary` component).
 *
 * The full variant is exercised end-to-end by the Preview page test
 * at `app/plan/preview/[plannedId]/__tests__/page.test.tsx`; this
 * file focuses on what the hero specifically needs:
 *   - chrome stripped: no back link, no outer header, no Start CTA
 *   - structured sections rendered for pure-cardio / strength / hybrid
 *   - cross-cardio-kind regression: every registered kind produces
 *     consistent structured rows (no alignment drift between kinds)
 *
 * Static HTML render only — no client effects or routing — so we can
 * use `renderToStaticMarkup` rather than spinning up React Testing
 * Library.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrescriptionItem } from "@hta/db";
import {
  SessionPreviewBody,
  type SessionPreviewInput,
} from "../SessionPreviewBody";
import { CARDIO_DESCRIPTIONS } from "@/lib/session/cardio-descriptions";

const main = (over: Partial<PrescriptionItem> = {}): PrescriptionItem =>
  ({
    kind: "main",
    movementId: over.movementId ?? "m-main",
    movementName: over.movementName ?? "Front Squat",
    percentTm: 80,
    reps: 5,
    sets: 1,
    ...over,
  }) as unknown as PrescriptionItem;

const cardio = (over: Partial<PrescriptionItem> = {}): PrescriptionItem =>
  ({
    kind: "cardio_vo2",
    movementId: over.movementId ?? "m-card",
    movementName: over.movementName ?? "VO2 intervals",
    durationMin: 35,
    protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
    hrCap: "90–95% HRmax during work",
    ...over,
  }) as unknown as PrescriptionItem;

const input = (
  items: PrescriptionItem[],
  over: Partial<SessionPreviewInput> = {},
): SessionPreviewInput => ({
  id: "planned-1",
  title: "Test Session",
  eyebrow: "TEST · WEEK 1 · MON 1 JAN",
  estDurationMin: 35,
  items,
  ...over,
});

function renderCompact(items: PrescriptionItem[], over?: Partial<SessionPreviewInput>) {
  return renderToStaticMarkup(
    <SessionPreviewBody variant="compact" session={input(items, over)} />,
  );
}

describe("SessionPreviewBody (compact / Today hero)", () => {
  const accessory = (over: Partial<PrescriptionItem> = {}): PrescriptionItem =>
    ({
      kind: "accessory",
      movementId: over.movementId ?? "m-acc",
      movementName: over.movementName ?? "Wrist Curl (BB)",
      reps: 14,
      sets: 1,
      ...over,
    }) as unknown as PrescriptionItem;

  it("collapses set-expanded accessory items: two 1×14 entries render as one 2 × 14", () => {
    const html = renderCompact([
      main(),
      accessory(),
      accessory(),
    ]);
    expect(html).toContain("2 × 14");
    // The confusing "1 × 14 · 1 × 14" must NOT appear.
    expect(html).not.toContain("1 × 14 · 1 × 14");
  });

  it("shows rehab sets × reps instead of the internal tendon kind", () => {
    const html = renderCompact([
      {
        kind: "tendon",
        movementId: "hip-adduction",
        movementName: "Standing Banded Hip Adduction",
        sets: 5,
        reps: 15,
        meta: { rehab: true },
      },
    ]);
    expect(html).toContain("5 × 15");
    expect(html).not.toContain("Tendon × 15");
    expect(html).toContain("REHAB");
    expect(html).not.toContain("TENDON WORK");
  });

  it("renders embedded rehab before strength and frames it as warm-up work", () => {
    const html = renderCompact([
      {
        kind: "tendon",
        movementId: "hip-adduction",
        movementName: "Standing Banded Hip Adduction",
        sets: 3,
        reps: 15,
        meta: {
          rehab: true,
          rehabProtocolName: "Adductor",
          rehabPlacement: "during_warmup",
        },
      },
      main({ movementId: "squat", movementName: "Front Squat" }),
    ]);

    expect(html).toContain("REHAB · ADDUCTOR");
    expect(html).toContain("Do during warm-up");
    expect(html.indexOf("REHAB · ADDUCTOR")).toBeLessThan(
      html.indexOf("MAIN LIFTS"),
    );
  });

  it("strips outer chrome: no back link, no outer header, no Start CTA", () => {
    const html = renderCompact([cardio()], { title: "VO2 intervals" });
    expect(html).not.toContain('data-testid="back-link"');
    expect(html).not.toContain('data-testid="session-preview-eyebrow"');
    expect(html).not.toContain('data-testid="session-preview-title"');
    expect(html).not.toContain('data-testid="session-preview-meta"');
    expect(html).not.toContain('data-testid="session-preview-start-cta"');
    // But the body root is still rendered and tagged with the variant.
    expect(html).toContain('data-testid="session-preview-body"');
    expect(html).toContain('data-variant="compact"');
  });

  it("renders the CardioCard with description + structured rows for a pure-cardio session", () => {
    const html = renderCompact([cardio()], { title: "VO2 intervals" });
    // CardioCard description + at least Intensity + Duration rows
    // (compact variant does NOT hide Duration — it IS the source of
    // truth, since the hero topline no longer carries `~N min`).
    expect(html).toContain('data-testid="session-preview-cardio-0"');
    expect(html).toContain('data-testid="session-preview-cardio-0-description"');
    expect(html).toContain('data-testid="session-preview-cardio-0-row-intensity"');
    expect(html).toContain('data-testid="session-preview-cardio-0-row-duration"');
    // The educational paragraph from CARDIO_DESCRIPTIONS leaks through.
    expect(html).toContain("90–95% of HRmax");
  });

  it("hero topline does not duplicate the cardio Duration: the only `35 min` lives inside the CardioCard", () => {
    // The hero card (page.tsx) used to render `~35 min` in the
    // topline AND the cardio block — that duplication is what this
    // refactor removed. The compact body is the single owner now;
    // verify it surfaces `35 min` exactly once.
    const html = renderCompact([cardio({ durationMin: 35 })], { title: "VO2 intervals" });
    const matches = html.match(/35\s*min/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("condenses each strength movement to a single overview row (no full set-by-set lines)", () => {
    const items: PrescriptionItem[] = [
      main({ movementId: "m-1", movementName: "Front Squat", percentTm: 85, reps: 5 }),
      main({ movementId: "m-2", movementName: "Bench Press", percentTm: 75, reps: 5 }),
    ];
    const html = renderCompact(items, { title: "Strength A" });
    // Movements appear, each tagged with its per-movement testid, inside
    // the single condensed STRENGTH card.
    expect(html).toContain("Front Squat");
    expect(html).toContain("Bench Press");
    expect(html).toContain('data-testid="session-preview-section-strength"');
    expect(html).toContain("MAIN LIFTS");
    expect(html).toContain('data-testid="session-preview-movement-m-1"');
    expect(html).toContain('data-testid="session-preview-movement-m-2"');
    // Condensed: the per-movement summary line is shown…
    expect(html).toContain("top 85% × 5");
    // …and the full warm-up / per-set "Set N" breakdown is NOT (that
    // lives on the Preview page / full variant only).
    expect(html).not.toContain("Set 1");
    expect(html).not.toContain("Warm-up");
  });

  it("separates main and supplemental movements into distinct compact cards", () => {
    const items: PrescriptionItem[] = [
      main({ movementId: "bench", movementName: "Bench Press" }),
      main({ movementId: "row", movementName: "Barbell Row" }),
      main({
        movementId: "pullup",
        movementName: "Pull-up",
        kind: "back_off",
        percentTm: undefined,
        reps: 8,
        repRange: { min: 8, max: 10 },
      }),
      main({
        movementId: "press",
        movementName: "Overhead Press",
        kind: "back_off",
        percentTm: 65,
        reps: 8,
        repRange: { min: 8, max: 10 },
      }),
    ];
    const html = renderCompact(items, { title: "Armor B1" });
    expect(html).toContain('data-testid="session-preview-section-strength"');
    expect(html).toContain('data-testid="session-preview-section-supplemental"');
    expect(html).toContain("MAIN LIFTS");
    expect(html).toContain("SUPPLEMENTAL LIFTS");
  });

  it("renders both strength and cardio for hybrid sessions", () => {
    const items: PrescriptionItem[] = [
      main({ movementId: "m-1", movementName: "Front Squat" }),
      cardio({ movementId: "m-card", movementName: "Z2 row", kind: "cardio_z2" }),
    ];
    const html = renderCompact(items, { title: "Hybrid day" });
    expect(html).toContain('data-testid="session-preview-movement-m-1"');
    expect(html).toContain('data-testid="session-preview-cardio-0"');
  });

  it("cross-cardio-kind regression: every kind renders with consistent structured rows + description (no alignment drift)", () => {
    for (const kind of Object.keys(CARDIO_DESCRIPTIONS)) {
      const html = renderCompact(
        [cardio({ kind: kind as PrescriptionItem["kind"], movementName: kind })],
        { title: kind },
      );
      // Every kind must surface the CardioCard description block AND
      // the Intensity row — those are the irreducible labels the old
      // TodayHeroSummary's per-kind branch struggled to align. With
      // SessionPreviewBody the shape is identical across kinds by
      // construction (single component, no branching).
      expect(
        html,
        `cardio kind ${kind}: missing description block`,
      ).toContain('data-testid="session-preview-cardio-0-description"');
      expect(
        html,
        `cardio kind ${kind}: missing Intensity row`,
      ).toContain('data-testid="session-preview-cardio-0-row-intensity"');
    }
  });
});

/* -------------------------------------------------------------------- */
/* Full-variant regression — make sure we didn't break the Preview page */
/* -------------------------------------------------------------------- */

describe("SessionPreviewBody (full / Preview page) — variant defaults preserved", () => {
  it("default variant still renders the full Preview chrome", () => {
    const html = renderToStaticMarkup(
      <SessionPreviewBody session={input([cardio()], { title: "VO2 intervals" })} />,
    );
    expect(html).toContain('data-testid="back-link"');
    expect(html).toContain('data-testid="session-preview-eyebrow"');
    expect(html).toContain('data-testid="session-preview-title"');
    expect(html).toContain('data-testid="session-preview-meta"');
    expect(html).toContain('data-testid="session-preview-start-cta"');
    expect(html).toContain('data-variant="full"');
    // Full variant continues to hide the cardio Duration row because
    // the page meta carries `~35 min`.
    expect(html).not.toContain('data-testid="session-preview-cardio-0-row-duration"');
  });

  it("labels supplemental-only movements and their optional fourth/fifth sets", () => {
    const supplemental = Array.from({ length: 5 }, (_, index) => ({
      movementId: "reverse-hyper",
      movementName: "Reverse Hyperextension",
      kind: "back_off" as const,
      sets: 1,
      reps: 8,
      percentTm: 65,
      intensityLabel: "65% 1RM",
      setRange: { min: 3, max: 5 },
      repRange: { min: 8, max: 10 },
      ...(index >= 3 ? { optional: true } : {}),
    }));
    const html = renderToStaticMarkup(
      <SessionPreviewBody session={input(supplemental)} />,
    );
    expect(html).toContain("SUPPLEMENTAL");
    expect(html).toContain("Supplemental lift");
    expect(html).toContain("Set 4 · optional");
    expect(html).toContain("Set 5 · optional");
    expect(html).toContain("65% 1RM × 8–10");
  });
});

describe("compact hero — user-authored links", () => {
  // The hero condenses each movement to one row, but a link still has to show:
  // it is the surface most sessions are started from, and a superset changes
  // how the session is performed. Previously only accessory ROWS were
  // bracketed, so a link across main/supplemental lifts was invisible here.
  const linked = (
    movementId: string,
    movementName: string,
    position: number,
    over: Partial<PrescriptionItem> = {},
  ): PrescriptionItem =>
    ({
      kind: "supplemental",
      movementId,
      movementName,
      percentTm: 75,
      reps: 8,
      sets: 3,
      circuit: { id: "link-1", name: "Superset", position, size: 2, rounds: 3 },
      ...over,
    }) as unknown as PrescriptionItem;

  it("brackets two linked supplemental lifts", () => {
    const html = renderCompact([
      main({ movementId: "m-bench", movementName: "Bench Press" }),
      linked("m-pullup", "Pull-up", 0),
      linked("m-press", "Overhead Press", 1),
    ]);
    expect(html).toContain('data-superset-group="link-1"');
    expect(html).toContain("Superset");
    expect(html).toContain("Pull-up");
    expect(html).toContain("Overhead Press");
  });

  it("uses the link's own name so a tri-set does not read as a superset", () => {
    const html = renderCompact([
      linked("m-a", "Lift A", 0, {
        circuit: { id: "link-2", name: "Tri-set", position: 0, size: 3, rounds: 3 },
      }),
      linked("m-b", "Lift B", 1, {
        circuit: { id: "link-2", name: "Tri-set", position: 1, size: 3, rounds: 3 },
      }),
      linked("m-c", "Lift C", 2, {
        circuit: { id: "link-2", name: "Tri-set", position: 2, size: 3, rounds: 3 },
      }),
    ]);
    expect(html).toContain("Tri-set");
  });

  it("leaves unlinked movements unbracketed", () => {
    const html = renderCompact([
      main({ movementId: "m-bench", movementName: "Bench Press" }),
      main({ movementId: "m-row", movementName: "Barbell Row" }),
    ]);
    expect(html).not.toContain("data-superset-group");
  });
});

