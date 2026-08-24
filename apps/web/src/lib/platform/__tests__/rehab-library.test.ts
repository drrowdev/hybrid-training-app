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
import type { RehabSchedule } from "../rehab-schedule";

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

/** A program whose rehab lives in its customization. */
const src = (customization: TbCustomization) => ({ customization });

/** A weekly block whose rehab lives in the envelope. */
const envelope = (over: Record<string, unknown> = {}) =>
  ({
    version: 1,
    localProtocolId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    name: "Elbow",
    items: [item("Wrist Curl")],
    series: ["slot-1"],
    days: [],
    ...over,
  }) as unknown as RehabSchedule;

describe("resolveRehabLibrary — no binding means no change", () => {
  it("returns the customization untouched when nothing is bound", () => {
    const customization = v3();
    const resolved = resolveRehabLibrary(src(customization), {}, {}, []);
    // Identity, not just equality: unbound programs must take the cheap path.
    expect(resolved.customization).toBe(customization);
    expect(resolved.missing).toEqual([]);
  });

  it("leaves a protocol alone when its library row is missing", () => {
    const customization = v3();
    const resolved = resolveRehabLibrary(
      src(customization),
      {},
      { "protocol-1": "lib-gone" },
      [],
    );
    expect(rehabFingerprint(resolved)[0]!.items[0]!.movementName).toBe(
      "Wrist Curl",
    );
    expect(resolved.missing).toEqual(["protocol-1"]);
  });
});

describe("resolveRehabLibrary — V3", () => {
  it("substitutes items and name for the bound protocol only", () => {
    const resolved = resolveRehabLibrary(src(v3()),
      {},
      { "protocol-1": "lib-1" },
      [lib({ name: "Golfer's Elbow", items: [item("Reverse Wrist Curl", { reps: 20 })] })],
    );
    const fingerprint = rehabFingerprint(resolved);
    expect(fingerprint[0]).toMatchObject({ id: "protocol-1", name: "Golfer's Elbow" });
    expect(fingerprint[0]!.items[0]!.movementName).toBe("Reverse Wrist Curl");
    expect(fingerprint[0]!.items[0]!.reps).toBe(20);
    // The unbound sibling is untouched.
    expect(fingerprint[1]).toMatchObject({ id: "protocol-2", name: "Groin" });
    expect(fingerprint[1]!.items[0]!.movementName).toBe("Copenhagen");
  });

  it("keeps the local id so links, assignments and source refs still resolve", () => {
    const resolved = resolveRehabLibrary(src(v3()), {}, { "protocol-1": "lib-1" }, [lib()]);
    expect(localProtocolIds(resolved)).toEqual([
      "protocol-1",
      "protocol-2",
    ]);
  });

  it("replaces the program's links for a bound protocol", () => {
    const resolved = resolveRehabLibrary(src(v3()),
      { "rehab.protocol-1": [{ id: "old", name: "Old", members: ["a", "b"] }] },
      { "protocol-1": "lib-1" },
      [lib({ links: [{ id: "new", name: "New", members: ["c", "d"] }] })],
    );
    expect(resolved.linksBySeries["rehab.protocol-1"]).toEqual([
      { id: "new", name: "New", members: ["c", "d"] },
    ]);
  });

  it("removes the series key when the user deletes the superset in Settings", () => {
    const resolved = resolveRehabLibrary(src(v3()),
      { "rehab.protocol-1": [{ id: "old", name: "Old", members: ["a", "b"] }] },
      { "protocol-1": "lib-1" },
      [lib({ links: [] })],
    );
    // Not `[]` — `sessionLinksSchema` requires at least one link per series, so
    // the absent key is the only valid "no links" value.
    expect("rehab.protocol-1" in resolved.linksBySeries).toBe(false);
  });

  it("leaves an unrelated series key alone", () => {
    const resolved = resolveRehabLibrary(src(v3()),
      { "strength.day-1": [{ id: "s", name: "S", members: ["x", "y"] }] },
      { "protocol-1": "lib-1" },
      [lib()],
    );
    expect(resolved.linksBySeries["strength.day-1"]).toHaveLength(1);
  });

  it("does not mutate its inputs", () => {
    const customization = v3();
    const links = { "rehab.protocol-1": [] };
    const snapshot = JSON.stringify({ customization, links });
    resolveRehabLibrary(src(customization), links, { "protocol-1": "lib-1" }, [lib()]);
    expect(JSON.stringify({ customization, links })).toBe(snapshot);
  });
});

