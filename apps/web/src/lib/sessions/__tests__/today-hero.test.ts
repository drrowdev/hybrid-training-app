import { describe, it, expect } from "vitest";
import {
  actionablePlannedSessions,
  isTodayFullyLogged,
  orderPlannedSessionsForToday,
} from "../today-hero";

const done = { completedAt: "2026-06-22T10:00:00Z" };
const pending = { completedAt: null };

describe("isTodayFullyLogged", () => {
  it("is false when a planned session is still pending, even if an unrelated activity was logged", () => {
    // The bug: an easy Strava run completes a standalone session while the
    // prescribed Station Intervals stays pending. The day is NOT fully logged.
    expect(
      isTodayFullyLogged({ completedTodayCount: 1, plannedToday: [pending] }),
    ).toBe(false);
  });

  describe("actionablePlannedSessions", () => {
    it("keeps only unfinished, unskipped sessions on a partial multi-session day", () => {
      const pending = {
        id: "rehab",
        completedAt: null,
        skippedAt: null,
      };
      const completed = {
        id: "strength",
        completedAt: "2026-08-10T10:18:56.099Z",
        skippedAt: null,
      };
      const skipped = {
        id: "cardio",
        completedAt: null,
        skippedAt: "2026-08-10T10:30:00.000Z",
      };

      expect(
        actionablePlannedSessions([
          completed,
          pending,
          skipped,
        ]),
      ).toEqual([pending]);
    });
  });

  describe("orderPlannedSessionsForToday", () => {
    it("leads with the primary single session before storage-only PM rehab", () => {
      const rehab = { id: "rehab", slot: "pm" as const, completedAt: null };
      const primary = {
        id: "armor-a1",
        slot: "single" as const,
        completedAt: null,
      };

      expect(
        orderPlannedSessionsForToday([rehab, primary], false),
      ).toEqual([primary, rehab]);
    });

    it("orders a genuine two-a-day AM before PM", () => {
      const pm = { id: "pm", slot: "pm" as const, completedAt: null };
      const am = { id: "am", slot: "am" as const, completedAt: null };

      expect(orderPlannedSessionsForToday([pm, am], true)).toEqual([am, pm]);
    });
  });

  it("is true when every planned session is completed", () => {
    expect(
      isTodayFullyLogged({ completedTodayCount: 1, plannedToday: [done] }),
    ).toBe(true);
  });

  it("is true on a rest day (no planned sessions) when something was logged", () => {
    expect(
      isTodayFullyLogged({ completedTodayCount: 1, plannedToday: [] }),
    ).toBe(true);
  });

  it("is false when nothing was completed today", () => {
    expect(
      isTodayFullyLogged({ completedTodayCount: 0, plannedToday: [] }),
    ).toBe(false);
    expect(
      isTodayFullyLogged({ completedTodayCount: 0, plannedToday: [done] }),
    ).toBe(false);
  });

  it("two-a-day: false until BOTH slots are completed", () => {
    expect(
      isTodayFullyLogged({ completedTodayCount: 1, plannedToday: [done, pending] }),
    ).toBe(false);
    expect(
      isTodayFullyLogged({ completedTodayCount: 2, plannedToday: [done, done] }),
    ).toBe(true);
  });

  it("treats skipped companion work as settled when another session was logged", () => {
    const skipped = {
      completedAt: null,
      skippedAt: "2026-08-10T12:00:00.000Z",
    };
    expect(
      isTodayFullyLogged({
        completedTodayCount: 1,
        plannedToday: [done, skipped],
      }),
    ).toBe(true);
  });

  it("does not call an all-skipped plan logged because of an unrelated activity", () => {
    expect(
      isTodayFullyLogged({
        completedTodayCount: 1,
        plannedToday: [
          {
            completedAt: null,
            skippedAt: "2026-08-10T12:00:00.000Z",
          },
        ],
      }),
    ).toBe(false);
  });
});
