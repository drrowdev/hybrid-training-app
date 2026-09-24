import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ from: vi.fn(), failedTable: "", active: true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mock.from }), getAuthUser: vi.fn() }));
vi.mock("../queries", async (original) => ({
  ...await original<typeof import("../queries")>(), getUserTimezone: async () => "UTC",
}));
import { createClient } from "@/lib/supabase/server";
import { getDeloadWeekPreview } from "../deload-week-preview";

const userId = "11111111-1111-4111-8111-111111111111";
const options = { timezone: "UTC", now: new Date("2026-09-14T12:00:00Z") };
beforeEach(() => {
  mock.failedTable = ""; mock.active = true;
  mock.from.mockReset().mockImplementation((table: string) => {
    const error = mock.failedTable === table ? { message: "Unavailable" } : null;
    const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), gte: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(), then: vi.fn() };
    for (const method of ["select", "eq", "is", "gte", "limit"] as const) query[method].mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({
      data: error ? null : table === "training_blocks" && mock.active
        ? { id: userId, started_on: "2026-09-14", weeks: 3, program_id: null } : null,
      error,
    });
    query.then.mockImplementation((resolve) => Promise.resolve({
      data: error ? null : [{ day_index: 1, slot: "single", title: "Strength", session_modality: "strength",
        prescription: { items: [{ kind: "main", movementId: userId, reps: 5, percentTm: 70 }] } }], error,
    }).then(resolve));
    return query;
  });
});

describe("DC-K4 recovery preview preserves failed-read semantics", () => {
  it("builds existing prescriptions and distinguishes a genuinely absent active program", async () => {
    const client = await createClient();
    expect(await getDeloadWeekPreview(client, userId, options)).toMatchObject({ afterWeek: 0, deloadWeekIndex: 1 });
    mock.active = false;
    expect(await getDeloadWeekPreview(client, userId, options)).toBeNull();
  });
  it.each(["training_blocks", "program_instances", "planned_sessions", "events"])("never treats a failed %s read as a safe default", async (table) => {
    mock.failedTable = table;
    await expect(getDeloadWeekPreview(await createClient(), userId, options)).rejects.toThrow();
  });
  it("reports an unreadable boundary recommendation instead of dropping it", async () => {
    mock.failedTable = "program_recommendations";
    await expect(getDeloadWeekPreview(await createClient(), userId, {
      ...options, boundaryKey: "peak-b1", recommendationId: userId,
    })).rejects.toThrow();
  });
});
