# ADR 0069 — HYROX deload cadence: recover through the hard block

Status: Accepted
Date: 2026-06-26

## Context

The engine inserted deloads only in the accumulation phases:
`(phase === "base" || "build") && w % 4 === 0`. For the default 12-week intermediate
build that produced **exactly one deload** (week 4), then an unbroken hard stretch from
week 5 through the taper (Build wk5–7 → Race-prep wk8–10). All three independent program
reviews flagged this as a HIGH-severity recovery weakness, and a research pass into
best-practice HYROX / concurrent-training deload programming confirmed it is too sparse:

- **PureGym's published 12-week HYROX plan** deloads every 3rd week (2 hard → 1 deload),
  continuing the cadence through every cycle.
- **Competitive-athlete strength guidance** (SetForSet) and **higher-volume endurance**
  guidance (TrainerRoad) both land on **every 3rd–4th week (3:1 / 4:1)**.
- **Concurrent-training science**: endurance and strength fatigue accumulate via
  *independent, additive* pathways (AMPK–mTOR interference; Coffey & Hawley 2007), so a
  hybrid athlete needs recovery *at least* as often as a single-mode athlete, not less.
  A 5–7-day deload does not erode adaptations (aerobic/strength residuals persist
  25–35 days; Issurin 2010), so frequent deloads are low-cost.
- The **taper is terminal recovery**, an *addition* to mid-block deloads — not a
  substitute for them.

Confidence note: the strongest *elite* HYROX coaching sources (RoxLyfe paid plans,
HYROX365, Dearden, etc.) were paywalled/unreachable, so "every 3–4 weeks" rests on one
mass-market HYROX plan + general competitive-athlete/concurrent science + the three AI
reviews. The *direction* (one-deload-in-12-weeks is too sparse) is convergent and
high-confidence; the exact cadence is moderate-confidence.

## Decision

Move to a **3:1 / 4:1 deload rhythm that continues into the realization (Specific)
block**, and lengthen the default builds so the rhythm + the ADR 0068 simulations fit.

1. **Deloads run every `DELOAD_EVERY` (4) work-weeks through Base, Build AND Specific** —
   no longer suppressed in race-prep. Guards:
   - never week 1, never the taper;
   - the **final `SIM_WEEKS` Specific weeks** (the half-sim sharpeners into the taper)
     are protected from deloads;
   - a Specific-phase deload is only taken when the Specific block has
     `>= SIM_WEEKS + 2` weeks, so a full sim and ≥1 real (non-sim) race-prep week still
     survive. Short Specific blocks stay accumulation-only.
2. **Default block lengths bumped** so the default builds carry ≥2 deloads + a full +
   half simulation: **beginner 10→12, intermediate 12→14, advanced 16→18.** A supplied
   race date still overrides (clamped 4–24).

Because the full sim is placed on the first *non-deload* Specific week (ADR 0068), a
Specific-phase deload simply lands *before* the full sim — i.e. the athlete deloads, then
hits the full-race benchmark fresh.

## Resulting structure (5 sessions/wk)

| Build | Deloads | Specific block | maxHardRun |
| ----- | ------- | -------------- | ---------- |
| intermediate 14wk (new default) | wk4, wk8 | full sim wk10 · normal wk11 · half sim wk12 | 4 |
| intermediate **12wk (race-date)** | **wk4, wk8** | normal wk9 · half sim wk10 | 3 |
| beginner 12wk (new default) | wk4, wk8 | full sim wk9 · normal wk10 · half sim wk11 | 3 |
| advanced 18wk (new default) | wk4, wk8, **wk12 (Specific)** | full sim wk13 · normal wk14 · half sims wk15–16 | 4 |

The headline win: even a **12-week race-date** intermediate build (what a real user 12
weeks out gets — the default bump does not touch them) now has **two** deloads, not one,
because the cadence runs into the Specific block.

## Mechanism

- `buildHyroxGrid`: `isDeload` rewritten — cadence `w % DELOAD_EVERY === 0` across
  base/build/specific, sparing week 1, the taper, the protected final Specific weeks, and
  short Specific blocks (`specificDeloadOk`). The sim sets are computed from the
  non-deload Specific weeks (unchanged), so sims route around any Specific deload.
- `WEEKS_BY_EXPERIENCE` defaults raised to 12 / 14 / 18.

## Calibration

`[DEF]` programming schedule, not physiology. **Confidence: HIGH that one-deload-in-12-wk
was too sparse; MODERATE on the exact every-4-week cadence and the specific default
lengths** (both trivially tunable). `DELOAD_EVERY` stays at 4 (4:1) — the conservative end
of the 3:1–4:1 consensus, least disruptive to the existing structure.

## Consequences

- Every default build, and 12-week+ race-date builds, now carry ≥2 deloads on a 4:1
  rhythm; the 6-week unbroken hard stretch is gone.
- The taper, the half-sim sharpeners, the full sim and the "≥1 real race-prep week"
  invariant are all preserved (guards + tests).
- Default plans are 2 weeks longer (beginner/intermediate) / 2 weeks longer (advanced) —
  an intentional product change (longer plans accepted).
- No load-model impact (schedule only). Deload weeks already render a light recovery
  session (`deloadWeekDays`).
- Tests: ADR 0069 block asserts ≥2 deloads per default build with no >5-week gap, the
  12-week race-date two-deload result, and the Specific-deload guards; the block-length
  constant tests updated to 12 / 14 / 18.
