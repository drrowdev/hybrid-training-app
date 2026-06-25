# ADR 0066 — HYROX compromised running: one rotating station per round

Status: Accepted
Date: 2026-06-25

## Context

`buildCompromised` rendered a self-contradictory session. The headline said
**N rounds** and the round segment said *"1 km run → one race station → 1 km run"*,
but the station list was populated by `stationRows(sess.movements, …)` — which emits
**every** loaded station in the session (`sled-push`, `wall-ball`, `sandbag-lunge`) at
**full race volume**. So a 4-round compromised run displayed as:

```
4 rounds
Each round: 1 km run → one race station → 1 km run
  Sled Push      152 kg · 50 m
  Wall Balls     6 kg · 100 reps
  Sandbag Lunges 20 kg · 100 m
```

Unanswerable from the card: *which* station each round? All three every round
(4 × 3 full stations = absurd)? One of the three, rotating (but which, and when)?
All three independent LLM program reviews flagged this as a real defect — ambiguous
structure layered on what reads like full-race-volume-times-N work. It is the same
class of bug ADR 0061 fixed for `station-intervals`/`se-circuit`, except those got
per-round chunks while `buildCompromised` was explicitly left untouched (ADR 0061
§Mechanism) on the assumption it "rotated one station across rounds" — which the code
never actually did.

## Decision

Make the structure match the intent: **one station per round, rotating** round-robin
over the session's loaded stations, offset by week for variety. Each round is rendered
as its own segment, naming its single station and that station's target:

```
4 rounds
  Round 1  1 km run → Wall Balls (100 reps · target 3.0 m) → 1 km run
  Round 2  1 km run → Sandbag Lunges (100 m) → 1 km run
  Round 3  1 km run → Sled Push (50 m) → 1 km run
  Round 4  1 km run → Wall Balls (100 reps · target 3.0 m) → 1 km run
  Wall Balls      6 kg · 100 reps · target 3.0 m   (load reference, deduped)
  Sandbag Lunges  20 kg · 100 m
  Sled Push       152 kg · 50 m
```

Key choices:

- **Stations stay at FULL race volume.** Compromised running's identity is doing a
  *real* race station under run-fatigue — unlike intervals, where ¼-race chunks are
  correct (ADR 0061). The bug was never the per-station volume; it was listing **all**
  stations every round. Now it is **one** full station per round, so the per-session
  station load is `rounds` single stations, not `rounds × 3`.
- **Rotation** = `stations[(week − 1 + roundIndex) mod n]`, so the leading station
  varies week to week and the block covers every station under fatigue over time.
- The `stations` array is the **unique** set touched this session (deduped, rotation
  order), purely as a load reference; the per-round assignment lives in the segments.
- Combines cleanly with the ADR 0065 taper: the race week's 2 rounds become a genuine
  2-station sharpener (e.g. run → lunges → run, run → sled → run).

## Mechanism

- New `compromisedRotation(movements, rounds, week)` (`prescription.ts`) returns the
  per-round `HyroxStation[]`, round-robin with a week offset, skipping non-station
  movements (`run`).
- `buildCompromised` builds per-round `Round N` segments + a deduped station load list,
  replacing the single `Each round` segment and the all-stations `stationRows(...)`
  call. `stationRows` is no longer used by `prescription.ts` (still exported for tests).
- Round COUNT continues to come from the ADR 0065 taper-aware formula.

## Calibration

`[DEF]` calibration, NOT published fact. **Confidence: high that the old structure was
a defect; moderate on "one full station per round" as the right dose.**

Grounding: HYROX "run–station–run" / compromised-run sessions are universally
programmed as a single station bout sandwiched by runs, repeated and rotated — not all
stations every round. Keeping the bout at full race volume preserves the race-specific
"station under fatigue" stimulus that distinguishes compromised running from the
lighter interval/circuit work. The rotation and volume are trivially tunable.

## Consequences

- The compromised-run card is now unambiguous and self-consistent; per-session station
  volume drops roughly 3× (one station/round instead of three) with no loss of the
  race-specific stimulus.
- Loads unchanged ⇒ no load-model / interference impact.
- **Materialize-time change:** existing live blocks keep stored values; regenerate to
  pick up the new structure. New plans are correct.
- Tests: `prescription.test.ts` adds an ADR 0066 block (one station/round, no
  all-stations-per-round, week rotation, full race volume + loads retained).
