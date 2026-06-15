/**
 * HYROX completion materialization (ADR 0050 step 7) — pure core tests.
 */
import { describe, it, expect } from "vitest";
import { HYROX_SESSIONS, getHyroxSession } from "@hta/hyrox";
import { CARDIO_MODALITY_MAP } from "@/lib/muscle/movement-muscle-map";
import {
  buildHyroxActuals,
  buildHyroxActualsById,
  loadedStationsForSession,
  sessionCardioModality,
} from "../materialize-actuals";

const baseInput = {
  totalDurationSec: 38 * 60,
  sessionRpe: 8,
  confirmedWeightsKg: {
    "sled-push": 152,
    "sled-pull": 110,
    "sandbag-lunge": 20,
    "wall-ball": 6,
    "farmers-carry": 24,
  },
};

const nonStrength = HYROX_SESSIONS.filter((s) => s.category !== "strength");

describe("HYROX actuals — cardio log", () => {
  it("emits exactly one cardio log per non-strength session with duration + rpe", () => {
    for (const s of nonStrength) {
      const { cardioLogs } = buildHyroxActuals(s, baseInput);
      expect(cardioLogs).toHaveLength(1);
      expect(cardioLogs[0]!.durationSec).toBe(38 * 60);
      expect(cardioLogs[0]!.rpe).toBe(8);
      expect(cardioLogs[0]!.blockIndex).toBe(0);
    }
  });

  it("uses a real CARDIO_MODALITY_MAP key for every mapped session (fanout fires)", () => {
    for (const s of nonStrength) {
      const modality = sessionCardioModality(s.id);
      expect(CARDIO_MODALITY_MAP[modality], `modality '${modality}' for ${s.id}`).toBeDefined();
    }
  });

  it("maps runs / ergs to their specific modality", () => {
    expect(sessionCardioModality("easy-run")).toBe("easy_run");
    expect(sessionCardioModality("long-run")).toBe("long_run");
    expect(sessionCardioModality("easy-ski")).toBe("ski_erg");
    expect(sessionCardioModality("easy-row")).toBe("row");
    expect(sessionCardioModality("vo2-intervals")).toBe("interval_run");
  });

  it("carries HR data when supplied (Strava import path)", () => {
    const { cardioLogs } = buildHyroxActualsById("sim-half", {
      ...baseInput,
      avgHrBpm: 168,
      hrZones: { z4: 900, z5: 1380 },
    });
    expect(cardioLogs[0]!.avgHrBpm).toBe(168);
    expect(cardioLogs[0]!.hrZones).toEqual({ z4: 900, z5: 1380 });
  });
});

describe("HYROX actuals — loaded station set logs", () => {
  it("materializes a set log per loaded station with prescribed reps/distance + confirmed weight", () => {
    const { setLogs } = buildHyroxActualsById("compromised-run", baseInput);
    const bySlug = Object.fromEntries(setLogs.map((s) => [s.slug, s]));
    // compromised-run movements: run, sled-push, wall-ball, sandbag-lunge
    expect(bySlug["sled-push-heavy"]).toMatchObject({ distanceM: 50, weightKg: 152 });
    expect(bySlug["wall-ball"]).toMatchObject({ reps: 100, weightKg: 6 });
    expect(bySlug["sandbag-lunge"]).toMatchObject({ distanceM: 100, weightKg: 20 });
    expect(setLogs.every((s) => s.rpe === 8 && s.setKind === "accessory")).toBe(true);
  });

  it("has unique contiguous set indices", () => {
    const { setLogs } = buildHyroxActualsById("sim-full", baseInput);
    expect(setLogs.map((s) => s.setIndex)).toEqual(setLogs.map((_, i) => i));
  });

  it("covers all five loaded stations in a full simulation", () => {
    const { setLogs } = buildHyroxActualsById("sim-full", baseInput);
    const slugs = setLogs.map((s) => s.slug).sort();
    expect(slugs).toEqual(
      ["farmer-carry-kb", "sandbag-lunge", "sled-pull", "sled-push-heavy", "wall-ball"].sort(),
    );
  });

  it("emits NO set logs for a pure run/erg session", () => {
    expect(buildHyroxActualsById("easy-run", baseInput).setLogs).toHaveLength(0);
    expect(buildHyroxActualsById("easy-ski", baseInput).setLogs).toHaveLength(0);
  });

  it("omits weightKg (distance/reps only) when a confirmed weight is missing", () => {
    const { setLogs } = buildHyroxActualsById("compromised-run", {
      totalDurationSec: 1800,
      sessionRpe: 7,
    });
    expect(setLogs.length).toBeGreaterThan(0);
    expect(setLogs.every((s) => s.weightKg === undefined)).toBe(true);
    // distance/reps still present so the movement (and its muscle tags) resolve
    expect(setLogs.some((s) => s.distanceM != null || s.reps != null)).toBe(true);
  });
});

describe("HYROX actuals — strength + unknown", () => {
  it("yields no rows for a strength session (uses the per-movement logger)", () => {
    const strength = HYROX_SESSIONS.find((s) => s.category === "strength")!;
    expect(buildHyroxActuals(strength, baseInput)).toEqual({ cardioLogs: [], setLogs: [] });
  });

  it("yields no rows for an unknown session id", () => {
    expect(buildHyroxActualsById("does-not-exist", baseInput)).toEqual({ cardioLogs: [], setLogs: [] });
  });
});

describe("loadedStationsForSession", () => {
  it("lists the confirmable loaded stations for the completion form", () => {
    const keys = loadedStationsForSession("sim-full").map((s) => s.key).sort();
    expect(keys).toEqual(["farmers-carry", "sandbag-lunge", "sled-pull", "sled-push", "wall-ball"].sort());
  });

  it("returns empty for run/erg and strength sessions", () => {
    expect(loadedStationsForSession("easy-run")).toEqual([]);
    const strengthId = HYROX_SESSIONS.find((s) => s.category === "strength")!.id;
    expect(loadedStationsForSession(strengthId)).toEqual([]);
  });

  it("maps every loaded station to a catalog slug", () => {
    for (const s of nonStrength) {
      for (const st of loadedStationsForSession(s.id)) {
        expect(typeof st.slug).toBe("string");
        expect(st.slug.length).toBeGreaterThan(0);
      }
    }
    // sanity: getHyroxSession resolves what we iterate
    expect(getHyroxSession("sim-half")).toBeDefined();
  });
});
