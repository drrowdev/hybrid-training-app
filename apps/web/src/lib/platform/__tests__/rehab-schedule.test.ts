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

const KNEE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SHOULDER = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";

const item = (movementName = "Copenhagen Plank") => ({
  movementId: "11111111-1111-1111-1111-111111111111",
  movementName,
  sets: 3,
  reps: 12,
});

const envelope = (over: Record<string, unknown> = {}): RehabSchedule =>
  ({
    version: 1,
    protocols: [{ id: "protocol-1", name: "Rehab", items: [item()] }],
    series: [{ key: "slot-1", protocolId: "protocol-1" }],
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

  it("rejects a placement naming a protocol it does not carry", () => {
    // It would resolve to nothing at materialisation, silently.
    expect(
      rehabScheduleSchema.safeParse(
        envelope({ series: [{ key: "slot-1", protocolId: "missing" }] }),
      ).success,
    ).toBe(false);
    expect(
      rehabScheduleSchema.safeParse(
        envelope({ series: [], days: [{ day: 2, protocolId: "missing" }] }),
      ).success,
    ).toBe(false);
  });

  it("rejects two protocols on one day or one session", () => {
    const two = [
      { id: KNEE, name: "Knee", items: [item()] },
      { id: SHOULDER, name: "Shoulder", items: [item()] },
    ];
    expect(
      rehabScheduleSchema.safeParse(
        envelope({
          protocols: two,
          series: [
            { key: "slot-1", protocolId: KNEE },
            { key: "slot-1", protocolId: SHOULDER },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      rehabScheduleSchema.safeParse(
        envelope({
          protocols: two,
          series: [],
          days: [
            { day: 2, protocolId: KNEE },
            { day: 2, protocolId: SHOULDER },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects duplicate protocol ids", () => {
    expect(
      rehabScheduleSchema.safeParse(
        envelope({
          protocols: [
            { id: KNEE, name: "Knee", items: [item()] },
            { id: KNEE, name: "Also knee", items: [item()] },
          ],
          series: [{ key: "slot-1", protocolId: KNEE }],
        }),
      ).success,
    ).toBe(false);
  });

  it("degrades a malformed stored blob to no rehab rather than throwing", () => {
    // The block itself is still readable; taking it down over its rehab would
    // lose far more than it saves.
    expect(parseStoredRehabSchedule({ version: 9 })).toBeUndefined();
    expect(parseStoredRehabSchedule(undefined)).toBeUndefined();
    expect(parseStoredRehabSchedule(envelope())?.protocols[0]!.id).toBe(
      "protocol-1",
    );
  });
});

describe("weeklyRehabPlan", () => {
  it("falls back to the customization when a block has no envelope", () => {
    // A deployed block must be unaffected until the wizard next writes it.
    const plan = weeklyRehabPlan(legacy(), undefined);
    expect([...plan.byDay]).toEqual([[1, "protocol-1"]]);
    expect(plan.bySeries.size).toBe(0);
    expect(plan.protocols).toHaveLength(1);
    expect(plan.protocols[0]!.items[0]!.movementName).toBe("Achilles Isometric");
    expect(plan.protocols[0]!.protocolId).toBeNull();
  });

  it("prefers the envelope over the customization", () => {
    const plan = weeklyRehabPlan(
      legacy(),
      envelope({ days: [{ day: 4, protocolId: "protocol-1" }] }),
    );
    expect([...plan.bySeries]).toEqual([["slot-1", "protocol-1"]]);
    expect([...plan.byDay]).toEqual([[4, "protocol-1"]]);
    expect(plan.protocols[0]!.items[0]!.movementName).toBe("Copenhagen Plank");
  });

  it("carries a different protocol per placement", () => {
    const plan = weeklyRehabPlan(
      undefined,
      envelope({
        protocols: [
          { id: KNEE, name: "Knee", items: [item("Copenhagen Plank")] },
          { id: SHOULDER, name: "Shoulder", items: [item("Prone Y")] },
        ],
        series: [
          { key: "slot-1", protocolId: KNEE },
          { key: "slot-2", protocolId: SHOULDER },
        ],
        days: [{ day: 6, protocolId: SHOULDER }],
      }),
    );
    expect(plan.bySeries.get("slot-1")).toBe(KNEE);
    expect(plan.bySeries.get("slot-2")).toBe(SHOULDER);
    expect(plan.byDay.get(6)).toBe(SHOULDER);
    expect(plan.protocols.map((p) => p.protocolName)).toEqual([
      "Knee",
      "Shoulder",
    ]);
  });

  it("suppresses provenance for the synthetic legacy id", () => {
    // A block converted from the old shape keeps emitting `rehab-w<wk>-d<day>`,
    // so the tombstones for rehab the user already deleted keep matching.
    const plan = weeklyRehabPlan(undefined, envelope());
    expect(plan.protocols[0]!.protocolId).toBeNull();
    expect(plan.protocols[0]!.protocolName).toBe("Rehab");
  });

  it("carries provenance and name for a library protocol", () => {
    const plan = weeklyRehabPlan(
      undefined,
      envelope({
        protocols: [{ id: KNEE, name: "Knee", items: [item()] }],
        series: [{ key: "slot-1", protocolId: KNEE }],
      }),
    );
    expect(plan.protocols[0]!.protocolId).toBe(KNEE);
    expect(plan.protocols[0]!.protocolName).toBe("Knee");
  });

  it("reads an Activation blob as no weekly rehab", () => {
    const activation = {
      version: 3,
      templateId: "activation",
      displayName: "x",
      phases: {},
      rehabProtocols: [],
    } as unknown as TbCustomization;
    expect(weeklyRehabPlan(activation, undefined).protocols).toEqual([]);
  });

  it("reads a customization with no rehab as no rehab", () => {
    expect(
      weeklyRehabPlan(legacy({ rehab: undefined }), undefined).protocols,
    ).toEqual([]);
    expect(weeklyRehabPlan(undefined, undefined).protocols).toEqual([]);
  });
});
