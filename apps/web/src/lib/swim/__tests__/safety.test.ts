import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { deriveLimitationsContext } from "@/lib/planner/limitations-context";
import { assertSwimSafety, swimLimitationConflicts } from "../safety";

describe("DC-SW9 shared swimming limitations", () => {
  it("blocks loaded regions and muscle-only restrictions without another injury system", () => {
    const context = deriveLimitationsContext([
      { region: "shoulder_scapular", kind: null, resolved_at: null },
      { region: null, kind: null, resolved_at: null, affected_muscles: ["biceps", "adductors"] },
      { region: "knee", kind: null, resolved_at: "2026-09-01" },
    ]);
    expect(swimLimitationConflicts(context, {
      regions: ["shoulder_scapular", "elbow_forearm", "knee"],
    })).toEqual({
      regions: ["shoulder_scapular", "elbow_forearm"],
      movementBlocked: false,
    });
  });

  it("does not block an unloaded region", () => {
    const context = deriveLimitationsContext([
      { region: "adductor_groin", kind: null, resolved_at: null },
    ]);
    expect(swimLimitationConflicts(context, {
      regions: ["shoulder_scapular", "elbow_forearm"],
    }).regions).toEqual([]);
  });

  it("honors explicit movement restrictions and the existing allow list", () => {
    const context = deriveLimitationsContext([{
      region: null, kind: null, resolved_at: null,
      affected_movement_ids: ["easy-swim", "interval-swim"],
      allowed_movement_ids: ["easy-swim"],
    }]);
    expect(swimLimitationConflicts(context, {
      regions: [], movementIds: ["easy-swim"],
    }).movementBlocked).toBe(false);
    expect(swimLimitationConflicts(context, {
      regions: [], movementIds: ["interval-swim"],
    }).movementBlocked).toBe(true);
  });

  it("an allowed movement bypasses muscle filtering but not an explicit region block", () => {
    const rows = [{
      region: null, kind: null, resolved_at: null,
      affected_muscles: ["biceps"],
      allowed_movement_ids: ["easy-swim"],
    }];
    const exposure = { regions: ["elbow_forearm"] as const, movementIds: ["easy-swim"] };
    expect(swimLimitationConflicts(deriveLimitationsContext(rows), exposure).regions).toEqual([]);
    expect(swimLimitationConflicts(deriveLimitationsContext([
      ...rows,
      { region: "elbow_forearm", kind: null, resolved_at: null },
    ]), exposure).regions).toEqual(["elbow_forearm"]);
  });

  it("does not extend one allowed swim to a different restricted swim", () => {
    const context = deriveLimitationsContext([{
      region: null, kind: null, resolved_at: null,
      affected_muscles: ["biceps"],
      allowed_movement_ids: ["easy-swim"],
    }]);
    expect(swimLimitationConflicts(context, {
      regions: ["elbow_forearm"],
      movementIds: ["easy-swim", "interval-swim"],
    }).regions).toEqual(["elbow_forearm"]);
  });

  it("fails closed if current limitations cannot be read", async () => {
    const client = createClient("https://swim.test", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async () => new Response(JSON.stringify({ message: "unavailable" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      },
    });
    await expect(assertSwimSafety(client, "user-1", {
      regions: ["shoulder_scapular"],
    })).rejects.toThrow();
  });
});
