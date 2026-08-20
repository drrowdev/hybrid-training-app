/**
 * Local protocol ids are load-bearing: supersets, day assignments and the
 * tombstones that remember "I deleted this day's rehab" are all keyed off them.
 * Getting this wrong doesn't fail loudly — it silently attaches one protocol's
 * history to another.
 */
import { describe, it, expect } from "vitest";
import {
  attachProtocols,
  bindingsByLibraryId,
  localProtocolIdFor,
  matchProtocolsToLibrary,
  pruneAssignments,
  pruneRehabLinks,
} from "../attachment";

const LIB_A = "aaaaaaaa-1111-4111-8111-111111111111";
const LIB_B = "bbbbbbbb-2222-4222-8222-222222222222";

const protocol = (libraryId: string, name: string) => ({
  libraryId,
  name,
  items: [{ movementId: "m", movementName: name, sets: 3, reps: 10 }],
});

describe("bindingsByLibraryId", () => {
  it("inverts the stored localId → libraryId map", () => {
    expect(bindingsByLibraryId({ "protocol-1": LIB_A, "protocol-2": LIB_B })).toEqual({
      [LIB_A]: "protocol-1",
      [LIB_B]: "protocol-2",
    });
  });

  it("is deterministic if one library protocol somehow occupies two slots", () => {
    expect(
      bindingsByLibraryId({ "protocol-1": LIB_A, "protocol-2": LIB_A })[LIB_A],
    ).toBe("protocol-1");
  });
});

describe("localProtocolIdFor", () => {
  it("keeps the id a program already uses", () => {
    // The decisive case: an existing program must not shift its ids the first
    // time it is edited after the library lands, or its links, day assignments
    // and deleted-rehab tombstones all stop matching.
    expect(localProtocolIdFor(LIB_A, { [LIB_A]: "protocol-1" })).toBe("protocol-1");
  });

  it("gives a new attachment the library id", () => {
    expect(localProtocolIdFor(LIB_B, { [LIB_A]: "protocol-1" })).toBe(LIB_B);
  });

  it("is a legal customization protocol id", () => {
    // `^[a-z0-9][a-z0-9-]{0,63}$` — the wizard's existing schema.
    expect(localProtocolIdFor(LIB_B, {})).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
  });

  it("never reuses an ordinal for a different protocol", () => {
    // The old scheme handed out `protocol-1` by position, so swapping which
    // protocol sits first silently inherited the previous one's supersets and
    // tombstones.
    const existing = { [LIB_A]: "protocol-1" };
    expect(localProtocolIdFor(LIB_B, existing)).not.toBe("protocol-1");
  });
});

describe("attachProtocols", () => {
  it("preserves existing ids and mints ids for newcomers", () => {
    const attached = attachProtocols(
      [protocol(LIB_A, "Elbow"), protocol(LIB_B, "Groin")],
      { [LIB_A]: "protocol-1" },
    );
    expect(attached).toEqual([
      expect.objectContaining({ localId: "protocol-1", libraryId: LIB_A, name: "Elbow" }),
      expect.objectContaining({ localId: LIB_B, libraryId: LIB_B, name: "Groin" }),
    ]);
  });

  it("keeps ids stable when the same protocols are re-selected", () => {
    const first = attachProtocols([protocol(LIB_A, "Elbow")], {});
    const bindings = { [LIB_A]: first[0]!.localId };
    const second = attachProtocols([protocol(LIB_A, "Elbow")], bindings);
    expect(second[0]!.localId).toBe(first[0]!.localId);
  });
});

describe("pruneAssignments", () => {
  it("drops a day pointing at a detached protocol", () => {
    // The customization cross-validates that every assignment names an existing
    // protocol, so a leftover makes the entire deploy invalid.
    const attached = attachProtocols([protocol(LIB_A, "Elbow")], {
      [LIB_A]: "protocol-1",
    });
    expect(
      pruneAssignments(
        [
          { day: 1, protocolId: "protocol-1" },
          { day: 4, protocolId: "protocol-2" },
        ],
        attached,
      ),
    ).toEqual([{ day: 1, protocolId: "protocol-1" }]);
  });

  it("keeps every assignment when nothing was detached", () => {
    const attached = attachProtocols([protocol(LIB_A, "Elbow")], {
      [LIB_A]: "protocol-1",
    });
    const assignments = [{ day: 2, protocolId: "protocol-1" }];
    expect(pruneAssignments(assignments, attached)).toEqual(assignments);
  });
});

describe("pruneRehabLinks", () => {
  const attached = attachProtocols([protocol(LIB_A, "Elbow")], {
    [LIB_A]: "protocol-1",
  });

  it("drops rehab links for a detached protocol", () => {
    expect(
      pruneRehabLinks(
        { "rehab.protocol-1": ["keep"], "rehab.protocol-2": ["drop"] },
        attached,
      ),
    ).toEqual({ "rehab.protocol-1": ["keep"] });
  });

  it("never touches a strength series", () => {
    expect(
      pruneRehabLinks({ "day-1": ["keep"], "rehab.protocol-9": ["drop"] }, attached),
    ).toEqual({ "day-1": ["keep"] });
  });
});

describe("matchProtocolsToLibrary", () => {
  const items = [{ movementId: "m1", sets: 3, reps: 10 }];
  const other = [{ movementId: "m2", sets: 4, reps: 8 }];

  it("matches a program's protocol to an identical library row", () => {
    // The case that matters: a program carrying rehab with NO binding row.
    // Without a match the wizard mints a new local id, which orphans that
    // program's day assignments and silently empties every rehab day.
    expect(
      matchProtocolsToLibrary(
        [{ id: "protocol-1", name: "Elbow", items }],
        [{ id: LIB_A, name: "Elbow", items }],
      ),
    ).toEqual({ "protocol-1": LIB_A });
  });

  it("falls back to an unambiguous name when the items have drifted", () => {
    expect(
      matchProtocolsToLibrary(
        [{ id: "protocol-1", name: "Elbow", items }],
        [{ id: LIB_A, name: "Elbow", items: other }],
      ),
    ).toEqual({ "protocol-1": LIB_A });
  });

  it("prefers the exact content match when a name is duplicated", () => {
    expect(
      matchProtocolsToLibrary(
        [{ id: "protocol-1", name: "Elbow", items }],
        [
          { id: LIB_A, name: "Elbow", items: other },
          { id: LIB_B, name: "Elbow", items },
        ],
      ),
    ).toEqual({ "protocol-1": LIB_B });
  });

  it("leaves an ambiguous name unmatched rather than guessing", () => {
    // A wrong match attaches the wrong movements to a live plan.
    expect(
      matchProtocolsToLibrary(
        [{ id: "protocol-1", name: "Elbow", items }],
        [
          { id: LIB_A, name: "Elbow", items: other },
          { id: LIB_B, name: "Elbow", items: other },
        ],
      ),
    ).toEqual({});
  });

  it("ignores case and surrounding space in the name", () => {
    expect(
      matchProtocolsToLibrary(
        [{ id: "protocol-1", name: "  golfer's ELBOW  ", items }],
        [{ id: LIB_A, name: "Golfer's elbow", items }],
      ),
    ).toEqual({ "protocol-1": LIB_A });
  });

  it("matches nothing when the library is empty", () => {
    expect(matchProtocolsToLibrary([{ id: "protocol-1", name: "Elbow", items }], [])).toEqual(
      {},
    );
  });
});
