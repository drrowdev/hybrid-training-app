# ADR 0061 — HYROX station-interval / circuit per-round volumes

Status: Accepted
Date: 2026-06-24

## Context

The HYROX engine builds two "rotate through the stations" conditioning sessions —
`station-intervals` (category `intervals`) and `se-circuit` (category `circuit`).
Both are prescribed as **N rounds** of a station rotation, where
`N = ROUNDS_BY_LEVEL` (beginner 3 / intermediate 4 / advanced 5, +1 for `specific`).

The bug: `buildIntervals` and `buildCircuit` populated each round's station list via
`stationRows(...)`, which returns the **full race volume** for every station
(SkiErg 1000 m, Row 1000 m, Sled push/pull 50 m, Wall Balls 100 reps, Sandbag Lunges
100 m, Burpee Broad Jumps 80 m, Farmers 200 m). With `rounds = 4`, a single
"interval" session prescribed **4 × an entire race's worth** of those stations
(4000 m ski + 4000 m row + 200 m sled + 400 wall balls + …). That is not an interval
session — it exceeds a full race simulation by 4×. Reported by the user from the
in-app station-intervals card ("are the distances and reps really correct for an
'interval' with 4 rounds? That looks more like a simulation").

## Decision

Introduce an explicit **per-round interval volume** per station — the short,
repeatable chunk done *each round* of an interval/circuit session — distinct from
the full race distance/reps (which simulations still use).

`INTERVAL_VOLUME` (`packages/hyrox/src/divisions.ts`):

| Station            | Per-round chunk | Race volume | ×4 rounds |
| ------------------ | --------------- | ----------- | --------- |
| SkiErg / Row       | 250 m           | 1000 m      | 1000 m ✓  |
| Sled Push / Pull   | 12.5 m (1 length) | 50 m      | 50 m ✓    |
| Wall Balls         | 25 reps         | 100 reps    | 100 ✓     |
| Sandbag Lunges     | 25 m            | 100 m       | 100 m ✓   |
| Burpee Broad Jumps | 20 m            | 80 m        | 80 m ✓    |
| Farmers Carry      | 50 m            | 200 m       | 200 m ✓   |

Each chunk is ≈ **¼ of the race volume**, held **fixed per round** (NOT race ÷ N).
Because the chunk is fixed, the per-level round counts scale total work
intentionally:

- beginner (3 rounds) ≈ **0.75 race**
- intermediate (4 rounds) ≈ **1.0 race**
- advanced (5 rounds) ≈ **1.25 race**
- `specific` phase (+1 round) adds one more chunk.

Loads (kg) are **unchanged** — race-correct division/gender standards still apply to
the loaded stations; only the per-round *distance/reps* shrink.

## Mechanism

- `INTERVAL_VOLUME`, `intervalTargetLabel(station, gender)`, and
  `intervalStationRows(movements, division, gender)` added to `divisions.ts`.
  `intervalStationRows` mirrors `stationRows` but stamps the per-round target.
- `buildIntervals` and `buildCircuit` (`prescription.ts`) now call
  `intervalStationRows` instead of `stationRows`. The `meta` ("4 rounds"),
  per-round rotation segment, effort and load summary are unchanged.
- `buildCompromised` is **left on full race volume**: it does "1 km run → one race
  station → 1 km run" per round with the station *rotating across rounds* (one full
  station under fatigue is the intended race-specific stimulus), not all stations
  every round, so it never had the 4× multiplication. Out of scope here.
- Simulations (`buildSimulation`) keep full race volumes (they are race rehearsals).
- The off-plan **Quick HYROX** generator already used its own reduced `QUICK_DOSE`
  table and is unaffected.

## Calibration

`[DEF]` calibration, NOT published fact (the race distances in `HYROX_STATIONS`
remain CP-exempt published rule data; these per-round chunks are an engine dosing
choice). **Confidence: moderate as coach-consensus, lower on the exact chunk sizes.**

Grounding: HYROX-affiliate interval programming consistently uses short, repeated
race-pace station bouts (e.g. "5 rounds: 250 m ski, 1 sled length, 15–25 wall balls,
250 m row") rather than full stations × N — the point of an interval/circuit session
is repeatable quality and transitions, not race-distance accumulation (a full or
half **simulation** already covers that, and is gated as a costly, rare stimulus).
Anchoring the chunk at ≈ ¼ race so the level round counts sum to ≈ 0.75 / 1.0 / 1.25
races keeps the weekly conditioning dose sane and the level progression monotonic.
The exact numbers are trivially tunable.

## Consequences

- Station-intervals and SE-circuit sessions now prescribe a sane ~1-race-equivalent
  of station work spread across rounds, instead of ~4 races.
- The per-round station rows surface the **reduced** target (e.g. "SkiErg · 250 m")
  in both the plan drawer and the logging card (which now share `CardioPlanView`).
- **Materialize-time change:** existing live HYROX blocks already in the DB keep
  their stored (over-prescribed) values — users must **regenerate / redeploy** their
  HYROX block to pick up the corrected volumes. Newly generated plans are correct.
- Loads unchanged ⇒ no change to load-model sRPE inputs or interference scalars.
