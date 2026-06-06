# ADR 0030 — Deload cadence: two loading waves before a volume-led deload (Phase 1)

Status: Accepted (2026-06-06)
Supersedes: none
Related: ADR 0008 (modality-aware taper/peaking), CP-2 constants table row 51;
the reactive auto-deload (`apps/web/src/lib/engine/deload.ts`, unchanged)

## Context

Every curated archetype shipped a **fixed 4-week block**: a 3-week intensity
wave (`5s → 3s → heavy peak` for `strength_anchor`) followed by a **week-4
deload**, applied uniformly to every archetype and experience level
(`maintenance` excepted — it runs flat with no deload).

This is the classic 3:1 loading model inherited from strength-only templates.
A review against the programs the app is built to distil flagged it as the one
place the engine reifies a *tactic* (the calendar deload) as if it were the
*principle* (manage accumulated fatigue) — and does so at a cadence shorter
than every grounded source:

- **Tactical Barbell** (the purpose-built concurrent system) — 6-week blocks,
  *"no re-testing of maximums for at least 6 weeks"*; submaximal +
  never-to-failure (*"muscle failure is the enemy"*) is the **primary** fatigue
  lever, so the lifter *"rarely feels over-trained"* and can *"continue on this
  path for a lengthy period."* There is **no scheduled in-block deload**.
- **5/3/1 Forever** (Wendler) — the 7th-Week Protocol deload sits **between** a
  Leader and Anchor phase, *"not done every seventh week; it's just a name"*;
  *"more than two cycles will burn you out"* caps accumulation at ~6 weeks; the
  deload is explicitly **volume-led**.
- **Surveys** — Bell 2022 (~4–6 wk) and Rogerson 2024 (5.6 ± 2.3 wk); volume is
  *"the largest contributor of fatigue."*

The app's primary fatigue lever (submaximal TM% + RIR + polarized Z2) is
**already** in place, which makes the week-4 deload premature: the program
deliberately keeps fatigue low, then deloads on the calendar as if it had
accrued peaking-level fatigue.

## Decision

**Phase 1: replace the fixed week-4 deload with two repeated 3-week loading
waves followed by ONE unchanged, volume-led deload** — a 7-week block (6 weeks
of accumulation + 1 deload). Uniform across all non-`maintenance` archetypes.

Deliberately scoped:

- **Ship only the well-grounded change** — a *longer, uniform* cadence. The
  evidence for the longer cadence is HIGH; the evidence for *differentiating*
  cadence by archetype ("endurance deloads more often"), load, or experience is
  LOW (no direct comparative study) and is **explicitly not shipped here**.
- **The deload is unchanged** — same `strengthVolumeScale` (0.5–0.75) and
  `z2DurationMinOverride`. It was already volume-led; that is correct and kept.
- **The second wave repeats the first at the same TM** — submaximal
  accumulation, not a heavier cycle. TM progression stays *between* blocks
  (consistent with the existing next-block flow). This mirrors TB's "waved
  submaximal loads for 6 weeks at a fixed max."
- **`maintenance` is untouched** (no deload week → no expansion).

Deferred to later phases (where a live fatigue proxy can *earn* the
differentiation, rather than guessing constants):

- **Phase 2** — a skippable / autoregulated deload, gated on the GRM readiness
  signal + AMRAP/top-set performance trend (both already collected).
- **Phase 3** — per-archetype, combined-load-driven cadence using a fatigue
  proxy that includes the existing cardio interference scalar
  (`concurrent-scalar.ts`), so endurance-volume-heavy blocks pull the deload in
  and submaximal-strength blocks let it run longer — emergent from the
  principle, not hardcoded.

## Implementation

- `apps/web/src/lib/planner/archetypes.ts` — `DELOAD_CADENCE_WAVES = 2`,
  `expandToTwoWaves(profiles)` (repeats the non-deload "build" weeks
  `DELOAD_CADENCE_WAVES` times, re-appends the deload, re-contiguous
  `weekIndex`; **no-op when there is no Deload week**), and `withExpandedCadence`
  wrapping each non-`maintenance` archetype (`weeks` re-derived from the
  expanded profile length).
- `apps/web/src/lib/planner/accessory-intensity.ts` — `accessoryIntensity`
  gains an explicit `isDeload?` flag and `ACCESSORY_WAVE_LENGTH = 3`. The
  per-week RIR ramp, carry distance, and isometric-hold drop are now
  **wave-relative** (`weekIndex % 3`) with the deload signalled explicitly. The
  legacy default `isDeload ?? (weekIndex === 3)` keeps every existing caller /
  unit test **byte-identical** for the single-wave shape.
- `apps/web/src/lib/planner/assemble-prescription.ts` — resolves `isDeloadWeek`
  from the week profile and threads it into both accessory-intensity call sites.

## Consequences

- New blocks run 7 weeks (6 accumulation + 1 deload); `maintenance` stays 2.
  Existing materialised blocks are unaffected (blocks store their own `weeks` +
  planned sessions; **no migration**).
- The **deload-week prescription is byte-identical** to the legacy week-3
  deload (golden pinned) — the wave-relative accessory-intensity refactor maps
  the new week-6 deload to the same output.
- All UI reads `block.weeks` dynamically; block-length copy follows
  automatically. Cross-archetype cadence invariants are pinned in
  `deload-cadence.test.ts`.

## Calibration (CP-2)

`DELOAD_CADENCE_WAVES = 2` is a `[DEF→cal]` Stage-A heuristic. Confidence:
**HIGH** that a fixed week-4 cadence is too short and ~6 weeks is the
cross-program norm; **MEDIUM** on the exact wave count. Validation: per-user
completion-quality (sRPE, drop-off) and reactive-deload-trigger rate on 7-week
vs legacy 4-week blocks; whether users skip/extend the deload (the Phase 2
signal). See the design-constraints CP-2 table, row 51.
