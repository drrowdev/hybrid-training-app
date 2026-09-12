import { describe, expect, it } from "vitest";
import { swimScheduleAdvice } from "./swim-schedule";

const context = { blockId: "primary", sessions: [
  { id: "mon", date: "2026-09-07" }, { id: "wed", date: "2026-09-09" }, { id: "fri", date: "2026-09-11" },
] };
describe("DC-K4/DC-SW7 standalone swim scheduling", () => {
  it("defaults to two spaced days for a blockless swimmer", () => {
    expect(swimScheduleAdvice({ blockId: null, sessions: [] }, "2026-09-07", 6).defaults).toEqual([1, 4]);
  });
  it("uses actual calendar weekdays, leaving Monday/Wednesday/Friday strength untouched", () => {
    const before = JSON.stringify(context);
    const advice = swimScheduleAdvice(context, "2026-09-07", 6, [1, 4]);
    expect(advice.defaults).toEqual([2, 6]);
    expect(advice.conflicts).toEqual([{ value: 1, label: "Monday" }]);
    expect(JSON.stringify(context)).toBe(before);
  });
  it("does not fill an insufficient schedule with conflicting days", () => {
    const sessions = Array.from({ length: 7 }, (_, i) => ({ id: `${i}`, date: `2026-09-${String(7 + i).padStart(2, "0")}` }));
    expect(swimScheduleAdvice({ blockId: "p", sessions }, "2026-09-07", 2)).toMatchObject({ defaults: [], insufficientFreeDays: true });
    expect(swimScheduleAdvice({ blockId: "p", sessions: sessions.slice(0, 6) }, "2026-09-07", 2).defaults).toEqual([0]);
  });
  it("honours explicit dates and the requested horizon rather than repeating a past week", () => {
    expect(swimScheduleAdvice(context, "2026-09-14", 2).occupied).toEqual([]);
    expect(swimScheduleAdvice({ blockId: "p", sessions: [{ id: "s", date: "2026-09-20" }] }, "2026-09-07", 2, [0]).conflicts[0]?.label).toBe("Sunday");
  });
  it("invalidates confirmation after a primary, date, duration or weekday change", () => {
    const original = swimScheduleAdvice(context, "2026-09-07", 2, [1]).confirmationKey;
    for (const key of [
      swimScheduleAdvice({ ...context, blockId: "new" }, "2026-09-07", 2, [1]).confirmationKey,
      swimScheduleAdvice({ ...context, sessions: context.sessions.slice(1) }, "2026-09-07", 2, [1]).confirmationKey,
      swimScheduleAdvice(context, "2026-09-08", 2, [1]).confirmationKey,
      swimScheduleAdvice(context, "2026-09-07", 3, [1]).confirmationKey,
      swimScheduleAdvice(context, "2026-09-07", 2, [1, 4]).confirmationKey,
    ]) expect(key).not.toBe(original);
  });
});
