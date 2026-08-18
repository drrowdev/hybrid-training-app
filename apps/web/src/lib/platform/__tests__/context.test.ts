import { describe, expect, it, vi } from "vitest";
import {
  buildPlatformContext,
  validateCustomMovementBindings,
} from "../context";

describe("buildPlatformContext", () => {
  it("uses authoritative catalog metadata and rejects stale custom ids", () => {
    expect(
      validateCustomMovementBindings(
        [
          {
            key: "catalog:movement-1",
            movementId: "movement-1",
            slug: "belt-squat",
            displayName: "Client supplied name",
          },
        ],
        [
          {
            id: "movement-1",
            slug: "belt-squat",
            displayName: "Belt Squat",
          },
        ],
      ),
    ).toEqual([
      {
        key: "catalog:movement-1",
        movementId: "movement-1",
        slug: "belt-squat",
        displayName: "Belt Squat",
      },
    ]);
    expect(() =>
      validateCustomMovementBindings(
        [
          {
            key: "catalog:missing",
            movementId: "missing",
            slug: "made-up",
            displayName: "Missing movement",
          },
        ],
        [],
      ),
    ).toThrow(/no longer available/i);
  });

  it("combines user 1RMs with shared catalog movements for Activation", async () => {
    const from = vi.fn((table: string) => {
      if (table === "profiles") {
        // warmup_scheme IS NULL — the lifter has never configured a ladder, so
        // no `warmupRamp` should reach the engines and each program keeps its
        // own published ramp.
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { warmup_scheme: null },
                error: null,
              }),
            }),
          }),
        };
      }
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

    const bundle = await buildPlatformContext(
      { from } as never,
      "user-1",
      {
        customMovements: [
          {
            key: "catalog:trap-id",
            movementId: "trap-id",
            slug: "trap-bar-deadlift",
            displayName: "Trap Bar Deadlift",
          },
          {
            key: "catalog:no-max",
            movementId: "no-max",
            slug: "belt-squat",
            displayName: "Belt Squat",
          },
        ],
      },
    );

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
    expect(bundle.resolveMovement("catalog:trap-id")).toMatchObject({
      movementId: "trap-id",
      displayName: "Trap Bar Deadlift",
    });
    expect(bundle.ctx.oneRepMaxes["catalog:trap-id"]).toBe(180);
    expect(bundle.resolveMovement("catalog:no-max")).toMatchObject({
      movementId: "no-max",
      displayName: "Belt Squat",
    });
    expect(bundle.ctx.oneRepMaxes["catalog:no-max"]).toBeUndefined();
  });

  it("keeps rack pull and block pull deadlift on separate anchors", async () => {
    // Regression: the two used to share one catalog row, so a Rack Pull 1RM was
    // stored against Block Pull Deadlift — a Deadlift-role candidate — and
    // silently re-anchored the lifter's Deadlift. Migration 0132 split them.
    const from = vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { warmup_scheme: null }, error: null }),
            }),
          }),
        };
      }
      if (table === "training_maxes") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  one_rm_kg: 200,
                  movement: {
                    id: "conventional-id",
                    slug: "conventional-deadlift",
                    display_name: "Conventional Deadlift",
                  },
                },
                {
                  one_rm_kg: 260,
                  movement: {
                    id: "rack-pull-id",
                    slug: "rack-pull",
                    display_name: "Rack Pull",
                  },
                },
                {
                  one_rm_kg: 230,
                  movement: {
                    id: "block-pull-id",
                    slug: "block-pull-deadlift",
                    display_name: "Block Pull Deadlift",
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
          is: () => ({ in: async () => ({ data: [], error: null }) }),
        }),
      };
    });

    const bundle = await buildPlatformContext({ from } as never, "user-1", {});

    expect(bundle.ctx.oneRepMaxes["rack-pull"]).toBe(260);
    expect(bundle.ctx.oneRepMaxes.deadlift).toBe(200);
    expect(bundle.resolveMovement("deadlift")).toMatchObject({
      movementId: "conventional-id",
      displayName: "Deadlift",
    });
    expect(bundle.resolveMovement("rack-pull")).toMatchObject({
      movementId: "rack-pull-id",
      displayName: "Rack Pull",
    });
  });
});
