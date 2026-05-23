import { describe, expect, it } from "vitest";
import { rankItems, scoreItem } from "./matcher";
import type { PaletteItem } from "./types";

const page = (id: string, title: string, subtitle?: string): PaletteItem => ({
  id,
  kind: "page",
  title,
  subtitle,
  href: `/app/${id}`,
});

const movement = (id: string, title: string): PaletteItem => ({
  id,
  kind: "movement",
  title,
  href: `/app/stats/movements/${id}`,
});

describe("scoreItem", () => {
  it("returns null when the query doesn't match", () => {
    const r = scoreItem(page("plan", "Plan"), "zzz");
    expect(r).toBeNull();
  });

  it("scores an exact prefix higher than a mid-string substring", () => {
    const prefix = scoreItem(page("stats", "Stats"), "sta")!;
    const sub = scoreItem(movement("rev-stat-row", "Reverse Stat Row"), "sta")!;
    expect(prefix.score).toBeGreaterThan(sub.score);
  });

  it("scores a substring match higher than a pure subsequence match", () => {
    const sub = scoreItem(page("log", "Activity Log"), "log")!;
    const subseq = scoreItem(page("ladder", "Long Ladder Outing"), "log")!;
    expect(sub.score).toBeGreaterThan(subseq.score);
  });

  it("boosts subtitle matches", () => {
    const withSub = scoreItem(
      page("freshness", "Freshness", "Region recovery state"),
      "recovery",
    );
    expect(withSub).not.toBeNull();
    expect(withSub!.score).toBeGreaterThan(0);
  });

  it("highlights the contiguous substring when present", () => {
    const r = scoreItem(page("stats", "Stats — Overview"), "over")!;
    // "stats — overview" → "over" is at index 8.
    expect(r.ranges).toEqual([[8, 12]]);
  });
});

describe("rankItems", () => {
  const items: PaletteItem[] = [
    page("today", "Today"),
    page("plan", "Plan"),
    page("sessions", "Sessions"),
    page("stats", "Stats — Overview"),
    page("stats-wellness", "Stats — Wellness"),
    page("stats-blocks", "Stats — Blocks"),
    movement("back-squat", "Back Squat"),
    movement("front-squat", "Front Squat"),
  ];

  it("ranks page hits above movement hits at the same query", () => {
    const r = rankItems(items, "stats");
    expect(r[0].item.kind).toBe("page");
    // Top result should be one of the stats pages, not a movement.
    expect(r[0].item.title.toLowerCase()).toContain("stats");
  });

  it("returns 'Today' first when the query is 'tod'", () => {
    const r = rankItems(items, "tod");
    expect(r[0].item.title).toBe("Today");
  });

  it("filters out non-matches", () => {
    const r = rankItems(items, "zebra");
    expect(r).toHaveLength(0);
  });

  it("treats an empty query as 'show everything ordered by kind boost'", () => {
    const r = rankItems(items, "");
    expect(r).toHaveLength(items.length);
    // All pages should come before any movement once kind boost is the
    // only signal.
    const firstMovementIndex = r.findIndex((m) => m.item.kind === "movement");
    const lastPageIndex = r
      .map((m, i) => (m.item.kind === "page" ? i : -1))
      .filter((i) => i >= 0)
      .pop()!;
    expect(firstMovementIndex).toBeGreaterThan(lastPageIndex);
  });

  it("breaks score ties alphabetically by title", () => {
    const pair: PaletteItem[] = [
      movement("zoo", "Zoo Carry"),
      movement("apple", "Apple Lunge"),
    ];
    const r = rankItems(pair, "");
    expect(r[0].item.title).toBe("Apple Lunge");
  });
});
