import { describe, expect, it, vi } from "vitest";
import { getLastSetsForMovements } from "../queries";

describe("getLastSetsForMovements", () => {
  it("uses one RPC and converts numeric columns", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            movement_id: "squat",
            weight_kg: "150.00",
            reps: 5,
            rpe: "8.0",
            performed_at: "2026-08-01T12:00:00Z",
          },
          {
            movement_id: "bench",
            weight_kg: 100,
            reps: 3,
            rpe: null,
            performed_at: "2026-07-31T12:00:00Z",
          },
        ],
        error: null,
      }),
    };

    const result = await getLastSetsForMovements(
      client as never,
      "user-1",
      ["squat", "bench"],
      { excludeSessionId: "session-1" },
    );

    expect(client.rpc).toHaveBeenCalledOnce();
    expect(client.rpc).toHaveBeenCalledWith("last_sets_for_movements", {
      p_movement_ids: ["squat", "bench"],
      p_user_id: "user-1",
      p_exclude_session_id: "session-1",
    });
    expect(result.squat).toEqual({
      movementId: "squat",
      weightKg: 150,
      reps: 5,
      rpe: 8,
      performedAt: "2026-08-01T12:00:00Z",
    });
    expect(result.bench?.rpe).toBeNull();
  });

  it("does not call the RPC for an empty movement list", async () => {
    const client = { rpc: vi.fn() };
    await expect(
      getLastSetsForMovements(client as never, "user-1", []),
    ).resolves.toEqual({});
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
