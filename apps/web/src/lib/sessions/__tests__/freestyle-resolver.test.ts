/**
 * Page-level union resolver for the freestyle movement list.
 *
 * Covers the rule from the page query update:
 *   - Persisted (`session_movements`) rows come first, ordered by
 *     `sort_order` ascending.
 *   - Set-only rows (`set_logs.movement_id` distinct, restricted to
 *     non-prescribed movements) come after, ordered by the earliest
 *     `created_at` of their backing logs.
 *   - Prescribed movements are filtered out from both sides.
 *   - A movement that exists in BOTH halves only renders once
 *     (anchored by the persisted entry).
 */
import { describe, it, expect } from "vitest";
import {
  resolveFreestyleMovements,
  type PersistedFreestyle,
  type SetLogSlim,
} from "../freestyle-resolver";

const M = (id: string, name = `M${id}`) => ({
  id,
  slug: `m-${id}`,
  display_name: name,
  primary_region: "",
});

describe("resolveFreestyleMovements", () => {
  it("orders persisted-first by sort_order then set-only by first log time", () => {
    const persisted: PersistedFreestyle[] = [
      { movement: M("p2", "Persisted B"), sortOrder: 20, addedAt: "2026-05-01T10:10:00Z" },
      { movement: M("p1", "Persisted A"), sortOrder: 10, addedAt: "2026-05-01T10:00:00Z" },
    ];
    const sets: SetLogSlim[] = [
      // set-only movement logged 10:30
      { movement: M("s1", "Set Only A"), created_at: "2026-05-01T10:30:00Z" },
      // set-only movement logged earlier 10:20 → should come first
      // among the set-only block
      { movement: M("s2", "Set Only B"), created_at: "2026-05-01T10:20:00Z" },
      // also a set against p1 (the persisted one) — must NOT double up
      { movement: M("p1", "Persisted A"), created_at: "2026-05-01T10:25:00Z" },
    ];

    const out = resolveFreestyleMovements({
      persisted,
      sets,
      prescribedMovementIds: new Set(),
    });

    expect(out.map((r) => r.movement.id)).toEqual(["p1", "p2", "s2", "s1"]);
    // p1 has 1 logged set; p2 has none; s1/s2 have 1 each
    expect(out.find((r) => r.movement.id === "p1")?.loggedSetCount).toBe(1);
    expect(out.find((r) => r.movement.id === "p2")?.loggedSetCount).toBe(0);
    expect(out.find((r) => r.movement.id === "s2")?.loggedSetCount).toBe(1);
    // persisted entries carry sortOrder, set-only carry null
    expect(out.find((r) => r.movement.id === "p1")?.persisted).toBe(true);
    expect(out.find((r) => r.movement.id === "p1")?.sortOrder).toBe(10);
    expect(out.find((r) => r.movement.id === "s1")?.persisted).toBe(false);
    expect(out.find((r) => r.movement.id === "s1")?.sortOrder).toBeNull();
  });

  it("drops movements that are part of the prescription", () => {
    const persisted: PersistedFreestyle[] = [
      { movement: M("rx-1"), sortOrder: 10, addedAt: "2026-05-01T10:00:00Z" },
      { movement: M("free-1"), sortOrder: 20, addedAt: "2026-05-01T10:00:00Z" },
    ];
    const sets: SetLogSlim[] = [
      { movement: M("rx-2"), created_at: "2026-05-01T10:10:00Z" },
      { movement: M("free-2"), created_at: "2026-05-01T10:11:00Z" },
    ];

    const out = resolveFreestyleMovements({
      persisted,
      sets,
      prescribedMovementIds: new Set(["rx-1", "rx-2"]),
    });

    expect(out.map((r) => r.movement.id)).toEqual(["free-1", "free-2"]);
  });
});
