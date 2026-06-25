# ADR 0068 — HYROX full race simulation before the taper

Status: Accepted
Date: 2026-06-25

## Context

The grid only ever placed `sim-half` (a 4+4 rehearsal of the first four stations).
A `sim-full` session (8+8, the whole race) existed in the vocabulary and the
prescription renderer supported it, but nothing scheduled it. So an athlete following
the program **never rehearsed the back half of the race** (Row → Farmers → Sandbag
Lunges → Wall Balls) nor a full-distance race effort with its pacing, fuelling and
cumulative-fatigue demands. All three independent program reviews flagged the missing
full/near-full simulation as a real gap.

The half sim is correctly placed: it is a manageable-cost sharpener in the last
`SIM_WEEKS[level]` Specific weeks, near the taper. A full simulation is a different,
higher-cost stimulus that must sit **earlier**, with enough recovery before the race.

## Decision

Add **one full (8+8) simulation at the first Specific week**, keeping the existing half
sims as the late-block sharpeners. The full sim is only scheduled when the Specific
block is long enough that a real (non-sim) race-prep week still survives — i.e.

```
specificWeeks.length >= SIM_WEEKS[level] + 2
```

so the layout is always `full → … (≥1 normal) … → half(s) → taper`. The full sim is
therefore early in race-prep and clearly clear of the event (the "use rarely, never
close to the event" rule for a full rehearsal).

Intermediate (12-week, 5/wk) Specific block — Wk 8–10 — becomes:

| Week | Sessions |
| ---- | -------- |
| Wk 8 (first Specific) | compromised · station · strength · **Full Sim (8+8)** · long run |
| Wk 9 (normal) | compromised · station · strength · VO2 · long run |
| Wk 10 (last Specific) | compromised · station · strength · **Half Sim (4+4)** · long run |

A full benchmark early, a normal race-prep week, then a half-sim sharpener into the
taper.

## Mechanism

- `buildWeekDays` takes a `simKind: "full" | "half" | null` (was `withSim: boolean`)
  and places `sim-full` or `sim-half` accordingly. The ADR 0067 displacement (the sim
  replaces the last quality/station day, preserving strength / compromised / aerobic)
  is unchanged and applies to both sim kinds.
- `buildHyroxGrid` computes the half-sim set (last `SIM_WEEKS` Specific weeks) and the
  single full-sim week (the first Specific week, gated by the length guard above), and
  resolves each week's `simKind`.

## Calibration

`[DEF]` scheduling logic, not physiology. **Confidence: high** that a full/near-full
rehearsal belongs in a race build, and that it belongs early (recovery before the
event) with a lighter sharpener nearer the race — this is standard peaking practice and
universal HYROX coaching. The exact placement (first Specific week) and the
`SIM_WEEKS + 2` length guard are tunable defaults.

## Consequences

- Every default race build long enough to support it now includes exactly one full
  race rehearsal, early and clear of the taper, plus the existing half-sim sharpener(s).
- The "≥1 real (non-sim) race-prep week" invariant is preserved by the length guard;
  short Specific blocks simply keep the prior half-sim-only behaviour (no full sim).
- No change to session counts or to the half-sim sharpener placement.
- Tests: `program.test.ts` adds an ADR 0068 block (≤1 full sim, full precedes every
  half, intermediate gets exactly one full at the first Specific week with a normal
  week after it, full sim renders all 8 stations). The `sim-half`-specific tests now
  target the LAST sim (always a half).
