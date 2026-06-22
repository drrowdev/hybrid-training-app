# ADR 0053 — HYROX week-builder under-specified (quota-model redesign)

**Status:** Accepted
**Date:** 2026-06-21 (proposed) / 2026-06-22 (accepted + implemented)
**Relates to:** ADR 0050 (HYROX program — this revisits its week-generation
internals), ADR 0038 (cardio mesocycle progression), ADR 0008 (event taper).
Calibration policy CP-1…CP-5 in
`docs/knowledge/hybrid-training-design-constraints.md`.

## Context — a user's field report

A user built a HYROX beginner plan and got a week of only ~4 sessions:

| Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|
| Squat·Deadlift·OHP 75% | Easy Run 30m | Rest | Easy SkiErg 30m | Rest | Long Run 48m | Rest |

Their reaction: *"who in their right mind would do only ski-erg for 30 min? …
something is fundamentally wrong in the HYROX planning engine."*

**Verdict: they were right.** This was not cosmetic. The generated week was a
generic concurrent-endurance week, not a HYROX-specific one: **no station work,
no compromised running, no quality running, one monolithic strength day, and a
filler easy-ski.** (The related copy/UX issues — mislabelled "strength days",
superset toggle, future-block volume warning — were fixed separately in
PRs #617–#619.) This ADR is about the **engine**.

## Root cause — pool-by-index selection

`packages/hyrox/src/phases.ts` built a week by walking an **ordered pool** and
taking the first *N* entries for a budget of *N* sessions:

```ts
for (let i = 0; i < primaryCount; i++) {
  const session = pool[i % pool.length]!;     // ← front of the pool wins
  days[wd[i]!] = { kind: "session", session };
}
```

with the base pool ordered `["strength-full", "easy-run", "easy-ski",
"long-run", "threshold-run", "station-intervals", "easy-row"]`. So at **4
sessions** the week was exactly `base[0..3]` =
`strength-full, easy-run, easy-ski, long-run` — **the user's screenshot, verbatim.**
`threshold-run` (idx 4) and `station-intervals` (idx 5) were **never reached**.
The selection was an artifact of array order, not training logic. Consequences:

1. **No station work at low/moderate budgets** — a HYROX plan whose typical week
   has no functional-station session is mis-specified; the stations are half the race.
2. **Compromised running only in race-prep** — the race's defining skill (running
   pre-fatigued off a station) was untrained for the first ~70% of the block.
3. **No quality running until the budget was high** — low-budget weeks were all
   easy aerobic.
4. **A filler easy-ski** stole a primary slot in small weeks purely because of its
   index.
5. **One monolithic strength day** even at high budgets, with no split/variety.

The fix is **level-agnostic**: the builder is parameterized only by `phase` +
`sessionsPerWeek`, so correcting it fixes beginner/intermediate/advanced alike.

## Decision — a session-type quota model

Replace pool-by-index with a **per-phase ordered slot-category model**. Each
phase declares an ordered list of session *categories* (`strength`, `station`,
`quality`, `compromised`, `long`, `easy`, `cross`); the builder takes the first
*N* and resolves each to a concrete session, so the HYROX essentials always lead
and a real HYROX week is guaranteed at any budget (3–8):

```ts
const PHASE_SLOTS = {
  base:     ["strength","station","long","quality","easy","cross","easy"],
  build:    ["strength","station","quality","compromised","long","easy","strength"],
  specific: ["compromised","station","strength","quality","long","easy","cross"],
  taper:    ["strength","station","quality","easy","quality","cross","easy"],
};
```

Resolution adds variety on repeats (a 2nd strength slot splits to
`strength-lower`; a 2nd station uses the other modality; a 2nd quality is VO2).
`cross` = the off-feet ergs (`easy-ski`/`easy-row`), placed LAST so they are
**leftover-only** and never displace a station or quality run.

Worked: a **4-session base** week is now `strength · station · long-run ·
threshold-run` instead of `strength · easy-run · easy-ski · long-run`.

This was shipped in two parts:
- **Part 1 (stop-gap, PR #621, merged):** reorder the existing pools so essentials
  lead — immediate relief for live users.
- **Part 2 (this PR):** the full slot-category quota model, plus the decisions below.

### Resolved options (the four open questions)

1. **Both** — ship the cheap reorder now (PR #621) *and* the quota model (this PR).
2. **Compromised running ramps from Build** (budget ≥ 4), not race-prep-only — it
   is the signature skill and needs a ramp, not a cliff. (User decision.)
3. **Easy-ski/row demoted to leftover-only** — only fill budget ≥ 6, never a
   primary in a small week. (Recommendation, accepted.)
4. **Second strength day splits at high budgets** (`strength-full` →
   `strength-lower`) so a 7–8-session week isn't one monolithic strength day.
   (Recommendation, accepted.)

## Invariants (locked by tests, all levels × budgets 3–8)

`packages/hyrox/src/program.test.ts` → `describe("HYROX week quotas (ADR 0053)")`
asserts, for every experience level and every budget:
- every non-deload work week has **≥1 strength** (sim weeks excepted — the
  simulation IS the stimulus),
- every work week has **≥1 functional station** (or a race sim, which rehearses them),
- every work week has **≥1 running session** (never all off-feet),
- **off-feet ergs are leftover-only** (no ski/row primary below 6 sessions/week,
  deload recovery weeks excepted),
- **compromised running appears from Build** (budget ≥ 4) and in **every race-prep
  week**,
- a **second, split strength day** appears at high budgets,
- the specific reported regression (`strength + easy + ski + long`) cannot recur.

## CP pressure-test

- **CP-1:** the per-phase slot ordering + the "compromised from Build" threshold
  are heuristic weekly doses → `[DEF]` coach-consensus, validated by the
  plan-composition invariant tests above and (once usage exists) adherence signal.
- **CP-2:** **no shared engine constant moved.** HYROX-package-local
  (`phases.ts`); does not touch `buildPrescription`, the ceiling chain, the
  interference scalar, or the modality multipliers. No workspace CP-2 doc sync needed.
- **CP-3:** doses are small integer slot counts.
- **CP-4:** N/A — the HYROX grid is not part of the 2-factor ceiling chain.
- **CP-5:** HYROX methodology cited at MODERATE (practitioner consensus, no RCT).

## Scope / risk

- **HYROX-only**, package-local. No other program is affected (byte-identical).
- Taper / phase-assignment / weeks-by-experience / sim logic (ADR 0050) unchanged;
  only the **within-week session selection** changed.
- HYROX week output changes by design; covered by the new invariant suite rather
  than brittle golden snapshots.
