# ADR 0005 — Frequency-aware dual-main-lift folding for sub-4-strength-day plans

**Status:** Accepted
**Date:** 2026-05-29
**Phase:** D
**Generalises:** [ADR 0004 — Endurance Anchor dual-main-lift redesign](./0004-endurance-anchor-dual-main-lift.md).

## Context

ADR 0004 added `StrengthDay.secondaryRole` / `secondaryTitle` / `secondaryCandidateSlugs` / `secondaryMaxSets` to attach a same-J-cup-height upper lift onto each of the two `ENDURANCE_ANCHOR` strength sessions. The mechanism is data-driven, but the data was applied to exactly one archetype.

Other archetypes hit the same evidence wall whenever the user lands on a sub-4-strength-day week:

* `CONCURRENT_HYBRID` at `daysPerWeek = 2` trims to squat + deadlift (its only anchors) + the easy-Z2 anchor — the bench and OHP days are `priority: "optional"` after the ADR 0004 trim fix and get dropped. The two upper main-lift patterns are entirely missing for the duration of the block.
* `CONCURRENT_HYBRID` at `daysPerWeek = 3` is the same picture plus one extra cardio session — still no upper main lift.
* Any archetype whose anchor structure happens to leave a pattern uncovered at the trimmed frequency.

The evidence base for *why* this matters is unchanged from ADR 0004 and applies identically:

* **Huiberts 2024** (HIGH): concurrent interference is concentrated in lower-body strength; upper-body strength is statistically unaffected (SMD ≈ 0).
* **Spiering 2021** (HIGH): the minimum effective intensity to maintain 1RM is ≥75% 1RM; below that the user drifts toward regression.
* **Androulakis-Korakakis 2020** (HIGH): one hard set per week at ≥75% 1RM is sufficient to maintain (and in some populations grow) upper-body 1RM in trained lifters.

