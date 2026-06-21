# ADR 0053 — HYROX week-builder is under-specified (assessment + redesign proposal)

**Status:** Proposed (assessment + design — written for review before any engine
code, per the "propose engine changes first" rule)
**Date:** 2026-06-21
**Relates to:** ADR 0050 (HYROX program — this revisits its week-generation
internals), ADR 0038 (cardio mesocycle progression), ADR 0008 (event taper).
Calibration policy CP-1…CP-5 in
`docs/knowledge/hybrid-training-design-constraints.md`.

## Context — a user's field report

A user built a **6-training-day HYROX beginner** plan and got a week of only
~4 sessions:

| Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|
| Squat·Deadlift·OHP 75% | Easy Run 30m | Rest | Easy SkiErg 30m | Rest | Long Run 48m | Rest |

Their reaction: *"who in their right mind would do only ski-erg for 30 min? …
something is fundamentally wrong in the HYROX planning engine."*

**Verdict: they are right.** This is not cosmetic. The generated week is a
generic concurrent-endurance week, not a HYROX-specific one: **no station work,
no compromised running, no quality running, one monolithic strength day, and a
filler easy-ski.** The copy/UX issues (mislabelled "strength days", superset
toggle, future-block volume warning) are fixed separately (PRs #617–#619); this
ADR is about the **engine**.

## Root cause — pool-by-index selection

`packages/hyrox/src/phases.ts` builds a week by walking an **ordered pool** and
taking the first *N* entries for a budget of *N* sessions:

```ts
// phases.ts:163-166
for (let i = 0; i < primaryCount; i++) {
  const session = pool[i % pool.length]!;     // ← front of the pool wins
  days[wd[i]!] = { kind: "session", session };
}
```

with the base pool ordered:

```ts
// phases.ts:99-107
base: ["strength-full", "easy-run", "easy-ski", "long-run",
       "threshold-run", "station-intervals", "easy-row"],
```

So at **4 sessions** the week is exactly `base[0..3]` =
`strength-full, easy-run, easy-ski, long-run` — **the user's screenshot, verbatim.**
`threshold-run` (idx 4) and `station-intervals` (idx 5) are **never reached**. The
selection is an artifact of array order, not training logic. Consequences:

1. **No station work at low/moderate budgets.** `station-intervals` / `se-circuit`
   sit at the back of every pool; a 3–5-session week rarely or never includes one.
   A HYROX plan whose typical week has **no functional-station session** is
   mis-specified — the stations are half the race.
2. **Compromised running only in race-prep.** `compromised-run` appears **only**
   in the `specific` pool (`phases.ts:119-127`), i.e. the last ~30% of the block.
   The race's defining skill (running pre-fatigued off a station) is untrained for
   the first 70% of a beginner's 10 weeks.
3. **No quality running until the budget is high.** `threshold-run` / `vo2-intervals`
   are mid/back of the pools, so low-budget weeks are all easy aerobic — no
   threshold or VO₂ development.
4. **The filler easy-ski.** `easy-ski` is `base[2]`, so it scores a *primary* slot
   in a 4-session week, displacing a run or a station. A 30-min steady ski-erg is
   fine as occasional low-impact cross-training but is poor use of a scarce
   session — the user's incredulity is justified. It's there purely because of its
   index, not because the week needs it.
5. **One monolithic strength day.** `strength-full` stacks squat+deadlift+press
   (`sessions.ts:233`). This is *defensible* for a time-crunched athlete and is
   intentional, but it's the **only** strength session that schedules at low
   budgets (no variety/progression), and at a 6-day budget there's room to split.
   Lower severity — more "taste" than "broken" — but worth revisiting.

There is also a **UX disconnect** feeding the perception: HYROX is
fixed-schedule, so the wizard's Schedule-step weekday picker is hidden and the
real count is HYROX's own `sessionsPerWeek` loadout dropdown (default 5). The
user's "6 days" likely never applied; they got 4. (Tracked with the wizard work,
not this ADR, but it compounds the impression.)

## Evidence base (HYROX methodology — MODERATE)

HYROX = 8×1 km runs alternating with 8 functional stations (ski-erg, sled
push/pull, burpee broad jumps, row, farmers carry, sandbag lunges, wall balls).
Practitioner consensus (no RCT literature specific to HYROX) is consistent that a
build needs, every week from early on: **easy aerobic volume, some quality
running (threshold/VO₂), strength for the loaded stations, dedicated station /
strength-endurance work, and — increasingly toward race day — compromised
running.** The current engine delivers only the first one or two at typical
budgets. The *principle* (a HYROX week must contain station + run-quality work)
is high-confidence; the exact weekly *doses* are practitioner heuristics (CP-1).

