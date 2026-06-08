# ADR 0037 — Coherent multi-modal deload (reduce intensity, not just volume)

Status: Accepted (2026-06-08)
Supersedes: none
Related: ADR 0030 (deload cadence / two waves), ADR 0031 (autoregulated
skippable deload), ADR 0036 (universal pull floor — same PR adds pull-plane
diversity). CP-2 constraints rows for the deload constants.

## Context

A deep-research review (and a direct audit of a generated prod block) found the
deload week was **internally incoherent**: it reduced *volume* but left the
*high-intensity* conditioning at full dose. Concretely, on the endurance
archetype's deload week:

- Strength main sets trimmed (`strengthVolumeScale`) ✓
- Easy Z2 duration cut (`z2DurationMinOverride`, 60→30 / 100→30) ✓
- **VO2 intervals UNCHANGED** — still `4×4 min @ 90–95% HRmax` (the single most
  stressful session of the week) ✗
- **Alactic finisher UNCHANGED** — near-max sprints retained ✗

The code comment even described the deload as deliberately "volume-led ...
`z2DurationMinOverride` unchanged". So the week cut the *easy* aerobic work while
keeping *both* maximal exposures — backwards for a recovery week.

### Why this is a real defect (grounded in the canonical literature)

The app's strength model is deliberately faithful to **Tactical Barbell** (hold
load constant within a 6-week block, progress between blocks) and **5/3/1
Forever** (TM progression at the block boundary; the AMRAP/PR set is the
within-block progress signal on strength-goal archetypes only). Both systems are
explicit that a *deload reduces intensity*, not merely volume:

- **5/3/1 "7th Week Protocol"**: a deload "decrease[s] the total amount of reps
  during this time **and/or use[s] less intensive movements**." (Wendler, *5/3/1
  Forever*, "The Deload / 7th Week Protocol".)
- **Tactical Barbell**: the deload drops intensity; high-intensity quality work
  is not carried at full dose into a recovery period. (K. Black, *Tactical
  Barbell*, 3rd ed., "Strength Blocks".)

This validates the existing within-block static-load strength model (we did NOT
add within-wave TM bumps — that would contradict TB). The *only* genuine defect
is the cardio side of the deload, which this ADR fixes.

## Decision

On the **deload week** (`weekProfile.intensityLabel === "Deload"`), the cardio
prescription is made coherent by a single pure helper, `deloadCardioPlan`, which
both materialization paths consult:

1. **Drop the alactic finisher.** Any cardio day carrying a `finisher` emits the
   base aerobic session only on the deload week (no near-max sprints in a
   recovery week).

2. **Downgrade the maximal VO2 session to a sub-maximal touch.** A
   `cardio_vo2` day is converted to:
   - **easy Z2** (`run-easy-z2`, `cardio_z2`) by default; or
   - **one threshold touch** (`run-threshold`, `cardio_threshold`) ONLY when the
     block's weekly training frequency ≥ `DELOAD_THRESHOLD_MIN_FREQ` (5) **and**
     the user's tier ≥ `DELOAD_THRESHOLD_MIN_TIER` (2, i.e. the tier that
     actually earns the real VO2 session). This keeps "at most one" quality
     exposure to preserve neuromuscular readiness on high-frequency blocks while
     guaranteeing the deload is **never harder than a loading week** (lower tiers
     already resolve the VO2 day down to easy Z2 / tempo, so they always get the
     easy-Z2 downgrade).

The existing `z2DurationMinOverride` continues to trim duration; the converted
session inherits it. The strength deload (`strengthVolumeScale`, keep-heaviest
per ADR 0030/#372) is **unchanged** — this ADR only touches cardio.

The substitute slugs are preloaded into the per-archetype catalog
(`requiredCardioSlugs`) whenever the archetype has a VO2 day and a deload week,
so the lookup never misses.

### Data-driven, scales with structure

The helper keys off `day.cardioKind`, the week profile's `intensityLabel`, the
block's active-day count, and the user tier — **no hardcoded movements, days, or
archetypes**. It fires for any archetype with a VO2 day + deload week, at any
frequency or focus, and is a no-op on non-deload weeks (byte-identical) and on
archetypes with no high-intensity cardio (rebuild's easy-Z2-only deload, the
pure strength archetypes).

## Consequences

- **NOT byte-identical on the deload week of cardio archetypes** (intended): the
  endurance / hybrid deload now shows easy Z2 (or one threshold touch) instead of
  VO2 4×4, and no alactic finisher.
- **No migration / no schema change** — reuses existing seeded slugs
  (`run-easy-z2`, `run-threshold`) and existing fields.
- **Goldens unaffected** — the conversion lives in the `actions.ts`
  materialization (prod path); the golden harness drives `buildPrescription`
  directly with explicit days and is not deload-cardio-bearing. A dedicated
  `deloadCardioPlan` unit matrix + the endurance realism guard cover it.
- **Loading weeks untouched** — `deloadCardioPlan` returns `null` off the deload
  week, so every non-deload prescription is identical.

## Pull-plane diversity (bundled)

Same PR. ADR 0036 scaled the weekly pull count to pressing exposures; the
within-week variety penalty made the second pull a different *movement* but it
could still be a second *vertical* pull (pull-up + chin-up, no horizontal row).

Fix: a soft `PULL_PLANE_DIVERSITY_PENALTY` demotes a pull candidate whose plane
(vertical = lats-dominant; horizontal = mid-back/rear-delt-dominant, classified
from `primaryMuscles`) was already used earlier in the week. So a block that
seats two pulls gets one vertical + one horizontal, covering both back vectors.
Soft (below the role/value floor) — a repeat plane still wins when no
complementary candidate is feasible. Data-driven (no movement-id lists).

## Science / rationale

Deload intensity reduction: 5/3/1 7th Week Protocol; Tactical Barbell strength
blocks (both above). Polarized-deload practice (retain ≤1 brief quality touch to
maintain neuromuscular readiness while cutting total stress) is standard taper /
deload guidance (Mujika & Padilla 2003; Bell 2022). The `≥5 freq` and `≥tier 2`
gates are CP-1 heuristics (a minimum-disruption rule, not a calibrated dose).
Push:pull plane balance is a basic resistance-training principle (same basis as
ADR 0036).

## Files
- `apps/web/src/lib/planner/archetypes.ts` — `deloadCardioPlan`, deload-cardio
  constants, `requiredCardioSlugs` preload of substitute slugs.
- `apps/web/src/lib/planner/actions.ts` — apply the plan in both materialization
  loops (createBlock + custom/regenerate): swap movement, drop finisher, render
  the effective cardio day.
- `apps/web/src/lib/planner/accessory-picker.ts` — `PULL_PLANE_DIVERSITY_PENALTY`,
  `avoidPullPlanes` on the pull functional requirement.
- Tests: `deload-cardio-plan.test.ts`, pull-plane assertion in
  `endurance-block-realism.test.ts`.
- `docs/knowledge/hybrid-training-design-constraints.md` (+ workspace mirror) —
  CP-2 rows for the new constants.
