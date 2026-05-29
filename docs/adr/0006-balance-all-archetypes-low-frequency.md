# ADR 0006 — Demote bench + OHP from anchor in STRENGTH_ANCHOR and HYPERTROPHY_ANCHOR so dual-main-lift folding triggers at low frequency

**Status:** Accepted
**Date:** 2026-05-29
**Phase:** D
**Closes follow-up from:** [ADR 0005 — Frequency-aware dual-main-lift folding](./0005-frequency-aware-dual-main-lift-folding.md).
**Evidence base:** [ADR 0004 — Endurance Anchor dual-main-lift](./0004-endurance-anchor-dual-main-lift.md).

## Context

ADR 0005 shipped the post-trim `foldDualMainLifts` transformation and set per-archetype caps (`foldedSecondaryMaxSets = 5` for STRENGTH_ANCHOR, `4` for HYPERTROPHY_ANCHOR). Its open follow-ups recorded an audit finding: both archetypes mark all four strength days as `priority: "anchor"`, so `daysForFrequency` always returns the full 4-day strength block. Folding is therefore a structural no-op for these two archetypes — the caps are armed, but never fire.

User intent on the audit: *"There can't be any archetypes left that only give lower main lifts during the week. It needs to be balanced."* Today `STRENGTH_ANCHOR` at `daysPerWeek = 2` collapses to squat + deadlift (its anchors) — exactly the gap the user flagged. Same shape for `HYPERTROPHY_ANCHOR`.

The evidence base from ADR 0004 applies identically — this is the same gap, in two more archetypes, closed by the same mechanism:

* **Huiberts 2024** (HIGH meta, PMID 37847373) — upper-body strength not impaired by concurrent endurance.
* **Spiering 2021** (HIGH, PMID 33629972) — ≥75% 1RM is the maintenance threshold.
* **Androulakis-Korakakis 2020** (HIGH, PMID 31797219) — 1 hard set/wk at ≥75% 1RM maintains 1RM; 2–5 sets sits comfortably above the floor.

This ADR is a small, mechanical priority demotion. No new infrastructure; no new algorithm. It activates the cap ADR 0005 already wrote.

## Why this is a separate ADR rather than a hotfix to ADR 0005

ADR 0005 deliberately scoped itself to the folding *infrastructure* and left the archetype-shape question as an audit follow-up. Splitting infrastructure and data is the same discipline ADR 0004 → ADR 0005 followed (curated templates → dynamic generalisation). Promoting the audit finding into its own ADR keeps the rationale (anchor demotion is a coverage decision, not a folding decision) reviewable independently from the folding mechanism, and keeps the per-archetype priority changes auditable as a single atomic record.

## Decisions

1. **STRENGTH_ANCHOR `days`.** Bench (`dayIndex 1`) and OHP (`dayIndex 4`) drop from `priority: "anchor"` to `priority: "optional"` with `rank: 7` and `rank: 8` respectively. Squat (rank 1) and deadlift (rank 3) remain anchors. Matches the CONCURRENT_HYBRID convention from ADR 0004.
2. **STRENGTH_ANCHOR `twoADayDays`.** Same demotion on the AM/PM split: bench AM and OHP AM go `priority: "optional"` with ranks 7 and 8.
3. **HYPERTROPHY_ANCHOR `days`.** Same demotion in the archetype's inline strength-day list — bench (`dayIndex 1`) and OHP (`dayIndex 4`) drop from anchor to optional with ranks 7/8.
4. **HYPERTROPHY_ANCHOR `twoADayDays`.** Same demotion for the AM bench / AM OHP entries.
5. **Cardio days — no change in either archetype.** STRENGTH_ANCHOR has no cardio anchor today; we do not add one. HYPERTROPHY_ANCHOR's Z2 day was always `priority: "optional"`; we do not promote it. Hypertrophy identity doesn't depend on cardio the way `CONCURRENT_HYBRID`'s does (where ADR 0004 deliberately anchored Z2 to preserve the "balanced concurrent" identity at freq=2).
6. **Inline comments updated.** The ADR 0005 inline comments in both archetypes ("all four strength days are anchors so folding is a structural no-op") are stale after this change. They become: "ADR 0006 — bench + OHP demoted to optional so dual-main-lift folding (ADR 0005) triggers at freq < 4. `foldedSecondaryMaxSets` here is now LIVE."
7. **Behaviour summary.**
   * STRENGTH_ANCHOR at `freq = 2` → trim returns squat + deadlift (the two anchors) → fold attaches OHP onto squat (≤5 sets) and bench onto deadlift (≤5 sets). All four patterns covered.
   * STRENGTH_ANCHOR at `freq = 3` → squat + deadlift anchors + the rank-5 Z2 cardio. Fold attaches OHP onto squat and bench onto deadlift (both still missing). All four patterns covered.
   * STRENGTH_ANCHOR at `freq = 6` → all four strength days return (2 anchors + 2 optionals by rank, after both cardio days at ranks 5/6) and fold is a no-op. **No behavioural change at high frequency.** This is the critical regression guard the test suite enforces.
   * HYPERTROPHY_ANCHOR at `freq = 2` → squat + deadlift only → fold attaches both upper patterns (≤4 sets each). All four patterns covered.
   * HYPERTROPHY_ANCHOR at `freq = 3` → squat + deadlift + Z2 (rank 5). Fold attaches both upper patterns.
   * HYPERTROPHY_ANCHOR at `freq = 5` → all four strength days + Z2; fold is a no-op (regression guard).
   * At any intermediate frequency in either archetype, fold closes whatever pattern is missing — the user-intent guarantee is "no week left with lower-only main lifts" at *every* supported frequency, not at every frequency exactly equal to 4. The all-archetypes invariant test enforces this for `freq ∈ [2..6]` across every non-disabled archetype.
