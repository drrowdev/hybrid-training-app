# ADR 0022 — Accessory weekly-volume units fix + bucket-aware reps

- **Status:** Accepted (implemented in the same PR). Scope confirmed with the
  user 2026-06-01.
- **Date:** 2026-06-01
- **Supersedes / extends:** Extends the accessory-picker volume model
  (`focus-muscle-targets.ts` + `accessory-picker.ts`). Related: ADR 0016
  (effort/volume dial), ADR 0020 (secondary-focus volume tilt), ADR 0021
  (secondary-focus intensity tilt). Does **not** touch `buildPrescription`'s
  main-lift path or the dual-main-lift folding ADRs (0004–0006).

## Context

A user inspecting a Strength-archetype Week-1 day (Front Squat + Standing
Overhead Press + six accessories) reported every accessory reading an
identical **3 × 10**, and questioned whether accessory programming was really
distributing a weekly volume or just stamping a constant.

Recon confirmed two distinct issues — one cosmetic, one a genuine half-wired
model:

### Issue A — uniform reps (cosmetic)

`buildPick` (`accessory-picker.ts`) sets every aesthetic accessory's reps to
the **midpoint** of the archetype's `aesthetic.repRange`. For the Strength
archetype that range is `{ min: 8, max: 12 }`, so every line rounds to **10**.
A compound row and a lateral raise come out at the same rep target, which
reads as un-programmed.

### Issue B — the weekly-volume units mismatch (the real bug)

The engine **does** have a weekly per-muscle volume model:
`defaultMuscleTargets()` (`focus-muscle-targets.ts`) emits `perMuscleTargets`
in **sets per week** (baseline `DEFAULT_MUSCLE_TARGET = 6`, focus muscles
raised toward MAV via the landmark table; total weekly sets held constant by
the substitution-with-cap invariant).

But the picker tracks delivered progress in the **wrong unit**.
`countMusclesPrimary` and the four gap-fill bump sites credit **+1 per item**
per primary muscle, then `pickLargestAestheticGap` compares that
item-count progress directly against the sets/week target:

```
gap = target(sets/week)  −  progress(items)
```

Because the targets (6+) dwarf the handful of items a session can deliver
(~2), gaps effectively never close. The consequence:

- The weekly target acts as a **priority ranking** (pick the muscle with the
  biggest nominal gap next), not as a real **set budget**. A muscle never
  "fills up" and drops out, so a chosen **focus muscle does not actually
  receive the extra weekly sets** its raised landmark intends — the headline
  promise of the focus feature is structurally under-delivered.
- In the **no-focus** case every target is the same `6`, so largest-gap
  selection degenerates to round-robin-by-exposure regardless of unit — which
  is why no-focus blocks look reasonable and the bug went unnoticed.

So the model is half-wired: correct in intent (landmarks, substitution
invariant) but inert wherever targets differ across muscles, i.e. exactly the
focus case it exists to serve.

## Decision

Ship **two surgical changes** in one PR. No new constants are introduced.

### B1 — Count delivered accessory volume in **sets**, not items

Make the picker's per-muscle progress accumulator speak the same unit
(sets/week) as the targets it is compared against:

- `countMusclesPrimary(week, fallbackSets)` sums each history item's `sets`
  into each of its primary muscles (was: `+1` per item).
- The four in-loop bump sites (durability, functional, power, aesthetic) add
  the **built pick's `sets`** into each primary muscle (was: `+1`).
- `pickLargestAestheticGap` is unchanged — it is now an apples-to-apples
  `target(sets) − progress(sets)` comparison.
- `WeekAccessoryHistoryItem` gains an optional `sets?: number`. The assembler
  (`assemble-prescription.ts`) populates it from the pick (`sets: p.sets`).
  When absent (older fixtures / callers that never recorded it), the picker
  falls back to `profile.aesthetic.setsPerItem` — i.e. "assume one standard
  exposure at the archetype base." Production always supplies the real value.

**Effect.** A muscle now "completes" once its weekly set target is met and
drops out of contention, freeing the gap-fill budget for under-target
(focus) muscles. For **no-focus blocks the selection is essentially
unchanged** (uniform targets ⇒ same round-robin ordering whether counting
items or sets). The behaviour change is concentrated in the **focus case**,
which is the bug being fixed.

