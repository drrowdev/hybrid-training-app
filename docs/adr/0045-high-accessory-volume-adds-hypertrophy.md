# ADR 0045 — High accessory volume actually adds hypertrophy work

Status: Accepted (2026-06-09)
Supersedes: none
Related: ADR 0024 (accessory-volume Low/Med/High lever — the control this fixes),
ADR 0027 (synergist credit — the compound coverage that saturated the gap-fill),
ADR 0028 (goal-weighted physique-triad down-weight — cancelled at High),
ADR 0020 (secondary-focus tilt — the muscle-secondary path that is inert on
concurrent_hybrid). `focus-muscle-targets.ts` (per-muscle landmarks).

## Context

The Low/Medium/High accessory-volume lever (ADR 0024) was **inert** on
"cardio-safe" performance archetypes — most visibly `concurrent_hybrid`
(Hybrid Focus). On a 4-lift + 2-cardio hybrid block, every level produced an
identical strength day with **zero** hypertrophy (aesthetic) accessories, so the
wizard greyed "High" as redundant and the user could not opt into more volume.

Root cause (verified empirically against the real seed catalog):

1. **The aesthetic gap-fill is target-driven.** It only seats an aesthetic item
   for a muscle whose weekly target exceeds the coverage it already has. ADR 0027
   seeds that coverage from the main compound lifts. On `concurrent_hybrid` the
   four compounds already cover every aesthetic muscle to its MEV-floor target
   (`DEFAULT_MUSCLE_TARGET = 6`), so there was **no gap to fill**.
2. **The aesthetic budget is a shared ceiling, not additive.** `aestheticMaxItems`
   (≈ `itemsPerSession + FLOOR_FUNCTIONAL_RESERVE`) is checked against the TOTAL
   pick count. `concurrent_hybrid`'s mandatory durability + functional floor
   (~7 items) already met that ceiling, so the aesthetic loop never ran.
3. **The "muscle" secondary focus is a no-op here** (ADR 0020), and the ADR 0028
   physique-triad down-weight further suppressed the few aesthetic targets — so
   even the documented escape hatch did nothing.

Net: the lever, the recommendation chip ("muscle second goal → High adds
hypertrophy work"), and the greyed-High tooltip ("the plan caps accessory
volume") were all dishonest on this archetype.

## Decision

Make **High** genuinely add hypertrophy volume, while keeping **Medium/Low
byte-identical** (the cardio-safe default). Three composed changes, all gated on
`accessoryVolume === "high"`:

1. **Raise the aesthetic targets** (`defaultMuscleTargets({ highVolume })`). At
   High the per-muscle baseline is lifted from the MEV floor to each muscle's
   PRODUCTIVE-zone landmark (`FOCUS_LANDMARKS[m].productive`; Israetel 2017 RP /
   Schoenfeld 2017 / Baz-Valle 2022), creating genuine gaps for the fill to chase.
2. **Make the aesthetic budget additive** (`pickAccessoriesForSession`’s
   `aestheticItemFloor`). At High the gap-fill seats up to a floor count of
   aesthetic ITEMS measured by aesthetic-pick count — additive ON TOP of the
   durability/functional floor (it keeps seating while EITHER the shared ceiling
   has room OR the additive floor is unmet, so High is never fewer items than
   Medium). The floor targets `itemsPerSession + HIGH_AESTHETIC_ITEM_BONUS`
   (= +2), at the archetype's base set count — High adds aesthetic **items**, not
   extra sets (a set bump bleeds into the durability/functional fills, which share
   `aesthetic.setsPerItem`).
3. **Cancel the ADR 0028 physique-triad down-weight at High** — High is an
   explicit "I want aesthetic volume" opt-in, the same as an honoured `muscle`
   secondary.

The **duration governor remains the hard bound.** For High the candidate ladder
descends the additive floor (max → 1 → no-floor fallback) and prices each rung
against a **raised** cap, `HIGH_VOLUME_SESSION_CAP_MIN = 90` (vs the default
`SESSION_HARD_CAP_MIN = 75`): High is a deliberate opt-in to a longer,
higher-volume session, but the governor still trims the floor if even the raised
cap is exceeded, so the session can never run away.

## Consequences

- A 4-lift/2-cardio hybrid block at High now seats real hypertrophy accessories
  (empirically 0 → ~4 items, ~87 min); the lever is no longer greyed.
- Medium and Low are unchanged on every archetype (golden master + the ADR 0024
  identity pins stay green): `highVolume`/`aestheticItemFloor`/the goal-weight
  `highVolume` flag all default off.
- `High ≥ Medium` aesthetic items on every archetype (no inversion); durability /
  functional set counts are identical across levels (no set leak).
- The wizard copy that claimed the plan "caps accessory volume … to protect
  recovery for cardio" is corrected — on separate-day concurrent training the
  acute interference cost is minimal, so the cap was not the real constraint.

## Calibration

`HIGH_AESTHETIC_ITEM_BONUS = 2` and `HIGH_VOLUME_SESSION_CAP_MIN = 90` are
CP-1 [DEF→cal] Stage-A heuristics — directionally grounded in the productive
weekly-set zone and typical serious-lifter session lengths, un-tuned against real
`accessory_volume` × outcome / logged-duration data. The duration governor is the
hard safety bound on the upward direction.
