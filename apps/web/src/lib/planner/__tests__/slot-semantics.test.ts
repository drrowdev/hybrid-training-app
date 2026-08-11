/**
 * Slot-semantics tests for feat/slot-semantics.
 *
 * Invariant: when a user has `allows_two_a_days = false`, no planned
 * session row may carry `slot: "am" | "pm"`. The plan view also relies
 * on this invariant — AM/PM badges are only meaningful when a calendar
 * day actually pairs two sessions.
 *
 * The fix is layered:
 *  1. Curated archetype `days` arrays carry no AM/PM slot tags.
 *  2. `sanitiseSlotForMode` coerces anything else to "single" at
 *     createBlock-time as belt-and-suspenders against future drift.
 *  3. The rendering code (plan/page.tsx + plan/history) only paints
 *     AM/PM badges when the day actually pairs two sessions.
 *
 * This file covers (1) and (2). The end-to-end render gate lives in
 * `apps/web/e2e/no-am-pm-on-single-mode.spec.ts`.
 */
import { describe, it, expect } from "vitest";
import { hasTwoADaySlotPair, sanitiseSlotForMode } from "../slot";
import {
  ARCHETYPES,
  type Archetype,
} from "../archetypes";

describe("sanitiseSlotForMode", () => {
  it("returns 'single' for every input when allowsTwoADays = false", () => {
    expect(sanitiseSlotForMode("single", false)).toBe("single");
    expect(sanitiseSlotForMode("am", false)).toBe("single");
    expect(sanitiseSlotForMode("pm", false)).toBe("single");
    expect(sanitiseSlotForMode(null, false)).toBe("single");
    expect(sanitiseSlotForMode(undefined, false)).toBe("single");
  });

  it("preserves the slot value when allowsTwoADays = true", () => {
    expect(sanitiseSlotForMode("single", true)).toBe("single");
    expect(sanitiseSlotForMode("am", true)).toBe("am");
    expect(sanitiseSlotForMode("pm", true)).toBe("pm");
  });

  it("defaults missing slot to 'single' when allowsTwoADays = true", () => {
    expect(sanitiseSlotForMode(null, true)).toBe("single");
    expect(sanitiseSlotForMode(undefined, true)).toBe("single");
  });
});

describe("hasTwoADaySlotPair", () => {
  it("recognises a genuine AM + PM pair", () => {
    expect(hasTwoADaySlotPair(["pm", "am"])).toBe(true);
  });

  it("does not expose a storage-only PM slot beside a single session", () => {
    expect(hasTwoADaySlotPair(["single", "pm"])).toBe(false);
  });

  it("does not treat an isolated AM or PM session as a two-a-day", () => {
    expect(hasTwoADaySlotPair(["am"])).toBe(false);
    expect(hasTwoADaySlotPair(["pm"])).toBe(false);
  });
});

describe("Archetype data: single-day arrays carry no AM/PM slot tags", () => {
  // The single-day `days` array is the one used when
  // `allowsTwoADays === false`. Any AM/PM tag in here would leak slot
  // badges onto isolated calendar days (the bug feat/slot-semantics
  // was opened to fix).
  const entries = Object.entries(ARCHETYPES) as Array<[string, Archetype]>;

  it.each(entries)(
    "%s: every day in `days` has slot 'single' or no slot at all",
    (_name, archetype) => {
      for (const d of archetype.days) {
        // Either no slot field, or explicitly "single".
        if ("slot" in d && d.slot != null) {
          expect(d.slot).toBe("single");
        }
      }
    },
  );

  it.each(entries)(
    "%s: no day title in `days` carries an (AM) or (PM) parenthetical",
    (_name, archetype) => {
      for (const d of archetype.days) {
        expect(d.title).not.toMatch(/\((?:AM|PM)\)/);
      }
    },
  );

  it.each(entries)(
    "%s: no day title in `twoADayDays` carries an (AM) or (PM) parenthetical (UI is the single source of truth)",
    (_name, archetype) => {
      for (const d of archetype.twoADayDays ?? []) {
        expect(d.title).not.toMatch(/\((?:AM|PM)\)/);
      }
    },
  );
});
