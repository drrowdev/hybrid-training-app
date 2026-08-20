/**
 * Regression: a prescription value must never break across visual lines.
 *
 * Reported from a phone — the rehab card on Today rendered
 * "Supported Wrist Radial Deviation (DB)" with its "3 × 15" split into
 * "3 ×" on one line and "15" on the next. The value was plain text inside a
 * flex item that shrinks to whatever the movement name leaves behind, so a
 * long name pushed the value into wrapping mid-value. Measured in Chromium
 * against the real component at 360px: 4 of 8 rows broke (rehab, main lifts
 * and accessories all affected); 0 after the fix.
 *
 * A value CAN wrap between its " · "-separated chunks ("4 sets · top 85% × 3")
 * — each chunk is an independent fact. It must never wrap inside one.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrescriptionItem } from "@hta/db";
import {
  SessionPreviewBody,
  type SessionPreviewInput,
} from "../SessionPreviewBody";
import { splitPrescriptionChunks } from "@/lib/plan/prescription-chunks";

const session = (items: PrescriptionItem[]): SessionPreviewInput => ({
  id: "planned-1",
  title: "Armor A2",
  eyebrow: "ARMOR · WK 2 · MON",
  estDurationMin: 60,
  items,
});

const rehab = (movementName: string, over: Partial<PrescriptionItem> = {}) =>
  ({
    kind: "tendon",
    movementId: movementName,
    movementName,
    sets: 3,
    reps: 15,
    meta: { rehab: true, rehabProtocolName: "Golfer's Elbow Rehab" },
    ...over,
  }) as unknown as PrescriptionItem;

const mainLift = (movementName: string) =>
  ({
    kind: "main",
    movementId: movementName,
    movementName,
    percentTm: 85,
    reps: 3,
    sets: 1,
  }) as unknown as PrescriptionItem;

/** Every chunk the browser must keep on one line, per value cell. */
function nowrapChunks(html: string): string[] {
  return [...html.matchAll(/<span style="white-space:nowrap">([^<]*)<\/span>/g)].map(
    (m) => m[1]!,
  );
}

describe("splitPrescriptionChunks", () => {
  it("splits on the ' · ' separator and drops empties", () => {
    expect(splitPrescriptionChunks("3 × 15")).toEqual(["3 × 15"]);
    expect(splitPrescriptionChunks("4 sets · top 85% × 3")).toEqual([
      "4 sets",
      "top 85% × 3",
    ]);
    expect(splitPrescriptionChunks("3 × 30s hold · each side")).toEqual([
      "3 × 30s hold",
      "each side",
    ]);
    expect(splitPrescriptionChunks("")).toEqual([]);
  });

  it("keeps the multiplication sign inside a chunk, never as a boundary", () => {
    // The bug was a break at the "×", so that must not be a split point.
    for (const chunk of splitPrescriptionChunks("3 × 12 · 3 × 10")) {
      expect(chunk).toMatch(/^\d+ × \d+$/);
    }
  });
});

describe("prescription values are unbreakable on narrow screens", () => {
  it("keeps a rehab row's sets × reps on one line", () => {
    const html = renderToStaticMarkup(
      <SessionPreviewBody
        variant="compact"
        session={session([
          rehab("Supported Wrist Radial Deviation (DB)"),
          rehab("Supported Pronation / Supination (DB)"),
          mainLift("Box Squat"),
        ])}
      />,
    );
    expect(nowrapChunks(html)).toContain("3 × 15");
  });

  it("keeps each part of a condensed strength summary on one line", () => {
    const html = renderToStaticMarkup(
      <SessionPreviewBody
        variant="compact"
        session={session([
          mainLift("Barbell Bulgarian Split Squat (Rear Foot Elevated)"),
          mainLift("Barbell Bulgarian Split Squat (Rear Foot Elevated)"),
        ])}
      />,
    );
    const chunks = nowrapChunks(html);
    expect(chunks).toContain("2 sets");
    expect(chunks).toContain("top 85% × 3");
  });

  it("splits a multi-fact rehab value between facts, not inside one", () => {
    const html = renderToStaticMarkup(
      <SessionPreviewBody
        variant="compact"
        session={session([
          rehab("Eccentric Wrist Extension With Long Hold (DB)", {
            reps: undefined,
            holdSec: { min: 30, max: 30 },
            notes: "each side",
          }),
          mainLift("Box Squat"),
        ])}
      />,
    );
    const chunks = nowrapChunks(html);
    expect(chunks).toContain("3 × 30s hold");
    expect(chunks).toContain("each side");
  });

  it("lets the movement name absorb the shrinking instead of the value", () => {
    const html = renderToStaticMarkup(
      <SessionPreviewBody
        variant="compact"
        session={session([rehab("Supported Wrist Radial Deviation (DB)")])}
      />,
    );
    // `min-width: 0` is what allows the name cell to shrink below its
    // min-content width so the value keeps its intrinsic size.
    expect(html).toMatch(/<span style="min-width:0;overflow-wrap:anywhere/);
  });

  it("keeps per-set lines on the full Preview page unbreakable too", () => {
    const html = renderToStaticMarkup(
      <SessionPreviewBody
        session={session([
          mainLift("Barbell Bulgarian Split Squat (Rear Foot Elevated)"),
        ])}
      />,
    );
    expect(nowrapChunks(html)).toContain("85% TM × 3");
  });
});