describe("resolveRehabLibrary — legacy V1 / V2", () => {
  it("binds the synthetic protocol-1 to the unnamed item list", () => {
    expect(localProtocolIds(src(v1()))).toEqual(["protocol-1"]);
    const resolved = resolveRehabLibrary(src(v1()),
      {},
      { "protocol-1": "lib-1" },
      [lib({ items: [item("Heel Raise", { sets: 4 })] })],
    );
    expect(rehabFingerprint(resolved)[0]!.items).toEqual([
      item("Heel Raise", { sets: 4 }),
    ]);
  });

  it("reports no protocol ids when a legacy blob has no rehab", () => {
    const bare = { version: 1, displayName: "x", dayTypes: [], sessionMovements: {} };
    expect(localProtocolIds(src(bare as unknown as TbCustomization))).toEqual([]);
  });
});

describe("resolveRehabLibrary — weekly envelope", () => {
  const bindings = { "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa": "lib-1" };

  it("substitutes the library's name and items, keeping placement", () => {
    const resolved = resolveRehabLibrary({ rehabSchedule: envelope() }, {}, bindings, [
      lib({ name: "Golfer's Elbow", items: [item("Reverse Wrist Curl")] }),
    ]);
    expect(resolved.rehabSchedule?.name).toBe("Golfer's Elbow");
    expect(resolved.rehabSchedule?.items[0]!.movementName).toBe("Reverse Wrist Curl");
    // Placement belongs to the PROGRAM — Settings must never move rehab days.
    expect(resolved.rehabSchedule?.series).toEqual(["slot-1"]);
  });

  it("resolves with no customization at all", () => {
    // A canonical template can carry rehab: the envelope is independent of the
    // customize opt-in, so sync must not require one.
    const resolved = resolveRehabLibrary({ rehabSchedule: envelope() }, {}, bindings, [
      lib({ name: "Renamed" }),
    ]);
    expect(resolved.customization).toBeUndefined();
    expect(resolved.rehabSchedule?.name).toBe("Renamed");
  });

  it("addresses links by the envelope's own local id", () => {
    const resolved = resolveRehabLibrary(
      { rehabSchedule: envelope() },
      {},
      bindings,
      [lib({ links: [{ id: "l", name: "L", members: ["a", "b"] }] })],
    );
    expect(
      resolved.linksBySeries["rehab.aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"],
    ).toHaveLength(1);
  });

  it("reports a bound protocol whose library row is gone", () => {
    const resolved = resolveRehabLibrary({ rehabSchedule: envelope() }, {}, bindings, []);
    expect(resolved.missing).toEqual(["aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"]);
    expect(resolved.rehabSchedule?.name).toBe("Elbow");
  });

  it("sees a rename as a change so it reaches the plan", () => {
    expect(
      resolutionChangesProgram({ rehabSchedule: envelope() }, {}, bindings, [
        lib({ name: "Renamed" }),
      ]),
    ).toBe(true);
    expect(
      resolutionChangesProgram({ rehabSchedule: envelope() }, {}, bindings, [lib()]),
    ).toBe(false);
  });
});

describe("resolutionChangesProgram", () => {
  it("is false when the library matches what the program already has", () => {
    expect(
      resolutionChangesProgram(src(v3()), {}, { "protocol-1": "lib-1" }, [lib()]),
    ).toBe(false);
  });

  it("is true when the movements changed", () => {
    expect(
      resolutionChangesProgram(src(v3()), {}, { "protocol-1": "lib-1" }, [
        lib({ items: [item("Wrist Curl", { reps: 20 })] }),
      ]),
    ).toBe(true);
  });

  it("is true for a RENAME with identical movements", () => {
    // rehabItemsForComparison() strips rehabProtocolName, so the prescription
    // comparison cannot see a rename. If this returned false a rename would
    // never reach the plan.
    expect(
      resolutionChangesProgram(src(v3()), {}, { "protocol-1": "lib-1" }, [
        lib({ name: "Renamed" }),
      ]),
    ).toBe(true);
  });

  it("is true when only the links changed", () => {
    expect(
      resolutionChangesProgram(src(v3()), {}, { "protocol-1": "lib-1" }, [
        lib({ links: [{ id: "l", name: "L", members: ["a", "b"] }] }),
      ]),
    ).toBe(true);
  });

  it("is false for a program with no bindings at all", () => {
    expect(resolutionChangesProgram(src(v3()), {}, {}, [lib({ name: "Whatever" })])).toBe(
      false,
    );
  });

  it("treats an absent links key and an empty link list as the same thing", () => {
    // A protocol with no supersets resolves to an absent key, which is also
    // what a program with no supersets stored. Counting that as a change would
    // rewrite the plan on every single save.
    expect(
      resolutionChangesProgram(src(v3()), {}, { "protocol-1": "lib-1" }, [lib({ links: [] })]),
    ).toBe(false);
  });
});
