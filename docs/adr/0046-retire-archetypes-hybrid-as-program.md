# ADR 0046 — Retire the archetype model; the concurrent engine becomes one "Hybrid" program

Status: Accepted (2026-06-11)
Supersedes: the archetype-as-app-model premise of ADR 0004–0006 (dual-main-lift
folding, balanced low-frequency archetypes) and the archetype delivery vehicle for
ADR 0020/0024/0027/0028/0037/0040/0045 (the accessory / interference / taper
science). The **science** in those ADRs is preserved; only its packaging changes.
Related: `@hta/program-core` (the platform↔program contract), the platform write
path (`apps/web/src/lib/platform/`), migration 0103 (nullable `archetype`,
`program_id`/`program_family` columns).

## Context

The app began as a six-**archetype** generator: the user picked a goal-shaped
preset (Strength Anchor, Endurance Anchor, Rebuild, Hypertrophy Anchor, Concurrent
Hybrid, Maintenance) and one engine in `apps/web/src/lib/planner/` built a
mesocycle from it. Over this session the app became a **platform**: a pluggable
`ProgramEngine` contract (`@hta/program-core`) now hosts named, pre-configured
methodologies — 5/3/1 (`@hta/wendler`), Tactical Barbell (`@hta/tacticalbarbell`),
and Green Protocol (`@hta/green`) — each deployed through a single program picker
and write path (`createProgramInstance`).

Both producers write the **same** tables: `training_blocks`
(archetype blocks set `archetype`; platform blocks set `program_id`/
`program_family`, `archetype` NULL) and `planned_sessions` (a materialised
`prescription` JSONB per `week × day × slot`). There is only **test data** in prod.

This left two parallel models for the same job. We measured the coupling before
deciding how to converge:

1. **The archetype engine is a pure deploy-time producer.**
   `assemblePrescriptionItems` is called only from write/estimate paths inside
   `lib/planner/` (createBlock, quick-generate, estimate-actions) — **never at
   read time**. Prescriptions are materialised once and persisted.
2. **Consumers read the persisted grid, producer-agnostically.** Today, Plan,
   session-detail, and Stats all read `planned_sessions`; none re-run the
   archetype engine to render.
3. **The read seam was already de-archetyped** (migration 0103):
   `archetypeDisplayName(null, notes)` resolves platform blocks, and Today renders
   a separate program-recommendations banner that is a no-op for archetype blocks.
4. **The platform has zero dependency on `lib/planner/`.** `buildPlatformContext`
   reads `training_maxes`/`movements` directly. Retiring `lib/planner/` cannot
   break the platform spine.

So "going native" is largely **deletion**, not a rebuild — the architecture is
*already* a platform with two producers.

The one thing of real value tangled inside the archetype engine is the
**personalised concurrent-training science**: goal-weighted accessory selection
(ADR 0028/0045), concurrent interference management (ADR 0040), modality-aware
taper/deload (ADR 0037), and the experience-tier volume governor (ADR 0024).
None of the three pre-configured programs replicate this — they are recipes the
user follows; the archetype engine is the only thing that **generates a plan from
the user's goals**.

## Decision

**Retire the six-archetype model and go native to the platform/program model.
Do NOT wrap each archetype as a program (compat debt for an abandoned model), and
do NOT delete the concurrent science.** Instead, collapse the six archetypes —
which were one adaptive engine wearing six goal-preset "hats" — into **one new
first-class platform program, `@hta/hybrid`**, implementing `ProgramEngine`.

Product positioning makes the program catalog a coherent two-mode story:

- **"Follow a method"** — 5/3/1, Tactical Barbell, Green Protocol. Pre-configured;
  the user drives. Light setup.
- **"Build one for my goals"** — **Hybrid**. Personalised; the engine drives. It
  collects goals (primary/secondary focus, focus muscles, days/week, equipment,
  experience tier) and generates an interference-aware concurrent plan. This is
  the app's differentiator and the home of the preserved science.

The six archetypes become **goal presets / input values inside the Hybrid setup**,
not separate picker cards.

## Migration (phased; each phase is independently shippable + reversible)

- **Phase 0 — Port the science first.** Build `@hta/hybrid` as a `ProgramEngine`
  that wraps the existing concurrent engine, BEFORE deleting any archetype code.
  Pin prescription parity with **golden tests** against the current archetype
  output (same inputs → byte-identical `planned_sessions.prescription`) so the
  science transfers intact, not approximately.
- **Phase 1 — Extract shared infrastructure.** Lift the genuinely reusable,
  program-agnostic pieces out of `lib/planner/` into a shared platform lib/package
  (movement catalog/resolution, TM/1RM math, plate rounding, cardio catalog, load
  model) so nothing reusable dies with the archetypes.
- **Phase 2 — Single write path.** Make the program picker the only
  block-creation entry point; retire archetype creation in the BlockWizard,
  onboarding, and quick-generate. Onboarding routes goal-driven users into the
  Hybrid program's setup.
- **Phase 3 — De-archetype the read seam.** Replace the remaining label/phase
  couplings (`archetypeDisplayName`, `deloadWeekIndexFor`, next-block suggestions)
  with reads off `program_instances` + `planned_sessions.role` + `programRef`,
  which the platform already populates.
- **Phase 4 — Schema cleanup.** Once nothing writes them, drop `archetype` and the
  archetype-only columns (`power_emphasis`, focus / secondary-focus) in a
  migration, and delete the dead archetype code.

## Consequences

- The picker presents one adaptive **Hybrid** program plus three recipes — the
  six archetype cards collapse to one goal-driven card. Less clutter; a clearer
  "coach vs recipe" product story.
- The research investment (ADR 0020/0024/0027/0028/0037/0040/0045) survives behind
  the same `ProgramEngine` contract as every other program. Golden parity tests
  guard the port.
- `lib/planner/` shrinks to either the Hybrid engine internals or shared infra;
  the archetype-as-app-model scaffolding is deleted.
- The Hybrid card needs a richer setup step than the recipe cards (it reuses the
  existing archetype wizard's goal inputs). This asymmetry is intentional and
  matches the "the engine drives" positioning.

## Calibration / open risks

- **No usage data.** This is a product-strategy bet (the goal-driven coach is the
  defensible product), not a protect-existing-users decision — prod is test data
  only. LOW confidence that the auto-generated plans are *liked*; HIGH confidence
  they are internally consistent (the ADR suites prove the latter, not the
  former). If output-quality conviction stays low, Phase 0 is the natural place to
  reassess before committing to Phases 1–4.
- Phases 1–4 are deletion-heavy; the golden parity tests from Phase 0 plus the
  existing ADR invariant suites are the safety net against silent regressions
  during extraction.
