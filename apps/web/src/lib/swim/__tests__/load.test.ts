import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SwimActualResult } from "@hta/db";
import { deriveDailyRegionLoad } from "@/lib/engine/region-daily-load";
import { recomputeRegionState } from "@/lib/engine/region-ledger";
import { structuredSwimRegions } from "../load";

function result(overrides: Partial<SwimActualResult> = {}): SwimActualResult {
  return {
    version: 1,
    snapshot: {
      course: { numerator: 25, denominator: 1, unit: "m" },
      strokes: ["freestyle"],
      equipment: [],
      protocol: null,
      calibration: null,
      versions: { model: "swim-model-1", generator: "swim-gen-1", assessment: null },
    },
    lengths: 16,
    timeMs: 20 * 60 * 1000,
    rpe: 5,
    completion: "completed",
    provenance: { source: "manual", recordedAt: "2026-09-05T09:00:00Z" },
    ...overrides,
  };
}

function load(swimResult: SwimActualResult | null, durationSec = 1200) {
  return deriveDailyRegionLoad({
    sets: [],
    userTz: "UTC",
    cardio: [{
      performedAt: "2026-09-05T09:00:00Z",
      durationSec, rpe: 5, modality: "swim", movement: null, hrZones: null,
      swimResult,
    }],
  });
}

describe("DC-SW9 single structured swimming load", () => {
  afterEach(() => vi.useRealTimers());

  it("adds elbow exposure while retaining generic swimming behavior", () => {
    const generic = load(null);
    const structured = load(result());
    expect(generic.get("shoulder_scapular")?.get("2026-09-05")).toBe(80);
    expect(generic.get("lumbar_trunk")?.get("2026-09-05")).toBe(40);
    expect(generic.get("elbow_forearm")?.size).toBe(0);
    expect(structured.get("shoulder_scapular")?.get("2026-09-05")).toBe(80);
    expect(structured.get("elbow_forearm")?.get("2026-09-05")).toBe(40);
  });

  it("does not multiply the aggregate session load by lengths or splits", () => {
    const first = load(result());
    const moreLengths = load(result({
      lengths: 32,
      splits: [{ lengths: 16, timeMs: 550000 }, { lengths: 16, timeMs: 600000 }],
    }));
    expect(moreLengths).toEqual(first);
    expect(load(result(), 600).get("shoulder_scapular")?.get("2026-09-05")).toBe(40);
  });

  it("uses actual stroke/equipment and does not duplicate overlapping regions", () => {
    const actual = result();
    const exposure = structuredSwimRegions({
      ...actual,
      snapshot: {
        ...actual.snapshot, strokes: ["freestyle", "breaststroke"], equipment: ["fins"],
      },
    });
    expect(exposure?.primaryRegions).toEqual(["shoulder_scapular"]);
    expect(exposure?.secondaryRegions).toEqual(expect.arrayContaining([
      "elbow_forearm", "knee", "adductor_groin", "foot_ankle_calf",
    ]));
    expect(new Set(exposure?.secondaryRegions).size).toBe(exposure?.secondaryRegions.length);
    expect(exposure?.secondaryRegions).not.toContain("shoulder_scapular");
  });

  it("does not silently treat corrupt native history as generic swimming", () => {
    expect(() => structuredSwimRegions({ version: 1, lengths: -1 })).toThrow();
    expect(structuredSwimRegions(null)).toBeNull();
  });

  it.each([
    { strokes: ["unrecognized"] },
    { equipment: ["unrecognized"] },
    { protocol: "unsupported" },
    { calibration: {} },
  ])("rejects invalid snapshot fields before shared attribution: %j", (fields) => {
    const actual = result();
    expect(() => structuredSwimRegions({
      ...actual, snapshot: { ...actual.snapshot, ...fields },
    })).toThrow("Invalid swimming history");
  });

  it("retains valid half-millisecond assessment rates in native history", () => {
    const actual = result();
    expect(structuredSwimRegions({
      ...actual,
      snapshot: {
        ...actual.snapshot,
        protocol: "css_200_400",
        versions: { ...actual.snapshot.versions, assessment: "swim-css-1" },
        calibration: {
          msPer100: 140000.5, unit: "m", protocol: "css_200_400",
          observedOn: "2026-09-01", heuristic: true, version: "swim-css-1",
        },
      },
    })).toEqual(structuredSwimRegions(actual));
  });

  it("replaces shared load on edit and removes/restores it through session Trash", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
    let deleted = false;
    let durationSec = 1200;
    let clears = 0;
    const writes: { region: string; atl: number; ctl: number }[][] = [];
    const client = createClient("https://swim.test", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          let data: unknown = [];
          if (url.pathname.endsWith("/sessions")) {
            expect(url.searchParams.get("deleted_at")).toBe("is.null");
            expect(url.searchParams.get("completed_at")).toBe("not.is.null");
            data = deleted ? [] : [{ id: "session-1", performed_at: "2026-09-05T09:00:00Z" }];
          } else if (url.pathname.endsWith("/cardio_logs")) {
            expect(url.searchParams.get("session_id")).toBe("in.(session-1)");
            data = [{
              session_id: "session-1", duration_sec: durationSec, rpe: 5,
              modality: "swim", hr_zones: null, movement: null,
              swim_result: result({ timeMs: durationSec * 1000 }),
            }];
          } else if (url.pathname.endsWith("/region_state")) {
            if (init?.method === "DELETE") clears += 1;
            else writes.push(JSON.parse(String(init?.body)));
          } else {
            expect(url.pathname.endsWith("/set_logs")).toBe(true);
          }
          return new Response(JSON.stringify(data), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        },
      },
    });
    await recomputeRegionState(client, "user-1", "UTC");
    await recomputeRegionState(client, "user-1", "UTC");
    expect(writes[1]).toEqual(writes[0]);

    durationSec = 600;
    await recomputeRegionState(client, "user-1", "UTC");
    const original = writes[0]!.find((row) => row.region === "shoulder_scapular")!;
    const edited = writes[2]!.find((row) => row.region === "shoulder_scapular")!;
    expect(edited.atl).toBeCloseTo(original.atl / 2);
    expect(edited.ctl).toBeCloseTo(original.ctl / 2);

    deleted = true;
    expect(await recomputeRegionState(client, "user-1", "UTC")).toEqual({
      updated: 0, firstDate: null, lastDate: null,
    });
    expect(clears).toBe(1);
    deleted = false;
    await recomputeRegionState(client, "user-1", "UTC");
    expect(writes[3]).toEqual(writes[2]);
  });
});
