/**
 * The resolver is the single point where a library protocol's content replaces
 * the copy a program was deployed with. If it is wrong, either a Settings edit
 * never reaches the plan, or a program loses rehab it should have kept.
 */
import { describe, it, expect } from "vitest";
import {
  localProtocolIds,
  rehabFingerprint,
  resolutionChangesProgram,
  resolveRehabLibrary,
  type LibraryProtocol,
} from "../rehab-library";
import type { TbCustomization } from "../tb-customization";

const item = (movementName: string, over: Record<string, unknown> = {}) => ({
  movementId: "11111111-1111-1111-1111-111111111111",
  movementName,
  side: "both" as const,
  sets: 3,
  reps: 15,
  ...over,
});

const v3 = (over: Partial<Record<string, unknown>> = {}): TbCustomization =>
  ({
    version: 3,
    templateId: "activation",
    displayName: "Armor A2",
    phases: {
      base: { sessions: {}, rehabAssignments: [{ day: 1, protocolId: "protocol-1" }] },
      armor: { sessions: {}, rehabAssignments: [] },
      operator: { sessions: {}, rehabAssignments: [] },
      vertex: { sessions: {}, rehabAssignments: [] },
    },
    rehabProtocols: [
      { id: "protocol-1", name: "Elbow", items: [item("Wrist Curl")] },
      { id: "protocol-2", name: "Groin", items: [item("Copenhagen")] },
    ],
    ...over,
  }) as unknown as TbCustomization;

const v1 = (): TbCustomization =>
  ({
    version: 1,
    displayName: "My TB",
    dayTypes: ["strength", "rehab", "rest", "rest", "rest", "rest", "rest"],
    sessionMovements: {},
    rehab: { items: [item("Achilles Isometric")] },
  }) as unknown as TbCustomization;

const lib = (over: Partial<LibraryProtocol> = {}): LibraryProtocol => ({
  id: "lib-1",
  name: "Elbow",
  items: [item("Wrist Curl")],
  links: [],
  ...over,
});

describe("resolveRehabLibrary — no binding means no change", () => {
  it("returns the customization untouched when nothing is bound", () => {
    const customization = v3();
    const resolved = resolveRehabLibrary(customization, {}, {}, []);
    // Identity, not just equality: unbound programs must take the cheap path.
    expect(resolved.customization).toBe(customization);
    expect(resolved.missing).toEqual([]);
  });

  it("leaves a protocol alone when its library row is missing", () => {
    const customization = v3();
    const resolved = resolveRehabLibrary(
      customization,
      {},
      { "protocol-1": "lib-gone" },
      [],
    );
    expect(rehabFingerprint(resolved.customization)[0]!.items[0]!.movementName).toBe(
      "Wrist Curl",
    );
    expect(resolved.missing).toEqual(["protocol-1"]);
  });
});

