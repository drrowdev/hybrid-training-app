/**
 * Unit tests for getAffectedMovements — the helper backing the
 * "Engine will block" preview inside AddLimitationModal.
 *
 * Mocks Supabase at the chainable-builder layer so the assertions
 * exercise the filtering + sort logic without hitting the DB.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAffectedMovements } from "./affected-movements";

type MovementRow = {
  id: string;
  slug: string;
  display_name: string;
  primary_region: string | null;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
  user_id: string | null;
};

function mockClient(rows: MovementRow[]): SupabaseClient {
  const builder = {
    or: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(builder),
    }),
  } as unknown as SupabaseClient;
}

const SAMPLE: MovementRow[] = [
  {
    id: "m1",
    slug: "back-squat",
    display_name: "Back Squat",
    primary_region: "knee",
    primary_muscles: ["quads", "glutes"],
    secondary_muscles: ["adductors", "erectors"],
    user_id: null,
  },
  {
    id: "m2",
    slug: "adductor-machine",
    display_name: "Adductor Machine",
    primary_region: "adductor_groin",
    primary_muscles: ["adductors"],
    secondary_muscles: [],
    user_id: null,
  },
  {
    id: "m3",
    slug: "calf-raise",
    display_name: "Calf Raise",
    primary_region: "foot_ankle_calf",
    primary_muscles: ["calves"],
    secondary_muscles: [],
    user_id: null,
  },
];

describe("getAffectedMovements", () => {
  it("returns nothing when nothing is selected", async () => {
    const r = await getAffectedMovements(mockClient(SAMPLE), "u", [], null);
    expect(r).toEqual([]);
  });

  it("flags a movement with adductors as secondary when adductors is blocked", async () => {
    const r = await getAffectedMovements(
      mockClient(SAMPLE),
      "u",
      ["adductors"],
      null,
    );
    expect(r.map((m) => m.slug)).toEqual(
      expect.arrayContaining(["back-squat", "adductor-machine"]),
    );
    const back = r.find((m) => m.slug === "back-squat");
    expect(back?.affectedAs).toBe("secondary");
    const adductor = r.find((m) => m.slug === "adductor-machine");
    expect(adductor?.affectedAs).toBe("primary");
  });

  it("sorts primary movements first, then alphabetically", async () => {
    const r = await getAffectedMovements(
      mockClient(SAMPLE),
      "u",
      ["adductors", "calves"],
      null,
    );
    // Two primaries (adductor-machine, calf-raise) come before the
    // single secondary (back-squat), and primaries are alphabetised.
    expect(r.map((m) => m.slug)).toEqual([
      "adductor-machine",
      "calf-raise",
      "back-squat",
    ]);
    expect(r[0]?.affectedAs).toBe("primary");
    expect(r[r.length - 1]?.affectedAs).toBe("secondary");
  });

  it("also includes region-matched rows when affectedRegion is set", async () => {
    const r = await getAffectedMovements(
      mockClient(SAMPLE),
      "u",
      [],
      "foot_ankle_calf",
    );
    expect(r.map((m) => m.slug)).toContain("calf-raise");
  });
});
