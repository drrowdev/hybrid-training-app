import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSwimStrengthContext } from "../strength-schedule";
import { swimScheduleAdvice } from "@hta/domain";

function client(block: object | null, rows: object[] = [], error: object | null = null) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: block, error })),
    range: vi.fn(async () => ({ data: rows, error })),
  };
  return { query, db: { from: vi.fn(() => query) } as unknown as SupabaseClient };
}
describe("DC-K4/DC-SW7 active materialized strength calendar", () => {
  it("converts Monday-based native and fixed/explicit foreign rows through dayDate", async () => {
    const { db, query } = client({ id: "primary", started_on: "2026-09-09" }, [
      { id: "native", week_index: 0, day_index: 0, role: "squat", prescription: { items: [{ kind: "main" }] } },
      { id: "fixed", week_index: 1, day_index: 6, role: "strength", prescription: { items: [] } },
      { id: "cardio", week_index: 0, day_index: 2, role: "cardio", prescription: { items: [{ kind: "cardio_z2" }] } },
    ]);
    const context = await loadSwimStrengthContext(db, "owner");
    expect(context.sessions).toEqual([{ id: "native", date: "2026-09-07" }, { id: "fixed", date: "2026-09-20" }]);
    expect(swimScheduleAdvice(context, "2026-09-07", 2, [0, 1]).conflicts.map((day) => day.label)).toEqual(["Monday", "Sunday"]);
    expect(query.eq).toHaveBeenCalledWith("user_id", "owner");
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
    expect(query.is).toHaveBeenCalledWith("skipped_at", null);
  });
  it("distinguishes blockless state from read failure", async () => {
    expect(await loadSwimStrengthContext(client(null).db, "owner")).toEqual({ blockId: null, sessions: [] });
    await expect(loadSwimStrengthContext(client(null, [], { code: "error" }).db, "owner")).rejects.toThrow("Could not check");
    const { db, query } = client({ id: "p", started_on: "2026-09-07" });
    query.range.mockResolvedValueOnce({ data: [], error: { code: "error" } });
    await expect(loadSwimStrengthContext(db, "owner")).rejects.toThrow("Could not check");
  });
});
