# ADR 0065 — HYROX taper sheds conditioning (compromised / station) volume

Status: Accepted
Date: 2026-06-25

## Context

The HYROX taper was only **half** implemented. `buildAerobic` shrinks run duration
(`AEROBIC_PHASE_MULT.taper = 0.55`, threshold ×0.7) and `buildStrength` trims one
working set in the taper — but the two highest-fatigue conditioning sessions,
`compromised-run` (`buildCompromised`) and `station-intervals` (`buildIntervals`),
had **no taper branch at all**. They were prescribed at full work in every phase:

- `buildCompromised`: `rounds = ROUNDS_BY_LEVEL` (intermediate = 4), full race station
  volume, in the **race week** (final taper week, ≤7 days out).
- `buildIntervals`: `rounds = ROUNDS_BY_LEVEL (+1 specific)`, unchanged in taper.

This is the root cause of the standout finding from three independent LLM reviews of a
generated 12-week intermediate program: the **race week was not a taper**. Wk 12 carried
a 4-round compromised run (50 m sled + 100 wall balls + 100 m lunges + ~8 km running)
plus a 4-round station-intervals session, days before the race — exactly the residual
fatigue a taper exists to shed. The comment on `TAPER_RACE_SLOTS` even *claimed* the
compromised/station work was "volume-cut by the taper engine"; the code never did it.

This convergent, code-confirmed defect is the highest-impact, lowest-risk fix in the
review backlog — the engine is simply out of sync with its own documented intent.

## Decision

Introduce a **taper rounds delta** for the two conditioning builders, mirroring the
volume-down / intensity-maintained taper already applied to runs and strength:

`taperRoundsDelta(taperKind)` (`packages/hyrox/src/prescription.ts`):

| Taper sub-kind | Rounds delta |
| -------------- | ------------ |
| `sharpen` (earlier taper week) | −1 |
| `race` (final taper week, ≤7d out) | −2 |
| non-taper | 0 |

Applied as `Math.max(2, baseRounds + (phase === "taper" ? delta : 0))`, so every taper
session is floored to a **brief sharpener** (≥2 rounds), never empty. Intensity (RPE,
race-pace effort, station loads) is **unchanged** — only total work (rounds) drops.

Worked example — intermediate (`ROUNDS_BY_LEVEL = 4`), 2-week taper:

| Session | Specific (race-prep) | Sharpen (Wk 11) | Race (Wk 12) |
| ------- | -------------------- | --------------- | ------------ |
| `compromised-run`  | 4 rounds | 3 rounds | **2 rounds** |
| `station-intervals` | 5 rounds (+1 specific bump) | 3 rounds | **2 rounds** |

## Mechanism

- `HyroxWeekPlan` gains a `taperKind: TaperKind` field (`phases.ts`), populated from the
  already-computed `taperKindFor(w)` — previously discarded after `buildWeekDays`.
  `TaperKind` is now exported.
- `prescribeRef` (`program.ts`) threads `week.taperKind` into `PrescribeArgs` (optional;
  spread only when truthy, so non-taper weeks pass nothing).
- `PrescribeArgs` gains `taperKind?: "sharpen" | "race" | null`.
- `buildCompromised` and `buildIntervals` add the taper delta to their round count.
  `meta`, the per-round rotation, segments, effort, loads and duration estimate all
  derive from `rounds`, so they update automatically.

This is the F1 fix of the engine-fix plan. F2 (per-round dose + disambiguating the
"4 rounds / 3 stations" structure of `buildCompromised`) is a separate, follow-on ADR —
this change only reduces the **count** of rounds, not their station content.

## Calibration

`[DEF]` calibration, NOT published fact. **Confidence: moderate as coach-consensus;
lower on the exact −1 / −2 deltas.**

Grounding: a taper that **reduces volume while holding intensity** is the most robust
finding in the endurance-taper literature (Bosquet et al. 2007 meta-analysis — a
progressive ~41–60% volume reduction over ~2 weeks, with intensity and frequency
maintained, maximises the performance gain). Shedding rounds (not effort) on the two
race-specific conditioning sessions, biased deeper in the race week than the sharpen
week, sits squarely inside that window. The deltas are trivially tunable and floored so
the athlete still *touches* the race pattern in race week (per `TAPER_RACE_SLOTS`).

## Consequences

- Taper weeks now prescribe a genuine, progressively-lighter conditioning dose; the race
  week is a sharpener, not a full session. Directly resolves the reviews' #1 finding.
- **Non-taper weeks are byte-identical** — the delta is 0 outside the taper, so Base /
  Build / Specific prescriptions are unchanged (regression-guarded by a new test).
- Loads unchanged ⇒ no change to load-model sRPE inputs or interference scalars.
- **Materialize-time change:** existing live HYROX blocks keep their stored values; users
  regenerate / redeploy their block to pick up the lighter taper. New plans are correct.
- Tests: `packages/hyrox/src/prescription.test.ts` adds an ADR 0065 block asserting the
  race-week cut, the sharpen > race progression, and non-taper invariance.
