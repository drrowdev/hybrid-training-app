/**
 * Per-session HYROX station swap (ADR 0064) — curated alternatives + override application.
 */
import { describe, it, expect } from "vitest";
import {
  STATION_ALTERNATIVES,
  stationAlternativesFor,
  findStationAlternative,
  isOverrideLoaded,
  overriddenStationName,
  applyOverridesToStationRows,
} from "./station-alternatives";
import { stationBlockPlanParts, stationBlocksForWeek } from "./prescription";

describe("HYROX station alternatives (ADR 0064)", () => {
  it("defines curated substitutes for every focused station", () => {
    for (const key of [
      "skierg",
      "rowing-erg",
      "sled-push",
      "sled-pull",
      "wall-ball",
      "sandbag-lunge",
      "farmers-carry",
      "burpee-broad-jump",
    ]) {
      expect(stationAlternativesFor(key).length).toBeGreaterThan(0);
    }
    // Ergs are interchangeable.
    expect(stationAlternativesFor("skierg").some((a) => a.key === "rowing-erg")).toBe(true);
    // Sled substitutes are flagged approximate (no clean gym equivalent).
    expect(STATION_ALTERNATIVES["sled-push"]!.every((a) => a.approximate)).toBe(true);
  });

  it("findStationAlternative only resolves a station's own curated options", () => {
    expect(findStationAlternative("skierg", "bike-erg")?.name).toBe("Bike erg");
    expect(findStationAlternative("skierg", "db-walking-lunge")).toBeUndefined(); // not an erg option
  });

  it("isOverrideLoaded reflects original vs substitute load", () => {
    expect(isOverrideLoaded("sandbag-lunge")).toBe(true); // loaded station, no override
    expect(isOverrideLoaded("skierg")).toBe(false); // unloaded erg, no override
    expect(isOverrideLoaded("sandbag-lunge", { "sandbag-lunge": "db-walking-lunge" })).toBe(true);
    expect(isOverrideLoaded("sled-pull", { "sled-pull": "ring-row" })).toBe(false); // unloaded sub
  });

  it("overriddenStationName relabels swapped stations", () => {
    expect(overriddenStationName("skierg")).toBe("SkiErg");
    expect(overriddenStationName("skierg", { skierg: "bike-erg" })).toBe("Bike erg");
  });

  it("applyOverridesToStationRows relabels + drops load for unloaded subs", () => {
    const rows = [
      { name: "SkiErg", target: "250 m", key: "skierg" },
      { name: "Sandbag Lunges", load: "20 kg", target: "25 m", key: "sandbag-lunge" },
    ];
    const out = applyOverridesToStationRows(rows, {
      skierg: "bike-erg",
      "sandbag-lunge": "db-walking-lunge",
    });
    const ski = out.find((r) => r.key === "skierg")!;
    expect(ski.name).toBe("Bike erg");
    const lunge = out.find((r) => r.key === "sandbag-lunge")!;
    expect(lunge.name).toBe("DB/KB walking lunge");
    expect(lunge.load).toBe("20 kg"); // loaded sub keeps the load
    // Unloaded sub (ring row) drops the load.
    const out2 = applyOverridesToStationRows(
      [{ name: "Sled Pull", load: "103 kg", target: "12.5 m", key: "sled-pull" }],
      { "sled-pull": "ring-row" },
    );
    expect(out2[0]!.load).toBeUndefined();
  });

  it("stationBlockPlanParts applies overrides to segments + stations", () => {
    const blocks = stationBlocksForWeek("station-intervals", 1, []); // sled power + erg/wall-ball
    const overrides = { skierg: "bike-erg", "rowing-erg": "bike-erg" };
    const { segments, stations } = stationBlockPlanParts(blocks, "open", "male", overrides);
    // Row → Bike erg in the rotation text + station rows.
    const rowStation = stations.find((s) => s.key === "rowing-erg");
    expect(rowStation?.name).toBe("Bike erg");
    expect(segments.some((s) => s.detail.includes("Bike erg"))).toBe(true);
    // Unchanged stations keep their names + the original key is preserved.
    const sled = stations.find((s) => s.key === "sled-push");
    expect(sled?.name).toBe("Sled Push");
  });
});
