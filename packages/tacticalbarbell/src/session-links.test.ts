/**
 * Engine-side contracts for user-authored session links (supersets / tri-sets).
 *
 * Step one only ingests the links into the instance — `prescribe()` does not
 * emit circuit metadata for them yet. What matters here is that a malformed or
 * unsafe link can never reach `prescribe()` in the first place, because
 * `setup()` receives an untyped values blob straight off the wire.
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext } from "@hta/program-core";
import { tacticalBarbellEngine as tb, type TbInstance } from "./program";

const ctx: PlatformContext = {
  oneRepMaxes: {
    squat: 200,
    bench: 100,
    deadlift: 250,
    press: 100,
    "overhead-press": 100,
    pullup: 50,
    "weighted-pullup": 50,
    "barbell-row": 120,
    "rack-pull": 250,
  },
  roundingKg: 2.5,
};

function setup(values: Record<string, unknown> = {}): TbInstance {
  return tb.setup({ values }, ctx);
}

const link = (over: Record<string, unknown> = {}) => ({
  id: "link-1",
  name: "Superset",
  members: ["barbell-curl", "triceps-pushdown"],
  ...over,
});

describe("TB setup — customSessionLinks ingestion", () => {
  it("is absent by default, so an un-linked instance stays byte-identical", () => {
    expect(setup().customSessionLinks).toBeUndefined();
  });

  it("ingests a well-formed link keyed by session series", () => {
    const inst = setup({ customSessionLinks: { "slot-1": [link()] } });
    expect(inst.customSessionLinks).toEqual({ "slot-1": [link()] });
  });

  it("ingests an Activation phase-keyed link", () => {
    const inst = setup({
      templateId: "activation",
      customSessionLinks: { "activation.armor.armor-a1": [link()] },
    });
    expect(Object.keys(inst.customSessionLinks ?? {})).toEqual([
      "activation.armor.armor-a1",
    ]);
  });

  it("drops milestone-keyed links — the key collapses repeated test weeks", () => {
    const inst = setup({
      templateId: "activation",
      customSessionLinks: {
        "activation.milestone.operator-test": [link()],
      },
    });
    expect(inst.customSessionLinks).toBeUndefined();
  });

  it("drops a link with fewer than two distinct members", () => {
    expect(
      setup({ customSessionLinks: { "slot-1": [link({ members: ["a"] })] } })
        .customSessionLinks,
    ).toBeUndefined();
    expect(
      setup({
        customSessionLinks: { "slot-1": [link({ members: ["a", "a"] })] },
      }).customSessionLinks,
    ).toBeUndefined();
  });

  it("drops links missing an id or a name", () => {
    expect(
      setup({ customSessionLinks: { "slot-1": [link({ id: "" })] } })
        .customSessionLinks,
    ).toBeUndefined();
    expect(
      setup({ customSessionLinks: { "slot-1": [link({ name: "" })] } })
        .customSessionLinks,
    ).toBeUndefined();
  });

  it("keeps only the FIRST link claiming a movement — circuit is singular", () => {
    const inst = setup({
      customSessionLinks: {
        "slot-1": [
          link({ id: "link-1", members: ["curl", "pushdown"] }),
          link({ id: "link-2", members: ["curl", "calf-raise"] }),
        ],
      },
    });
    expect(inst.customSessionLinks?.["slot-1"]).toHaveLength(1);
    expect(inst.customSessionLinks?.["slot-1"]?.[0]?.id).toBe("link-1");
  });

  it("drops a duplicate link id within one session", () => {
    const inst = setup({
      customSessionLinks: {
        "slot-1": [
          link({ id: "link-1", members: ["a", "b"] }),
          link({ id: "link-1", members: ["c", "d"] }),
        ],
      },
    });
    expect(inst.customSessionLinks?.["slot-1"]).toHaveLength(1);
  });

  it("survives junk without throwing", () => {
    expect(setup({ customSessionLinks: "nope" }).customSessionLinks).toBeUndefined();
    expect(setup({ customSessionLinks: 42 }).customSessionLinks).toBeUndefined();
    expect(
      setup({ customSessionLinks: { "slot-1": "nope" } }).customSessionLinks,
    ).toBeUndefined();
    expect(
      setup({ customSessionLinks: { "slot-1": [null, 3, "x"] } })
        .customSessionLinks,
    ).toBeUndefined();
  });
});

describe("Activation Armor supplemental — canonical slot identity", () => {
  // The Armor supplemental choice substitutes the movement in place. The
  // canonical slot identity must survive the swap, because peak detection, the
  // AB Triad classifier and (from step three) user links all resolve members via
  // `sourceMovement ?? movement`. Before the fix, `resolvedDefault` was built
  // without `sourceMovement`, so a link authored against `back-extension` could
  // never match the emitted `reverse-hyper`.
  const armorRef = "b1-w6-armor-a1";

  function movementIds(instance: TbInstance): string[] {
    return tb
      .prescribe(instance, armorRef, ctx)
      .items.map((item) => item.movementId ?? "");
  }

  it("prescribes the default back-extension when unchanged", () => {
    const ids = movementIds(setup({ templateId: "activation" }));
    expect(ids).toContain("back-extension");
    expect(ids).not.toContain("reverse-hyper");
  });

  it("substitutes reverse-hyper when chosen, keeping the rest of the session", () => {
    const base = setup({ templateId: "activation" });
    const swapped = setup({
      templateId: "activation",
      armorSupplementalA: "reverse-hyper",
    });
    const ids = movementIds(swapped);
    expect(ids).toContain("reverse-hyper");
    expect(ids).not.toContain("back-extension");
    // Only the supplemental slot changes — same item count, same other lifts.
    expect(ids).toHaveLength(movementIds(base).length);
    expect(ids.filter((id) => id !== "reverse-hyper")).toEqual(
      movementIds(base).filter((id) => id !== "back-extension"),
    );
  });
});
