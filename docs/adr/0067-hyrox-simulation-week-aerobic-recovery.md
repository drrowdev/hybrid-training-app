# ADR 0067 — HYROX simulation week preserves aerobic recovery

Status: Accepted
Date: 2026-06-25

## Context

The race-prep simulation (`sim-half`) is placed by `buildWeekDays` into the last
`SIM_WEEKS[experience]` Specific weeks. It does NOT add a session — it **replaces** one,
so a sim week keeps the same budget. But the replacement rule was *"replace the last
non-strength day"*, and in a Specific week (slot order
`compromised, station, strength, quality, long, …`) the last non-strength day placed is
the **long run**. So the sim displaced the week's only aerobic / recovery session,
leaving the peak week as:

```
compromised (hard) · station (hard) · strength (heavy) · VO2 5×800 (very hard) · sim-half (max test)
```

Five sessions, **all** RPE 7–9, with a near-maximal race simulation stacked among four
other hard efforts and **zero** easy/aerobic day. All three independent program reviews
called Wk 10 a "death week." The defect is real: a simulation is a costly maximal
stimulus, and the week that contains it should *shed* hard load, not run four other hard
sessions and drop the recovery run.

## Decision

A simulation **is** a hard, race-specific effort (continuous race-pace running through
the stations), so it should **replace a redundant hard session — never the aerobic
recovery.** The sim now displaces the last **quality** or **station** day (the sim
already rehearses race-pace running and the stations), and explicitly preserves:

- **strength** (maintenance — already protected; the sim never took a strength day),
- **compromised running** (the signature run-under-fatigue skill — and a program
  invariant: every Specific week must train it),
- the **long / easy aerobic** day (engine + recovery).

If no quality/station day exists in a small-budget week, it falls back to the old
"last non-strength day" rule so a sim is always placed.

Result for the intermediate Wk 10 (5 sessions):

| | Before | After |
| --- | --- | --- |
| Sessions | compromised · station · strength · **VO2 5×800** · sim | compromised · station · strength · **sim** · **long run** |
| Hard efforts | 4 hard + max sim, **no aerobic** | 3 hard + sim **+ aerobic recovery** |

The sim displaces the standalone VO2 (redundant with the sim's quality stimulus) and the
long aerobic run returns — one fewer maximal session and a genuine recovery/engine day in
the peak week.

## Mechanism

- `buildWeekDays` (`phases.ts`) now records each placed day's slot **category** (`posCat`)
  during placement. The sim search walks from the last day, picks the last `quality` or
  `station` day, and falls back to the previous "last non-strength" rule when neither
  exists. Strength, compromised, long and easy are therefore never displaced when a
  quality/station day is present.
- No change to session COUNT (the sim still replaces, not adds) or to which weeks carry a
  sim (`simWeekSet`).

## Calibration

`[DEF]` scheduling logic, not physiology. **Confidence: high.** Sport-science taper /
peaking practice and HYROX coaching both hold that a race-simulation week is a *reduced*
hard-volume week with the rehearsal as the key session — not an additional hard week.
Preferring to drop the standalone VO2 (whose top-end quality the sim's race-pace effort
substantially covers) over the long aerobic run (distinct adaptation, low interference,
aids recovery) is the standard concurrent-training call.

## Consequences

- Sim weeks keep an aerobic recovery/engine day and shed one redundant hard session;
  the peak week is no longer all-hard-plus-a-test.
- Non-sim weeks are unchanged (the new branch only runs when `withSim`).
- The "every Specific week trains compromised running" and "every work week has a
  station (or sim)" invariants still hold (compromised is never displaced; a sim counts
  as a station). Verified by the existing suite + a new ADR 0067 test.
- No load-model impact (placement only; no load/volume math changed).
