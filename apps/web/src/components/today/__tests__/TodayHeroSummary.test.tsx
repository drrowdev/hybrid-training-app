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
    const strength = rows.filter((r) => r.variant === "strength") as Array<
      Extract<typeof rows[number], { variant: "strength" }>
    >;
    expect(strength.map((r) => r.name)).toEqual(["Front Squat", "Bench Press"]);
    expect(strength[0]!.protocol).toBe("1 × 5 @ 80%");
    expect(strength[1]!.protocol).toBe("1 × 5 @ 75%");
  });

  it("renders cardio sessions as a labelled block (description + Intensity + Total at minimum)", () => {
    const { rows } = buildTodayHeroSummary([
      cardio({
        durationMin: 35,
        protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
      }),
    ]);
    // Cardio-only single item: no cardio-header (deduped against the
    // hero title above). Description → Intervals → Intensity →
    // Recovery → Total.
    expect(rows.map((r) => r.variant)).toEqual([
      "cardio-description",
      "cardio-detail",
      "cardio-detail",
      "cardio-detail",
      "cardio-detail",
    ]);
    const detailRows = rows.filter((r) => r.variant === "cardio-detail") as Array<
      Extract<typeof rows[number], { variant: "cardio-detail" }>
    >;
    expect(detailRows.map((r) => r.label)).toEqual([
      "Intervals",
      "Intensity",
      "Recovery",
      "Total",
    ]);
    expect(detailRows.find((r) => r.label === "Total")!.value).toBe("35 min");
    expect(detailRows.find((r) => r.label === "Intervals")!.value).toMatch(
      /4\s*×\s*4\s*min/,
    );
    expect(detailRows.find((r) => r.label === "Intensity")!.value).toContain(
      "HRmax",
    );
  });

  it("never emits the duplicate 'HR cap' label inside a cardio block (Fix 1)", () => {
    const { rows } = buildTodayHeroSummary([
      cardio({
        durationMin: 35,
        protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
        hrCap: "90–95% HRmax during work",
      }),
    ]);
    const detailRows = rows.filter((r) => r.variant === "cardio-detail") as Array<
      Extract<typeof rows[number], { variant: "cardio-detail" }>
    >;
    expect(detailRows.map((r) => r.label)).not.toContain("HR cap");
    expect(
      detailRows.every((r) => !r.value.includes("during work")),
    ).toBe(true);
  });

  it("hybrid sessions list strength movements first, then cardio (header + description + details)", () => {
    const { rows } = buildTodayHeroSummary([
      main({ percentTm: 80, reps: 5 }),
      cardio({ durationMin: 20, protocolNote: "easy spin" }),
    ]);
    // Strength row + cardio-header + cardio-description + cardio-
    // detail(s). Order is strength first, cardio block second.
    expect(rows[0]!.variant).toBe("strength");
    expect(rows[0]!).toMatchObject({ name: "Front Squat" });
    expect(rows[1]!.variant).toBe("cardio-header");
    expect(rows[1]!).toMatchObject({ name: "VO2 intervals" });
    expect(rows[2]!.variant).toBe("cardio-description");
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

  it("cardio-only sessions render the cardio block WITHOUT the redundant movement name (dedup against the hero title)", () => {
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
    expect(html).toContain('data-variant="cardio-description"');
    expect(html).toContain('data-variant="cardio-detail"');
    // Name suppressed: the hero card already shows "VO2 intervals"
    // directly above this summary, so repeating it reads "amateurish".
    // No cardio-header variant in the output for cardio-only sessions.
    expect(html).not.toContain('data-variant="cardio-header"');
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
    // Cardio header keeps the name because the row above is something
    // else — the hero title can't be a synonym for both.
    expect(html).toContain("VO2 intervals");
    expect(html).toContain('data-variant="cardio-header"');
  });
});

/* -------------------------------------------------------------------- */
/* Cross-kind regression: every cardio kind exported from the planner    */
/* MUST render description + Intensity + Total in the hero. Guard rail   */
/* against adding a new kind without wiring up a one-liner or fallback.  */
/* -------------------------------------------------------------------- */

import {
  CARDIO_DESCRIPTIONS,
  CARDIO_ONE_LINERS,
  cardioOneLinerForKind,
} from "@/lib/session/cardio-descriptions";

const ALL_CARDIO_KINDS = Object.keys(CARDIO_DESCRIPTIONS) as Array<
  keyof typeof CARDIO_DESCRIPTIONS
>;