A user picks a low-frequency plan for life-fit reasons — busy weeks, travel, deload, family load. Losing whole movement patterns as a consequence is the wrong default. The ADR 0004 fix already exists in the codebase; the missing piece is applying it dynamically when the frequency trim creates the same coverage gap that the static ENDURANCE_ANCHOR template was designed around.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Fold after the trim | After `daysForFrequency` returns the trimmed list, if the strength-session count is `< 4` and any of the four canonical patterns (`squat`, `deadlift`, `horizontal_press`, `vertical_press`) is uncovered, fold the missing pattern(s) onto existing strength days using ADR 0004's ergonomic pairing (squat↔vertical_press, deadlift↔horizontal_press) | Same evidence as ADR 0004, applied to the same coverage gap. Folding rather than re-trimming preserves the user's chosen frequency |
| 2 | New module, pure function | Implemented in a new module `apps/web/src/lib/planner/main-lift-folding.ts`, exported as `foldDualMainLifts(archetype, trimmedDays)`. Wired into both `createBlock` (after `daysForFrequency`, before placement remap) and `createCustomBlock` (after `compileCustomArchetype`, before strength resolution). Pure function, returns a new array | Pure post-trim transformation. No special-casing inside the prescription pipeline; same data shape that ADR 0004 already plumbs end-to-end |
| 3 | Skip-if-already-present guard | If a `StrengthDay` already carries `secondaryRole`, the fold step leaves it untouched. ENDURANCE_ANCHOR's static templates survive unchanged | Backwards compatibility. ADR 0004's curated pairings are explicit and ergonomic; the dynamic step is a fallback that fills coverage, not a re-writer of curated data |
| 4 | 3-strength-day fold rule | If exactly one pattern is missing, fold it onto its ergonomic partner. If the partner day is not in the trimmed list either, fold onto whichever strength day is present and does not already have a secondary (deterministic order: lowest `dayIndex` first) | Symmetric with the 2-day case. The ergonomic rationale is the binding constraint when it can be honoured; coverage is the binding constraint when it can't |
| 5 | 2-strength-day case | Squat + deadlift trim folds to squat+OHP, deadlift+bench (matches ADR 0004) | Same rack-ergonomics reasoning as ADR 0004 — both pairs share the J-cup height |
| 6 | Edge: 2 days, non-canonical pair | E.g. trim returns squat + bench. Fold deadlift onto the bench day (its partner) and OHP onto the squat day (its partner). If no fold can apply cleanly, log via `console.warn("[main-lift-folding] …")` and return unchanged | Ergonomic pairing still applies pattern-wise even when the present pair isn't itself ergonomic. Soft-fail rather than silent gap |
| 7 | Per-archetype secondary set cap | New archetype-level field `foldedSecondaryMaxSets?: number` (defaults to `3` if absent). Read at fold time and written to the folded day's `secondaryMaxSets`. ENDURANCE_ANCHOR = 3, CONCURRENT_HYBRID = 3, STRENGTH_ANCHOR = 5, HYPERTROPHY_ANCHOR = 4. New `disableFolding?: boolean` opts an archetype out entirely. REBUILD = true, MAINTENANCE = true — both are intentionally minimal recovery/maintenance archetypes whose identity is "do less" | Cap calibrated to each archetype's recovery budget. REBUILD's intensity cap and tendon-day anchors leave no room for extra main-lift volume; MAINTENANCE's two-week sub-maintenance shape is the point of the archetype |
| 8 | Two-a-day variants | Same logic. Strength sessions in two-a-day templates count as strength sessions for the count. Folding applies regardless of AM/PM slot, keyed by `daySlotKey` so AM+PM pairs on the same calendar day don't collide | The interference budget Huiberts 2024 identifies is about session content, not session timing. AM strength sessions are still strength sessions |
| 9 | Title computation | Folded days get titles of the form `"Squat + Overhead Press"` joining primary + secondary friendly labels. Days that ADR 0004 (or any future curated source) has already populated with `secondaryRole` retain their existing title via Decision 3 | Consistent visual treatment with the ADR 0004 ENDURANCE_ANCHOR titles. Explicit pairings still win where they exist |
| 10 | Missing-TM enforcement | Folded secondary slots use the same `missingRoles` push pattern from ADR 0004. A user without bench TM on a 2-day CONCURRENT_HYBRID gets the actionable `No TM set for: Bench Press, Overhead Press` error | The fold makes the secondary required, not opt-in. Silently dropping it would re-create the coverage gap the fold exists to close |

## Rationale (point by point)

**Why generalise now.** ADR 0004 paid for the type extension and threaded it end-to-end through resolution, prescription, warmup, and stress accounting. Adding a post-trim transformation that emits the same data shape is the cheapest possible way to close the coverage gap for the other archetypes. Doing it via static day-template edits per archetype would multiply the edge cases (every archetype × every frequency × two-a-day vs single) and lock the coverage policy to handwritten data; the dynamic step keeps the policy in code, in one place.

**Why post-trim, not pre-trim.** Pre-trim would mean editing archetype templates to carry the secondary fields, which is the ADR 0004 approach. That's correct for ENDURANCE_ANCHOR — the dual-main-lift shape is the archetype's identity at all frequencies. It is wrong for CONCURRENT_HYBRID — there the dual-main-lift shape is a frequency-trim mitigation, not the archetype's identity at freq ≥ 4. Post-trim keeps the high-frequency behaviour untouched and applies the mitigation only where the coverage gap actually opens.

**Why ergonomic pairing carries through.** ADR 0004 chose squat↔OHP and deadlift↔bench because both pairs share the same J-cup height on a power rack and remove the only piece of equipment manipulation that would otherwise fragment a dual-lift session. That rationale is rack-bound, not archetype-bound — it applies wherever two main lifts share a session, including the dynamically-folded cases this ADR introduces. The non-canonical edge case (Decision 6) still honours it pattern-wise even when the trimmed pair isn't itself ergonomic.

**Why opt REBUILD and MAINTENANCE out.** REBUILD's whole point is a sub-strength-driving load with tendon-day anchors carrying the recovery budget; an extra main lift in a single session contradicts the archetype's design intent. MAINTENANCE explicitly runs at sub-maintenance volume for two weeks of life-fit cover; adding a secondary main lift would convert it into a normal training block. Both are easy "no" calls — the `disableFolding` flag is the right shape to record them.

