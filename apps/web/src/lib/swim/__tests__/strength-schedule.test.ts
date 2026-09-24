import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSwimStrengthContext } from "../strength-schedule";
import { swimScheduleAdvice } from "@hta/domain";

function client(entries: object[], error: object | null = null) {
  const rpc = vi.fn(async () => ({ data: { revision: "a".repeat(32), entries }, error }));
  return { rpc, db: { rpc } as unknown as SupabaseClient };
}

describe("DC-K4/DC-SW7 shared materialized training calendar", () => {
  it("includes dated strength, cardio, rehab and one-off work, excludes swimming and keeps planned rest", async () => {
    const { db, rpc } = client([
      { id: "strength", source: "primary", programId: "p", date: "2026-09-07", title: "Strength", state: "scheduled" },
      { id: "cardio", source: "primary", programId: "p", date: "2026-09-09", title: "Running", state: "scheduled" },
      { id: "rehab", source: "primary", programId: "p", date: "2026-09-10", title: "Rehab", state: "scheduled" },
      { id: "one-off", source: "session", programId: null, date: "2026-09-11", title: "Workout", state: "started" },
      { id: "rest", source: "primary", programId: "p", date: "2026-09-12", title: "Planned rest", state: "rest" },
      { id: "swim", source: "swim", programId: "s", date: "2026-09-13", title: "Swimming", state: "scheduled" },
    ]);
    const context = await loadSwimStrengthContext(db, "owner");
    expect(context.sessions.map(({ id }) => id)).toEqual(["strength", "cardio", "rehab", "one-off", "rest"]);
    expect(context.revision).toBe("a".repeat(32));
    expect(swimScheduleAdvice(context, "2026-09-07", 1, [1, 3, 4, 5, 6]).conflicts.map((day) => day.label))
      .toEqual(["Monday", "Wednesday", "Thursday", "Friday"]);
    expect(rpc).toHaveBeenCalledWith("training_schedule_snapshot");
  });

  it("distinguishes an empty calendar from a failed or malformed snapshot", async () => {
    expect(await loadSwimStrengthContext(client([]).db, "owner")).toEqual({ blockId: null, revision: "a".repeat(32), sessions: [] });
    await expect(loadSwimStrengthContext(client([], { code: "error" }).db, "owner")).rejects.toThrow("Could not load");
    await expect(loadSwimStrengthContext(client([{ id: "invalid" }]).db, "owner")).rejects.toThrow("could not be read");
  });
});
