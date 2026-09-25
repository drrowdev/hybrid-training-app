import { createClient } from "@supabase/supabase-js";
import { isDeepStrictEqual } from "node:util";
import type { Prescription } from "@hta/db";
import { describe, expect, it, vi } from "vitest";
import { applyPrescriptionUpdates } from "../remaining-sessions";

describe("DC-K4 derived prescription compare-and-set", () => {
  it.each([
    ["absent", '{"items":[{"movementId":"movement","kind":"accessory","sets":4,"reps":8}]}'],
    ["null", '{"items":[{"movementId":"movement","kind":"accessory","sets":4,"reps":8}],"meta":{"editRevision":null}}'],
  ])("rejects the second concurrent writer even when editRevision stays %s", async (_revision, json) => {
    const source: Prescription = JSON.parse(json);
    let stored = structuredClone(source);
    const writes: Prescription[] = [];
    const pending: Array<() => void> = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const query = new URL(String(input)).searchParams;
      expect(init?.method).toBe("PATCH");
      expect(Object.fromEntries(query)).toEqual({
        id: "eq.planned", user_id: "eq.owner", block_id: "eq.block",
        completed_session_id: "is.null", skipped_at: "is.null",
        prescription: `eq.${json}`,
      });
      await new Promise<void>((resolve) => {
        pending.push(resolve);
        if (pending.length >= 2) pending.forEach((release) => release());
      });
      const matches = isDeepStrictEqual(stored, JSON.parse(query.get("prescription")!.slice(3)));
      if (matches) {
        stored = JSON.parse(String(init?.body)).prescription;
        writes.push(structuredClone(stored));
      }
      return new Response(null, { status: 204, headers: { "content-range": `*/${matches ? 1 : 0}` } });
    });
    const clients = [0, 1].map(() => createClient("https://synthetic.invalid", "synthetic-key", { global: { fetch } }));
    const updates = [
      { id: "planned", expectedPrescription: structuredClone(source), prescription: { ...source, autoregVolumeScale: 0.8 } },
      { id: "planned", expectedPrescription: structuredClone(source), prescription: { ...source, items: [{ ...source.items[0]!, reps: 12 }] } },
    ];
    const results = await Promise.all(clients.map((client, index) =>
      applyPrescriptionUpdates(client, "owner", "block", [updates[index]!])));
    expect(results.map((result) => result.updated)).toEqual([1, 0]);
    expect(results[0]!.error).toBeUndefined();
    expect(results[1]!.error).toBeTruthy();
    expect(writes).toEqual([updates[0]!.prescription]);
    expect(stored).toEqual(updates[0]!.prescription);
    expect(stored.meta?.editRevision).toBe(source.meta?.editRevision);
    expect(updates.every((update) => isDeepStrictEqual(update.expectedPrescription, source))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    const retry = await applyPrescriptionUpdates(clients[1]!, "owner", "block", [updates[1]!]);
    expect(retry.updated).toBe(0);
    expect(retry.error).toBeTruthy();
    expect(writes).toEqual([updates[0]!.prescription]);
    expect(stored).toEqual(updates[0]!.prescription);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

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
