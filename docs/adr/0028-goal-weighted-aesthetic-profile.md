# ADR 0028 — Goal-weighted aesthetic profile (physique-triad down-weight)

Status: Accepted (2026-06-04)
Supersedes: none
Related: ADR 0027 (aesthetic-slot anti-redundancy), ADR 0020 (secondary-focus
volume tilt + duration governor), ADR 0024 (accessory volume level), ADR 0016
(hypertrophy volume dial)

## Context

The governing promise is the **most effective program for the time committed** —
no junk volume. ADR 0027 fixed *which* movement and *which* muscle the aesthetic
gap-fill slot targets (demote redundant compounds; credit main-lift synergist
coverage into the muscle ledger). That fix had a correct-but-goal-blind side
effect that this ADR addresses.

After ADR 0027 Lever B credits the synergist coverage the main lifts already
deliver (triceps, lats, front delts, quads, hamstrings, …), the muscles with the
**least** main-lift carryover read as the most under-covered and therefore
attract the aesthetic gap-fill first. Those muscles are the canonical **physique
triad**: **side delts, biceps, calves** — the three aesthetic-target muscles that
receive 0–0.33 synergist credit from any strength role.

This is exactly correct for a **hypertrophy primary** (the triad *is* the goal).
It is **goal-misaligned for a performance primary** (strength / hybrid /
endurance), where the engine, having freed those slots from redundant compound
work, then re-spends them on lateral raises, curls, and calf raises. For a
time-pressed strength or hybrid athlete, that vanity isolation is low-priority
relative to a bigger main lift or simply a shorter session. The aesthetic profile
assigned **every** target muscle the same weekly set target
(`DEFAULT_MUSCLE_TARGET = 6`) regardless of the user's primary goal — the profile
was goal-blind.

## Decision

Apply a single, bounded **×0.5 down-weight** to the physique-triad target
muscles (`side_delts`, `biceps`, `calves`) on the three performance-primary
archetypes, leaving every other muscle and every other archetype untouched.

New module `apps/web/src/lib/planner/aesthetic-goal-weight.ts`,
`applyGoalWeightToTargets(targets, opts)`. It post-processes the per-muscle
aesthetic target map produced by `defaultMuscleTargets`, **before** the
onboarding-ramp scalar and the ADR 0020 tilt run, inside `assemblePrescriptionItems`.

- `PERFORMANCE_PRIMARY_ARCHETYPES = { strength_anchor, concurrent_hybrid,
  endurance_anchor }` — only these down-weight. `hypertrophy_anchor` (triad is
  the goal), `rebuild`, and `maintenance` (lifecycle archetypes, minimal/zero
  aesthetic budget) are excluded → identity.
- `PHYSIQUE_TRIAD = { side_delts, biceps, calves }` — the only muscles touched.
- `AESTHETIC_GOAL_WEIGHT = 0.5` — halves the triad target (6 → 3), floored at 1
  so a budgeted muscle is **de-prioritised, never deleted**.

The triad keeps a maintenance dose (3 weekly sets ≈ MEV) rather than being
zeroed; on a tight-budget day this frees roughly one vanity slot, which the
gap-fill then re-spends on a genuinely under-covered performance muscle (per
ADR 0027) or which the duration governor trims away.

### Override hatches (user-respecting)

1. **An honoured `muscle` secondary cancels the whole down-weight.** If the user
   explicitly picks "Muscle" as their secondary focus *and ADR 0020 honours it
   for this primary*, they asked for physique volume on a performance block, so
   the triad stays at full target. "Honoured" is defined as
   `isActiveTilt(secondaryVolumeTilt(archetype.id, secondaryFocus))` — i.e. the
   ADR 0020 volume tilt actually fires (strength + muscle, endurance + muscle).
   The caller computes this boolean and threads it as `secondaryMuscleHonored`;
   the module carries **no** ADR 0020 scope knowledge of its own.
2. **An explicit focus pick always wins.** A triad muscle the user selected as a
   `focusMuscle` is left at its focus-elevated target, even on a performance
   primary with no muscle secondary.

### The `concurrent_hybrid` interaction (why it stays down-weighted)