**Why per-archetype caps.** A blanket cap would either over-program ENDURANCE_ANCHOR (whose 3-set ceiling exists because cardio is competing for recovery) or under-program STRENGTH_ANCHOR (whose strength-led identity supports a larger maintenance dose than 3 sets if folding ever triggers). The per-archetype field — `foldedSecondaryMaxSets` — keeps the dose calibrated to the archetype's recovery budget without leaking branching into the fold function itself.

## Implementation contract

The fold is a single pure function plus two type-extension fields. No change to existing prescription-pipeline behaviour at the four-strength-day frequencies; no change to ENDURANCE_ANCHOR's behaviour at any frequency.

* **Type additions.** `Archetype` gains two optional fields:
  ```ts
  /** Cap for secondary-slot set count when foldDualMainLifts attaches a secondary. */
  foldedSecondaryMaxSets?: number;
  /** When true, foldDualMainLifts is a no-op for this archetype. */
  disableFolding?: boolean;
  ```
  Per-archetype values: `ENDURANCE_ANCHOR.foldedSecondaryMaxSets = 3`, `CONCURRENT_HYBRID.foldedSecondaryMaxSets = 3`, `STRENGTH_ANCHOR.foldedSecondaryMaxSets = 5`, `HYPERTROPHY_ANCHOR.foldedSecondaryMaxSets = 4`, `REBUILD.disableFolding = true`, `MAINTENANCE.disableFolding = true`. No change to `StrengthDay` — the existing ADR 0004 fields carry the folded result.
* **Module.** `apps/web/src/lib/planner/main-lift-folding.ts` exports one pure function:
  ```ts
  export function foldDualMainLifts(
    archetype: Archetype,
    trimmedDays: DayTemplate[],
  ): DayTemplate[]
  ```
  Steps: (1) early-return if `archetype.disableFolding === true`; (2) count strength-session days in the trimmed list; (3) early-return if count ≥ 4; (4) compute present strength roles across primaries (and any existing secondaries — Decision 3 guard); (5) compute missing patterns from the canonical four; (6) early-return if none are missing; (7) for each missing pattern, attach to its ergonomic partner's day if that day has no `secondaryRole` yet, else attach to the strength day with the lowest `dayIndex` that has no secondary yet; (8) if no slot is available, `console.warn` and return unchanged for that pattern.
* **Day mutation shape.** A folded day is a shallow clone with `secondaryRole`, `secondaryCandidateSlugs` (from `STRENGTH_ROLE_CANDIDATES[missingPattern]`), `secondaryTitle`, `secondaryMaxSets` (`archetype.foldedSecondaryMaxSets ?? 3`), and a regenerated `title` of the form `"Squat + Overhead Press"`. Non-strength days and strength days that aren't folded pass through by reference.
* **Wiring.** `createBlock` calls `foldDualMainLifts(archetype, canonicalActiveDays)` between `daysForFrequency` and `applyPlacementsToActiveDays`. `createCustomBlock` calls `foldDualMainLifts(archetype, archetype.days)` after `compileCustomArchetype` and replaces `archetype.days` so the downstream strength-resolution loop and row-emission loop see the same shape. Both call sites are pure addition — no existing logic is removed, no branches added inside the prescription pipeline.
* **Observability.** Unfoldable cases (Decision 6 "no fold can apply cleanly") emit `console.warn("[main-lift-folding] …")` matching the existing `[planner]` / `[limitations-context]` prefix convention in `actions.ts` and `limitations-context.ts`. No new logging primitive.
* **Movement resolution + prescription.** Unchanged. The folded `secondaryCandidateSlugs` flow through `allCandidateLiftSlugs`, `pickSecondaryStrengthMovement`, and `buildPrescription`'s existing secondary-movement argument exactly as ADR 0004 plumbed them.

## Out of scope for this PR

