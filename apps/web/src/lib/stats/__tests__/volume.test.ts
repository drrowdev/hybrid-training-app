/**
 * Volume tonnage aggregator unit tests.
 *
 * Pins (a) warmups excluded, (b) sessions outside the window excluded,
 * (c) per-week bucketing, (d) deleted sessions never reach this layer
 * because the DB wrapper filters them.
 *
 * The bucket layout is "5 most-recent weeks ending at the Monday of the
 * current ISO week", so a known date helps the tests stay readable.
 */
import { describe, it, expect } from "vitest";
import { bucketTonnageByWeek, type SetRow } from "../volume";
import { mondayOfYmd, addDaysToYmd } from "@/lib/dates";

const TODAY = "2026-05-23"; // Saturday — Monday = 2026-05-18.

const thisWeekMonday = mondayOfYmd(TODAY);
const oneWeekAgoMonday = addDaysToYmd(thisWeekMonday, -7);
const fourWeeksAgoMonday = addDaysToYmd(thisWeekMonday, -28);

describe("bucketTonnageByWeek", () => {
  it("sums weight × reps across non-warmup strength sets in the window", () => {
    const rows: SetRow[] = [
      // 100 kg × 5 reps (this week) → 500
      { weightKg: 100, reps: 5, setKind: "main", performedYmd: TODAY },
      // 80 kg × 8 reps (this week) → 640
      { weightKg: 80, reps: 8, setKind: "back_off", performedYmd: TODAY },
      // 90 kg × 5 (a week ago)
      { weightKg: 90, reps: 5, setKind: "main", performedYmd: oneWeekAgoMonday },
    ];
    const r = bucketTonnageByWeek(rows, TODAY);
    expect(r.totalKg).toBe(500 + 640 + 450);
    // Bucket 4 = this week, bucket 3 = last week.
    expect(r.weeklyKg[4]).toBe(500 + 640);
    expect(r.weeklyKg[3]).toBe(450);
  });

  it("excludes warmups from the tonnage sum", () => {
    const rows: SetRow[] = [
      { weightKg: 60, reps: 5, setKind: "warmup", performedYmd: TODAY },
      { weightKg: 100, reps: 5, setKind: "main", performedYmd: TODAY },
    ];
    const r = bucketTonnageByWeek(rows, TODAY);
    expect(r.totalKg).toBe(500);
  });

  it("excludes rows outside the 5-week window", () => {
    const rows: SetRow[] = [
      // Four weeks ago Monday is the floor — still inside (bucket 0).
      { weightKg: 100, reps: 5, setKind: "main", performedYmd: fourWeeksAgoMonday },
      // One day before the floor — out.
      {
        weightKg: 100,
        reps: 5,
        setKind: "main",
        performedYmd: addDaysToYmd(fourWeeksAgoMonday, -1),
      },
    ];
    const r = bucketTonnageByWeek(rows, TODAY);
    expect(r.totalKg).toBe(500);
  });

  it("skips rows with null weight or null reps (cardio / isometric)", () => {
    const rows: SetRow[] = [
      { weightKg: null, reps: 5, setKind: "main", performedYmd: TODAY },
      { weightKg: 100, reps: null, setKind: "main", performedYmd: TODAY },
      { weightKg: 100, reps: 0, setKind: "main", performedYmd: TODAY },
      { weightKg: 100, reps: 5, setKind: "main", performedYmd: TODAY },
    ];
    const r = bucketTonnageByWeek(rows, TODAY);
    expect(r.totalKg).toBe(500);
  });

  it("returns exactly 5 weekly buckets, oldest first", () => {
    const rows: SetRow[] = [
      { weightKg: 100, reps: 1, setKind: "main", performedYmd: fourWeeksAgoMonday },
    ];
    const r = bucketTonnageByWeek(rows, TODAY);
    expect(r.weeklyKg).toHaveLength(5);
    expect(r.weekStarts).toHaveLength(5);
    expect(r.weekStarts[0]).toBe(addDaysToYmd(thisWeekMonday, -28));
    expect(r.weekStarts[4]).toBe(thisWeekMonday);
    expect(r.weeklyKg[0]).toBe(100);
  });
});
