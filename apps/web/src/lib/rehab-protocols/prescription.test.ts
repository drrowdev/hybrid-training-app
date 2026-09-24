import { describe, expect, it } from "vitest";
import { authoredExecutionParts, authoredPartComplete } from "@hta/domain";
import { compileLibraryRehab, rehabPrescriptionItems } from "./prescription";

const protocol = {
  id: "10000000-0000-4000-8000-000000000001", name: "Adductor protocol", revision: 3,
  items: [
    { movementId: "10000000-0000-4000-8000-000000000002", movementName: "Side hold", side: "left" as const, sets: 2, holdSeconds: 30, instructions: "Keep the pelvis level." },
    { movementId: "10000000-0000-4000-8000-000000000002", movementName: "Side hold", side: "right" as const, sets: 2, holdSeconds: 30 },
    { movementId: "10000000-0000-4000-8000-000000000003", movementName: "Adduction", sets: 4, reps: 8, repRange: { min: 8, max: 12 }, targetWeightKg: 5 },
  ],
  links: [{ id: "pair", name: "Pair", members: ["10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003"] }],
};

describe("DC-R5 shared library rehab prescription", () => {
  it("retains protocol revision, both sides, dose, ordered set identity and grouping", () => {
    const before = structuredClone(protocol);
    const items = compileLibraryRehab(protocol, "workout:one");
    expect(items).toHaveLength(8);
    expect(items.map((item) => item.meta?.rehabItemIndex)).toEqual([0, 0, 1, 1, 2, 2, 2, 2]);
    expect(items.map((item) => item.meta?.rehabSetIndex)).toEqual([0, 1, 0, 1, 0, 1, 2, 3]);
    expect(items.map((item) => item.circuit?.round)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(items.every((item) => item.kind === "tendon" && item.sets === 1 &&
      item.meta?.rehabProtocolId === protocol.id && item.meta?.rehabProtocolRevision === 3)).toBe(true);
    expect(items[0]).toMatchObject({ holdSec: { min: 30, max: 30 }, meta: { side: "left" } });
    expect(items[2]).toMatchObject({ holdSec: { min: 30, max: 30 }, meta: { side: "right" } });
    expect(items[4]).toMatchObject({ reps: 8, repRange: { min: 8, max: 12 }, targetWeightKg: 5 });
    expect(protocol).toEqual(before);
  });
  it("keeps repeated attachments distinct without changing library IDs", () => {
    const first = compileLibraryRehab(protocol, "part:one");
    const second = compileLibraryRehab(protocol, "part:two");
    expect(first[0]?.circuit?.id).not.toBe(second[0]?.circuit?.id);
    expect(first[0]?.meta?.rehabProtocolId).toBe(second[0]?.meta?.rehabProtocolId);
  });
  it("requires every set in an attached authored part before marking it complete", () => {
    const items = compileLibraryRehab(protocol, "part").map((item) => ({
      ...item, meta: { ...item.meta, authoredPartId: "part" },
    }));
    const [part] = authoredExecutionParts(items);
    expect(part).toMatchObject({ kind: "rehab", title: protocol.name });
    expect(authoredPartComplete(part!, new Set([0, 1, 2, 3, 4, 5, 6]), new Set())).toBe(false);
    expect(authoredPartComplete(part!, new Set([0, 1, 2, 3, 4, 5, 6, 7]), new Set())).toBe(true);
  });
  it("retains legacy materializer metadata without inventing a library revision", () => {
    const [item] = rehabPrescriptionItems(protocol.items, { protocolId: "protocol-1", protocolName: protocol.name, sourceRef: "legacy" });
    expect(item?.meta?.rehabProtocolId).toBe("protocol-1");
    expect(item?.meta).not.toHaveProperty("rehabProtocolRevision");
  });
});
