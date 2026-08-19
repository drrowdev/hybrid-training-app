/**
 * The summary line is the only place a protocol's size is stated, so it has to
 * agree with what the workout will actually contain. The duration deliberately
 * reuses the canonical session estimator rather than a second implementation.
 */
import { describe, it, expect } from "vitest";
import {
  formatProtocolSummary,
  summariseProtocol,
  toPrescriptionItems,
} from "../summary";
import type { RehabProtocolItem } from "../queries";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

const item = (over: Partial<RehabProtocolItem> = {}): RehabProtocolItem => ({
  movementId: A,
  movementName: "Wrist Curl",
  side: "both",
  sets: 3,
  reps: 15,
  ...over,
});

describe("summariseProtocol", () => {
  it("counts distinct movements, not rows", () => {
    // A protocol addresses left and right as two rows of the SAME movement.
    // Counting rows would report "2 movements" for one exercise.
    const summary = summariseProtocol([
      item({ side: "left" }),
      item({ side: "right" }),
    ]);
    expect(summary.movementCount).toBe(1);
  });

  it("totals sets across rows", () => {
    expect(
      summariseProtocol([item({ sets: 3 }), item({ movementId: B, sets: 4 })]).setCount,
    ).toBe(7);
  });

  it("produces a duration", () => {
    expect(summariseProtocol([item()]).minutes).toBeGreaterThan(0);
  });

  it("reports nothing for an empty protocol", () => {
    expect(summariseProtocol([])).toMatchObject({
      movementCount: 0,
      setCount: 0,
      minutes: null,
    });
  });
});

describe("toPrescriptionItems", () => {
  it("maps a rep-based movement onto the tendon prescription shape", () => {
    expect(toPrescriptionItems([item()])[0]).toMatchObject({
      movementId: A,
      kind: "tendon",
      sets: 3,
      reps: 15,
      meta: { rehab: true },
    });
  });

  it("maps a hold onto holdSec rather than reps", () => {
    const mapped = toPrescriptionItems([
      item({ reps: undefined, holdSeconds: 30 }),
    ])[0]!;
    expect(mapped.holdSec).toEqual({ min: 30, max: 30 });
    expect(mapped.reps).toBeUndefined();
  });

  it("omits load when the protocol sets none", () => {
    expect(toPrescriptionItems([item()])[0]!.targetWeightKg).toBeUndefined();
  });
});

describe("formatProtocolSummary", () => {
  it("reads as movements, sets, then duration", () => {
    const line = formatProtocolSummary([item(), item({ movementId: B })]);
    expect(line).toMatch(/^2 movements · 6 sets · ~\d+ min$/);
  });

  it("singularises a one-movement, one-set protocol", () => {
    expect(formatProtocolSummary([item({ sets: 1 })])).toMatch(
      /^1 movement · 1 set · /,
    );
  });
});
