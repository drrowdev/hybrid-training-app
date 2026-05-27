import { describe, it, expect } from "vitest";
import {
  isOverdue,
  summariseOverdue,
  overdueDays,
  type OverdueCandidate,
} from "../overdue";
import { todayYmd } from "@/lib/dates";

function row(over: Partial<OverdueCandidate> = {}): OverdueCandidate {
  return {
    date: "2026-05-26",
    completedSessionId: null,
    skippedAt: null,
    ...over,
  };
}

describe("isOverdue", () => {
  const today = "2026-05-26";

  it("returns false for today's date (not yet overdue)", () => {
    expect(isOverdue(row({ date: today }), today)).toBe(false);
  });

  it("returns false for a future date", () => {
    expect(isOverdue(row({ date: "2026-05-27" }), today)).toBe(false);
  });

  it("returns false when a past row was completed", () => {
    expect(
      isOverdue(
        row({ date: "2026-05-20", completedSessionId: "s-1" }),
        today,
      ),
    ).toBe(false);
  });

  it("returns false when a past row was skipped", () => {
    expect(
      isOverdue(
        row({ date: "2026-05-20", skippedAt: "2026-05-21T08:00:00Z" }),
        today,
      ),
    ).toBe(false);
  });

  it("returns true when a past row has neither completion nor skip", () => {
    expect(isOverdue(row({ date: "2026-05-20" }), today)).toBe(true);
  });

  it("evaluates date strictly less than today (boundary)", () => {
    expect(isOverdue(row({ date: "2026-05-25" }), today)).toBe(true);
    expect(isOverdue(row({ date: "2026-05-26" }), today)).toBe(false);
  });

  it("uses user-local today, not host UTC date (TZ edge case)", () => {
    // Helsinki at 01:00 local on 2026-05-26 is 22:00 UTC the prior day.
    // The user-local today must be 2026-05-26, and a row dated
    // 2026-05-25 must read as overdue. Using `todayYmd("UTC")` would
    // (incorrectly) report 2026-05-25 and mark the row as NOT overdue.
    const helsinkiAt0100 = new Date(Date.UTC(2026, 4, 25, 22, 0, 0));
    const original = Date;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const PatchedDate: any = class extends original {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(helsinkiAt0100.getTime());
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          super(...(args as [any]));
        }
      }
      static override now() {
        return helsinkiAt0100.getTime();
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Date = PatchedDate;
    try {
      const userToday = todayYmd("Europe/Helsinki");
      expect(userToday).toBe("2026-05-26");
      expect(isOverdue(row({ date: "2026-05-25" }), userToday)).toBe(true);

      const utcToday = todayYmd("UTC");
      expect(utcToday).toBe("2026-05-25");
      expect(isOverdue(row({ date: "2026-05-25" }), utcToday)).toBe(false);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Date = original;
    }
  });
});

describe("summariseOverdue", () => {
  const today = "2026-05-26";

  it("returns empty summary when no rows are overdue", () => {
    const out = summariseOverdue(
      [
        row({ date: today }),
        row({ date: "2026-05-27" }),
        row({ date: "2026-05-20", completedSessionId: "x" }),
        row({ date: "2026-05-21", skippedAt: "2026-05-22T00:00:00Z" }),
      ],
      today,
    );
    expect(out).toEqual({ count: 0, oldestDate: null, items: [] });
  });

  it("counts only past-incomplete rows and finds the oldest date", () => {
    const rows = [
      row({ date: today }), // ignored — today
      row({ date: "2026-05-22" }), // overdue
      row({ date: "2026-05-20", completedSessionId: "x" }), // ignored
      row({ date: "2026-05-19" }), // overdue — oldest
      row({ date: "2026-05-24" }), // overdue
    ];
    const out = summariseOverdue(rows, today);
    expect(out.count).toBe(3);
    expect(out.oldestDate).toBe("2026-05-19");
    expect(out.items.map((i) => i.date)).toEqual([
      "2026-05-22",
      "2026-05-19",
      "2026-05-24",
    ]);
  });

  it("preserves caller-supplied object identity in items", () => {
    const a = row({ date: "2026-05-22" });
    const b = row({ date: "2026-05-23" });
    const out = summariseOverdue([a, b], today);
    expect(out.items[0]).toBe(a);
    expect(out.items[1]).toBe(b);
  });
});

describe("overdueDays", () => {
  it("returns positive integer day count between row date and today", () => {
    expect(overdueDays(row({ date: "2026-05-25" }), "2026-05-26")).toBe(1);
    expect(overdueDays(row({ date: "2026-05-19" }), "2026-05-26")).toBe(7);
  });
});
