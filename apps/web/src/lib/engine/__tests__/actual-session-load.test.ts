/**
 * Unit tests for `computeActualSessionLoad` — Finding 1 fix.
 *
 * The integration tests in `__tests__/actual-session-load-integration.test.ts`
 * cover the DB write paths.
 */
import { describe, expect, it } from "vitest";
import {
  computeActualSessionLoad,
  type CardioLogRow,
  type SetLogRow,
} from "../actual-session-load";
import { MODALITY_STRESS_MULTIPLIER } from "@/lib/planner/session-modality";

const mainSet = (movementId = "m-1", overrides: Partial<SetLogRow> = {}): SetLogRow => ({
  movementId,
  setKind: "main",
  weightKg: 100,
  reps: 5,
  rpe: 8,
  isSkipped: false,
  ...overrides,
});

const warmupSet = (movementId = "m-1"): SetLogRow => ({
  movementId,
  setKind: "warmup",
  weightKg: 50,
  reps: 5,
  rpe: 5,
  isSkipped: false,
});

const skippedSet = (movementId = "m-1"): SetLogRow => ({
  ...mainSet(movementId),
  isSkipped: true,
});

const cardioZ2 = (durationMin: number): CardioLogRow => ({
  movementId: null,
  modality: "easy_z2",
  durationSec: durationMin * 60,
  inferredKind: "cardio_z2",
});

