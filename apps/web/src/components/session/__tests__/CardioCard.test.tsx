/**
 * Smoke render tests for the shared CardioCard component used by both
 * the Session Preview body and the live in-session cardio section.
 *
 * Asserts the structured-row layout (Fix 3), the educational
 * description (Fix 5), the heading dedup hook (Fix 2) and the
 * cardioKind-code suppression guard (Fix 1).
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrescriptionItem } from "@hta/db";
import { CardioCard } from "../CardioCard";

const vo2 = (over: Partial<PrescriptionItem> = {}): PrescriptionItem =>
  ({
    kind: "cardio_vo2",
    movementId: "m-cardio",
    movementName: "VO2 Intervals — 4×4",
    durationMin: 35,
    protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
    hrCap: "90–95% HRmax during work",
    ...over,
  }) as unknown as PrescriptionItem;

describe("CardioCard", () => {
  it("renders the structured Intervals / Intensity / Recovery rows", () => {
    const html = renderToStaticMarkup(
      <CardioCard
        item={vo2()}
        testId="card"
        rowTestIdPrefix="card"
      />,
    );
    expect(html).toContain("Intervals");
    expect(html).toContain("Intensity");
    expect(html).toContain("Recovery");
    expect(html).toContain('data-testid="card-row-intervals"');
    expect(html).toContain('data-testid="card-row-intensity"');
    expect(html).toContain('data-testid="card-row-recovery"');
  });

  it("strips the ' — 4×4' shorthand from the heading", () => {
    const html = renderToStaticMarkup(
      <CardioCard item={vo2()} testId="card" />,
    );
    expect(html).toMatch(/<h3[^>]*>\s*VO2 Intervals\s*<\/h3>/);
    expect(html).not.toMatch(/<h3[^>]*>[^<]*— 4×4/);
  });

  it("hides the heading entirely when hideHeading is true", () => {
    const html = renderToStaticMarkup(
      <CardioCard item={vo2()} hideHeading testId="card" />,
    );
    expect(html).not.toMatch(/<h3[^>]*>/);
    // Mockup B drops the "CARDIO" eyebrow — make sure it stayed gone.
    expect(html).not.toContain(">CARDIO<");
  });

  it("hides the Duration row when hideDurationRow is true", () => {
    const html = renderToStaticMarkup(
      <CardioCard
        item={vo2()}
        hideDurationRow
        testId="card"
        rowTestIdPrefix="card"
      />,
    );
    expect(html).not.toContain("card-row-duration");
  });

  it("renders the kind-specific educational description (Fix 5)", () => {
    const vo2Html = renderToStaticMarkup(
      <CardioCard item={vo2()} testId="card" rowTestIdPrefix="card" />,
    );
    expect(vo2Html).toContain('data-testid="card-description"');
    // Mockup B drops the "How to do it" label — the 2 px accent border on
    // the description block carries the affordance instead.
    expect(vo2Html).not.toContain("How to do it");
    // VO2 description mentions HRmax target.
    expect(vo2Html).toMatch(/90.95%/);

    const z2Html = renderToStaticMarkup(
      <CardioCard
        item={vo2({ kind: "cardio_z2", movementName: "Z2 Easy" })}
        testId="card"
      />,
    );
    expect(z2Html).toMatch(/conversation/i);

    const alacticHtml = renderToStaticMarkup(
      <CardioCard
        item={vo2({
          kind: "cardio_alactic",
          movementName: "Hill sprints",
          protocolNote: "6 × 10s sprints",
        })}
        testId="card"
      />,
    );
    expect(alacticHtml).toMatch(/sprint|sharp|explosive/i);
  });

  it("never renders the bare engine kind code (VO2 / Z2 / alactic) as its own block (Fix 1)", () => {
    // Allow occurrences inside the title / structured Intensity row,
    // but not as a standalone chip.
    const html = renderToStaticMarkup(
      <CardioCard
        item={vo2({ intensityLabel: "VO2" })}
        testId="card"
      />,
    );
    expect(html).not.toMatch(/<span[^>]*>\s*VO2\s*<\/span>/);
    expect(html).not.toMatch(/<div[^>]*>\s*VO2\s*<\/div>/);
  });

  it("renders the educational description as a plain block (not a collapsible details) — Fix 2", () => {
    const html = renderToStaticMarkup(
      <CardioCard item={vo2()} testId="card" rowTestIdPrefix="card" />,
    );
    // The description block sits ABOVE the structured rows.
    expect(html).toContain('data-testid="card-description"');
    expect(html).not.toMatch(
      /<details[^>]*data-testid="card-description"/,
    );
    const descIdx = html.indexOf('data-testid="card-description"');
    const intervalsIdx = html.indexOf('data-testid="card-row-intervals"');
    expect(descIdx).toBeGreaterThan(-1);
    expect(intervalsIdx).toBeGreaterThan(-1);
    expect(descIdx).toBeLessThan(intervalsIdx);
  });

  it("renders the modality chip in the header when modalityLabel is provided — Fix 4", () => {
    const html = renderToStaticMarkup(
      <CardioCard
        item={vo2()}
        modalityLabel="Run"
        testId="card"
        rowTestIdPrefix="card"
      />,
    );
    expect(html).toContain('data-testid="card-modality"');
    expect(html).toContain('data-modality="run"');
    expect(html).toMatch(/>\s*Run\s*</);
  });

  it("renders headerActions inline with the heading + modality chip — Fix 4", () => {
    const html = renderToStaticMarkup(
      <CardioCard
        item={vo2()}
        modalityLabel="Bike"
        headerActions={
          <button type="button" data-testid="my-swap-button">
            Swap
          </button>
        }
        testId="card"
        rowTestIdPrefix="card"
      />,
    );
    expect(html).toContain('data-testid="my-swap-button"');
    // Order: heading → modality chip → headerActions, all in the same
    // header row that appears before the description block.
    const headingIdx = html.indexOf("VO2 Intervals");
    const modalityIdx = html.indexOf('data-testid="card-modality"');
    const swapIdx = html.indexOf('data-testid="my-swap-button"');
    const descIdx = html.indexOf('data-testid="card-description"');
    expect(headingIdx).toBeLessThan(modalityIdx);
    expect(modalityIdx).toBeLessThan(swapIdx);
    expect(swapIdx).toBeLessThan(descIdx);
  });

  it("omits the modality chip when modalityLabel is null / empty — Fix 4", () => {
    const html = renderToStaticMarkup(
      <CardioCard
        item={vo2()}
        modalityLabel={null}
        testId="card"
        rowTestIdPrefix="card"
      />,
    );
    expect(html).not.toContain('data-testid="card-modality"');
  });
});
