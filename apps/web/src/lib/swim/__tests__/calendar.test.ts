import { describe, expect, it } from "vitest";
import { standaloneSwimCalendar } from "../calendar";

const swim = { id: "swim", plan_id: "plan", scheduled_date: "2026-09-07", slot: "single" as const, session_id: null, status: "scheduled" as const };

describe("ADR0079 standalone calendar seam", () => {
  it("shows independent dates without any primary block", () => {
    expect(standaloneSwimCalendar([{ id: "plan", status: "active" }], [swim])).toEqual([
      { source: "swim", id: "swim", planId: "plan", date: "2026-09-07", slot: "single", sessionId: null, status: "scheduled", href: "/app/swim/swim" },
    ]);
  });
  it.each(["paused", "finished", "archived"])("removes future %s swims but retains started history", (status) => {
    const started = { ...swim, id: "started", session_id: "session", status: "started" as const };
    expect(standaloneSwimCalendar([{ id: "plan", status }], [swim, started]).map((item) => item.id)).toEqual(["started"]);
  });
  it("does not carry skipped work into later dates", () => {
    expect(standaloneSwimCalendar([{ id: "plan", status: "active" }], [{ ...swim, status: "skipped" }])).toEqual([]);
  });
  it("removes an abandoned trashed start and restores its calendar identity on undo", () => {
    const started = { ...swim, session_id: "session", status: "started" as const, deleted: true };
    expect(standaloneSwimCalendar([{ id: "plan", status: "active" }], [started])).toEqual([]);
    expect(standaloneSwimCalendar([{ id: "plan", status: "active" }], [{ ...started, deleted: false }])[0]?.id).toBe(swim.id);
  });
});
