/**
 * `slotBadge` rendering invariant for the plan calendar views.
 *
 * Calendar items only carry an AM/PM `slotBadge` when the date has
 * ≥2 planned sessions. A lone AM session (e.g. its PM partner is
 * skipped or doesn't exist because the block was created in
 * single-session mode) renders without a badge so the views read as
 * a normal single-day session.
 *
 * See feat/slot-semantics for the broader fix.
 */
import { describe, it, expect } from "vitest";
import { buildCalendarItems, type RawPlannedRow } from "../calendar-data";

const TODAY = "2026-05-23";

function planned(over: Partial<RawPlannedRow> = {}): RawPlannedRow {
  return {
    id: "p1",
    date: "2026-05-25",
    title: "Squat day",
    isCardio: false,
    completedSessionId: null,
    skippedAt: null,
    slot: "single",
    ...over,
  };
}

describe("buildCalendarItems — slotBadge", () => {
  it("does NOT attach slotBadge to a lone AM/PM session", () => {
    const items = buildCalendarItems({
      today: TODAY,
      planned: [planned({ id: "p1", date: "2026-05-25", slot: "pm", title: "Easy Z2" })],
      sessions: [],
      events: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.slotBadge).toBeUndefined();
  });

  it("does NOT attach slotBadge when slot is 'single' even on a paired day", () => {
    const items = buildCalendarItems({
      today: TODAY,
      planned: [
        planned({ id: "p1", date: "2026-05-25", slot: "single", title: "Squat" }),
        planned({ id: "p2", date: "2026-05-25", slot: "single", title: "Bench" }),
      ],
      sessions: [],
      events: [],
    });
    for (const it of items) {
      expect(it.slotBadge).toBeUndefined();
    }
  });

  it("attaches slotBadge to BOTH sessions on a genuine two-a-day", () => {
    const items = buildCalendarItems({
      today: TODAY,
      planned: [
        planned({ id: "p1", date: "2026-05-25", slot: "am", title: "Squat" }),
        planned({
          id: "p2",
          date: "2026-05-25",
          slot: "pm",
          isCardio: true,
          cardioModality: "bike",
          title: "Easy Z2",
        }),
      ],
      sessions: [],
      events: [],
    });
    const am = items.find((i) => i.sessionId === "p1");
    const pm = items.find((i) => i.sessionId === "p2");
    expect(am?.slotBadge).toBe("am");
    expect(pm?.slotBadge).toBe("pm");
  });

  it("keeps slotBadge on the survivor when its partner is skipped (two-a-day intent survives)", () => {
    // The skipped row is dropped from the rendered list but still
    // counted for pairing — a session keeps its slot context even
    // when its partner is missing.
    const items = buildCalendarItems({
      today: TODAY,
      planned: [
        planned({ id: "p1", date: "2026-05-25", slot: "am", title: "Squat" }),
        planned({
          id: "p2",
          date: "2026-05-25",
          slot: "pm",
          isCardio: true,
          title: "Easy Z2",
          skippedAt: "2026-05-24T18:00:00Z",
        }),
      ],
      sessions: [],
      events: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.sessionId).toBe("p1");
    expect(items[0]!.slotBadge).toBe("am");
  });
});