describe("TodayHeroSummary cross-kind consistency", () => {
  it.each(ALL_CARDIO_KINDS)(
    "%s — minimal prescription (kind + durationMin only) renders description + Intensity + Total",
    (kind) => {
      const { rows } = buildTodayHeroSummary([
        cardio({
          kind: kind as unknown as PrescriptionItem["kind"],
          movementName: `${kind} session`,
          durationMin: 30,
          // Intentionally no protocolNote or hrCap — exercises the
          // kind-based Intensity fallback in cardio-preview-rows.
        }),
      ]);

      const description = rows.find((r) => r.variant === "cardio-description");
      expect(description, `${kind}: missing description row`).toBeDefined();
      expect(
        (description as { text: string }).text.length,
        `${kind}: description text is empty`,
      ).toBeGreaterThan(0);

      const detailRows = rows.filter(
        (r) => r.variant === "cardio-detail",
      ) as Array<Extract<typeof rows[number], { variant: "cardio-detail" }>>;
      const intensity = detailRows.find((r) => r.label === "Intensity");
      expect(intensity, `${kind}: missing Intensity row`).toBeDefined();
      expect(
        intensity!.value.length,
        `${kind}: Intensity value is empty`,
      ).toBeGreaterThan(0);

      const total = detailRows.find((r) => r.label === "Total");
      expect(total, `${kind}: missing Total row`).toBeDefined();
      expect(total!.value).toMatch(/min/);
    },
  );

  it("every CARDIO_DESCRIPTIONS kind has a matching CARDIO_ONE_LINERS entry", () => {
    // Catches the case where someone adds a new kind to the long-form
    // paragraphs but forgets the hero one-liner.
    for (const kind of ALL_CARDIO_KINDS) {
      expect(
        CARDIO_ONE_LINERS[kind],
        `missing one-liner for ${kind}`,
      ).toBeTypeOf("string");
      expect(
        CARDIO_ONE_LINERS[kind]!.length,
        `one-liner for ${kind} is empty`,
      ).toBeGreaterThan(0);
    }
  });

  it("cardioOneLinerForKind falls back to a generic sentence for unknown kinds", () => {
    expect(cardioOneLinerForKind("cardio_future_unknown")).toMatch(
      /Cardio session/i,
    );
    expect(cardioOneLinerForKind(undefined)).toMatch(/Cardio session/i);
    expect(cardioOneLinerForKind(null)).toMatch(/Cardio session/i);
  });
});

/* -------------------------------------------------------------------- */
/* Concrete-case regression: scenarios from the original bug report      */
/* -------------------------------------------------------------------- */

describe("TodayHeroSummary concrete cardio cases", () => {
  it("Long Z2 (cardio_z2, hrCap-only, no protocolNote) renders description + Intensity + Total", () => {
    const { rows } = buildTodayHeroSummary([
      cardio({
        kind: "cardio_z2" as PrescriptionItem["kind"],
        movementName: "Long Z2",
        durationMin: 100,
        hrCap: "≤ 70% HRR, conversational",
      }),
    ]);
    const description = rows.find((r) => r.variant === "cardio-description");
    expect(description).toBeDefined();
    expect((description as { text: string }).text).toMatch(/conversation/i);

    const details = rows.filter((r) => r.variant === "cardio-detail") as Array<
      Extract<typeof rows[number], { variant: "cardio-detail" }>
    >;
    expect(details.map((r) => r.label)).toEqual(["Intensity", "Total"]);
    expect(details[0]!.value).toContain("HRR");
    expect(details[1]!.value).toBe("100 min");
  });

  it("Tempo run (cardio_threshold) with minimal protocolNote renders all three baseline rows", () => {
    const { rows } = buildTodayHeroSummary([
      cardio({
        kind: "cardio_threshold" as PrescriptionItem["kind"],
        movementName: "Tempo run",
        durationMin: 40,
        protocolNote: "20 min @ threshold pace",
      }),
    ]);
    const description = rows.find((r) => r.variant === "cardio-description");
    expect(description).toBeDefined();
    const details = rows.filter((r) => r.variant === "cardio-detail") as Array<
      Extract<typeof rows[number], { variant: "cardio-detail" }>
    >;
    // Whatever the parser extracts, Intensity + Total are non-
    // negotiable for the hero.
    expect(details.find((r) => r.label === "Intensity")).toBeDefined();
    expect(details.find((r) => r.label === "Total")?.value).toBe("40 min");
  });

  it("VO2 (cardio_vo2, rich protocolNote) preserves the full Intervals/Intensity/Recovery/Total breakdown", () => {
    const { rows } = buildTodayHeroSummary([
      cardio({
        kind: "cardio_vo2" as PrescriptionItem["kind"],
        movementName: "VO2 intervals",
        durationMin: 35,
        protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
      }),
    ]);
    const details = rows.filter((r) => r.variant === "cardio-detail") as Array<
      Extract<typeof rows[number], { variant: "cardio-detail" }>
    >;
    expect(details.map((r) => r.label)).toEqual([
      "Intervals",
      "Intensity",
      "Recovery",
      "Total",
    ]);
  });

  it("Easy bike Z2 (modality bike, kind cardio_z2) renders the same shape as Long Z2 run", () => {
    const { rows } = buildTodayHeroSummary([
      cardio({
        kind: "cardio_z2" as PrescriptionItem["kind"],
        movementName: "Easy bike",
        durationMin: 60,
        hrCap: "≤ 70% HRR",
      }),
    ]);
    const description = rows.find((r) => r.variant === "cardio-description");
    expect(description).toBeDefined();
    const details = rows.filter((r) => r.variant === "cardio-detail") as Array<
      Extract<typeof rows[number], { variant: "cardio-detail" }>
    >;
    expect(details.map((r) => r.label)).toEqual(["Intensity", "Total"]);
    expect(details[1]!.value).toBe("60 min");
  });
});