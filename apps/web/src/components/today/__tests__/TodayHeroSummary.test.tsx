import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import type { PrescriptionItem } from "@hta/db";
import {
  buildTodayHeroSummary,
  TodayHeroSummary,
} from "../TodayHeroSummary";

/* -------------------------------------------------------------------- */
/* Fixture helpers                                                       */
/* -------------------------------------------------------------------- */

const main = (over: Partial<PrescriptionItem>): PrescriptionItem =>
  ({
    kind: "main",
    movementId: over.movementId ?? "m-main",
    movementName: over.movementName ?? "Front Squat",
    ...over,
  }) as unknown as PrescriptionItem;

const accessory = (over: Partial<PrescriptionItem>): PrescriptionItem =>
  ({
    kind: "accessory",
    movementId: over.movementId ?? "m-acc",
    movementName: over.movementName ?? "Pull-ups",
    sets: 3,
    reps: 10,
    ...over,
  }) as unknown as PrescriptionItem;

const cardio = (over: Partial<PrescriptionItem>): PrescriptionItem =>
  ({
    kind: "cardio_vo2",
    movementId: over.movementId ?? "m-card",
    movementName: over.movementName ?? "VO2 intervals",
    ...over,
  }) as unknown as PrescriptionItem;

/* -------------------------------------------------------------------- */
/* buildTodayHeroSummary                                                 */
/* -------------------------------------------------------------------- */

