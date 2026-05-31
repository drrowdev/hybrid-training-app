import { describe, expect, it } from "vitest";
import { inferRegion, resolveRegion } from "./region";

/**
 * Pure region inference / resolution. The actions persist whatever
 * `resolveRegion` returns, so these lock down the "Auto / None /
 * explicit" contract and the legacy parity guarantee.
 */
describe("inferRegion", () => {
  it("maps the first matching muscle to its region", () => {
    expect(inferRegion(["forearms"])).toBe("elbow_forearm");
    expect(inferRegion(["quads"])).toBe("knee");
    expect(inferRegion(["calves"])).toBe("foot_ankle_calf");
  });

  it("picks the first mapped muscle when several are selected", () => {
    expect(inferRegion(["quads", "forearms"])).toBe("knee");
  });

  it("returns null when nothing maps", () => {
    expect(inferRegion([])).toBeNull();
    expect(inferRegion(["unknown_muscle"])).toBeNull();
  });
});

describe("resolveRegion", () => {
  it("infers from muscles when region is undefined (Auto / legacy parity)", () => {
    expect(resolveRegion(undefined, ["forearms"])).toBe("elbow_forearm");
    expect(resolveRegion(undefined, [])).toBeNull();
  });

  it("returns null when region is explicitly null (None)", () => {
    expect(resolveRegion(null, ["forearms"])).toBeNull();
  });

  it("uses an explicit region verbatim, ignoring the muscles", () => {
    expect(resolveRegion("shoulder_scapular", ["quads"])).toBe(
      "shoulder_scapular",
    );
  });
});