8. **In-flight blocks safety.** Existing user blocks are not modified — the change applies only to newly-generated blocks. Same posture as ADR 0004 / ADR 0005.

## Rationale

**Why squat + deadlift remain anchors (not some other pair).** Squat and deadlift are the longest-recovery lifts and the highest-stakes patterns to drop. Bench and OHP recover faster and tolerate the folded secondary slot. This also matches CONCURRENT_HYBRID's convention from ADR 0004, keeping the cross-archetype anchor pattern consistent.

**Why STRENGTH_ANCHOR cap = 5 (already set in ADR 0005).** Strength-led identity supports a larger secondary dose. The full back-off wave (top set + descending sets) fits without breaking session timing.

**Why HYPERTROPHY_ANCHOR cap = 4 (already set in ADR 0005).** Hypertrophy stimulus is per-set volume in the 60–75% band; 4 sets at hypertrophy intensity is meaningful per-pattern volume without blowing up total weekly volume.

**Why no algorithm change.** `foldDualMainLifts` already handles the squat-only / deadlift-only trim case (ergonomic pairing: squat↔vertical_press, deadlift↔horizontal_press). The function is archetype-agnostic — activating it for STRENGTH_ANCHOR and HYPERTROPHY_ANCHOR is a data-only change.

**Why not promote one cardio day to anchor.** STRENGTH_ANCHOR's two cardio days (`easy_z2` at `dayIndex 2`, `long_z2_plus_alactic` at `dayIndex 5`) are explicit "added when day budget allows" — promoting either would change the archetype's strength-led identity (rather than just unlocking the freq=2 case). HYPERTROPHY_ANCHOR's single optional Z2 sits there to preserve an aerobic floor when budget allows, not as an identity-defining element. CONCURRENT_HYBRID's situation in ADR 0004 was different: "balanced concurrent" *is* the archetype's identity, so anchoring the Z2 day was the right call there.

**Why squat-and-deadlift specifically as the two-anchor pair.** Beyond recovery time, this pair maximally separates the trim-to-2-day session content — squat is knee-dominant axial loading, deadlift is hip-dominant axial loading. A bench-and-OHP anchor pair would leave the user with two horizontal-pulling-free, leg-free weeks at `freq = 2`, which contradicts the strength-led identity of both archetypes. A squat-and-bench or deadlift-and-OHP pair would create asymmetric upper-lower exposure. Squat + deadlift is the only pair that preserves both archetypes' identity at minimum frequency.

## Session shape — STRENGTH_ANCHOR before / after

```
STRENGTH_ANCHOR at daysPerWeek = 2, before this ADR:

  ?    Squat day                        (single main lift)         ~45–55 min
  ?    Deadlift day                     (single main lift)         ~45–55 min

  Pattern coverage: squat, deadlift. Missing: horizontal_press, vertical_press.

STRENGTH_ANCHOR at daysPerWeek = 2, after this ADR:

  ?    Squat + Overhead Press           (≤5 secondary sets)        target ≤75 min
  ?    Deadlift + Bench Press           (≤5 secondary sets)        target ≤75 min

  Pattern coverage: all four canonical patterns.
```

HYPERTROPHY_ANCHOR's `freq = 2` shape is identical, with `≤4` secondary sets instead of `≤5`.

## Out of scope

* `ENDURANCE_ANCHOR` and `CONCURRENT_HYBRID` — already balanced via ADR 0004 / ADR 0005.
* `REBUILD` and `MAINTENANCE` — `disableFolding: true` from ADR 0005, intentional per their identities.
* Power-emphasis interaction — deferred per ADR 0005.
* Any change to the folding algorithm itself or to `buildPrescription` / warmup / stress pipelines.

## Implications

* **Coverage.** All non-disabled archetypes ship all four canonical patterns weekly at every supported frequency ≥ 2. This is the "no archetype left with lower-only weeks" invariant the user asked for.
* **Session length.** STRENGTH_ANCHOR strength days may grow by 10–15 min on the two folded days when `freq < 4`. Acceptable — the user is opting into fewer total sessions. HYPERTROPHY_ANCHOR session length grows similarly; the 4-set cap was chosen with this in mind.
* **`minDaysForArchetype` shifts.** Anchor calendar day count drops from 4 to 2 for both archetypes (single-session and two-a-day). 2 becomes the new minimum viable frequency. The wizard's frequency picker will now offer 2-day STRENGTH_ANCHOR and HYPERTROPHY_ANCHOR plans.
* **No retroactive change.** Standard live-engine convention — existing blocks keep the templates they were generated with.
* **Constraints doc.** New CP-2 row 33 in `hybrid-training-design-constraints.md`.
* **Live engine spec.** §10 archetype descriptions updated; ADR 0006 line appended to the §20 audit trail.

## Open follow-ups

* Whether to apply ADR 0004's static squat↔OHP / deadlift↔bench rack-ergonomic pairing to STRENGTH_ANCHOR and HYPERTROPHY_ANCHOR's day templates the way ENDURANCE_ANCHOR has it. Folding picks the pairing dynamically at runtime, and the runtime title generation (`"Squat + Overhead Press"`) is sufficient for v1. Deferred.
* Power-emphasis interaction — still deferred (was deferred in ADR 0005 too).
* Whether to scale the 4-set / 5-set caps by week (heavy vs deload). Defer until 4 weeks of post-ship adherence data.
