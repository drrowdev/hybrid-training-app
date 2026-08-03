import { describe, expect, it, vi } from "vitest";
import { buildPlatformContext } from "../context";

describe("buildPlatformContext", () => {
  it("combines user 1RMs with shared catalog movements for Activation", async () => {
    const from = vi.fn((table: string) => {
      if (table === "training_maxes") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  one_rm_kg: 80,
                  movement: {
                    id: "ohp-id",
                    slug: "ohp-standing",
                    display_name: "Overhead Press",
                  },
                },
                {
                  one_rm_kg: 100,
                  movement: {
                    id: "push-press-id",
                    slug: "push-press",
                    display_name: "Push Press",
                  },
                },
                {
                  one_rm_kg: 180,
                  movement: {
                    id: "trap-id",
                    slug: "trap-bar-deadlift",
                    display_name: "Trap Bar Deadlift",
                  },
                },
              ],
              error: null,
            }),
          }),
        };
      }
      return {
        select: () => ({
          is: () => ({
            in: async () => ({
              data: [
                { id: "push-up-id", slug: "push-up", display_name: "Push-Up" },
                {
                  id: "row-id",
                  slug: "bb-row-overhand",
                  display_name: "Barbell Row (overhand)",
                },
              ],
              error: null,
            }),
          }),
        }),
      };
    });

    const bundle = await buildPlatformContext({ from } as never, "user-1");

    expect(bundle.ctx.oneRepMaxes["push-press"]).toBe(100);
    expect(bundle.ctx.oneRepMaxes.press).toBe(80);
    expect(bundle.ctx.oneRepMaxes.deadlift).toBe(180);
    expect(bundle.resolveMovement("deadlift")).toMatchObject({
      movementId: "trap-id",
      displayName: "Trap Bar Deadlift",
    });
    expect(bundle.resolveMovement("pushup")).toMatchObject({
      movementId: "push-up-id",
      displayName: "Push-Up",
    });
    expect(bundle.resolveMovement("plyo-pushup")).toMatchObject({
      movementId: "push-up-id",
      displayName: "Plyometric Push-up",
    });
    expect(bundle.resolveMovement("barbell-row")).toMatchObject({
      movementId: "row-id",
      displayName: "Barbell Row",
    });
  });
});
