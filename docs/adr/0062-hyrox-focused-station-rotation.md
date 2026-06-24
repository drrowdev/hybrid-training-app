# ADR 0062 — HYROX focused station-interval rotation

Status: Accepted
Date: 2026-06-24

## Context

After ADR 0061 fixed the *volume* of `station-intervals` / `se-circuit` (they were
prescribing 4× a full race), a second, structural problem remained: both sessions
**rotate through every station, every round**. Station-intervals touches all 6 of
its stations (SkiErg, Row, Sled push, Sled pull, Wall balls, Sandbag lunges) each of
N rounds; se-circuit all 4.

That is wrong on two counts:

1. **It is simulation-shaped, not interval-shaped.** An interval / conditioning
   session is meant to be a *focused* stimulus — hit one or two qualities hard and
   repeatably. Covering the whole station list each round is what a **simulation**
   does (and the program already has a separate, gated simulation slot). A sampler of
   all stations gives no station a real dose.
2. **It is impractical to set up.** Doing all 6 stations as a rotation means holding
   — simultaneously, for ~40 min — a sled lane, *both* ergs, a wall-ball spot and a
   sandbag, with 20+ station transitions (6 stations × N rounds). Outside a
   HYROX-affiliated box a solo athlete simply cannot run it. (User-reported.)

How HYROX is actually coached: conditioning sessions are **focused couplets** — a
sled day, an erg+wall-ball couplet, a lunge/carry day — each equipment-coherent and
intense, with the *focus rotating* across the block so everything gets trained over
time.

## Decision

`station-intervals` and `se-circuit` now prescribe a **focused 2-station subset that
rotates by week**, instead of the full station list. Each group is
**equipment-coherent** (runnable in one spot) and the rotation **covers every
station across the block**.

`STATION_FOCUS_GROUPS` (`packages/hyrox/src/prescription.ts`):

**station-intervals** (cycle of 3):
| Week mod 3 | Focus | Stations | Kit |
| --- | --- | --- | --- |
| 1 | sled power | Sled Push + Sled Pull | turf/sled lane |
| 2 | erg + wall ball | Row + Wall Balls | rower + med ball |
| 0 | SkiErg + lunges | SkiErg + Sandbag Lunges | ski + sandbag |

**se-circuit** (cycle of 2):
| Week mod 2 | Focus | Stations | Kit |
| --- | --- | --- | --- |
| 1 | bodyweight engine | Wall Balls + Burpee Broad Jumps | med ball + floor |
| 0 | loaded carries | Sandbag Lunges + Farmers Carry | sandbag + KBs |

Selection: `stationFocusForWeek(sessionId, week)` indexes the group list by
`(week − 1) mod groups.length`. Per-round volumes (ADR 0061) and race-correct loads
are unchanged; only *which* stations appear changes. The session keeps its
`ROUNDS_BY_LEVEL` round count, so a focused session totals ≈ one race's worth of its
2 stations — a tight, hard, repeatable interval block.

The plan copy now names the week's focus ("this week's emphasis is sled power … the
focus rotates each week so the block covers everything") in the summary and `meta`
("4 rounds · sled power"), so the rotation is legible to the athlete.

`vo2-intervals` (also category `intervals`, but pure running with no stations) is not
in the map and falls back to its full movement list — unchanged.

## Mechanism

- `week` threaded into `PrescribeArgs` (`program.ts` already has `week.week`).
- `STATION_FOCUS_GROUPS` + exported `stationFocusForWeek(sessionId, week, fallback)`.
- `buildIntervals` / `buildCircuit` select the focused group, build the rotation,
  station rows, summary/meta from it. `buildCompromised` (one rotating full station
  under fatigue) and `buildSimulation` (the whole race, by design) are untouched.

## Calibration

`[DEF]` structural choice, not a CP-2 physiological constant. **Confidence: high** on
the *direction* (focus down, rotate, make it gym-feasible) — it is how HYROX
conditioning is universally coached and resolves a concrete usability blocker. The
specific groupings (which two stations pair, the cycle length) are a sensible default,
trivially tunable; **moderate** confidence on the exact pairings.

## Consequences

- Each conditioning session is now a focused, intense, **single-spot** couplet — far
  easier to actually do, and a better training stimulus than an all-stations sampler.
- Across the block every station is still trained (cover-all invariant, tested).
- Volumes (ADR 0061) and loads unchanged ⇒ no change to load-model / interference.
- **Materialize-time change:** existing HYROX blocks keep their stored all-stations
  sessions — users must **regenerate / redeploy** to get the focused rotation.
- The full all-stations rehearsal still exists where it belongs: the gated
  half/full **simulation** sessions.
