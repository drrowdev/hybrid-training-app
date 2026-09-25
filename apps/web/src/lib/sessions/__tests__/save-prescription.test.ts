import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { savePrescription } from "../save-prescription";
import { prescriptionRevision } from "../prescription-revision";

describe("DC-K4 prescription optimistic edits", () => {
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
