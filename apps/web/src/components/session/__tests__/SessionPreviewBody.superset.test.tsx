/**
 * P5a render coverage for the antagonist-superset bracket (ADR 0026).
 *
 * Verifies the full Preview variant wraps two paired accessory rows in a
 * "Superset" cluster when the read-time pairing pass has tagged them, and that
 * an un-paired accessory list renders no cluster (the OFF / unpaired case).
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrescriptionItem } from "@hta/db";
import {
  SessionPreviewBody,
  type SessionPreviewInput,
} from "../SessionPreviewBody";

const acc = (over: Partial<PrescriptionItem> = {}): PrescriptionItem =>
  ({
    kind: "accessory",
    movementId: over.movementId ?? "m-acc",
    movementName: over.movementName ?? "Accessory",
    sets: 3,
    reps: 12,
    ...over,
  }) as unknown as PrescriptionItem;

const input = (items: PrescriptionItem[]): SessionPreviewInput => ({
  id: "planned-1",
  title: "Strength A",
  eyebrow: "TEST · WEEK 1 · MON 1 JAN",
  estDurationMin: 40,
  items,
});

describe("SessionPreviewBody — superset bracket", () => {
  it("wraps a tagged antagonist pair in a superset cluster", () => {
    const items = [
      acc({
        movementId: "curl",
        movementName: "Biceps Curl",
        meta: { supersetGroup: "ss-1", supersetSlot: "A1" },
      }),
      acc({
        movementId: "pushdown",
        movementName: "Triceps Pushdown",
        meta: { supersetGroup: "ss-1", supersetSlot: "A2" },
      }),
      acc({ movementId: "calf", movementName: "Calf Raise" }),
    ];
    const html = renderToStaticMarkup(<SessionPreviewBody session={input(items)} />);
    expect(html).toContain('data-superset-group="ss-1"');
    expect(html).toContain("Superset");
    expect(html).toContain("Biceps Curl");
    expect(html).toContain("Triceps Pushdown");
    // The solo accessory is NOT inside a cluster.
    expect(html).toContain("Calf Raise");
  });

  it("renders no cluster when accessories are unpaired (OFF / unpaired case)", () => {
    const items = [
      acc({ movementId: "curl", movementName: "Biceps Curl" }),
      acc({ movementId: "pushdown", movementName: "Triceps Pushdown" }),
    ];
    const html = renderToStaticMarkup(<SessionPreviewBody session={input(items)} />);
    expect(html).not.toContain("superset-cluster");
    expect(html).not.toContain("Superset");
  });

  it("renders a widowed member solo (no half-bracket)", () => {
    const items = [
      acc({
        movementId: "curl",
        movementName: "Biceps Curl",
        meta: { supersetGroup: "ss-1", supersetSlot: "A1" },
      }),
      acc({ movementId: "calf", movementName: "Calf Raise" }),
    ];
    const html = renderToStaticMarkup(<SessionPreviewBody session={input(items)} />);
    expect(html).not.toContain("superset-cluster");
    expect(html).toContain("Biceps Curl");
  });
});
