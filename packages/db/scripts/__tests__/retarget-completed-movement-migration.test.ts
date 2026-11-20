import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r\n", "\n");

describe("DC-K4: changing the movement of a finished workout (0169)", () => {
  const up = read("../../drizzle/0169_retarget_completed_movement.sql");
  const down = read("../../rollbacks/0169_retarget_completed_movement.down.sql");

  it("leaves the pinned prescription guard alone and restores completion inside the transaction", () => {
    expect(up).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.guard_program_prescription/);
    expect(up.indexOf("SET completed_at = NULL")).toBeGreaterThan(0);
    expect(up.indexOf("SET completed_at = finished")).toBeGreaterThan(up.indexOf("SET completed_at = NULL"));
  });

  it("is signed-in only, owner-scoped and refuses swimming and credited bodyweight progress", () => {
    expect(up).toContain("SECURITY INVOKER");
    expect(up).toContain("REVOKE ALL ON FUNCTION public.retarget_completed_movement(uuid, uuid, uuid) FROM PUBLIC, anon;");
    expect(up).toContain("GRANT EXECUTE ON FUNCTION public.retarget_completed_movement(uuid, uuid, uuid) TO authenticated;");
    expect(up).toContain("Use the swimming result editor");
    expect(up).toContain("Bodyweight progress was already credited");
    expect(up).toContain("pg_advisory_xact_lock(hashtextextended('program-deploy:'");
  });

  it("rolls back by dropping the function", () => {
    expect(down).toContain("DROP FUNCTION IF EXISTS public.retarget_completed_movement(uuid, uuid, uuid);");
  });
});
