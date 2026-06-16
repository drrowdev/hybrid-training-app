import { describe, it, expect } from "vitest";
import {
  assembleQuickHyroxItems,
  buildQuickHyroxView,
  feasibleFormats,
  type HyroxQuickStation,
} from "../quick-hyrox";
import { pickFormat } from "../quick-hyrox-resolve";
import type { HyroxQuickFormat } from "../quick-hyrox";

const S = (...s: HyroxQuickStation[]) => new Set<HyroxQuickStation>(s);

describe("feasibleFormats", () => {
  it("erg needs a ski erg or rower", () => {
    expect(feasibleFormats(S("ski_erg"))).toContain("erg");
    expect(feasibleFormats(S("rower"))).toContain("erg");
    expect(feasibleFormats(S("sled", "sandbag"))).not.toContain("erg");
  });

  it("run needs run selected", () => {
    expect(feasibleFormats(S("run"))).toContain("run");
    expect(feasibleFormats(S("sled", "wall_ball"))).not.toContain("run");
  });

  it("circuit needs at least two stations (ergs count as stations)", () => {
    expect(feasibleFormats(S("sled", "wall_ball"))).toContain("circuit");
    expect(feasibleFormats(S("ski_erg", "rower"))).toContain("circuit");
    expect(feasibleFormats(S("sled"))).not.toContain("circuit");
    expect(feasibleFormats(S("run", "sled"))).not.toContain("circuit"); // only 1 station
  });

  it("compromised needs run AND at least one station", () => {
    expect(feasibleFormats(S("run", "sled"))).toContain("compromised");
    expect(feasibleFormats(S("run"))).not.toContain("compromised");
    expect(feasibleFormats(S("sled", "wall_ball"))).not.toContain("compromised");
  });

  it("empty selection is infeasible", () => {
    expect(feasibleFormats(S())).toEqual([]);
  });
});

describe("assembleQuickHyroxItems", () => {
  const base = { length: "normal" as const, experience: "intermediate" as const, division: "open" as const };

  it("circuit lists the selected stations in race order with loads, as one cardio item", () => {
    const items = assembleQuickHyroxItems({ ...base, format: "circuit", stations: S("wall_ball", "sled", "rower") });
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("cardio_threshold");
    expect(items[0]!.movementId).toBe("");
    expect(items[0]!.durationMin).toBe(60);
    // race order: row (5) → sled (2,3) → wall ball (8) → reordered by HYROX order: sled before row before wall ball
    expect(items[0]!.notes).toMatch(/rounds:/);
    expect(items[0]!.notes).toMatch(/sled/i);
    expect(items[0]!.notes).toMatch(/wall ball/i);
    expect(items[0]!.notes).toMatch(/Loads —/);
  });

  it("short circuit caps at 30 min with fewer rounds than normal", () => {
    const short = assembleQuickHyroxItems({ ...base, length: "short", format: "circuit", stations: S("sled", "wall_ball") });
    const normal = assembleQuickHyroxItems({ ...base, length: "normal", format: "circuit", stations: S("sled", "wall_ball") });
    expect(short[0]!.durationMin).toBe(30);
    const shortRounds = Number(short[0]!.notes!.match(/^(\d+) rounds/)![1]);
    const normalRounds = Number(normal[0]!.notes!.match(/^(\d+) rounds/)![1]);
    expect(shortRounds).toBeLessThan(normalRounds);
  });

  it("compromised describes run → station → run rounds", () => {
    const items = assembleQuickHyroxItems({ ...base, format: "compromised", stations: S("run", "sled") });
    expect(items[0]!.movementName).toBe("HYROX · Compromised Run");
    expect(items[0]!.notes).toMatch(/run →/i);
    expect(items[0]!.notes).toMatch(/sled/i);
  });

  it("erg is a steady Zone 2 block sized under the cap", () => {
    const items = assembleQuickHyroxItems({ ...base, format: "erg", stations: S("ski_erg") });
    expect(items[0]!.notes).toMatch(/SkiErg/);
    expect(items[0]!.notes).toMatch(/Zone 2/);
    expect(items[0]!.durationMin).toBe(60);
  });

  it("pro division surfaces the heavier station loads", () => {
    const open = assembleQuickHyroxItems({ ...base, division: "open", format: "circuit", stations: S("sled", "wall_ball") });
    const pro = assembleQuickHyroxItems({ ...base, division: "pro", format: "circuit", stations: S("sled", "wall_ball") });
    expect(open[0]!.notes).toMatch(/Open:/);
    expect(pro[0]!.notes).toMatch(/Pro:/);
  });
});

