import { createClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { describe, expect, it, vi } from "vitest";
import { applyPrescriptionUpdates } from "../remaining-sessions";

describe("DC-K4 derived prescription compare-and-set", () => {
  it.each([null, "deleted-unfinished-session"])("compares the full source alongside the existing guards (link %s)", async (link) => {
    const source: Prescription = {
      items: [{ movementId: "movement", kind: "accessory", sets: 4, reps: 8 }],
      meta: { editRevision: crypto.randomUUID() },
    };
    const next = { ...source, autoregVolumeScale: 0.8 };
    const fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 204, headers: { "content-range": "*/1" },
    }));
    const client = createClient("https://synthetic.invalid", "synthetic-key", { global: { fetch } });
    expect(await applyPrescriptionUpdates(client, "owner", "block", [{
      id: "planned", prescription: next, expectedPrescription: source, expectedCompletedSessionId: link,
    }])).toEqual({ updated: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual({
      id: "eq.planned", user_id: "eq.owner", block_id: "eq.block",
      completed_session_id: link ? `eq.${link}` : "is.null",
      skipped_at: "is.null", prescription: `eq.${JSON.stringify(source)}`,
    });
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ prescription: next });
  });

  it("rejects zero-row writes explicitly and does not attempt later updates", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 204, headers: { "content-range": "*/0" },
    }));
    const client = createClient("https://synthetic.invalid", "synthetic-key", { global: { fetch } });
    const update = { prescription: { items: [], autoregVolumeScale: 0.8 }, expectedPrescription: { items: [] } };
    const result = await applyPrescriptionUpdates(client, "owner", "block", [
      { id: "first", ...update }, { id: "second", ...update },
    ]);
    expect(result.updated).toBe(0);
    expect(result.error).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
