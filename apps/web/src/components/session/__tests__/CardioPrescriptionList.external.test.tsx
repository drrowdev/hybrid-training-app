/**
 * Phase 1 "external cardio" — render coverage for the placeholder
 * card. SSR-only (the repo intentionally avoids @testing-library/react;
 * see CardioPrescriptionList.test.tsx for the precedent).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CardioPrescriptionList } from "../CardioPrescriptionList";
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

describe("CardioPrescriptionList — cardio_external rows", () => {
  it("renders the program name as the title and a Mark complete CTA", () => {
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[{ item: externalItem, itemIndex: 0 }]}
        ownedCardio={[]}
        swapAction={noopSwap}
        markExternalCompleteAction={noopMark}
      />,
    );
    expect(html).toContain('data-external="true"');
    expect(html).toContain("Runna");
    expect(html).toContain("Logged via Runna. Mark complete when done.");
    expect(html).toContain('data-testid="cardio-external-mark-complete-0"');
    expect(html).toContain("Mark complete");
  });

  it("hides the Swap button on the external-cardio row", () => {
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[{ item: externalItem, itemIndex: 0 }]}
        ownedCardio={[]}
        swapAction={noopSwap}
        markExternalCompleteAction={noopMark}
      />,
    );
    expect(html).not.toContain('data-testid="cardio-prescription-swap-button-0"');
  });

  it("falls back to 'External cardio' when no program name is provided", () => {
    const unnamed: PrescriptionItem = {
      movementId: "",
      kind: "cardio_external",
      intensityLabel: "External program",
      protocolNote: "Logged via your external program.",
    };
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[{ item: unnamed, itemIndex: 0 }]}
        ownedCardio={[]}
        swapAction={noopSwap}
        markExternalCompleteAction={noopMark}
      />,
    );
    expect(html).toContain("External cardio");
    expect(html).toContain("Logged via your external program. Mark complete when done.");
  });

  it("hides the Mark complete CTA when the session is read-only", () => {
    const html = renderToStaticMarkup(
      <CardioPrescriptionList
        plannedSessionId="00000000-0000-0000-0000-000000000001"
        items={[{ item: externalItem, itemIndex: 0 }]}
        ownedCardio={[]}
        swapAction={noopSwap}
        markExternalCompleteAction={noopMark}
        isReadOnly
      />,
    );
    expect(html).not.toContain('data-testid="cardio-external-mark-complete-0"');
  });
});
