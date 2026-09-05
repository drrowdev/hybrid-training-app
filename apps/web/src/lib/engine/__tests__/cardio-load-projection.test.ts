import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveRegionFreshnessLive } from "@/lib/stats/region-state-snapshot";
import { swimFixture } from "@/lib/swim/__tests__/fixtures";
import { recomputeRegionState } from "../region-ledger";

type Availability = "present" | "absent" | "error" | "invalid";
const baseColumns = "session_id,duration_sec,rpe,modality,hr_zones,movement:movements(primary_region,secondary_regions)";

function harness(availability: Availability, options: { cardioError?: boolean; noSessions?: boolean } = {}) {
  const selections: string[] = [];
  const writes: { region: string; atl: number }[][] = [];
  let capabilityCalls = 0;
  const actual = swimFixture().history[0]!.result;
  const client = createClient("https://swim.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      let data: unknown;
      let status = 200;
      if (url.pathname.endsWith("/rpc/swim_storage_ready")) {
        capabilityCalls++;
        if (availability === "present" || availability === "invalid") {
          data = availability === "present";
        } else {
          status = availability === "absent" ? 404 : 500;
          data = { code: availability === "absent" ? "PGRST202" : "57014", message: "Capability request failed" };
        }
      } else if (url.pathname.endsWith("/sessions")) {
        data = options.noSessions ? [] : [{ id: "session-1", performed_at: "2026-09-05T09:00:00Z" }];
      } else if (url.pathname.endsWith("/set_logs")) {
        data = [];
      } else if (url.pathname.endsWith("/cardio_logs")) {
        selections.push((url.searchParams.get("select") ?? "").replace(/\s/g, ""));
        if (options.cardioError) {
          status = 500;
          data = { code: "57014", message: "Cardio read failed" };
        } else {
          data = [{
            session_id: "session-1", duration_sec: 1200, rpe: 5, modality: "swim",
            hr_zones: null, movement: null,
            ...(availability === "present" ? { swim_result: actual } : {}),
          }];
        }
      } else if (url.pathname.endsWith("/region_state")) {
        if (init?.method === "POST") writes.push(JSON.parse(String(init.body)));
        data = [];
      } else {
        throw new Error("Unexpected mock request");
      }
      return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    } },
  });
  return { client, selections, writes, capabilityCalls: () => capabilityCalls };
}

const readers = [
  { name: "region ledger", run: recomputeRegionState },
  { name: "live snapshot", run: deriveRegionFreshnessLive },
];

describe.each(readers)("DC-SW9 narrow cardio reads: $name", ({ run }) => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it.each(["absent", "present"] as const)("selects only used fields with swim schema %s", async (availability) => {
    const mock = harness(availability);
    const result = await run(mock.client, "user-1", "UTC");
    expect(mock.capabilityCalls()).toBe(1);
    expect(mock.selections).toEqual([`${baseColumns}${availability === "present" ? ",swim_result" : ""}`]);
    const elbowAtl = result instanceof Map
      ? result.get("elbow_forearm")?.atl ?? 0
      : mock.writes[0]!.find((row) => row.region === "elbow_forearm")!.atl;
    if (availability === "present") expect(elbowAtl).toBeGreaterThan(0);
    else expect(elbowAtl).toBe(0);
  });

  it.each(["error", "invalid"] as const)("surfaces %s capability rather than silently reading generic data", async (availability) => {
    const mock = harness(availability);
    await expect(run(mock.client, "user-1", "UTC")).rejects.toThrow();
    expect(mock.selections).toEqual([]);
    expect(mock.writes).toEqual([]);
  });

  it("surfaces a cardio query failure without retrying a wider or generic projection", async () => {
    const mock = harness("present", { cardioError: true });
    await expect(run(mock.client, "user-1", "UTC")).rejects.toThrow("Cardio read failed");
    expect(mock.selections).toEqual([`${baseColumns},swim_result`]);
    expect(mock.writes).toEqual([]);
  });

  it("does not probe optional storage when there are no completed sessions to read", async () => {
    const mock = harness("error", { noSessions: true });
    await run(mock.client, "user-1", "UTC");
    expect(mock.capabilityCalls()).toBe(0);
    expect(mock.selections).toEqual([]);
  });
});
