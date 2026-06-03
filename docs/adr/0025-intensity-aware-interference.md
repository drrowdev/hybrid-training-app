# ADR 0025 — Intensity-aware concurrent interference (stats-only)

- **Status:** Accepted (implemented — stats-only)
- **Date:** 2026-06-03
- **Phase:** Production (engine review #2 — concurrent-training interference)
- **Extends:** The modality-aware continuous concurrent scalar
  (`apps/web/src/lib/engine/concurrent-scalar.ts`, originating ADR for the
  modality dimension). Adds an **intensity** dimension on top of the existing
  **modality** dimension. Reuses `ZONE_INTENSITY_WEIGHTS` from ADR 0009
  (`cardio-intensity.ts`).
- **Touches:** `apps/web/src/lib/engine/concurrent-scalar.ts` (new
  per-block entry point + intensity multiplier), `apps/web/src/lib/stats/muscle-volume.ts`
  (new `cardioBlocksFromLogs` builder; consumer switches to the block path and
  selects `hr_zones`/`rpe`). Tests in the respective `__tests__` dirs.
- **Does NOT touch:** `buildPrescription`, the ceiling chain, or any prescription
  output. This is a **stats/display-only** change.

## Context

The concurrent-training interference scalar weights cardio minutes by **modality**
(`run 1.0, swim 0.6, bike 0.4, …`) and runs a piecewise-linear dose curve. It is
**intensity-blind**: a 300-min easy Z2 week and a 300-min week packed with
VO2/threshold intervals produce the same weighted dose → the same displayed
volume-compression. That is physiologically wrong — a minute of Z5 work carries a
larger acute neuromuscular fatigue cost and a bigger AMPK→mTOR interference spike
than a minute of easy aerobic work.

The scalar is consumed in exactly one place: `getWeeklyMuscleVolume`
(`lib/stats/muscle-volume.ts`), where it scales the Stats-page muscle-volume
landmark thresholds and drives the "concurrent" info pill. It does **not** enter
the generator (`assemble-prescription.ts` hardwires `concurrentStressActive:
false`).

## Decision

Make the per-block interference contribution **intensity-weighted**, anchored at
the Z2 reference so the legacy dose-only behaviour is preserved exactly:

```
weightedDose = Σ_block  minutes_b × MODALITY_INTERFERENCE[modality_b] × I_b

I_b = hasZoneSignal(block)
        ? clamp( cardioIntensityScalar(block) / ZONE_INTENSITY_WEIGHTS.z2 ,
                 I_MIN, I_MAX )
        : 1.0
```

- **Z2 (reference)** → 1.0 (no change vs today)
- **threshold (z4)** → 1.8/0.8 = 2.25; **VO2 (z5)** → 2.2/0.8 = 2.75 (premium)
- **recovery (z1)** → 0.5/0.8 = 0.625 (discount)
- **no objective HR-zone signal** → 1.0 (continuity)

The weighted dose then feeds the **unchanged** piecewise-linear curve (knee 300,
0.70 at knee, 0.60 floor). The intensity premium is per-*minute*, and hard
sessions are short, so long easy volume remains the dominant interference source
(a 30-min pure-Z5 run = 82.5 weighted min < a 90-min Z2 run = 90). This matches
the concurrent-training literature: interference is intensity- *and*
duration-dependent (Fyfe 2014; Schumann 2022; Coffey & Hawley 2017), with acute
high-intensity endurance impairing subsequent strength work (Doma 2017).

### Three decisions worth recording

1. **Stats-only scope (CP-4).** CP-4 forbids reintroducing an
   `interference_modifier` into the prescription ceiling chain until a measurable
   user-outcome signal motivates it (and would require a 25% week-over-week
   compression cap). We have one user on test data → no outcome signal. We
   therefore refine the **existing display scalar only** and leave the generator
   untouched. Wiring interference into the generator is a future, CP-4-gated ADR.

2. **Objective signal only — RPE is excluded.** Only time-in-zone (`hr_zones`)
   earns an intensity adjustment. RPE-only and no-data blocks fall back to 1.0.
   A single subjective RPE number is too coarse to anchor a premium against the
   Z2 reference, and using it would silently shift compression for every
   RPE-logging user. RPE remains a deliberate Stage-B exclusion.

3. **No new intensity coefficients.** The reference (`z2 = 0.8`) and the clamp
   bounds (`z1/z2 = 0.625`, `z5/z2 = 2.75`) are all derived from the existing
   `ZONE_INTENSITY_WEIGHTS` (ADR 0009). The clamp is defensive — it never binds
   for a real zone mix. So this ADR adds **zero** new uncited magnitudes.

## Calibration policy compliance

- **CP-1/CP-2/CP-3:** No new numeric constants enter engine code; the intensity
  multiplier is built from existing CP-1-tagged `ZONE_INTENSITY_WEIGHTS`. The
  derivations carry source comments.
- **CP-4:** Respected — the scalar stays stats-only; the 2-factor ceiling chain is
  untouched.
- **CP-5:** Structural claim (intensity-dependent interference) is cited
  (Fyfe 2014, Schumann 2022, Coffey & Hawley 2017, Doma 2017) at MODERATE
  confidence; magnitudes are heuristic/Stage-B and tagged as such.

## Confidence

- Intensity *direction* (high-zone cardio interferes more per minute than easy
  cardio): **MODERATE** — mechanistically grounded, literature-supported.
- Exact multiplier *magnitudes*: **heuristic / Stage-B**. Calibration signal:
  predicted-vs-actual hypertrophy tolerance on intensity-mixed weeks.

## Consequences

- The Stats muscle-volume chart and "concurrent" pill now reflect *how hard* the
  week's cardio was, not just how much — a truer, more honest display.
- Users without HR-zone data (no wearable / no Strava zones) see **identical**
  output to before. Every continuity pin is byte-identical.
- Lays calibrated groundwork for an eventual generator-wiring ADR once real
  outcome data exists to satisfy CP-4.

## Rejected alternative

**Wire interference into the generator now (Option B).** Rejected: it is exactly
the `interference_modifier` CP-4 names as forbidden without an outcome signal, and
would change the actual prescribed program based on magnitudes we openly label as
guesses. Premature per our own calibration policy.
