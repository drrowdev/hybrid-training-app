/**
 * PR detection — extended scenarios covering multi-session progression,
 * idempotency on re-detection, and the conservative-dispatcher gate.
 *
 * These tests model real user trajectories ("hit a PR, then re-saved the
 * set"; "hit a PR three weeks in a row"; "matched without exceeding")
 * rather than just unit-level boundaries.
 */
import { describe, it, expect } from "vitest";
import { detectPrs, type HistoricalSet } from "../pr";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe("PR detection across consecutive sessions", () => {
  it("hits a weight PR week 1, then a reps-at-weight PR week 2 at the same weight", () => {
    // Week 1: 100 × 5 (first ever) -> weight + e1rm
    const week1 = detectPrs({ weight: 100, reps: 5 }, []);
    expect(week1.hits.find((h) => h.kind === "weight")).toBeDefined();
    expect(week1.hits.find((h) => h.kind === "e1rm")).toBeDefined();

    // Week 2: 100 × 6 against history of 100 × 5
    const history: HistoricalSet[] = [{ weight: 100, reps: 5, performed_at: daysAgo(7) }];
    const week2 = detectPrs({ weight: 100, reps: 6 }, history);
    // Same weight, more reps -> reps-at-weight + e1rm. NOT weight.
    expect(week2.hits.find((h) => h.kind === "weight")).toBeUndefined();
    expect(week2.hits.find((h) => h.kind === "reps_at_weight")).toBeDefined();
    expect(week2.hits.find((h) => h.kind === "e1rm")).toBeDefined();
  });

  it("re-detection on the same set against new history yields no PR (idempotent)", () => {
    // Imagine the engine ran detection once, the user edited the set, and
    // the engine re-runs. The history now CONTAINS the prior result.
    const history: HistoricalSet[] = [{ weight: 100, reps: 5, performed_at: daysAgo(0) }];
    const out = detectPrs({ weight: 100, reps: 5 }, history);
    // Tied performance -> no PR (the original set is now in history).
    expect(out.hits.find((h) => h.kind === "weight")).toBeUndefined();
    expect(out.hits.find((h) => h.kind === "reps_at_weight")).toBeUndefined();
  });

  it("conservative dispatcher protects against low-RPE inflation across history", () => {
    // Historical: 110 × 3 with no RPE -> Epley = 121.
    // New attempt: 100 × 5 @ RPE 6 (fresh) — RPE-based 1RM = 100/0.774 = 129,
    // but Epley = 116.67. Conservative pick = 116.67. Not a PR.
    const history: HistoricalSet[] = [{ weight: 110, reps: 3, performed_at: daysAgo(7) }];
    const out = detectPrs({ weight: 100, reps: 5, rpe: 6 }, history);
    expect(out.hits.find((h) => h.kind === "e1rm")).toBeUndefined();
  });

  it("days-since-previous reflects the gap to the matching prior PR", () => {
    const history: HistoricalSet[] = [
      { weight: 100, reps: 5, performed_at: daysAgo(30) },
      { weight: 102.5, reps: 1, performed_at: daysAgo(14) },
    ];
    const out = detectPrs({ weight: 105, reps: 1 }, history);
    const weight = out.hits.find((h) => h.kind === "weight");
    expect(weight?.previousBest).toBe(102.5);
    expect(weight?.daysSincePrevious).toBe(14);
  });

  it("RPE 10 grinder is excluded — even on what would be a clear PR", () => {
    const history: HistoricalSet[] = [{ weight: 100, reps: 5, performed_at: daysAgo(7) }];
    const out = detectPrs({ weight: 150, reps: 1, rpe: 10 }, history);
    expect(out.hits).toHaveLength(0);
  });
});

describe("PR detection — tie handling", () => {
  it("matched weight + matched reps yields no PR", () => {
    const out = detectPrs(
      { weight: 100, reps: 5 },
      [{ weight: 100, reps: 5, performed_at: daysAgo(7) }],
    );
    expect(out.hits.find((h) => h.kind === "weight")).toBeUndefined();
    expect(out.hits.find((h) => h.kind === "reps_at_weight")).toBeUndefined();
  });

  it("matched best weight, fewer reps at that weight yields no PR", () => {
    const out = detectPrs(
      { weight: 100, reps: 3 },
      [{ weight: 100, reps: 5, performed_at: daysAgo(7) }],
    );
    expect(out.hits.find((h) => h.kind === "reps_at_weight")).toBeUndefined();
    expect(out.hits.find((h) => h.kind === "weight")).toBeUndefined();
  });

  it("first set at a NEW weight is a weight PR, not a reps-at-weight PR", () => {
    const out = detectPrs(
      { weight: 110, reps: 1 },
      [{ weight: 100, reps: 5, performed_at: daysAgo(7) }],
    );
    expect(out.hits.find((h) => h.kind === "weight")).toBeDefined();
    expect(out.hits.find((h) => h.kind === "reps_at_weight")).toBeUndefined();
  });
});
