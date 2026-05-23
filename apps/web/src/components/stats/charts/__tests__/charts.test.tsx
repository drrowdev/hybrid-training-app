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

type AnyEl = ReactElement<{ children?: unknown; "data-testid"?: string }>;

function flattenChildren(node: unknown): AnyEl[] {
  if (node == null || typeof node !== "object") return [];
  const el = node as AnyEl;
  const out: AnyEl[] = [el];
  const c = el.props?.children;
  if (Array.isArray(c)) {
    for (const child of c) out.push(...flattenChildren(child));
  } else if (c != null && typeof c === "object") {
    out.push(...flattenChildren(c));
  }
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
});
