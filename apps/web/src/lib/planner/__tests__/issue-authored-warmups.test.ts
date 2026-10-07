import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prescription } from "@hta/db";
import { createClient } from "@/lib/supabase/server";
import { savePrescription } from "@/lib/sessions/save-prescription";
import { issueAuthoredWarmups } from "../issue-authored-warmups";

const state = vi.hoisted(() => ({ readError: false, from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: state.from }),
}));
vi.mock("@/lib/sessions/save-prescription", () => ({ savePrescription: vi.fn() }));
const source: Prescription = { items: [{
  movementId: "bench", movementSlug: "bench-press-flat", kind: "main", sets: 1, reps: 5, percentTm: 75,
  meta: { authoredPartId: "bench", authoredMovementId: "bench",
    programLoadBasis: { version: 1, kind: "one-rm", percent: 100, roundingKg: null } },
}] };

beforeEach(() => {
  vi.clearAllMocks();
  state.readError = false;
  state.from.mockImplementation((table: string) => {
    const data = table === "profiles" ? { bodyweight_kg: 87, warmup_scheme: null }
      : table === "movements" ? [{ id: "bench", slug: "bench-press-flat", equipment: "barbell" }]
        : [{ movement_id: "bench", one_rm_kg: 100, tm_percent: 90 }];
    const result = { data, error: state.readError ? { message: "fixture failure" } : null };
    const chain = {
      select: () => chain, eq: () => chain,
      in: async () => result, maybeSingle: async () => result,
    };
    return chain;
  });
  vi.mocked(savePrescription).mockImplementation(async (_client, _table, _id, _revision, prescription) =>
    ({ ok: true, prescription: { ...prescription, meta: { ...prescription.meta, editRevision: "confirmed-revision" } } }));
});

describe("DC-R6 unstarted authored issuance boundary", () => {
  it("upgrades existing saved items through the guarded revision save before session issuance", async () => {
    const client = await createClient();
    const planned = { id: "planned", prescription: source, completed_session_id: null };
    await issueAuthoredWarmups(client, "owner", planned);
    expect(savePrescription).toHaveBeenCalledWith(client, "planned_sessions", "planned", "0",
      expect.objectContaining({ items: expect.any(Array) }), true);
    expect(planned.prescription.items).toHaveLength(4);
    expect(planned.prescription.meta?.editRevision).toBe("confirmed-revision");
    expect(source.items).toHaveLength(1);
  });
  it("does not insert or reindex anything under in-progress or completed session links", async () => {
    const client = await createClient();
    for (const id of ["in-progress", "completed", "cancelled"]) {
      const planned = { id: "planned", prescription: source, completed_session_id: id };
      await issueAuthoredWarmups(client, "owner", planned);
      expect(planned.prescription).toBe(source);
    }
    expect(state.from).not.toHaveBeenCalled();
    expect(savePrescription).not.toHaveBeenCalled();
  });
  it("stops on a concurrent edit/start rather than shifting the winner's item indices", async () => {
    vi.mocked(savePrescription).mockResolvedValue({ error: "Workout changed" });
    const planned = { id: "planned", prescription: source, completed_session_id: null };
    await expect(issueAuthoredWarmups(await createClient(), "owner", planned)).rejects.toThrow("Workout changed");
    expect(planned.prescription).toBe(source);
  });
  it("fails before writes when account/catalog/max reads fail", async () => {
    state.readError = true;
    await expect(issueAuthoredWarmups(await createClient(), "owner", {
      id: "planned", prescription: source, completed_session_id: null,
    })).rejects.toThrow("Could not prepare");
    expect(savePrescription).not.toHaveBeenCalled();
  });
});
