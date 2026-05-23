/**
 * Sparkline / MiniBars chart-primitive shape tests.
 *
 * Vitest runs in a Node environment (`vitest.config.ts`), so there is
 * no DOM to mount React against. Instead we call each component as a
 * plain function and assert the shape of the returned React element
 * tree — which is enough to pin "renders the correct number of bars",
 * "exposes a stable test id", and the empty-state branch.
 *
 * This is intentionally minimal: the goal is to catch a regression
 * that swaps the bar count or removes the chart's test hooks, not to
 * exercise full rendering. Visual coverage lives in the desktop E2E.
 */
import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { Sparkline } from "../Sparkline";
import { MiniBars } from "../MiniBars";
import { MiniLine } from "../MiniLine";
import { MiniScatter } from "../MiniScatter";

type AnyEl = ReactElement<{ children?: unknown; "data-testid"?: string }>;

function flattenChildren(node: unknown): AnyEl[] {
  if (node == null) return [];
  if (Array.isArray(node)) {
    const out: AnyEl[] = [];
    for (const child of node) out.push(...flattenChildren(child));
    return out;
  }
  if (typeof node !== "object") return [];
  const el = node as AnyEl;
  const out: AnyEl[] = [el];
  const c = el.props?.children;
  if (c != null) out.push(...flattenChildren(c));
  return out;
}

describe("Sparkline", () => {
  it("renders one polyline path for the provided values", () => {
    const el = Sparkline({ values: [1, 2, 3, 4] }) as AnyEl;
    const all = flattenChildren(el);
    const linePath = all.find((c) => c.props?.["data-testid"] === "sparkline-line");
    expect(linePath).toBeTruthy();
  });

  it("falls back to a baseline when given no values", () => {
    const el = Sparkline({ values: [] }) as AnyEl;
    const all = flattenChildren(el);
    expect(all.find((c) => c.props?.["data-testid"] === "sparkline-line")).toBeUndefined();
  });
});

describe("MiniBars", () => {
  it("renders one <rect> per value", () => {
    const values = [1, 2, 3, 4, 5];
    const el = MiniBars({ values }) as AnyEl;
    const all = flattenChildren(el);
    const bars = all.filter((c) => c.props?.["data-testid"] === "minibars-bar");
    expect(bars).toHaveLength(values.length);
  });

  it("renders exactly 7 bars for a week-of-sleep input", () => {
    const week = [7.5, 8.0, 6.5, 7.2, 8.1, 7.8, 7.0];
    const el = MiniBars({ values: week, max: 10 }) as AnyEl;
    const bars = flattenChildren(el).filter(
      (c) => c.props?.["data-testid"] === "minibars-bar",
    );
    expect(bars).toHaveLength(7);
  });

  it("renders no bars for empty input", () => {
    const el = MiniBars({ values: [] }) as AnyEl;
    const bars = flattenChildren(el).filter(
      (c) => c.props?.["data-testid"] === "minibars-bar",
    );
    expect(bars).toHaveLength(0);
  });

  it("draws an overlay path when overlay is supplied", () => {
    const el = MiniBars({
      values: [1, 2, 3, 4, 5],
      overlay: [null, null, 2, 3, 4],
    }) as AnyEl;
    const all = flattenChildren(el);
    const overlay = all.find((c) => c.props?.["data-testid"] === "minibars-overlay");
    expect(overlay).toBeTruthy();
  });

  it("skips overlay path when fewer than two non-null entries", () => {
    const el = MiniBars({
      values: [1, 2, 3],
      overlay: [null, null, 2],
    }) as AnyEl;
    const overlay = flattenChildren(el).find(
      (c) => c.props?.["data-testid"] === "minibars-overlay",
    );
    expect(overlay).toBeUndefined();
  });
});

describe("MiniLine", () => {
  it("renders the main line path for the provided values", () => {
    const el = MiniLine({ values: [1, 2, 3] }) as AnyEl;
    const all = flattenChildren(el);
    expect(all.find((c) => c.props?.["data-testid"] === "miniline-path")).toBeTruthy();
  });

  it("draws an overlay path when overlay is supplied", () => {
    const el = MiniLine({ values: [1, 2, 3, 4], overlay: [1.5, 2, 2.5, 3] }) as AnyEl;
    const all = flattenChildren(el);
    expect(all.find((c) => c.props?.["data-testid"] === "miniline-overlay")).toBeTruthy();
  });

  it("does NOT draw an overlay when lengths mismatch", () => {
    const el = MiniLine({ values: [1, 2, 3, 4], overlay: [1.5, 2] }) as AnyEl;
    const all = flattenChildren(el);
    expect(all.find((c) => c.props?.["data-testid"] === "miniline-overlay")).toBeUndefined();
  });
});

describe("MiniScatter", () => {
  it("renders one circle per point", () => {
    const points = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ];
    const el = MiniScatter({ points }) as AnyEl;
    const dots = flattenChildren(el).filter(
      (c) => c.props?.["data-testid"] === "miniscatter-point",
    );
    expect(dots).toHaveLength(points.length);
  });

  it("renders a reference line when provided", () => {
    const el = MiniScatter({
      points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
      referenceLine: [0, 0, 10, 10],
    }) as AnyEl;
    expect(
      flattenChildren(el).find((c) => c.props?.["data-testid"] === "miniscatter-reference"),
    ).toBeTruthy();
  });

  it("renders axes only on empty input", () => {
    const el = MiniScatter({ points: [] }) as AnyEl;
    const all = flattenChildren(el);
    expect(all.find((c) => c.props?.["data-testid"] === "miniscatter-point")).toBeUndefined();
  });
});