ADR 0020 deliberately makes a `muscle` secondary **inert** on `concurrent_hybrid`
(a concurrent block is already interference-constrained; bolting on hypertrophy
volume fights the goal). So `secondaryVolumeTilt(concurrent_hybrid, "muscle")`
is `NO_TILT` → `secondaryMuscleHonored` is **false** → the triad down-weight is
**not** cancelled. This is the intended, consistent behaviour: a `muscle`
secondary does nothing on concurrent, including not cancelling the down-weight.
The ADR 0020 invariant "`muscle` secondary is a byte-identical no-op on
`concurrent_hybrid`" therefore **still holds** — both `none` and `muscle`
resolve to the same down-weighted profile — and its regression test passes
unchanged.

## The engine-regression invariant

Like ADR 0027, this is a **core correctness fix applied to everyone on the three
performance primaries**, not an opt-in feature. It is therefore *consciously
NOT volume-invariant*: it is a deliberate, modest **volume reduction** (a triad
muscle's structural target drops 6 → 3), trimming roughly one vanity slot on a
budget-bound day. Safety properties held:

- **Scoped to three archetypes and three muscles.** Every other archetype and
  every non-triad muscle is byte-identical (the module returns a verbatim copy).
  `hypertrophy_anchor`, `rebuild`, `maintenance` are untouched.
- **Cancellable.** An honoured muscle-secondary or an explicit focus pick
  restores full target — opt-out paths are exact.
- **Other passes untouched.** Only the aesthetic per-muscle target map is
  altered; durability / functional / power selection, the ADR 0020 tilt, and the
  ADR 0027 levers are unchanged (the down-weight composes upstream of them).
- **Cross-archetype invariants hold.** No archetype config changes; the
  "no lower-only week at any frequency" and tendon-floor invariants are
  unaffected (full suite green, 3284 tests).

The golden snapshot (`assemble-prescription.golden.test.ts`) **passed unchanged**:
its synthetic catalog's limited aesthetic-only isolations mean the specific
2-pick strength_anchor result is stable under the down-weight. A dedicated
integration test (`adr-0028-goal-weight-integration.test.ts`) with an
aesthetic-rich catalog proves the redirect is real (triad picks flip to
performance muscles as budget grows).

## Constants (calibration policy)

- `AESTHETIC_GOAL_WEIGHT = 0.5` — CP-1 Stage-A heuristic, **no calibration data**.
  Chosen to leave a maintenance dose while freeing ~one slot.
- `PERFORMANCE_PRIMARY_ARCHETYPES`, `PHYSIQUE_TRIAD` — CP-1 goal-aligned
  scope/classification per the SAID/specificity principle.
- `GOAL_WEIGHT_TARGET_FLOOR = 1` — CP-3, mirrors `PER_MUSCLE_TARGET_FLOOR` so a
  positive target never silently disappears.

Added to the CP-2 constants table in both the workspace canonical doc and the
`docs/knowledge` mirror (row #49).

## Science grounding (honest confidence)

Grounded in **SAID / specificity** + **opportunity cost**: training adaptations
are specific to the demand, and on a fixed time budget every set spent on a
non-goal muscle is a set not spent on the goal. There is **no RCT** showing a
strength athlete gains more by skipping lateral raises — this is a **programming-
philosophy default**, not a tuned dose-response result. Confidence: **MODERATE as
philosophy, LOW as a hard-science claim.** The 0.5 magnitude is an unvalidated
heuristic. This is a default a knowledgeable coach would set, made explicit and
overridable, not a calibrated constant.

## Consequences

- A performance-primary block spends its freed aesthetic budget on the muscles
  the program actually under-trains, or on a shorter session, instead of on
  vanity isolation — closing the ADR 0027 goal-blind gap.
- Users who *want* physique work on a performance block have two exact opt-outs
  (honoured muscle secondary; explicit focus pick).
- The 0.5 magnitude is the first candidate for recalibration once real
  per-muscle response / session-satisfaction data exists.

## Phasing

1. Core module `aesthetic-goal-weight.ts` (triad down-weight + floor + override
   hatches). Unit tests (down-weight on the three primaries; identity on the
   rest; honoured-secondary cancel; floor; focus-pick override).
2. Wire into `assemblePrescriptionItems` — wrap `defaultMuscleTargets` inside the
   existing `applyScalarToTargets(..., ramp)` call; thread
   `secondaryMuscleHonored = isActiveTilt(secondaryVolumeTilt(...))`.
3. Integration test with an aesthetic-rich catalog proving the redirect;
   re-run cross-archetype invariants + full suite; `pnpm --filter @hta/web build`.
4. Docs — ADR + CP-2 row #49 in both mirrors.