* No change to `buildPrescription`, `pickSecondaryStrengthMovement`, or the warmup / stress / ceiling pipelines — they consume the same `secondaryRole` shape they already handle from ADR 0004.
* No UI superset / back-to-back hint. The fold emits the data; rendering is unchanged.
* No change to `accessoryProfile` for any archetype. This ADR adds main-lift exposure; it does not also add accessory exposure.
* Power-emphasis interaction (power lifts use a different movement set and may need their own pairing rule) — deferred to a separate ADR if needed.

## Session shape — before / after

```
CONCURRENT_HYBRID at daysPerWeek = 2, before this ADR:

  Wed  Easy Z2                                                    ~60 min
  ?    Squat day                       (single main lift)         ~45–55 min
  ?    Deadlift day                    (single main lift)         ~45–55 min

  Pattern coverage: squat, deadlift. Missing: horizontal_press, vertical_press.

CONCURRENT_HYBRID at daysPerWeek = 2, after this ADR:

  Wed  Easy Z2                                                    ~60 min
  ?    Squat + Overhead Press          (≤3 secondary sets)        target ≤75 min
                                       [same J-cup height; superset or alternate sets]
  ?    Deadlift + Bench Press          (≤3 secondary sets)        target ≤75 min
                                       [same J-cup height; superset or alternate sets]

  Pattern coverage: squat, deadlift, horizontal_press, vertical_press.
```

ENDURANCE_ANCHOR at every frequency is unchanged by this ADR — its strength days already carry `secondaryRole` from ADR 0004, which Decision 3's skip-if-already-present guard preserves verbatim.

## Implications

* **Coverage.** CONCURRENT_HYBRID at freq = 2 ships all four canonical patterns weekly instead of two. Same for freq = 3 when one pattern is missing from the trim. ENDURANCE_ANCHOR is unchanged at every frequency (already covered by ADR 0004).
* **Session length.** Folded CONCURRENT_HYBRID strength sessions move from single-lift (~45–55 min) toward the ADR 0004 ≤ 75 min target. Cap held at 3 sets keeps the secondary inside the maintenance-dose band Spiering / Androulakis-Korakakis identify.
* **TM gating.** A user picking CONCURRENT_HYBRID at freq = 2 now needs TMs for all four main patterns. The `No TM set for X` error path already exists from ADR 0004 and surfaces this without code change.
* **STRENGTH_ANCHOR and HYPERTROPHY_ANCHOR posture.** No behaviour change today — see Open follow-ups for the audit finding. Caps are still written so the moment either archetype's day shape changes, the fold has the right dose ready.
* **No retroactive change.** Standard live-engine convention. Existing active blocks keep the day templates they were generated with; only newly-generated blocks pick up folding.
* **Constraints doc.** New CP-2 row 32 in `hybrid-training-design-constraints.md` referencing this ADR.
* **Live engine spec.** Per-archetype folding-behavior notes under §10; ADR-0005 line in the §20 audit trail.

## Open follow-ups

* **STRENGTH_ANCHOR + HYPERTROPHY_ANCHOR audit (recorded finding).** Both archetypes mark all four strength days as `priority: "anchor"`, so `minDaysForArchetype` returns 4 and `daysForFrequency` always retains the full four-day strength block. Folding is therefore a structural no-op for these two today. `foldedSecondaryMaxSets` is still set on both so the cap takes effect immediately if a future ADR ever drops one of their patterns to `optional` (mirroring what ADR 0004 did to CONCURRENT_HYBRID). No archetype-shape change is made under this ADR.
* Whether ENDURANCE_ANCHOR's static secondary templates should be deleted in favour of relying on the fold step. Deferred to a cleanup ADR if folding stabilises for 4+ weeks of post-ship adherence data without surfacing fold-vs-static drift.
* Whether HYPERTROPHY_ANCHOR should adopt a different fold rule if its per-pattern day shape ever changes (e.g. upper/lower split). Cap is currently set at 4 to honour the archetype's per-set volume identity if folding ever triggers.
* Whether the 3-set / 4-set / 5-set caps should scale by week (e.g. lower on heavy weeks, full on lighter weeks). Defer until 4 weeks of post-ship data.
* Power-emphasis interaction — power lifts use a different movement set and the ergonomic pairing rationale doesn't map cleanly. Separate ADR if pursued.
