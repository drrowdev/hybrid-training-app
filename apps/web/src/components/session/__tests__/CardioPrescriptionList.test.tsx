/**
 * Lightweight SSR coverage for the cardio prescription row. We can't
 * exercise the picker's open/close flow without a DOM testing library
 * (the repo intentionally avoids @testing-library/react), but we can
 * verify the initial structure renders correctly — swap button visible
 * for editable sessions, "previously: …" caption for already-swapped
 * items, and read-only suppression of the swap affordance.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CardioPrescriptionList } from "../CardioPrescriptionList";
import type { PrescriptionItem } from "@hta/db";

const baseItem: PrescriptionItem = {
  movementId: "mov-bike-z2",
  movementSlug: "bike-indoor-z2",
  movementName: "Indoor Bike — Z2",
  kind: "cardio_z2",
  durationMin: 45,
  hrCap: "≤ 70% HRR, conversational",
  intensityLabel: "Easy Z2",
};

const noopAction = (async () => ({ ok: true as const })) as unknown as Parameters<
  typeof CardioPrescriptionList
>[0]["swapAction"];

describe("CardioPrescriptionList — render", () => {
  it("shows a Swap button on each editable cardio row", () => {
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[{ item: baseItem, itemIndex: 0 }]}
        ownedCardio={[]}
        swapAction={noopAction}
      />,
    );
    expect(html).toContain('data-testid="cardio-prescription-swap-button-0"');
    // The card heading strips the " — Z2" protocol shorthand (Fix 2).
    expect(html).toMatch(/<h3[^>]*>\s*Indoor Bike\s*<\/h3>/);
    expect(html).not.toContain("Indoor Bike — Z2");
    expect(html).toContain("Swap");
  });

  it("renders the 'previously: …' caption for swapped items", () => {
    const swapped: PrescriptionItem = {
      ...baseItem,
      movementId: "mov-run-z2",
      movementSlug: "run-easy-z2",
      movementName: "Easy Run — Z2",
      meta: {
        swappedFrom: {
          movementId: "mov-bike-z2",
          movementName: "Indoor Bike — Z2",
        },
        swappedAt: "2026-06-01T10:00:00.000Z",
      },
    };
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[{ item: swapped, itemIndex: 0 }]}
        ownedCardio={[]}
        swapAction={noopAction}
      />,
    );
    // Heading is the stripped name; the "previously" caption keeps
    // the full original name verbatim so the swap audit reads
    // unambiguously.
    expect(html).toMatch(/<h3[^>]*>\s*Easy Run\s*<\/h3>/);
    expect(html).toContain("previously: Indoor Bike — Z2");
    expect(html).toContain('data-swapped="true"');
  });

  it("hides the Swap button when the session is read-only", () => {
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[{ item: baseItem, itemIndex: 0 }]}
        ownedCardio={[]}
        swapAction={noopAction}
        isReadOnly
      />,
    );
    expect(html).not.toContain('data-testid="cardio-prescription-swap-button-0"');
    expect(html).toMatch(/<h3[^>]*>\s*Indoor Bike\s*<\/h3>/);
  });

  it("hides the card heading when the page title matches the movement name (Fix 2 — heading dedup)", () => {
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[{ item: baseItem, itemIndex: 0 }]}
        ownedCardio={[]}
        swapAction={noopAction}
        pageTitle="Indoor Bike"
      />,
    );
    expect(html).not.toMatch(/<h3[^>]*>\s*Indoor Bike\s*<\/h3>/);
    expect(html).toContain(">CARDIO<");
  });

  it("never renders the internal cardioKind code (VO2 / Z2 / alactic) as a standalone chip beside the Swap button (Fix 1)", () => {
    const vo2Item: PrescriptionItem = {
      ...baseItem,
      kind: "cardio_vo2",
      movementName: "VO2 Intervals",
      intensityLabel: "VO2",
      hrCap: "90–95% HRmax",
      protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
    };
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[{ item: vo2Item, itemIndex: 0 }]}
        ownedCardio={[]}
        swapAction={noopAction}
      />,
    );
    // No bare "VO2" element rendered as its own chip / sub-line. The
    // string may still appear inside the page title elsewhere or in
    // structured protocol rows, but never as a free-standing label
    // adjacent to the Swap button.
    expect(html).not.toMatch(/<span[^>]*>\s*VO2\s*<\/span>/);
    expect(html).not.toMatch(/<div[^>]*>\s*VO2\s*<\/div>/);
  });

  it("renders the modality chip + Swap button inline in the card header — Fix 4", () => {
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[{ item: baseItem, itemIndex: 0, modalityLabel: "Bike" }]}
        ownedCardio={[]}
        swapAction={noopAction}
      />,
    );
    expect(html).toContain('data-testid="cardio-prescription-card-0-modality"');
    expect(html).toContain('data-testid="cardio-prescription-swap-button-0"');
    // Both modality chip and Swap button sit inside the card's header
    // row, ABOVE the description block — not in a separate footer row
    // below the card body.
    const modalityIdx = html.indexOf(
      'data-testid="cardio-prescription-card-0-modality"',
    );
    const swapIdx = html.indexOf(
      'data-testid="cardio-prescription-swap-button-0"',
    );
    const descIdx = html.indexOf(
      'data-testid="cardio-prescription-card-0-description"',
    );
    expect(modalityIdx).toBeGreaterThan(-1);
    expect(swapIdx).toBeGreaterThan(-1);
    expect(descIdx).toBeGreaterThan(-1);
    expect(modalityIdx).toBeLessThan(descIdx);
    expect(swapIdx).toBeLessThan(descIdx);
  });
});