## Proposed redesign — a session-type quota model

Replace pool-by-index with a **category-quota** fill. Each phase declares target
weekly doses per session category; the builder allocates the session budget to
hit per-phase **minimums first**, then fills the remainder by priority. This
guarantees a real HYROX week at *any* budget.

Categories: `aerobic_easy`, `aerobic_quality` (threshold/VO₂), `strength`,
`station` (intervals / SE circuit), `compromised_run`, `long_run`, plus an
optional `cross_easy` (the ski-/row-erg easy sessions) that only fills *leftover*
budget — never displaces a station/run/strength slot.

Illustrative per-phase minimum quotas (CP-1 heuristics, one sig fig — to be
reviewed, not shipped as-is):

| Phase | strength | station | quality run | compromised | long run | easy fills rest |
|---|---|---|---|---|---|---|
| Base | ≥1 | ≥1 | ≥0–1 | 0 | ≥1 | yes |
| Build | ≥1 | ≥1 | ≥1 | ≥0–1 (light, NEW) | ≥1 | yes |
| Race-prep | ≥1 | ≥1 | ≥1 | ≥1–2 | ≥1 | yes |
| Taper | maintain | ≥1 short | ≥1 short | ≥1 short | — | yes |

Worked: a **4-session base** week becomes e.g. `strength · station · quality-run ·
long-run` (or `strength · station · easy-run · long-run` if quality is deferred in
base) — a HYROX week, instead of `strength · easy-run · easy-ski · long-run`.

Other changes bundled with the quota model:
- **Demote `easy-ski`/`easy-row` to `cross_easy`** — only fills leftover budget,
  so it never takes a primary slot in a small week.
- **Introduce `compromised-run` from Build** (light), not only race-prep — it's
  the signature skill and needs a ramp, not a cliff.
- **Optionally split strength** at ≥5 sessions (`strength-lower` / `strength-upper`
  already exist in `sessions.ts`) instead of always `strength-full`.

## CP pressure-test

- **CP-1:** the per-phase quotas + the "introduce compromised-run in Build"
  threshold are new heuristics → tagged `// heuristic — HYROX weekly dose (CP-1),
  practitioner-consensus`, with a validation plan: **plan-composition audit**
  (does every generated week contain ≥1 station + appropriate run quality?) and,
  once usage exists, adherence/perceived-quality signal.
- **CP-2:** no shared engine constant moves. This is HYROX-package-local
  (`phases.ts` / `sessions.ts`); it does not touch `buildPrescription`, the
  ceiling chain, the interference scalar, or the modality multipliers.
- **CP-3:** doses expressed as small integer counts, one sig fig.
- **CP-4:** N/A — the HYROX grid is not part of the 2-factor ceiling chain.
- **CP-5:** HYROX methodology cited at MODERATE (practitioner consensus, no RCT);
  no fabricated precision.

## Scope / risk

- **HYROX-only**, package-local. No other program is affected.
- The taper / phase-assignment / weeks-by-experience logic (ADR 0050) stays; only
  the **within-week session selection** changes.
- Golden-master / snapshot: HYROX week output WILL change by design (that's the
  point). Snapshots get re-blessed with the reviewed quotas; other programs stay
  byte-identical.

## Open questions for review

1. **Build the quota model now, or first just reorder the pools** (a cheaper
   stop-gap: move `station-intervals` + `threshold-run` to the front so low
   budgets at least include them)? The reorder is ~1 line per pool and removes the
   worst symptom today; the quota model is the proper fix. I'd do the **reorder
   now** (immediate relief) **and** schedule the quota model as the real fix —
   your call on whether to do both or jump straight to quotas.
2. **Compromised running from Build** — agree it should ramp earlier, or keep it
   race-prep-only (more conservative for true beginners)?
3. **Easy-ski/row** — demote to leftover-only (my recommendation), or keep as a
   legitimate low-impact primary on high-fatigue weeks?
4. **Strength split at ≥5 sessions**, or keep the single full-body day as the
   intentional time-efficient choice?

## Decision

Pending review. Recommended path: **(a) ship the cheap pool-reorder stop-gap
now** so low-budget weeks stop missing stations/quality entirely, then **(b)
implement the quota model** as the real fix with the reviewed CP-1 doses.
