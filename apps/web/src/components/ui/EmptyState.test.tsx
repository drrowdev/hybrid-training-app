/**
 * EmptyState — shape tests.
 *
 * Vitest runs in a Node environment (`vitest.config.ts`), so there is
 * no DOM. We call EmptyState as a plain function and inspect the
 * returned React element tree — enough to pin "title + body always
 * render", "action only when supplied", "inline variant has no
 * border", and "action href round-trips".
 */
import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { EmptyState } from "./EmptyState";

type AnyEl = ReactElement<{
  children?: unknown;
  "data-testid"?: string;
  style?: { border?: string };
  href?: string;
}>;

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

function findByTestId(root: AnyEl, id: string): AnyEl | undefined {
  return flattenChildren(root).find(
    (c) => c.props?.["data-testid"] === id,
  );
}

function textOf(el: AnyEl | undefined): string {
  if (!el) return "";
  const c = el.props?.children;
  if (typeof c === "string" || typeof c === "number") return String(c);
  return "";
}

describe("EmptyState", () => {
  it("renders title and body", () => {
    const el = EmptyState({
      title: "No HR-zone data",
      body: "Strava-imported runs with a heart-rate stream populate this card.",
    }) as AnyEl;
    expect(textOf(findByTestId(el, "empty-state-title"))).toBe("No HR-zone data");
    expect(textOf(findByTestId(el, "empty-state-body"))).toMatch(
      /Strava-imported runs/,
    );
  });

  it("renders the action button only when provided", () => {
    const noAction = EmptyState({
      title: "Nothing yet",
      body: "Once you log a session it appears here.",
    }) as AnyEl;
    expect(findByTestId(noAction, "empty-state-action")).toBeUndefined();

    const withAction = EmptyState({
      title: "Nothing yet",
      body: "Once you log a session it appears here.",
      action: { label: "Start a block →", href: "/app/plan" },
    }) as AnyEl;
    const cta = findByTestId(withAction, "empty-state-action");
    expect(cta).toBeTruthy();
    expect(textOf(cta)).toBe("Start a block →");
  });

  it("action href is forwarded to the Link", () => {
    const el = EmptyState({
      title: "No integrations",
      body: "Connect Strava to populate this card.",
      action: { label: "Connect Strava", href: "/app/settings/integrations" },
    }) as AnyEl;
    const cta = findByTestId(el, "empty-state-action");
    expect(cta?.props?.href).toBe("/app/settings/integrations");
  });

  it("inline variant has no border", () => {
    const inline = EmptyState({
      title: "No goals set",
      body: "Set a goal and we'll show progress here.",
      variant: "inline",
    }) as AnyEl;
    const root = findByTestId(inline, "empty-state");
    expect(root?.props?.style?.border).toBeUndefined();

    const card = EmptyState({
      title: "No goals set",
      body: "Set a goal and we'll show progress here.",
    }) as AnyEl;
    const cardRoot = findByTestId(card, "empty-state");
    expect(cardRoot?.props?.style?.border).toMatch(/var\(--cp-border\)/);
  });

  it("inline variant suppresses the icon slot", () => {
    const el = EmptyState({
      title: "x",
      body: "y",
      variant: "inline",
      icon: "🍃",
    }) as AnyEl;
    expect(findByTestId(el, "empty-state-icon")).toBeUndefined();
  });

  it("card variant renders the icon when supplied", () => {
    const el = EmptyState({
      title: "x",
      body: "y",
      icon: "🍃",
    }) as AnyEl;
    expect(findByTestId(el, "empty-state-icon")).toBeTruthy();
  });
});