describe("resolveRehabLibrary — V3", () => {
  it("substitutes items and name for the bound protocol only", () => {
    const resolved = resolveRehabLibrary(
      v3(),
      {},
      { "protocol-1": "lib-1" },
      [lib({ name: "Golfer's Elbow", items: [item("Reverse Wrist Curl", { reps: 20 })] })],
    );
    const fingerprint = rehabFingerprint(resolved.customization);
    expect(fingerprint[0]).toMatchObject({ id: "protocol-1", name: "Golfer's Elbow" });
    expect(fingerprint[0]!.items[0]!.movementName).toBe("Reverse Wrist Curl");
    expect(fingerprint[0]!.items[0]!.reps).toBe(20);
    // The unbound sibling is untouched.
    expect(fingerprint[1]).toMatchObject({ id: "protocol-2", name: "Groin" });
    expect(fingerprint[1]!.items[0]!.movementName).toBe("Copenhagen");
  });

  it("keeps the local id so links, assignments and source refs still resolve", () => {
    const resolved = resolveRehabLibrary(v3(), {}, { "protocol-1": "lib-1" }, [lib()]);
    expect(localProtocolIds(resolved.customization)).toEqual([
      "protocol-1",
      "protocol-2",
    ]);
  });

  it("replaces the program's links for a bound protocol", () => {
    const resolved = resolveRehabLibrary(
      v3(),
      { "rehab.protocol-1": [{ id: "old", kind: "superset", members: ["a", "b"] }] },
      { "protocol-1": "lib-1" },
      [lib({ links: [{ id: "new", kind: "circuit", members: ["c", "d"], rounds: 3 }] })],
    );
    expect(resolved.linksBySeries["rehab.protocol-1"]).toEqual([
      { id: "new", kind: "circuit", members: ["c", "d"], rounds: 3 },
    ]);
  });

  it("clears links the user removed in Settings", () => {
    const resolved = resolveRehabLibrary(
      v3(),
      { "rehab.protocol-1": [{ id: "old", kind: "superset", members: ["a", "b"] }] },
      { "protocol-1": "lib-1" },
      [lib({ links: [] })],
    );
    expect(resolved.linksBySeries["rehab.protocol-1"]).toEqual([]);
  });

  it("leaves an unrelated series key alone", () => {
    const resolved = resolveRehabLibrary(
      v3(),
      { "strength.day-1": [{ id: "s", kind: "superset", members: ["x", "y"] }] },
      { "protocol-1": "lib-1" },
      [lib()],
    );
    expect(resolved.linksBySeries["strength.day-1"]).toHaveLength(1);
  });

  it("does not mutate its inputs", () => {
    const customization = v3();
    const links = { "rehab.protocol-1": [] };
    const snapshot = JSON.stringify({ customization, links });
    resolveRehabLibrary(customization, links, { "protocol-1": "lib-1" }, [lib()]);
    expect(JSON.stringify({ customization, links })).toBe(snapshot);
  });
});

describe("resolveRehabLibrary — legacy V1 / V2", () => {
  it("binds the synthetic protocol-1 to the unnamed item list", () => {
    expect(localProtocolIds(v1())).toEqual(["protocol-1"]);
    const resolved = resolveRehabLibrary(
      v1(),
      {},
      { "protocol-1": "lib-1" },
      [lib({ items: [item("Heel Raise", { sets: 4 })] })],
    );
    expect(rehabFingerprint(resolved.customization)[0]!.items).toEqual([
      item("Heel Raise", { sets: 4 }),
    ]);
  });

  it("reports no protocol ids when a legacy blob has no rehab", () => {
    const bare = { version: 1, displayName: "x", dayTypes: [], sessionMovements: {} };
    expect(localProtocolIds(bare as unknown as TbCustomization)).toEqual([]);
  });
});

describe("resolutionChangesProgram", () => {
  it("is false when the library matches what the program already has", () => {
    expect(
      resolutionChangesProgram(v3(), {}, { "protocol-1": "lib-1" }, [lib()]),
    ).toBe(false);
  });

  it("is true when the movements changed", () => {
    expect(
      resolutionChangesProgram(v3(), {}, { "protocol-1": "lib-1" }, [
        lib({ items: [item("Wrist Curl", { reps: 20 })] }),
      ]),
    ).toBe(true);
  });

  it("is true for a RENAME with identical movements", () => {
    // rehabItemsForComparison() strips rehabProtocolName, so the prescription
    // comparison cannot see a rename. If this returned false a rename would
    // never reach the plan.
    expect(
      resolutionChangesProgram(v3(), {}, { "protocol-1": "lib-1" }, [
        lib({ name: "Renamed" }),
      ]),
    ).toBe(true);
  });

  it("is true when only the links changed", () => {
    expect(
      resolutionChangesProgram(v3(), {}, { "protocol-1": "lib-1" }, [
        lib({ links: [{ id: "l", kind: "superset", members: ["a", "b"] }] }),
      ]),
    ).toBe(true);
  });

  it("is false for a program with no bindings at all", () => {
    expect(resolutionChangesProgram(v3(), {}, {}, [lib({ name: "Whatever" })])).toBe(
      false,
    );
  });

  it("treats an absent links key and an empty link list as the same thing", () => {
    // A protocol with no supersets resolves to `rehab.<id>: []`, which the
    // program never stored. Counting that as a change would rewrite the plan on
    // every single save.
    expect(
      resolutionChangesProgram(
        v3(),
        { "rehab.protocol-1": [] },
        { "protocol-1": "lib-1" },
        [lib({ links: [] })],
      ),
    ).toBe(false);
  });
});
