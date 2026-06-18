# ADR 0052 — Season emphasis → Hybrid concurrent-generator biasing (PROPOSAL)

**Status:** Proposed (design-only — written for review before any code, per the
handoff's "propose engine changes before implementing" rule)
**Date:** 2026-06-18
**Relates to:** ADR 0051 (Season roadmap — this is the deferred Phase-2
"generator-biasing" half its Decision 7 named; the *advisory* half shipped as
PR #610 "Option B"), ADR 0008 (modality-aware taper), ADR 0037 (strength "hold"
during a cardio build), ADR 0038 (cardio mesocycle easy-volume creep), ADR 0016
(the `effortPreference` optional-param threading precedent), ADR 0046
(programs-not-archetypes). Calibration policy CP-1…CP-5 in
`docs/knowledge/hybrid-training-design-constraints.md`.

## Context

ADR 0051 shipped the Season roadmap. Its differentiator (Decision 7) is **balance
periodization**: a `strength_bias` / `endurance_bias` block concentrates one
quality while holding the other at a maintenance floor. We shipped this in two
honest halves:

- **Selection** (PR #608/#609): emphasis steers *which* program/template the
  planner proposes (a strength-bias slot proposes 5/3/1 or TB Operator; an
  endurance slot proposes Green Protocol/HYROX). Already live.
- **Advisory floor** (PR #610, "Option B"): for a `*_bias` block we *show*
  whether the held quality clears its maintenance floor, computed from the
  user's real rolling cardio + the existing interference scalar. Read-only.

What is **not** done — and what this ADR proposes — is making a **`strength_bias`
Hybrid block actually re-allocate** its internal strength↔cardio mix (and
*enforce*, not just display, the maintenance floor). Today a Season emphasis has
**zero effect** on a deployed Hybrid block's generation.

### Why this is a real engine change (the finding that triggered this ADR)

The Hybrid wizard collects only `focusMuscles` + `tmPercent`
(`describeHybridSetup`, `engine.ts`). The instance field that *looks* like a
strength↔cardio lever — `secondaryFocus` — is **vestigial for `concurrent_hybrid`**:

- `cardioProgressionTier(archetypeId, secondaryFocus)` returns `"balanced"` for
  `concurrent_hybrid` **regardless** of `secondaryFocus` (`archetypes.ts:1603`).
- `secondaryVolumeTilt(archetype.id, secondaryFocus)` returns `NO_TILT` for
  `concurrent_hybrid` (`secondary-focus.ts:118`).
- The only thing `secondaryFocus` does on a hybrid block is nudge cardio
  *modality* (run vs bike) via `modalityPreferenceForDay`
  (`assemble-block-sessions.ts:553`).

So **there is no existing allocation lever to reuse** — a Season bias must be a
**new, optional, defaulted parameter**, threaded the way ADR 0016 threaded
`effortPreference`.

## The allocation seam (grounded)

`concurrent_hybrid` (`archetypes.ts:1161`) is built from:

| Day | kind | priority | rank | base dur |
|---|---|---|---|---|
| Squat (dayIndex 0) | strength | **anchor** | 1 | — |
| Deadlift (3) | strength | **anchor** | 3 | — |
| Easy Z2 (2) | cardio | **anchor** | 2 | 60 min |
| Bench (1) | strength | optional | 7 | — |
| OHP (4) | strength | optional | 8 | — |
| VO2 (5) | cardio | optional | 6 | 45 min |

`daysForFrequency(archetype, daysPerWeek)` (`archetypes.ts:1423`) keeps all
anchors, then greedily fills the remaining day budget with **optionals sorted by
`rank`**. So the strength↔cardio mix at a given frequency is a pure function of
(a) which days are anchors and (b) the optional ranks. Worked example:

- freq 4 → squat, deadlift, Z2 (anchors) + bench (rank 7) = **3 strength / 1 cardio**
- freq 5 → + OHP = **4 strength / 1 cardio**
- freq 6 → + VO2 = **4 strength / 2 cardio**

Cardio *volume* is the archetype `durationMin` (60/45) plus the fixed `"balanced"`
creep `CARDIO_CREEP_PARAMS.balanced = { creepPerWeek: 0.05, cap: 0.1 }`
(`archetypes.ts:1626`) applied by `cardioProgressionPlan` (`archetypes.ts:1683`).

**Therefore a bias has exactly three clean levers, all *before* the ceiling:**
1. **Optional-rank reorder** — promote VO2 (endurance bias) or strength optionals
   (strength bias) so the day budget fills toward the concentrated quality.
2. **Cardio volume** — modulate `durationMin` / the creep params (raise for
   endurance bias; hold-at-floor, never raise, for strength bias).
3. **Anchor status of the lone cardio day** — never drop Z2 below anchor (that is
   the maintenance-frequency floor in archetype terms — see the tension below).

## Decisions (proposed)

| # | Topic | Proposed decision | Why |
|---|---|---|---|
| 1 | New optional param, not a repurposed knob | Add `seasonBias?: "strength" \| "endurance" \| null` to `BuildBlockAssemblyContextInput`, threaded like ADR 0016's `effortPreference` (optional, default `null` ⇒ byte-identical). | `secondaryFocus` is vestigial for hybrid; reusing it would be a lie + couple modality to allocation. |
| 2 | Bias acts on ALLOCATION, before the ceiling | The bias only **reorders optional ranks** and **modulates cardio volume/creep** inside `daysForFrequency` + `cardioProgressionPlan`. It never enters `sessionDurationCapMinutes` / the accessory governor. | **CP-4**: the 2-factor ceiling stays 2-factor; the day mix is decided pre-ceiling (`assemble-prescription.ts`), and the ceiling only trims accessories. |
| 3 | Enforce the floor as a FLOOR, not a target | `strength_bias`: never raise cardio; hold the existing Z2 anchor + clamp creep to 0; do **not** add cardio. `endurance_bias`: never drop strength below its two anchors (squat+deadlift); add easy cardio volume (raise creep toward the ADR-0038 `pure` band). | Decision 7's "concentrate one, **hold** the other" — the held quality floor is the archetype's anchor, which the bias must not breach. |
| 4 | Runtime-only, gated, golden-master-clean | With `seasonBias == null` the archetype `days`/ranks/creep are untouched ⇒ `assemble-prescription.golden.test.ts` (imports `CONCURRENT_HYBRID`) stays green. Bias reorders a **copy** at runtime; the static archetype is never mutated. | Non-Season Hybrid stays byte-identical (the ADR 0051 Decision 6 regression guard, extended to the generator). |
| 5 | Only Hybrid; foreign/arc programs untouched | Bias applies to `concurrent_hybrid` only. 5/3/1, TB, Green, HYROX express emphasis through SELECTION (ADR 0051 A4), not internal re-allocation. | Arc programs self-periodize (must not double-periodize); foreign programs own their own structure. |
| 6 | Advisory floor (PR #610) becomes the validator | The shipped `maintenance-floor-server.ts` check is the read-out of whether the biased allocation cleared the floor — same numbers, now describing a real allocation rather than a hypothetical. | One source of truth for "did we hold the floor". |

## The maintenance-frequency-floor tension (must be surfaced, not hidden)

`MAINTENANCE_FREQUENCY_FLOOR = 2` sessions/wk (PR #610, Bickel 2011 principle).
But `concurrent_hybrid` ships **one** cardio anchor (Z2) until freq 6. So a
literal "≥2 cardio sessions/wk" floor would force a strength-biased block to
*add* a cardio day — the opposite of concentrating strength. **Resolution
options (needs your call):**

- **(3a) Archetype-relative floor (recommended):** the floor is "do not drop the
  held quality below its archetype anchor." For a strength-bias Hybrid block the
  held-cardio floor is the **1 Z2 anchor at its base 60 min**, not 2 sessions. The
  global 2×/wk number stays the *advisory* baseline shown to the user; the
  *enforced* floor is the archetype anchor. Honest + non-contradictory.
- **(3b) Honor 2×/wk literally:** a strength-bias Hybrid block keeps Z2 **and**
  retains VO2 (or a 2nd easy session) at minimum volume. Costs a day; arguably
  not "concentrated" strength.
- **(3c) Bias only at freq ≥ 5:** below that, a Hybrid week is too small to
  meaningfully concentrate, so the bias is a no-op + the UI says so.

## Constants introduced (all NEW, all CP-1 heuristics)

Reuse `SEASON_BIAS_SHIFT` (already shipped, display-only) as the *magnitude* the
allocation tilts — but it now has a generator effect, so it gets a **validation
plan** (it was display-only before). Plus:

- `BIAS_RANK_DELTA` — how far a bias moves an optional's effective rank (e.g.
  promote VO2 below the strength optionals for endurance bias). heuristic (CP-1).
- `BIAS_CARDIO_CREEP` — the creep rate used for an `endurance_bias` Hybrid block
  (toward ADR-0038's `pure`/`mixed` band, e.g. 0.07–0.10). heuristic (CP-1),
  consistent-with ADR 0038.
- `STRENGTH_BIAS_CREEP_CLAMP = 0` — strength-bias holds cardio flat. CP-1.

## Evidence base & confidence (honest)

- **Block periodization / concentrated loading** (Issurin 2010; Bompa) —
  **MODERATE**. Sequencing emphasis is well-established; the *magnitude* of a
  one-block strength↔cardio tilt for a recreational concurrent athlete is not
  RCT-grade.
- **Maintenance via preserved frequency at ~⅓ volume** (Bickel 2011, HIGH for
  the *principle*) — anchors Decision 3; magnitudes CP-1.
- **Concurrent interference is dose/intensity-dependent** (Wilson 2012; Coffey &
  Hawley 2017) — **MODERATE**. Supports holding-but-reducing the other quality.
- **Periodized ≈ non-periodized in non-elites; individual response dominates**
  (Grgic 2017) — **MODERATE**. The reason this stays opt-in + advisory-framed and
  must not claim a guaranteed performance edge (ADR 0051 Decision 8).

**Net confidence:** the *mechanism* (tilt allocation, hold the floor) is sound and
CP-clean; the *constants* are LOW-confidence heuristics. This is why the change is
opt-in, gated, reversible, and paired with the PR-#610 validator.

## CP pressure-test

- **CP-1:** the 3 new constants ship `// heuristic … (CP-1)` tagged, each with a
  validation plan: **interference-deload trigger rate inside biased vs base
  blocks** (if bias raises reactive deloads materially, the tilt/creep is too
  aggressive → roll back) and **measured retention of the held quality** (Z2
  pace/HR drift for strength-bias; top-AMRAP e1RM drift for endurance-bias).
- **CP-2:** **no existing engine constant moves.** The modality multipliers, load
  model, deload cadence, and interference scalar are untouched. `seasonBias=null`
  is byte-identical (golden master).
- **CP-3:** magnitudes expressed at one sig fig / as rank deltas; no two-decimal
  precision without a tag.
- **CP-4 (tripwire):** the bias **must not** route through `getCeilingExplain` /
  `sessionDurationCapMinutes`. It acts in `daysForFrequency` +
  `cardioProgressionPlan`, strictly *before* the ceiling. Any PR that adds a
  `seasonBias × baseCeiling` term fails review.
- **CP-5:** the maintenance principle cites Bickel 2011 (HIGH); the tilt
  magnitudes carry the CP-1 heuristic tag (consistent-with, not equal-to).

## Threading plan (mirrors ADR 0016)

1. `BuildBlockAssemblyContextInput.seasonBias?` (`build-block-assembly-context.ts`)
   — resolved to `seasonBias: string | null` on `BlockAssemblyContext` (`?? null`).
2. `createProgramInstance` already carries `seasonBlockId` (PR #604). When a
   block is activated from a Season, read the `season_blocks.emphasis`, map
   `strength_bias→"strength"` / `endurance_bias→"endurance"` (else null), and pass
   it into `setupHybrid`'s values → the context input. **No new wizard field.**
3. `daysForFrequency` gains an optional `seasonBias` arg that reorders a *copy* of
   the optionals before the greedy fill; `cardioProgressionPlan` gains the same
   arg to pick the creep clamp/band. Both default to today's behaviour.
4. Golden master re-blessed only for new `seasonBias != null` snapshot rows; the
   null-bias matrix stays byte-identical.

## Regression guards / test plan

- Extend `assemble-prescription.golden.test.ts` with `seasonBias` cases; assert
  the **null-bias** matrix is unchanged (the existing snapshot).
- Cross-archetype invariant tests: a biased Hybrid block at every freq still
  ships ≥ the held quality's anchor (no "all-strength, zero-cardio" week; no
  lower-only week) — extends the existing ADR-0006 invariant test.
- A `strength_bias` block never *raises* cardio vs base; an `endurance_bias`
  block never *drops* strength below squat+deadlift.
- Engine-regression check: deploy the same Hybrid block with and without bias and
  diff prescriptions for non-bias users → identical.

## Out of scope

- Biasing foreign/arc programs internally (they use selection).
- Any change to `buildPrescription`'s load math, the ceiling chain, the
  interference scalar, or the deload cadence.
- A user-facing balance *slider* that writes a custom split (the read-only bar
  shipped in PR #610 stays; a writable slider is a separate ADR if wanted).
- A guaranteed-performance claim (Decision 8 / Grgic 2017).

## Open questions for review

1. **Floor tension (the key one):** 3a (archetype-relative floor — recommended),
   3b (literal 2×/wk), or 3c (bias only at freq ≥ 5)?
2. **Tilt magnitude:** start `SEASON_BIAS_SHIFT` at the shipped 0.1 (→ ~60/40), or
   more conservative (0.05) for the first generator-affecting release?
3. **Scope of first cut:** ship `endurance_bias` first (lower risk — it only adds
   easy aerobic volume, the ADR-0038 path already exists) and defer
   `strength_bias` (which must *remove* cardio, higher detraining risk)?
