import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { commitReviewedProgram, programSchedulePreview, type ProgramReviewContext } from "../program-review";
import { commitTrainingSchedule } from "@/lib/schedule/storage";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/schedule/storage", async (original) => ({
  ...await original<typeof import("@/lib/schedule/storage")>(),
  commitTrainingSchedule: vi.fn(async () => ({ data: {}, error: null })),
}));

const client = createClient("https://example.invalid", "synthetic", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async () => { throw new Error("Unexpected network request"); } },
});
const context = (): ProgramReviewContext => ({
  previewOnly: false, input: { programId: "hybrid" }, active: [
    { id: "primary", notes: "Existing program", program_id: "hybrid", program_kind: "hybrid", started_on: "2026-09-22" },
  ],
  snapshot: { revision: "a".repeat(32), entries: [
    { id: "old", source: "primary", programId: "primary", date: "2026-09-22", title: "Old workout", state: "scheduled" },
    { id: "swim", source: "swim", programId: "swimming", date: "2026-09-22", title: "Swim", state: "scheduled" },
    { id: "rest", source: "primary", programId: "another", date: "2026-09-23", title: "Planned rest", state: "rest" },
  ] },
});
const rows = [
  { week_index: 0, day_index: 1, title: "Strength" },
  { week_index: 0, day_index: 2, title: "Conditioning" },
];
const typedArgs = { p_block: { program_kind: "hybrid" }, programKind: "hybrid" };

describe("DC-K4 template schedule review", () => {
  it("keeps exact dates, excludes only the replaced program and separates planned rest", () => {
    const preview = programSchedulePreview(context(), typedArgs, "2026-09-22", rows);
    expect(preview.dates).toEqual([
      { date: "2026-09-22", title: "Strength" }, { date: "2026-09-23", title: "Conditioning" },
    ]);
    expect(preview.overlaps.map((entry) => entry.id)).toEqual(["swim"]);
    expect(preview.plannedRest.map((entry) => entry.id)).toEqual(["rest"]);
    expect(preview.replaces).toEqual({ id: "primary", name: "Existing program" });
    expect(programSchedulePreview(context(), typedArgs, "2026-09-22", rows, "primary").replaces).toBeNull();
  });

  it("requires fresh review and explicit overlap/replacement independently of saved preferences", async () => {
    const flow = context(), args = { p_block: { program_kind: "hybrid", allows_two_a_days: true } };
    const preview = programSchedulePreview(flow, args, "2026-09-22", rows);
    await expect(commitReviewedProgram(client, flow, preview, "primary-create", args)).rejects.toThrow(/confirm/);
    flow.review = { previewId: preview.id, revision: preview.revision,
      requestId: "00000000-0000-4000-8000-000000000001", replaceBlockId: "primary", acceptOverlap: false };
    await expect(commitReviewedProgram(client, flow, preview, "primary-create", args)).rejects.toThrow(/overlapping/);
    flow.review.acceptOverlap = true;
    await expect(commitReviewedProgram(client, flow, preview, "primary-create", args)).resolves.toMatchObject({ error: null });
    expect(commitTrainingSchedule).toHaveBeenCalledWith(client, "primary-create", args, flow.review, flow.input);
    await expect(commitReviewedProgram(client, flow, { ...preview, id: "b".repeat(64) }, "primary-create", args)).rejects.toThrow(/changed/);
  });
  it("DC-SW7 leaves another type in the calendar rather than offering its replacement", () => {
    const flow = context();
    const preview = programSchedulePreview(flow, { p_block: { program_kind: "running" } }, "2026-09-22", rows);
    expect(preview.replaces).toBeNull();
    expect(preview.overlaps.map((entry) => entry.id)).toEqual(["old", "swim"]);
    expect(() => programSchedulePreview(flow, { programKind: "running" }, "2026-09-22", rows, "primary")).toThrow();
  });
  it("refuses typed activation over an unclassified older program without changing it", () => {
    const flow = context();
    flow.active[0]!.program_kind = null;
    expect(() => programSchedulePreview(flow, typedArgs, "2026-09-22", rows)).toThrow();
    expect(flow.active[0]!.program_kind).toBeNull();
  });
});
