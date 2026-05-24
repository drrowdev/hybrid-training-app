/**
 * Pure-builder tests for `buildCalendarItems` + `filterCalendarItems`.
 *
 * The Supabase fetcher is a mechanical pass-through (covered by the
 * e2e seed); the interesting logic — planned vs logged classification,
 * past-unfulfilled detection, and the strength/cardio filter — lives
 * here.
 */
import { describe, it, expect } from "vitest";
import {
  buildCalendarItems,
  filterCalendarItems,
  type RawPlannedRow,
  type RawSessionRow,
} from "../calendar-data";

const TODAY = "2026-05-23";

function planned(over: Partial<RawPlannedRow> = {}): RawPlannedRow {
  return {
    id: "p1",
    date: "2026-05-25",
    title: "Squat day",
    isCardio: false,
    completedSessionId: null,
    skippedAt: null,
    ...over,
  };
}

function session(over: Partial<RawSessionRow> = {}): RawSessionRow {
  return {
    id: "s1",
    performedYmd: TODAY,
    title: "Lift",
    isCardio: false,
    isStrength: true,
    durationMin: 45,
    ...over,
  };
}

describe("buildCalendarItems", () => {
  it("classifies a future planned row as planned_strength / planned_cardio", () => {
    const items = buildCalendarItems({
      today: TODAY,
      planned: [
        planned({ id: "p1", date: "2026-05-25", isCardio: false }),
        planned({ id: "p2", date: "2026-05-26", isCardio: true, cardioModality: "run", title: "Z2 run" }),
      ],
      sessions: [],
      events: [],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "planned_strength", sessionId: "p1" });
    expect(items[1]).toMatchObject({ kind: "planned_cardio", modality: "run" });
  });

  it("detects past-unfulfilled: planned in the past with no completion and no skip", () => {
    const items = buildCalendarItems({
      today: TODAY,
      planned: [
        planned({ id: "p1", date: "2026-05-20", completedSessionId: null, skippedAt: null }),
      ],
      sessions: [],
      events: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("past_unfulfilled");
    expect(items[0].href).toContain("match=p1");
  });

  it("drops skipped planned rows from the surface", () => {
    const items = buildCalendarItems({
      today: TODAY,
      planned: [planned({ id: "p1", date: "2026-05-20", skippedAt: "2026-05-20T10:00:00Z" })],
      sessions: [],
      events: [],
    });
    expect(items).toHaveLength(0);
  });

  it("drops the planned row when a logged session is linked (the logged session represents the day)", () => {
    const items = buildCalendarItems({
      today: TODAY,
      planned: [planned({ id: "p1", date: "2026-05-21", completedSessionId: "s1" })],
      sessions: [session({ id: "s1", performedYmd: "2026-05-21" })],
      events: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("logged_strength");
  });

  it("renders a hybrid session as two chips (logged_strength + logged_cardio)", () => {
    const items = buildCalendarItems({
      today: TODAY,
      planned: [],
      sessions: [
        session({ id: "s1", performedYmd: TODAY, isCardio: true, isStrength: true, modality: "bike" }),
      ],
      events: [],
    });
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("logged_strength");
    expect(items[1].kind).toBe("logged_cardio");
    expect(items[1].modality).toBe("bike");
  });

  it("includes priority events with priority labels", () => {
    const items = buildCalendarItems({
      today: TODAY,
      planned: [],
      sessions: [],
      events: [
        { id: "e1", date: "2026-06-15", name: "Spring 10k", priority: "A", modality: "run" },
      ],
    });
    expect(items[0]).toMatchObject({ kind: "event", priority: "A", title: "Spring 10k" });
  });

  it("sorts items by date ascending, events first on tied days", () => {
    const items = buildCalendarItems({
      today: TODAY,
      planned: [planned({ id: "p1", date: "2026-06-01" })],
      sessions: [],
      events: [
        { id: "e1", date: "2026-06-01", name: "Test", priority: "B", modality: null },
      ],
    });
    expect(items.map((i) => i.kind)).toEqual(["event", "planned_strength"]);
  });
});

describe("filterCalendarItems", () => {
  const all = buildCalendarItems({
    today: TODAY,
    planned: [
      planned({ id: "p1", date: "2026-05-25", isCardio: false }),
      planned({ id: "p2", date: "2026-05-26", isCardio: true, cardioModality: "run", title: "Z2 run" }),
    ],
    sessions: [
      session({ id: "s1", performedYmd: TODAY }),
      session({ id: "s2", performedYmd: TODAY, isStrength: false, isCardio: true, modality: "bike" }),
    ],
    events: [
      { id: "e1", date: "2026-06-15", name: "Race", priority: "A", modality: "run" },
    ],
  });

  it("all → identity", () => {
    expect(filterCalendarItems(all, "all")).toHaveLength(all.length);
  });

  it("strength → keeps strength + events, drops cardio", () => {
    const out = filterCalendarItems(all, "strength");
    const kinds = out.map((i) => i.kind);
    expect(kinds).toContain("planned_strength");
    expect(kinds).toContain("logged_strength");
    expect(kinds).toContain("event");
    expect(kinds).not.toContain("planned_cardio");
    expect(kinds).not.toContain("logged_cardio");
  });

  it("cardio → keeps cardio + events, drops strength", () => {
    const out = filterCalendarItems(all, "cardio");
    const kinds = out.map((i) => i.kind);
    expect(kinds).toContain("planned_cardio");
    expect(kinds).toContain("logged_cardio");
    expect(kinds).toContain("event");
    expect(kinds).not.toContain("planned_strength");
    expect(kinds).not.toContain("logged_strength");
  });
});