describe("buildQuickHyroxView", () => {
  const base = { length: "normal" as const, experience: "intermediate" as const, division: "open" as const };

  it("circuit view lists each selected station + loaded-station confirm rows", () => {
    const v = buildQuickHyroxView({ ...base, format: "circuit", stations: S("sled", "wall_ball", "rower") });
    expect(v.title).toBe("HYROX · Station Circuit");
    expect(v.divisionLabel).toBe("Open division");
    expect(v.structure[0]!.name).toMatch(/rounds/);
    const names = v.structure.map((r) => r.name);
    expect(names).toContain("Sled Push");
    expect(names).toContain("Wall Balls");
    expect(names).toContain("Row");
    const loadedKeys = v.loadedStations.map((s) => s.key);
    expect(loadedKeys).toContain("sled-push");
    expect(loadedKeys).toContain("wall-ball");
    expect(loadedKeys).not.toContain("rowing-erg"); // erg carries no division load
    expect(v.loadedStations.find((s) => s.key === "wall-ball")!.defaultKg).toBe(6); // Open men
  });

  it("compromised view is run → station → run with the station's load to confirm", () => {
    const v = buildQuickHyroxView({ ...base, format: "compromised", stations: S("run", "sandbag") });
    expect(v.title).toBe("HYROX · Compromised Run");
    expect(v.structure.filter((r) => r.name === "Run")).toHaveLength(2);
    expect(v.structure.some((r) => r.name === "Sandbag Lunges")).toBe(true);
    expect(v.loadedStations.map((s) => s.key)).toEqual(["sandbag-lunge"]);
  });

  it("compromised rotates through all selected FUNCTIONAL stations, excluding ergs", () => {
    const v = buildQuickHyroxView({
      ...base,
      format: "compromised",
      stations: S("run", "ski_erg", "sled", "sandbag", "wall_ball"),
    });
    const names = v.structure.map((r) => r.name);
    expect(names).toContain("Sled Push");
    expect(names).toContain("Sandbag Lunges");
    expect(names).toContain("Wall Balls");
    // the ski erg is aerobic, not a compromised-run station
    expect(names).not.toContain("SkiErg");
    expect(v.loadedStations.map((s) => s.key)).toEqual(
      expect.arrayContaining(["sled-push", "sandbag-lunge", "wall-ball"]),
    );
  });

  it("erg view has no loaded stations", () => {
    const v = buildQuickHyroxView({ ...base, format: "erg", stations: S("ski_erg") });
    expect(v.loadedStations).toEqual([]);
    expect(v.structure[0]!.amount).toBe("60 min");
  });

  it("pro division raises the confirm-weight default", () => {
    const open = buildQuickHyroxView({ ...base, division: "open", format: "circuit", stations: S("sled", "wall_ball") });
    const pro = buildQuickHyroxView({ ...base, division: "pro", format: "circuit", stations: S("sled", "wall_ball") });
    const openWb = open.loadedStations.find((s) => s.key === "wall-ball")!.defaultKg;
    const proWb = pro.loadedStations.find((s) => s.key === "wall-ball")!.defaultKg;
    expect(proWb).toBeGreaterThan(openWb);
  });
});

describe("pickFormat — overdue-relative-to-cadence", () => {
  const never: Record<HyroxQuickFormat, number> = { compromised: Infinity, circuit: Infinity, erg: Infinity, run: Infinity };

  it("prefers a never-done feasible format", () => {
    expect(pickFormat(["circuit", "erg"], never)).toBe("circuit"); // tie on Infinity → priority circuit > erg
  });

  it("a compromised run that's overdue (>cadence) beats a recently-done circuit", () => {
    // compromised last done 9 days ago (target 7 → ratio 1.29); circuit done 1 day ago (ratio 0.14).
    const days = { ...never, compromised: 9, circuit: 1 };
    expect(pickFormat(["compromised", "circuit"], days)).toBe("compromised");
  });

  it("a fresh compromised (done yesterday) yields to a more-overdue circuit", () => {
    const days = { ...never, compromised: 1, circuit: 8 };
    expect(pickFormat(["compromised", "circuit"], days)).toBe("circuit");
  });

  it("ergs (shorter cadence) only win when the signature sessions aren't due", () => {
    // erg 5 days (target 4 → 1.25) vs circuit 6 days (target 7 → 0.86): erg more overdue.
    const days = { ...never, erg: 5, circuit: 6 };
    expect(pickFormat(["erg", "circuit"], days)).toBe("erg");
  });

  it("returns null for no feasible formats", () => {
    expect(pickFormat([], never)).toBeNull();
  });
});
