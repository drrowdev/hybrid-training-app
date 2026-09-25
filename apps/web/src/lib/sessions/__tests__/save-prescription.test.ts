import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { savePrescription } from "../save-prescription";
import { prescriptionRevision } from "../prescription-revision";
import { RPC_SAVE_RETRY_MESSAGE } from "@/lib/supabase/rpc-errors";

describe("DC-K4 prescription optimistic edits", () => {
  it.each(["PGRST202", "42883"])("keeps the draft and revision available for retry when the named RPC is absent (%s)", async (code) => {
    const fetch = vi.fn().mockImplementation(async () => Response.json({
      code, message: "Could not find the function public.save_prescription_if_current",
    }, { status: 404 }));
    const client = createClient("https://synthetic.invalid", "synthetic-key", { global: { fetch } });
    const draft = { items: [{ movementId: crypto.randomUUID(), kind: "main" as const, reps: 8 }], userEdited: true };
    const original = structuredClone(draft);
    const id = crypto.randomUUID();
    const revision = crypto.randomUUID();
    const save = () => savePrescription(client, "planned_sessions", id, revision, draft, true);
    expect(await save()).toEqual({ error: RPC_SAVE_RETRY_MESSAGE });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(draft).toEqual(original);
    expect(await save()).toEqual({ error: RPC_SAVE_RETRY_MESSAGE });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [first, retry] = fetch.mock.calls;
    expect(first![0]).toBe(retry![0]);
    expect(first![1].body).toBe(retry![1].body);
    expect(JSON.parse(first![1].body)).toEqual({
      p_target: "planned_sessions", p_id: id, p_expected_revision: revision,
      p_prescription: original, p_require_unstarted: true,
    });
  });

  it.each([
    { code: "PGRST202", message: "Could not find the function unrelated_function" },
    { code: "42883", message: "function unrelated_function does not exist" },
    { code: "42501", message: "save_prescription_if_current denied" },
  ])("preserves other errors ($code: $message)", async (error) => {
    const fetch = vi.fn().mockResolvedValue(Response.json(error, { status: 400 }));
    const client = createClient("https://synthetic.invalid", "synthetic-key", { global: { fetch } });
    expect(await savePrescription(client, "sessions", crypto.randomUUID(), "0", { items: [] }))
      .toEqual({ error: error.message });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects missing revisions without sending any write", async () => {
    const fetch = vi.fn();
    const client = createClient("https://synthetic.invalid", "synthetic-key", { global: { fetch } });
    expect((await savePrescription(client, "sessions", crypto.randomUUID(), null, { items: [] })).error).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the current prescription separately without mutating the user's draft or retrying", async () => {
    const current = { items: [], meta: { editRevision: crypto.randomUUID() } };
    const fetch = vi.fn().mockResolvedValue(Response.json({ conflict: true, prescription: current }));
    const client = createClient("https://synthetic.invalid", "synthetic-key", { global: { fetch } });
    const draft = { items: [], userEdited: true };
    const result = await savePrescription(client, "planned_sessions", crypto.randomUUID(), "0", draft);
    expect(result.ok).toBeUndefined();
    expect(result.error).toBeTruthy();
    expect(result.currentPrescription).toEqual(current);
    expect(draft).toEqual({ items: [], userEdited: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetch.mock.calls[0]![1].body));
    expect(request).toMatchObject({ p_expected_revision: "0", p_prescription: draft });
    expect(prescriptionRevision(current)).toBe(current.meta.editRevision);
  });
});
