import { describe, it, expect } from "vitest";
import {
  rankTopMovements,
  memberSincePhrase,
  shortRelative,
  type SetLogJoinRow,
} from "../queries";

const NOW = new Date("2026-05-10T12:00:00Z");

function row(
  movementId: string,
  slug: string,
  name: string,
  sessionId: string,
  performedAt: string,
): SetLogJoinRow {
  return {
    movement_id: movementId,
    sessions: { id: sessionId, performed_at: performedAt },
    movements: { id: movementId, slug, display_name: name },
  };
}

describe("rankTopMovements", () => {
  it("returns empty when input is empty", () => {
    expect(rankTopMovements([], 6)).toEqual([]);
  });

  it("counts distinct sessions per movement, not total sets", () => {
    // Squat: 3 sets across 2 sessions → count = 2.
    // Bench: 1 set across 1 session → count = 1.
    const rows: SetLogJoinRow[] = [
      row("sq", "squat", "Squat", "s1", "2026-05-09T10:00:00Z"),
      row("sq", "squat", "Squat", "s1", "2026-05-09T10:00:00Z"),
      row("sq", "squat", "Squat", "s2", "2026-05-07T10:00:00Z"),
      row("bp", "bench", "Bench Press", "s3", "2026-05-05T10:00:00Z"),
    ];
    const out = rankTopMovements(rows, 6);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      movementId: "sq",
      movementName: "Squat",
      movementSlug: "squat",
      sessionCount: 2,
      lastPerformedAt: "2026-05-09T10:00:00Z",
    });
    expect(out[1]!.movementId).toBe("bp");
    expect(out[1]!.sessionCount).toBe(1);
  });

  it("breaks ties on most-recent performedAt", () => {
    const rows: SetLogJoinRow[] = [
      row("a", "a", "A", "s1", "2026-05-01T10:00:00Z"),
      row("b", "b", "B", "s2", "2026-05-05T10:00:00Z"),
    ];
    const out = rankTopMovements(rows, 6);
    expect(out.map((r) => r.movementId)).toEqual(["b", "a"]);
  });

  it("clamps to `limit`", () => {
    const rows: SetLogJoinRow[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(
        row(`m${i}`, `m-${i}`, `Movement ${i}`, `s${i}`, `2026-05-0${i % 9}T10:00:00Z`),
      );
    }
    expect(rankTopMovements(rows, 6)).toHaveLength(6);
    expect(rankTopMovements(rows, 0)).toHaveLength(0);
  });

  it("skips rows missing the session or movement join", () => {
    const rows: SetLogJoinRow[] = [
      { movement_id: "x", sessions: null, movements: null },
      row("y", "y", "Y", "s1", "2026-05-01T10:00:00Z"),
    ];
    const out = rankTopMovements(rows, 6);
    expect(out).toHaveLength(1);
    expect(out[0]!.movementId).toBe("y");
  });

  it("accepts PostgREST array-shaped joins", () => {
    const rows: SetLogJoinRow[] = [
      {
        movement_id: "z",
        sessions: [{ id: "sz", performed_at: "2026-05-08T10:00:00Z" }],
        movements: [{ slug: "z", display_name: "Z" }],
      },
    ];
    const out = rankTopMovements(rows, 6);
    expect(out).toHaveLength(1);
    expect(out[0]!.movementName).toBe("Z");
  });
});

describe("memberSincePhrase", () => {
  it("renders today / days / weeks / months / years", () => {
    expect(memberSincePhrase(NOW.toISOString(), NOW)).toBe("Joined today");
    expect(memberSincePhrase("2026-05-07T12:00:00Z", NOW)).toBe(
      "Member since 3 days",
    );
    expect(memberSincePhrase("2026-04-20T12:00:00Z", NOW)).toBe(
      "Member since 3 weeks",
    );
    expect(memberSincePhrase("2026-01-10T12:00:00Z", NOW)).toBe(
      "Member since 4 months",
    );
    expect(memberSincePhrase("2024-05-10T12:00:00Z", NOW)).toBe(
      "Member since 2 years",
    );
  });

  it("falls back gracefully on bad input", () => {
    expect(memberSincePhrase("not-a-date", NOW)).toBe("Member");
  });
});

describe("shortRelative", () => {
  it("formats mins / hours / days / months / years", () => {
    expect(shortRelative(null, NOW)).toBe("");
    expect(shortRelative(NOW.toISOString(), NOW)).toBe("just now");
    expect(
      shortRelative(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW),
    ).toBe("5m ago");
    expect(
      shortRelative(
        new Date(NOW.getTime() - 3 * 60 * 60_000).toISOString(),
        NOW,
      ),
    ).toBe("3h ago");
    expect(
      shortRelative(
        new Date(NOW.getTime() - 4 * 86_400_000).toISOString(),
        NOW,
      ),
    ).toBe("4d ago");
    expect(
      shortRelative(
        new Date(NOW.getTime() - 60 * 86_400_000).toISOString(),
        NOW,
      ),
    ).toBe("2mo ago");
    expect(
      shortRelative(
        new Date(NOW.getTime() - 800 * 86_400_000).toISOString(),
        NOW,
      ),
    ).toBe("2y ago");
  });
});
