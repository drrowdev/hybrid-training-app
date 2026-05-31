import { describe, expect, it } from "vitest";
import { filterAffectedMovements, matchesLimitationQuery } from "./utils";

describe("filterAffectedMovements", () => {
  const items = [
    { id: "1", displayName: "Barbell Curl", slug: "barbell-curl" },
    { id: "2", displayName: "Triceps Pushdown", slug: "triceps-pushdown" },
    { id: "3", displayName: "Hammer Curl", slug: "hammer-curl" },
  ];

  it("returns a copy of all items for an empty query", () => {
    const out = filterAffectedMovements(items, "");
    expect(out).toHaveLength(3);
    expect(out).not.toBe(items);
  });

  it("matches on display name (case-insensitive)", () => {
    const out = filterAffectedMovements(items, "curl");
    expect(out.map((m) => m.id)).toEqual(["1", "3"]);
  });

  it("matches on slug", () => {
    const out = filterAffectedMovements(items, "pushdown");
    expect(out.map((m) => m.id)).toEqual(["2"]);
  });

  it("returns nothing when no item matches", () => {
    expect(filterAffectedMovements(items, "squat")).toHaveLength(0);
  });
});

describe("matchesLimitationQuery", () => {
  const row = {
    kind: "Cubital tunnel",
    severity: "moderate",
    side: "left",
    notes: "tingling in the pinky after pressing",
    regionLabel: "Elbow / forearm",
    muscleLabels: ["Forearms", "Triceps"],
    movementNames: ["Barbell Curl"],
  };

  it("matches everything on an empty query", () => {
    expect(matchesLimitationQuery(row, "")).toBe(true);
    expect(matchesLimitationQuery(row, "   ")).toBe(true);
  });

  it("matches on kind, region, muscle, movement and notes", () => {
    expect(matchesLimitationQuery(row, "cubital")).toBe(true);
    expect(matchesLimitationQuery(row, "elbow")).toBe(true);
    expect(matchesLimitationQuery(row, "forearms")).toBe(true);
    expect(matchesLimitationQuery(row, "barbell")).toBe(true);
    expect(matchesLimitationQuery(row, "tingling")).toBe(true);
  });

  it("requires every whitespace-separated token to match", () => {
    expect(matchesLimitationQuery(row, "cubital left")).toBe(true);
    expect(matchesLimitationQuery(row, "cubital right")).toBe(false);
  });

  it("returns false when nothing matches", () => {
    expect(matchesLimitationQuery(row, "shoulder")).toBe(false);
  });

  it("tolerates missing optional fields", () => {
    expect(matchesLimitationQuery({ kind: "Knee pain" }, "knee")).toBe(true);
    expect(matchesLimitationQuery({}, "anything")).toBe(false);
  });
});