describe("buildTodayHeroSummary", () => {
  it("returns one row per main strength movement with a top-set protocol", () => {
    const { rows, accessoryCount, overflow } = buildTodayHeroSummary([
      main({ percentTm: 80, reps: 5 }),
      main({ percentTm: 80, reps: 5 }),
      main({ percentTm: 80, reps: 5 }),
      accessory({}),
      accessory({ movementId: "m-acc-2", movementName: "Curls" }),
    ]);
    expect(rows).toEqual([
      { name: "Front Squat", protocol: "3 × 5 @ 80%", variant: "strength" },
    ]);
    expect(accessoryCount).toBe(2);
    expect(overflow).toBe(0);
  });

  it("handles dual-main-lift sessions by emitting one row per main section (ADR 0004)", () => {
    const rows = buildTodayHeroSummary([
      main({
        movementId: "m-fs",
        movementName: "Front Squat",
        percentTm: 80,
        reps: 5,
      }),
      main({
        movementId: "m-bp",
        movementName: "Bench Press",
        percentTm: 75,
        reps: 5,
      }),
    ]).rows;
    expect(rows.map((r) => r.name)).toEqual(["Front Squat", "Bench Press"]);
    expect(rows[0]!.protocol).toBe("1 × 5 @ 80%");
    expect(rows[1]!.protocol).toBe("1 × 5 @ 75%");
  });

  it("renders cardio sessions as a single dot-separated line without a Duration sub-row", () => {
    const { rows } = buildTodayHeroSummary([
      cardio({
        durationMin: 35,
        protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("VO2 intervals");
    // Duration is dropped (the hero topline already shows "~35 min").
    expect(rows[0]!.protocol).not.toMatch(/35 min/);
    // Intervals + Intensity + Recovery survive in the joined line.
    expect(rows[0]!.protocol).toMatch(/4\s*×\s*4\s*min/);
    expect(rows[0]!.protocol).toContain("HRmax");
    expect(rows[0]!.protocol).toContain("easy recovery");
  });

  it("never emits the duplicate 'HR cap' label inside the cardio line (Fix 1)", () => {
    const { rows } = buildTodayHeroSummary([
      cardio({
        durationMin: 35,
        protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
        hrCap: "90–95% HRmax during work",
      }),
    ]);
    expect(rows[0]!.protocol).not.toContain("HR cap");
    expect(rows[0]!.protocol).not.toContain("during work");
  });

  it("hybrid sessions list strength movements first, then cardio", () => {
    const { rows } = buildTodayHeroSummary([
      main({ percentTm: 80, reps: 5 }),
      cardio({ durationMin: 20, protocolNote: "easy spin" }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Front Squat", "VO2 intervals"]);
  });

  it("truncates to 5 rows with '… and N more' when more strength movements exist", () => {
    const items: PrescriptionItem[] = Array.from({ length: 7 }, (_, i) =>
      main({
        movementId: `m-${i}`,
        movementName: `Lift ${i + 1}`,
        percentTm: 70,
        reps: 5,
      }),
    );
    const { rows, overflow } = buildTodayHeroSummary(items);
    // Spec: max 5 rows total. Truncation reserves the last visible row
    // for the "… and N more" line, so we keep 4 movement rows + the
    // overflow row = 5 visible lines.
    expect(rows).toHaveLength(4);
    expect(overflow).toBe(3);
  });

  it("counts distinct accessory movements rather than raw rows", () => {
    const { accessoryCount } = buildTodayHeroSummary([
      accessory({ movementId: "a", movementName: "Pull-ups" }),
      accessory({ movementId: "a", movementName: "Pull-ups" }),
      accessory({ movementId: "b", movementName: "Curls" }),
    ]);
    expect(accessoryCount).toBe(2);
  });
});

/* -------------------------------------------------------------------- */
/* TodayHeroSummary (rendering)                                          */
/* -------------------------------------------------------------------- */

describe("TodayHeroSummary", () => {
  it("renders a row per movement and an accessory tally", () => {
    const html = renderToStaticMarkup(
      React.createElement(TodayHeroSummary, {
        items: [
          main({ percentTm: 80, reps: 5 }),
          accessory({}),
          accessory({ movementId: "m-acc-2", movementName: "Curls" }),
        ],
      }),
    );
    expect(html).toContain('data-testid="today-hero-summary"');
    expect(html).toContain('data-testid="today-hero-summary-row"');
    expect(html).toContain("Front Squat");
    expect(html).toContain("1 × 5 @ 80%");
    expect(html).toContain('data-testid="today-hero-summary-accessories"');
    expect(html).toContain("+ 2 accessories");
  });

  it("renders the '… and N more' overflow marker when there are too many movements", () => {
    const items: PrescriptionItem[] = Array.from({ length: 7 }, (_, i) =>
      main({
        movementId: `m-${i}`,
        movementName: `Lift ${i + 1}`,
        percentTm: 70,
        reps: 5,
      }),
    );
    const html = renderToStaticMarkup(
      React.createElement(TodayHeroSummary, { items }),
    );
    expect(html).toContain('data-testid="today-hero-summary-overflow"');
    expect(html).toMatch(/… and 3 more/);
  });

  it("renders nothing when the prescription is empty", () => {
    const html = renderToStaticMarkup(
      React.createElement(TodayHeroSummary, { items: [] }),
    );
    expect(html).toBe("");
  });

  it("singularises the accessory tally when there's exactly one accessory", () => {
    const html = renderToStaticMarkup(
      React.createElement(TodayHeroSummary, {
        items: [main({ percentTm: 80, reps: 5 }), accessory({})],
      }),
    );
    expect(html).toContain("+ 1 accessory");
  });

  /* ------------------------------------------------------------------ */
  /* Fix 2 — restructured layout (no awkward two-column split)          */
  /* ------------------------------------------------------------------ */

  it("strength rows render in the stacked variant (movement name on its own line, protocol indented below)", () => {
    const html = renderToStaticMarkup(
      React.createElement(TodayHeroSummary, {
        items: [main({ percentTm: 80, reps: 5 })],
      }),
    );
    expect(html).toContain('data-variant="strength"');
    // The old two-column layout used flex with
    // justifyContent:space-between — the new stacked layout must not.
    expect(html).not.toMatch(/space-between/);
  });

  it("cardio-only sessions render the cardio row WITHOUT the redundant movement name (dedup against the hero title)", () => {
    const html = renderToStaticMarkup(
      React.createElement(TodayHeroSummary, {
        items: [
          cardio({
            durationMin: 35,
            protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
          }),
        ],
      }),
    );
    expect(html).toContain('data-variant="cardio"');
    // Name suppressed: the hero card already shows "VO2 intervals"
    // directly above this summary, so repeating it reads "amateurish".
    expect(html).not.toContain("VO2 intervals");
    // The protocol detail is still rendered.
    expect(html).toMatch(/4\s*×\s*4\s*min/);
  });

  it("hybrid sessions keep the cardio movement name (only suppressed when it's the single row)", () => {
    const html = renderToStaticMarkup(
      React.createElement(TodayHeroSummary, {
        items: [
          main({ percentTm: 80, reps: 5 }),
          cardio({
            durationMin: 20,
            protocolNote: "easy spin",
          }),
        ],
      }),
    );
    // Strength row shows name + protocol stacked.
    expect(html).toContain("Front Squat");
    // Cardio row keeps its name because the row above is something
    // else — the hero title can't be a synonym for both.
    expect(html).toContain("VO2 intervals");
  });
});
