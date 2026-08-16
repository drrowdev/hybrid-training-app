/**
 * Step-one contract tests for user-authored session links.
 *
 * These cover the schema itself plus the two integrity properties the rest of
 * the feature leans on:
 *   - a movement belongs to at most ONE link (`PrescriptionItem.circuit` is
 *     singular, so overlap is unrepresentable downstream), and
 *   - milestone/test series keys are refused (the unqualified
 *     `activation.milestone.<id>` key collapses repeats of the same test session
 *     across weeks, so a link stored against it would apply to the wrong week).
 */
import { describe, expect, it } from "vitest";
import {
  MILESTONE_SERIES_PREFIX,
  RESERVED_LINK_IDS,
  SESSION_LINKS_VERSION,
  defaultLinkName,
  emptySessionLinks,
  isEmptySessionLinks,
  linksBySeries,
  normalizeSessionLinks,
  parseStoredSessionLinks,
  sessionLinksSchema,
} from "../session-links";

const link = (over: Record<string, unknown> = {}) => ({
  id: "link-1",
  name: "Superset",
  members: ["barbell-curl", "triceps-pushdown"],
  ...over,
});

const envelope = (bySeries: Record<string, unknown[]>) => ({
  version: SESSION_LINKS_VERSION,
  bySeries,
});

describe("sessionLinksSchema", () => {
  it("accepts a two-member link on a weekly slot key", () => {
    const parsed = sessionLinksSchema.safeParse(
      envelope({ "slot-1": [link()] }),
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts an Activation phase key", () => {
    const parsed = sessionLinksSchema.safeParse(
      envelope({ "activation.operator.op-a": [link()] }),
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts a giant set of up to eight members", () => {
    const members = Array.from({ length: 8 }, (_, i) => `movement-${i}`);
    const parsed = sessionLinksSchema.safeParse(
      envelope({ "slot-1": [link({ members, name: "Giant set" })] }),
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects a nine-member link", () => {
    const members = Array.from({ length: 9 }, (_, i) => `movement-${i}`);
    const parsed = sessionLinksSchema.safeParse(
      envelope({ "slot-1": [link({ members })] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects a one-member link — a superset needs two lifts", () => {
    const parsed = sessionLinksSchema.safeParse(
      envelope({ "slot-1": [link({ members: ["barbell-curl"] })] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects the same movement twice inside one link", () => {
    const parsed = sessionLinksSchema.safeParse(
      envelope({
        "slot-1": [link({ members: ["barbell-curl", "barbell-curl"] })],
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects a movement claimed by two links in the same session", () => {
    const parsed = sessionLinksSchema.safeParse(
      envelope({
        "slot-1": [
          link({ id: "link-1", members: ["curl", "pushdown"] }),
          link({ id: "link-2", members: ["curl", "calf-raise"] }),
        ],
      }),
    );
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]?.message).toMatch(
      /already in another link/,
    );
  });

  it("allows the same movement in links belonging to DIFFERENT sessions", () => {
    const parsed = sessionLinksSchema.safeParse(
      envelope({
        "slot-1": [link({ members: ["curl", "pushdown"] })],
        "slot-2": [link({ members: ["curl", "calf-raise"] })],
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects duplicate link ids within one session", () => {
    const parsed = sessionLinksSchema.safeParse(
      envelope({
        "slot-1": [
          link({ id: "link-1", members: ["a", "b"] }),
          link({ id: "link-1", members: ["c", "d"] }),
        ],
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it.each(RESERVED_LINK_IDS)(
    "rejects the reserved built-in circuit id %s",
    (reserved) => {
      const parsed = sessionLinksSchema.safeParse(
        envelope({ "slot-1": [link({ id: reserved })] }),
      );
      expect(parsed.success).toBe(false);
    },
  );

  it("rejects a milestone series key", () => {
    const parsed = sessionLinksSchema.safeParse(
      envelope({ [`${MILESTONE_SERIES_PREFIX}operator-test`]: [link()] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty link name — the logger drops nameless circuits", () => {
    const parsed = sessionLinksSchema.safeParse(
      envelope({ "slot-1": [link({ name: "   " })] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown keys on a link (strict)", () => {
    const parsed = sessionLinksSchema.safeParse(
      envelope({ "slot-1": [link({ rounds: 3 })] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects a mismatched envelope version", () => {
    const parsed = sessionLinksSchema.safeParse({
      version: 99,
      bySeries: { "slot-1": [link()] },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("helpers", () => {
  it("names groups by size", () => {
    expect(defaultLinkName(2)).toBe("Superset");
    expect(defaultLinkName(3)).toBe("Tri-set");
    expect(defaultLinkName(4)).toBe("Giant set");
  });

  it("treats an envelope with no links as empty", () => {
    expect(isEmptySessionLinks(emptySessionLinks())).toBe(true);
    expect(isEmptySessionLinks(undefined)).toBe(true);
    expect(
      isEmptySessionLinks({
        version: SESSION_LINKS_VERSION,
        bySeries: { "slot-1": [link()] },
      }),
    ).toBe(false);
  });

  it("normalize drops empty series and collapses to undefined", () => {
    expect(
      normalizeSessionLinks({
        version: SESSION_LINKS_VERSION,
        bySeries: { "slot-1": [], "slot-2": [] },
      }),
    ).toBeUndefined();
    const kept = normalizeSessionLinks({
      version: SESSION_LINKS_VERSION,
      bySeries: { "slot-1": [], "slot-2": [link()] },
    });
    expect(kept && Object.keys(kept.bySeries)).toEqual(["slot-2"]);
  });

  it("linksBySeries flattens to the engine-facing map", () => {
    expect(linksBySeries(undefined)).toEqual({});
    expect(
      linksBySeries({
        version: SESSION_LINKS_VERSION,
        bySeries: { "slot-1": [link()] },
      }),
    ).toEqual({ "slot-1": [link()] });
  });
});

describe("parseStoredSessionLinks", () => {
  it("round-trips a valid stored blob", () => {
    const stored = envelope({ "slot-1": [link()] });
    expect(parseStoredSessionLinks(stored)).toEqual(stored);
  });

  it("degrades a malformed blob to undefined rather than throwing", () => {
    expect(parseStoredSessionLinks(undefined)).toBeUndefined();
    expect(parseStoredSessionLinks(null)).toBeUndefined();
    expect(parseStoredSessionLinks("nope")).toBeUndefined();
    expect(parseStoredSessionLinks({ version: 1 })).toBeUndefined();
    expect(
      parseStoredSessionLinks(envelope({ "slot-1": [link({ members: [] })] })),
    ).toBeUndefined();
  });
});