describe("computeActualSessionLoad", () => {
  it("pure strength — N logged main sets → ESL = N × pure_strength_mult", () => {
    const out = computeActualSessionLoad({
      prescribedModality: "pure_strength",
      setLogs: Array.from({ length: 5 }, () => mainSet("m-1")),
      cardioLogs: [],
    });
    expect(out.breakdown.hardSets).toBe(5);
    // 5 distinct (mov, kind) groups not made — all share movementId+kind,
    // so classifier sees one main movement with 5 estimatedHardSets →
    // rule 6 (pure_strength) fires.
    expect(out.sessionModality).toBe("pure_strength");
    expect(out.effectiveStressLoad).toBe(5 * MODALITY_STRESS_MULTIPLIER.pure_strength);
    expect(out.breakdown.strengthEsl).toBe(5 * MODALITY_STRESS_MULTIPLIER.pure_strength);
    expect(out.breakdown.cardioEsl).toBe(0);
    expect(out.breakdown.cardioSource).toBe("none");
  });

  it("no-show — zero logged sets → ESL 0, modality 'restorative' fallback", () => {
    const out = computeActualSessionLoad({
      prescribedModality: "pure_strength",
      setLogs: [],
      cardioLogs: [],
    });
    expect(out.effectiveStressLoad).toBe(0);
    expect(out.breakdown.hardSets).toBe(0);
    // No movements → classifier rule 1 (restorative) wins: low total
    // sets, no main, no HIIT, no cardio. The integration layer should
    // skip the WRITE when both arrays are empty so the prescribed ESL
    // stays.
    expect(out.sessionModality).toBe("restorative");
  });

  it("warmup-only sets are NOT counted", () => {
    const out = computeActualSessionLoad({
      prescribedModality: "pure_strength",
      setLogs: [warmupSet(), warmupSet(), warmupSet()],
      cardioLogs: [],
    });
    expect(out.breakdown.hardSets).toBe(0);
    expect(out.effectiveStressLoad).toBe(0);
  });

  it("skipped sets are NOT counted", () => {
    const out = computeActualSessionLoad({
      prescribedModality: "pure_strength",
      setLogs: [mainSet(), mainSet(), skippedSet(), skippedSet()],
      cardioLogs: [],
    });
    expect(out.breakdown.hardSets).toBe(2);
  });

  it("pure cardio — precomputed ESL is preferred over kind-derived", () => {
    const out = computeActualSessionLoad({
      prescribedModality: "pure_z2_aerobic",
      setLogs: [],
      cardioLogs: [
        {
          movementId: null,
          modality: "easy_z2",
          durationSec: 30 * 60,
          inferredKind: "cardio_z2",
          precomputedEsl: 45, // would otherwise be 0.5 × 30 = 15
        },
      ],
    });
    expect(out.breakdown.cardioEsl).toBe(45);
    expect(out.effectiveStressLoad).toBe(45);
    expect(out.breakdown.cardioSource).toBe("strava-classified");
  });

  it("pure cardio Z2 — inferredKind drives the duration × multiplier path", () => {
    const out = computeActualSessionLoad({
      prescribedModality: "pure_z2_aerobic",
      setLogs: [],
      cardioLogs: [cardioZ2(45)],
    });
    // cardioEslFromKind(cardio_z2, 45) = 0.5 × 45 = 22.5
    expect(out.breakdown.cardioEsl).toBe(22.5);
    expect(out.effectiveStressLoad).toBe(22.5);
    expect(out.sessionModality).toBe("pure_z2_aerobic");
    expect(out.breakdown.cardioSource).toBe("strava-classified");
  });

  it("cardio VO2 — high-intensity kind picks up vo2 mult", () => {
    const out = computeActualSessionLoad({
      prescribedModality: "pure_hiit",
      setLogs: [],
      cardioLogs: [
        {
          movementId: null,
          modality: "vo2_intervals",
          durationSec: 20 * 60,
          inferredKind: "cardio_vo2",
        },
      ],
    });
    // cardioEslFromKind(cardio_vo2, 20) = 2.0 × 20 = 40
    expect(out.breakdown.cardioEsl).toBe(40);
    expect(out.sessionModality).toBe("pure_hiit");
  });

  it("cardio with no inferred_kind — falls back to duration × modality", () => {
    const out = computeActualSessionLoad({
      prescribedModality: "pure_z2_aerobic",
      setLogs: [],
      cardioLogs: [
        {
          movementId: null,
          modality: "easy run",
          durationSec: 60 * 60,
          inferredKind: null,
        },
      ],
    });
    // mode = z2 (matched on "easy" substring) → 60 min × 0.4 = 24
    expect(out.breakdown.cardioEsl).toBe(24);
    expect(out.breakdown.cardioSource).toBe("duration-modality");
  });

  it("mixed: 5 main sets + 30 min Z2 → strength + cardio + modality flips", () => {
    const out = computeActualSessionLoad({
      prescribedModality: "pure_strength",
      setLogs: Array.from({ length: 5 }, () => mainSet("m-1")),
      cardioLogs: [cardioZ2(30)],
    });
    expect(out.sessionModality).toBe("mixed_modal");
    // strength: 5 × 1.25 (mixed_modal mult) = 6.25
    // cardio: 0.5 × 30 = 15
    expect(out.breakdown.strengthEsl).toBe(5 * MODALITY_STRESS_MULTIPLIER.mixed_modal);
    expect(out.breakdown.cardioEsl).toBe(15);
    expect(out.effectiveStressLoad).toBe(6.25 + 15);
  });

  it("modality reclassification: prescribed pure_strength → actual mixed_modal", () => {
    // The classifier rule 5 fires when strSets ≥ 3 AND cardio ≥ 10 min.
    const out = computeActualSessionLoad({
      prescribedModality: "pure_strength",
      setLogs: [mainSet(), mainSet(), mainSet()],
      cardioLogs: [cardioZ2(15)],
    });
    expect(out.sessionModality).toBe("mixed_modal");
  });

  it("hypertrophy: main + accessory, no cardio → pure_hypertrophy", () => {
    const out = computeActualSessionLoad({
      prescribedModality: "pure_hypertrophy",
      setLogs: [
        mainSet("m-1"),
        mainSet("m-1"),
        mainSet("m-1"),
        { ...mainSet("m-2"), setKind: "accessory" },
        { ...mainSet("m-2"), setKind: "accessory" },
        { ...mainSet("m-2"), setKind: "accessory" },
      ],
      cardioLogs: [],
    });
    expect(out.sessionModality).toBe("pure_hypertrophy");
    expect(out.breakdown.hardSets).toBe(6);
    expect(out.effectiveStressLoad).toBe(6 * MODALITY_STRESS_MULTIPLIER.pure_hypertrophy);
  });

  it("tendon sets count as accessory volume (Baar protocol)", () => {
    const out = computeActualSessionLoad({
      prescribedModality: "pure_hypertrophy",
      setLogs: [
        { ...mainSet("m-1"), setKind: "tendon" },
        { ...mainSet("m-1"), setKind: "tendon" },
      ],
      cardioLogs: [],
    });
    expect(out.breakdown.hardSets).toBe(2);
  });

  it("cardio with 0 duration is ignored (no negative or zero contribution)", () => {
    const out = computeActualSessionLoad({
      prescribedModality: "pure_z2_aerobic",
      setLogs: [],
      cardioLogs: [
        { movementId: null, modality: "z2", durationSec: 0, inferredKind: "cardio_z2" },
      ],
    });
    expect(out.breakdown.cardioEsl).toBe(0);
    expect(out.effectiveStressLoad).toBe(0);
  });

  it("multiple cardio blocks sum into cardioEsl", () => {
    const out = computeActualSessionLoad({
      prescribedModality: "pure_z2_aerobic",
      setLogs: [],
      cardioLogs: [cardioZ2(20), cardioZ2(30)],
    });
    // 0.5 × 20 + 0.5 × 30 = 25
    expect(out.breakdown.cardioEsl).toBe(25);
  });

  it("rounds effective_stress_load to 2 decimals", () => {
    // Trigger a non-trivial decimal: cardio_threshold for 17 min = 1.3 × 17 = 22.1
    const out = computeActualSessionLoad({
      prescribedModality: "pure_hiit",
      setLogs: [],
      cardioLogs: [
        {
          movementId: null,
          modality: "threshold",
          durationSec: 17 * 60,
          inferredKind: "cardio_threshold",
        },
      ],
    });
    expect(out.effectiveStressLoad).toBeCloseTo(22.1, 2);
    // Confirm the value really is round-2'd (no float garbage tail).
    expect(Number(out.effectiveStressLoad.toFixed(2))).toBe(out.effectiveStressLoad);
  });

  it("backward-compat: a completed session with zero logs returns 0 (caller decides whether to write)", () => {
    // Guard documented in actual-session-load.ts:
    //   "a session with ZERO logged sets… should keep its prescribed ESL".
    // The helper itself returns 0; the INTEGRATION layer is responsible
    // for skipping the write when sets+cardio are both empty (see
    // sessions/actions.ts → completeSession).
    const out = computeActualSessionLoad({
      prescribedModality: "pure_strength",
      setLogs: [],
      cardioLogs: [],
    });
    expect(out.effectiveStressLoad).toBe(0);
    expect(out.breakdown.hardSets).toBe(0);
    expect(out.breakdown.cardioEsl).toBe(0);
  });
});
