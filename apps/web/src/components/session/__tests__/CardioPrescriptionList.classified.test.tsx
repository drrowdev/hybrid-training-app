/**
 * Phase 2 — render coverage for the classified external cardio card.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CardioPrescriptionList, type CardioClassification } from "../CardioPrescriptionList";
import type { PrescriptionItem } from "@hta/db";

const externalItem: PrescriptionItem = {
  movementId: "",
  kind: "cardio_external",
  intensityLabel: "Runna",
  protocolNote: "Logged via Runna.",
};

const noopSwap = (async () => ({ ok: true as const })) as unknown as Parameters<
  typeof CardioPrescriptionList
>[0]["swapAction"];

const noopMark = (async () => ({ ok: true as const })) as Parameters<
  typeof CardioPrescriptionList
>[0]["markExternalCompleteAction"];

const baseClassification: CardioClassification = {
  label: "VO2 intervals",
  reason: "avg 168 bpm (Z4), max 178 bpm — likely VO2 work",
  confidence: 0.85,
  effectiveStressLoad: 80,
};

describe("CardioPrescriptionList — Phase 2 classification", () => {
  it("renders the inferred kind label and reason in place of the placeholder", () => {
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[{ item: externalItem, itemIndex: 0, classification: baseClassification }]}
        ownedCardio={[]}
        swapAction={noopSwap}
        markExternalCompleteAction={noopMark}
      />,
    );
    expect(html).toContain('data-classified="true"');
    expect(html).toContain("Detected as");
    expect(html).toContain("VO2 intervals");
    expect(html).toContain("avg 168 bpm (Z4), max 178 bpm");
    expect(html).toContain("Effective load: 80");
    expect(html).toContain("(high)");
    // The Phase 1 placeholder body should be gone.
    expect(html).not.toContain("Logged via Runna. Tap Mark done when finished.");
  });

  it("shows the (?) low-confidence marker when confidence < 0.7", () => {
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[
          {
            item: externalItem,
            itemIndex: 0,
            classification: { ...baseClassification, confidence: 0.42 },
          },
        ]}
        ownedCardio={[]}
        swapAction={noopSwap}
        markExternalCompleteAction={noopMark}
      />,
    );
    expect(html).toContain('data-testid="cardio-external-low-confidence-0"');
  });

  it("does NOT show the (?) marker when confidence ≥ 0.7", () => {
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[{ item: externalItem, itemIndex: 0, classification: baseClassification }]}
        ownedCardio={[]}
        swapAction={noopSwap}
        markExternalCompleteAction={noopMark}
      />,
    );
    expect(html).not.toContain("cardio-external-low-confidence-0");
  });

  it("falls back to the Phase 1 placeholder body when no classification is supplied", () => {
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[{ item: externalItem, itemIndex: 0 }]}
        ownedCardio={[]}
        swapAction={noopSwap}
        markExternalCompleteAction={noopMark}
      />,
    );
    expect(html).toContain('data-classified="false"');
    // The body element, not the CTA label — "Mark done" renders whether or
    // not the fallback body does, so asserting on it proved nothing.
    expect(html).toContain('data-testid="cardio-external-body-0"');
    expect(html).not.toContain("Detected as");
  });

  it("renders the ESL band qualifier based on the load number", () => {
    const low = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[
          {
            item: externalItem,
            itemIndex: 0,
            classification: { ...baseClassification, effectiveStressLoad: 15 },
          },
        ]}
        ownedCardio={[]}
        swapAction={noopSwap}
        markExternalCompleteAction={noopMark}
      />,
    );
    expect(low).toContain("Effective load: 15");
    expect(low).toContain("(low)");

    const mid = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[
          {
            item: externalItem,
            itemIndex: 0,
            classification: { ...baseClassification, effectiveStressLoad: 45 },
          },
        ]}
        ownedCardio={[]}
        swapAction={noopSwap}
        markExternalCompleteAction={noopMark}
      />,
    );
    expect(mid).toContain("(moderate)");
  });
});
