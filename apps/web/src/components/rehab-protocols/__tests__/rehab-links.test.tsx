/**
 * Rehab supersets are created by the shared `SessionLinkEditor` but stored and
 * validated by the rehab-protocol schema. Those are two independently-written
 * systems, so this asserts they actually agree: a link the editor produces has
 * to survive the schema, and the schema's membership rule has to reject a link
 * the editor could never have produced.
 *
 * Regression origin: moving authoring to Settings removed the wizard's rehab
 * link editor without adding one here, which left rehab supersets storable,
 * displayable and un-creatable.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { addLink, selectableMovements } from "@/components/program/session-link-editing";
import { rehabLinkableMovements } from "@/lib/platform/rehab-links";
import { parseRehabProtocolInput } from "@/lib/rehab-protocols/schema";
import { RehabProtocolsClient } from "../RehabProtocolsClient";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const item = (movementId: string, movementName: string) => ({
  movementId,
  movementName,
  side: "both" as const,
  sets: 3,
  reps: 15,
});

const noop = async () => ({ ok: true as const, syncedPrograms: [] });

describe("rehab supersets survive the round trip", () => {
  const items = [item(A, "Wrist Curl"), item(B, "Reverse Wrist Curl"), item(C, "Pronation")];
  const movements = rehabLinkableMovements(items);

  it("offers one entry per distinct movement", () => {
    // Left/right rows of one movement are a single station, not two.
    const withSides = [item(A, "Wrist Curl"), item(A, "Wrist Curl")];
    expect(rehabLinkableMovements(withSides)).toHaveLength(1);
  });

  it("stores a superset the editor produced", () => {
    const links = addLink([], movements, [A, B]);
    expect(links).toHaveLength(1);
    expect(links[0]!.name).toBe("Superset");

    const parsed = parseRehabProtocolInput({
      name: "Golfer's Elbow",
      definition: { items, links },
    });
    expect(parsed.ok).toBe(true);
  });

  it("stores a giant set", () => {
    const links = addLink([], movements, [A, B, C]);
    expect(links[0]!.name).toBe("Tri-set");
    expect(
      parseRehabProtocolInput({ name: "P", definition: { items, links } }).ok,
    ).toBe(true);
  });

  it("rejects a link naming a movement the protocol doesn't have", () => {
    const parsed = parseRehabProtocolInput({
      name: "P",
      definition: {
        items: [item(A, "Wrist Curl")],
        links: [{ id: "link-1", name: "Superset", members: [A, B] }],
      },
    });
    expect(parsed).toMatchObject({ ok: false });
  });

  it("never offers a movement that is already linked", () => {
    // Overlap is prevented by what the picker OFFERS — `PrescriptionItem.
    // circuit` is singular, so a movement in two links is unrepresentable.
    const first = addLink([], movements, [A, B]);
    expect(selectableMovements(movements, first).map((m) => m.key)).toEqual([C]);
  });

  it("rejects an overlapping link at save, not at deploy", () => {
    // The picker won't produce this, but the library is writable directly
    // through PostgREST under RLS.
    const parsed = parseRehabProtocolInput({
      name: "P",
      definition: {
        items,
        links: [
          { id: "link-1", name: "Superset", members: [A, B] },
          { id: "link-2", name: "Superset", members: [B, C] },
        ],
      },
    });
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.error).toMatch(/only belong to one superset/i);
  });
});

describe("the Settings editor exposes linking", () => {
  const protocol = {
    id: "p1",
    name: "Golfer's Elbow",
    items: [item(A, "Wrist Curl"), item(B, "Reverse Wrist Curl")],
    links: [{ id: "link-1", name: "Superset", members: [A, B] }],
    revision: 1,
    updatedAt: "2026-08-20T00:00:00.000Z",
    usedBy: ["Armor A2"],
  };

  it("renders the list with the protocol's summary", () => {
    const html = renderToStaticMarkup(
      <RehabProtocolsClient
        protocols={[protocol]}
        movements={[{ id: A, name: "Wrist Curl", pattern: "rehab" }]}
        createAction={noop}
        updateAction={noop}
        duplicateAction={noop}
        deleteAction={async () => ({ ok: true as const })}
      />,
    );
    expect(html).toContain("Golfer&#x27;s Elbow");
    expect(html).toContain("Used by Armor A2");
    expect(html).toContain("2 movements");
  });
});
