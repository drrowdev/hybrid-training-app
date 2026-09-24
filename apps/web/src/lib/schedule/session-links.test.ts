import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { TrainingCommitment } from "@hta/domain";
import { loadScheduleSessionLinks } from "./session-links";

const entry: TrainingCommitment = {
  id: "planned", programId: "program", title: "Workout", date: "2026-09-24",
  source: "primary", state: "completed",
};

describe("DC-R5 completed schedule destinations", () => {
  const client = (fetch: typeof globalThis.fetch) => createClient("https://synthetic.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
  });
  it.each(["completed", "started"] as const)("loads the linked session for %s work", async (state) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json([{ id: entry.id, completed_session_id: "logged" }]));
    expect(await loadScheduleSessionLinks(client(fetch), [{ ...entry, state }])).toEqual({ planned: "logged" });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("planned_sessions");
  });
  it("does not read session links for scheduled work or swimming", async () => {
    const fetch = vi.fn(async () => Response.json([]));
    expect(await loadScheduleSessionLinks(client(fetch), [
      { ...entry, state: "scheduled" }, { ...entry, source: "swim" },
    ])).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["missing", "error"] as const)("surfaces %s linkage instead of routing completed work to start", async (outcome) => {
    const fetch = async () => outcome === "missing" ? Response.json([]) :
      Response.json({ message: "Read failed" }, { status: 500 });
    await expect(loadScheduleSessionLinks(client(fetch), [entry])).rejects.toThrow();
  });
});
