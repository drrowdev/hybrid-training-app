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
    expect(html).toContain("Indoor Bike — Z2");
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
    expect(html).toContain("Easy Run — Z2");
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
    expect(html).toContain("Indoor Bike — Z2");
  });
});
