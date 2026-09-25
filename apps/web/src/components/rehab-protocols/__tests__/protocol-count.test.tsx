import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RehabProtocolItem } from "@/lib/rehab-protocols/queries";
import { summariseProtocol, toPrescriptionItems } from "@/lib/rehab-protocols/summary";
import { expandPrescriptionSets } from "@/lib/planner/expand-prescription-sets";
import { summarisePrescription } from "@/lib/planner/archetypes";
import { embedRehabPrescription } from "@/lib/platform/rehab-composition";
import { planMissingPrescriptionSets } from "@/lib/sessions/fill-plan-sets";
import { SessionPreviewBody } from "@/components/session/SessionPreviewBody";
import { RehabProtocolsClient } from "../RehabProtocolsClient";

const items: RehabProtocolItem[] = [
  {
    movementId: "copenhagen",
    movementName: "Copenhagen Plank",
    sets: 3,
    reps: 8,
    repRange: { min: 8, max: 10 },
    side: "both",
    instructions: "Dynamic",
  },
  {
    movementId: "copenhagen",
    movementName: "Copenhagen Plank",
    sets: 3,
    holdSeconds: 20,
    side: "both",
    instructions: "Isometric",
  },
  {
    movementId: "hip-flexor",
    movementName: "Hip Flexor Raise (kettlebell)",
    sets: 3,
    reps: 10,
    side: "both",
  },
];
const noop = async () => ({ ok: true as const, id: "adductor", syncedPrograms: [] });

describe("rehab protocol with dynamic and isometric Copenhagen entries", () => {
  it("counts three variants and nine sets in Settings and the program picker summary", () => {
    expect(summariseProtocol(items)).toMatchObject({ movementCount: 3, setCount: 9 });
    const html = renderToStaticMarkup(
      <RehabProtocolsClient
        protocols={[{
          id: "adductor",
          name: "Adductor rehab",
          items,
          links: [],
          revision: 1,
          updatedAt: "2026-09-17T11:00:00Z",
          usedBy: [],
        }]}
        movements={[]}
        createAction={noop}
        updateAction={noop}
        duplicateAction={noop}
        deleteAction={noop}
      />,
    );
    expect(html).toContain("3 movements");
    expect(html).toContain("9 sets");
  });

  it("keeps all nine loggable sets and both Copenhagen targets in the session preview (DC-J1 / DC-S2)", () => {
    const prescription = expandPrescriptionSets({ items: toPrescriptionItems(items) });
    expect(prescription.items).toHaveLength(9);
    expect(prescription.items.slice(0, 3).every(
      (item) => item.reps === 8 && item.repRange?.max === 10 && item.holdSec == null,
    )).toBe(true);
    expect(prescription.items.slice(3, 6).every(
      (item) => item.holdSec?.min === 20 && item.reps == null,
    )).toBe(true);
    expect(prescription.items.slice(6).every((item) => item.reps === 10)).toBe(true);
    expect(planMissingPrescriptionSets(
      "11111111-1111-4111-a111-111111111111", prescription.items, [],
    ).map((set) => set.itemIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(summarisePrescription(prescription.items)).toBe("Rehab · 3 movements");

    const embedded = embedRehabPrescription({ items: [] }, prescription.items, {
      protocolId: "adductor", protocolName: "Adductor rehab", sourceRef: "rehab-w0-d0",
    });
    expect(embedded.meta?.embeddedRehabSections?.[0]).toMatchObject({
      movementCount: 3, itemCount: 9,
    });
    const html = renderToStaticMarkup(
      <SessionPreviewBody session={{
        id: "planned", title: "Adductor rehab", eyebrow: "", estDurationMin: null,
        items: embedded.items,
      }} />,
    );
    expect(html).toContain("3 movements");
    expect(html).toContain("3 × 8–10");
    expect(html).toContain("20s");
    expect(html).toContain("3 × 10");
  });
});
