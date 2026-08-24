/**
 * `weeklyRehabPlan` is the single point where "what rehab runs, and where" is
 * decided for a weekly Tactical Barbell block. Every reader goes through it, so
 * a wrong answer here either loses a user's rehab or moves it to the wrong day.
 */
import { describe, it, expect } from "vitest";
import {
  parseStoredRehabSchedule,
  rehabScheduleSchema,
  weeklyRehabPlan,
  type RehabSchedule,
} from "../rehab-schedule";
import type { TbCustomization } from "../tb-customization";

const item = (movementName = "Copenhagen Plank") => ({
  movementId: "11111111-1111-1111-1111-111111111111",
  movementName,
  sets: 3,
  reps: 12,
});

const envelope = (over: Record<string, unknown> = {}): RehabSchedule =>
  ({
    version: 1,
    localProtocolId: "protocol-1",
    name: "Rehab",
    items: [item()],
    series: ["slot-1"],
    days: [],
    ...over,
  }) as unknown as RehabSchedule;

const legacy = (over: Record<string, unknown> = {}): TbCustomization =>
  ({
    version: 1,
    displayName: "My TB",
    dayTypes: ["strength", "rehab", "rest", "rest", "rest", "rest", "rest"],
    sessionMovements: {},
    rehab: { items: [item("Achilles Isometric")] },
    ...over,
  }) as unknown as TbCustomization;

describe("rehabScheduleSchema", () => {
  it("rejects a protocol that runs nowhere", () => {
    const parsed = rehabScheduleSchema.safeParse(
      envelope({ series: [], days: [] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects repeated days and repeated sessions", () => {
    expect(
      rehabScheduleSchema.safeParse(envelope({ series: [], days: [1, 1] })).success,
    ).toBe(false);
    expect(
      rehabScheduleSchema.safeParse(envelope({ series: ["slot-1", "slot-1"] }))
        .success,
    ).toBe(false);
  });

  it("degrades a malformed stored blob to no rehab rather than throwing", () => {
    // The block itself is still readable; taking it down over its rehab would
    // lose far more than it saves.
    expect(parseStoredRehabSchedule({ version: 9 })).toBeUndefined();
    expect(parseStoredRehabSchedule(undefined)).toBeUndefined();
    expect(parseStoredRehabSchedule(envelope())).toMatchObject({
      localProtocolId: "protocol-1",
    });
  });
});

describe("weeklyRehabPlan", () => {
  it("falls back to the customization when a block has no envelope", () => {
    // A deployed block must be unaffected until the wizard next writes it.
    const plan = weeklyRehabPlan(legacy(), undefined);
    expect(plan.days).toEqual([1]);
    expect(plan.series).toEqual([]);
    expect(plan.items[0]!.movementName).toBe("Achilles Isometric");
    expect(plan.localProtocolId).toBe("protocol-1");
    expect(plan.protocolId).toBeNull();
  });

  it("prefers the envelope over the customization", () => {
    const plan = weeklyRehabPlan(legacy(), envelope({ days: [4] }));
    expect(plan.series).toEqual(["slot-1"]);
    expect(plan.days).toEqual([4]);
    expect(plan.items[0]!.movementName).toBe("Copenhagen Plank");
  });

  it("suppresses provenance for the synthetic legacy id", () => {
    // A block converted from the old shape keeps emitting `rehab-w<wk>-d<day>`,
    // so the tombstones for rehab the user already deleted keep matching.
    const plan = weeklyRehabPlan(undefined, envelope());
    expect(plan.protocolId).toBeNull();
    expect(plan.protocolName).toBe("Rehab");
  });

  it("carries provenance and name for a library protocol", () => {
    const plan = weeklyRehabPlan(
      undefined,
      envelope({ localProtocolId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", name: "Groin" }),
    );
    expect(plan.protocolId).toBe("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
    expect(plan.protocolName).toBe("Groin");
  });

  it("reads an Activation blob as no weekly rehab", () => {
    const activation = {
      version: 3,
      templateId: "activation",
      displayName: "x",
      phases: {},
      rehabProtocols: [],
    } as unknown as TbCustomization;
    expect(weeklyRehabPlan(activation, undefined).items).toEqual([]);
  });

  it("reads a customization with no rehab as no rehab", () => {
    expect(weeklyRehabPlan(legacy({ rehab: undefined }), undefined).items).toEqual(
      [],
    );
    expect(weeklyRehabPlan(undefined, undefined).items).toEqual([]);
  });
});