Per-session item counts are **not** reduced in practice: across an archetype's
~10 aesthetic target muscles the total weekly set target (~60) far exceeds what
a strength week's accessory budget delivers (~20–30 sets), so gaps never
exhaust and sessions still fill to their item cap. (Were a configuration ever
to invert this, the loop terminating early is the *correct* response — stop
adding junk volume once weekly targets are met — and would surface in tests.)

### A — Bucket-aware reps within the archetype range

In `buildPick`, when there is no explicit `repsOverride`, infer the accessory
bucket (`inferAccessoryBucket`, already the source of truth for RIR/tempo) and
select reps **within the archetype's existing `aesthetic.repRange`**:

| Bucket                              | Reps                | Rationale |
|-------------------------------------|---------------------|-----------|
| `isolation`                         | `repRange.max`      | Single-joint work is conventionally run lighter / higher-rep (joint-stress + practicality). |
| `compound` (also the default)       | `repRange.min`      | Multi-joint accessories carry more absolute load; lower end is the standard dose. |
| `isometric` / `carry` / `plyometric` / `tendon` | `repRange` midpoint | Reps are moot here — these buckets are re-expressed downstream as holds / distance / explosive-intent overrides. |

This makes lines read as intentionally programmed (e.g. `3×8` rows alongside
`3×12` raises) instead of a uniform `×10`.

### Explicitly **not** done — per-item set variation within a session

Sets per accessory stay at the archetype base (modulated only by the existing
levers: secondary-focus tilt `setsPerItemDelta`, hypertrophy effort
preference, deload `weekDeloadScale`). Three accessories in one session
sharing **3 sets** is correct hypertrophy programming — weekly volume is
governed by **frequency and exercise selection** (now driven by the fixed
model in B1), not by jittering sets per line. Varying sets per item by bucket
would be an arbitrary constant with no volume model behind it (a `B2`/`B3`
option, declined). Reps varying (A) is what makes the prescription look
intentional; sets staying constant is a feature, not the bug.

## Calibration policy (CP-1 … CP-5)

- **No new absolute constants.** B1 reuses the existing `perMuscleTargets`
  (already landmark-sourced) and only corrects the accumulator's unit. A
  reuses each archetype's existing `aesthetic.repRange` endpoints — it selects
  *which existing endpoint* to use, it does not introduce a number.
- **CP-3 (precision needs a tag):** the bucket→rep-endpoint mapping is a
  structural heuristic, tagged `// heuristic` at the call site, consistent with
  the rep-range-equivalence direction of **Schoenfeld 2017** (systematic
  review: hypertrophy is largely rep-range-insensitive from ~6–20+ reps at
  matched effort, so biasing compound→low / isolation→high is a free
  joint-stress/practicality win, not a hypertrophy trade-off). No fabricated
  point-citation on a coefficient — there is no coefficient.
- **CP-2/CP-5:** the underlying MEV/MAV landmarks in `focus-muscle-targets.ts`
  keep their existing heuristic-pending-data status; this ADR does not change
  their values, only makes the picker honour them.

## Consequences

- **Accessory programming changes for all blocks** (reps always; weekly
  distribution in the focus case). The app currently has **no other users and
  only test data**, so no migration/backfill is required and the user has
  accepted the behaviour change.
- **No-focus regression surface is small** by construction (selection ordering
  is preserved); the visible delta there is reps only.
- Picker / golden tests that assert exact reps or focus-case pick distributions
  are updated in the same PR. The substitution invariant in
  `focus-muscle-targets.test.ts` is unaffected (it asserts on
  `defaultMuscleTargets` *output*, which B1 does not touch).
- Read/RLS posture unchanged — this is pure planner logic, no new write path.

## Validation plan (for the heuristic surface)

The bucket→rep mapping and the now-live weekly set budget are heuristics. Once
real user data exists, revisit with: (i) adherence / completion delta on
accessory work, and (ii) whether chosen focus muscles actually accumulate the
intended weekly set premium in shipped blocks. Rollback threshold: if the set
budget causes observed weekly accessory volume to drop materially below the
landmark MEV for non-focus muscles, revert B1's early-completion behaviour to a
softer priority weighting.
