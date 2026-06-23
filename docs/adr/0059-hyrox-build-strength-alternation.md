# ADR 0059 — HYROX Build phase: alternate a second strength day at a 5-session budget

Status: Accepted
Date: 2026-06-23

## Context

ADR 0056 made the HYROX Build phase **endurance-protected**: the four endurance
essentials (functional station, quality run, compromised run, long run) are taken
ahead of the second strength day, so a second (split) strength day only appears at
**6+ sessions/week**. At the common **5-session** budget the week is
`strength · station · quality · compromised · long` — exactly **one** strength day,
materialised as the full-body `strength-full`.

In real use this produced a jarring cliff. A 12-week / 5-day block runs two strength
days through Base (weeks 1–3), then drops to **one** strength day for the entire
Build **and** Specific block (weeks 5–12 after the week-4 deload). Eight straight
weeks of single-day maintenance strength is a long time, and the `2 → 1` transition
is abrupt rather than a gradual taper of strength frequency. Several best-in-class
HYROX builds hold two strength sessions deeper into accumulation and only cut to one
in the final race-prep weeks.

The constraint is a hard budget: 5 session slots cannot hold all four endurance
essentials **and** two strength days. To gain a second strength day in a Build week
you must drop exactly one endurance essential that week. The four essentials are not
equal in HYROX specificity:

- **station** (functional strength-endurance) — race-specific, keep weekly.
- **compromised** (run-under-fatigue) — the signature HYROX skill, keep weekly.
- **quality** (threshold/VO2) — drives running economy, keep weekly.
- **long** (aerobic base) — the most *bankable*: aerobic base decays slowly and the
  weekday running volume partly substitutes, so it tolerates a biweekly cadence.

## Decision

In the **Build phase only**, at a **5-session budget**, **alternate** Build weeks:

- **"double" weeks** swap that week's **long run** for a second (split) strength day
  → `strength-a · station · quality · compromised · strength-b` (two strength days,
  no long run).
- **"single" weeks** stay exactly as ADR 0056 → `strength-full · station · quality ·
  compromised · long` (one full-body strength day **with** the long run).

The alternation walks the **non-deload Build weeks in order and starts with a
double**, so a fresh post-deload Build re-accumulates strength first (e.g. a 3-week
Build → double / single / double = 2+1+2 strength exposures vs. 1+1+1 before).

Only the bankable **long** run alternates. `station`, `quality`, and `compromised`
stay **weekly** — the high-specificity endurance is never cut. The smoothing this
buys: strength frequency tapers `2 (Base) → ~1.5 (Build) → 1 (Specific) → race`
instead of the old `2 → 1 → 1` cliff.

### Scope (deliberately narrow)

- **Build only.** Specific (race-prep) **stays at one** maintenance strength day —
  specificity is highest there and maintenance strength 2–4 weeks out is correct.
- **5-session budget only.** This is the exact budget where the second strength day
  just misses. 3–4 sessions are unchanged (dropping a second essential there is too
  costly); 6+ sessions already carry two strength days, so the alternation never
  fires.

## Calibration

`[DEF]` scheduling default (an ordered-slot/cadence choice), **not** a new
physiological constant — no CP-2 table entry. It is overridable in spirit via the
session-frequency control (6+ days restores a fixed second strength day). The
direction (hold strength deeper into accumulation for a strength-supportive
endurance sport) is high-confidence coach consensus; the *exact* biweekly cadence
and "drop the long run" choice are the `[DEF]` calibration this ADR fixes.

## Consequences

- A 5-session Build now undulates strength 2/1/2…; some Build weeks have **no long
  run** (the cost of the second strength day). A long-run-limited athlete can keep
  the old behaviour by staying at ≤4 sessions or can lift the whole block to 6+.
- Invariants preserved: every Build week keeps a strength day, a station, and run
  work (quality + compromised); no week becomes lower-only (the split is full-body
  Squat+Press / Deadlift+Pull); deload and taper weeks are untouched.
- Does **not** address the separate question of a block with **no scheduled race**
  (which still tapers toward an implied race at block end) — tracked as a follow-up.
