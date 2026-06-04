# ADR 0027 — Aesthetic-slot anti-redundancy (compound demotion + synergist credit)

Status: Accepted (2026-06-04)
Supersedes: none
Related: ADR 0012 (accessory value-weighted block rotation), ADR 0020 (duration-governor
volume tilt), ADR 0022 (accessory rep/bucket bias), ADR 0024 (accessory volume level),
ADR 0026 (antagonist supersets)

## Context

The app is built for the time-pressed hybrid athlete; the governing promise is the
**most effective program for the time committed** — no junk volume. A PhD-level audit of
the accessory engine surfaced a real, production-confirmed redundancy in the **aesthetic
gap-fill slot** (the hypertrophy "bring-up" section that runs after durability →
functional → power).

Two independent defects compound each other:

### Defect 1 — the aesthetic slot prescribes redundant *compound* lifts

Measured by the picker's own authoritative `reason` field (not a reconstructed
classification), the aesthetic slot fills its budget with **big compound movements that
duplicate the main lifts**: a second `bench-press-flat`, a `zercher-squat`, `bb-row`,
`pull-up`, `kb-swing`. Across a week:

| Archetype | Aesthetic sets | …on muscles the main lifts already cover |
| --- | --- | --- |
| strength_anchor | 33 | 18 (55%) |
| hypertrophy_anchor | 33 | 18 (55%) |
| concurrent_hybrid | 30 | 15 (50%) |

For a strength athlete who already benches and squats as their **main** lifts, handing
them a *second* bench and a *second* squat as "accessories" is textbook junk volume —
high duplication, low marginal hypertrophy per unit fatigue/time.

Root cause (verified): the aesthetic candidate ranking (`candidateScore`) collapses on a
first block to a single term, `stim_to_fatigue_score` (SFR). The migration-0019 SFR
backfill only elevates **machine/supported** isolations (SFR 4–5); **free-weight
isolations get SFR 3, tying with compounds**. `loadPickerCatalog` has no `ORDER BY`, so
ties break on physical row order (seed-insertion order), where the big compounds are
seeded first → **compounds win every tie** in the aesthetic slot. ADR 0012's value model
(`ACCESSORY_VALUE_BONUS`, which rewards compound "staples") makes this worse on later
blocks.

### Defect 2 — main-lift coverage is invisible to the muscle ledger

`countMusclesPrimary` seeds the weekly aesthetic ledger (`muscleProgress`) **only** from
prior *accessory* history. The main compound lifts are pushed to `items`, never to
accessory history, so the muscles they train (chest, quads, front delts, …) read as
**empty** and keep attracting aesthetic gap-fill — even though the squat/bench already
supplied plenty of stimulus there. Meanwhile genuinely under-covered muscles (side/rear
delts, calves, biceps) compete on equal footing instead of being prioritised.

## Decision

Two complementary levers, both scoped to the aesthetic slot only. Neither changes the
**number** of aesthetic items or the **total** aesthetic set volume — they only change
**which movement** and **which muscle** each aesthetic slot targets. Pick count stays
bounded by `aestheticMaxItems`; total sets stay invariant. This is a *redirect-only*
core correctness change.

### Lever A — demote compounds in the aesthetic slot

Add a single scoped penalty term to `candidateScore`, fired **only** when the caller
sets `demoteCompound` (set true on the aesthetic `findCandidate` call, and on no other
pass). The durability, functional and power passes are byte-unchanged — compounds are
correct there.

```
if (query.demoteCompound && m.isCompound) score += AESTHETIC_COMPOUND_PENALTY;
```

`AESTHETIC_COMPOUND_PENALTY = 2 × ACCESSORY_VALUE_BONUS` (= 16). Chosen so it cleanly
**reverses ADR 0012's staple bias inside this slot** (a fresh isolation reliably outranks
a fresh compound for a shared muscle gap, on both first and later blocks), while staying
**below `ROTATION_BASE` (40)** so block-to-block rotation among isolations still
dominates. Resulting aesthetic ranking for a given muscle gap:

```
fresh isolation  <  fresh compound  <  recently-used isolation
```

So as long as ≥1 fresh isolation exists for the gap muscle, it wins; a compound is only
chosen when it is the *only* surviving candidate (penalty re-ranks, never filters). This
is a CP-1 Stage-A heuristic magnitude with a calibration note.

**Science grounding (MODERATE).** The aesthetic slot exists for targeted hypertrophy of a
lagging muscle. The compound's stimulus for that muscle is already delivered by the main
lift; a redundant compound adds disproportionate systemic fatigue for little extra local
stimulus, whereas an isolation delivers a higher **stimulus-to-fatigue ratio** for the
target (practitioner SFR concept; consistent with Schoenfeld 2017 dose-response — added
volume on an already-trained muscle sits on the flat of the curve). This is a direction,
not a tuned magnitude.

### Lever B — credit main-lift coverage into the muscle ledger

A role-keyed `SYNERGIST_CREDIT` table (`synergist-credit.ts`) maps each strength role
(`squat` / `horizontal_press` / `deadlift` / `vertical_press`) to the aesthetic muscles
it trains, with a fractional **effective-set** weight per muscle. The assembler computes
weekly credit from the archetype alone —

```
credit[muscle] = Σ over the week's strength days (role, secondaryRole)
                   of  SYNERGIST_CREDIT[role][muscle] × MAIN_LIFT_NOMINAL_SETS
```

— and folds it into `muscleProgress` right after the `countMusclesPrimary` seed. No
caller plumbing: the credit is role-keyed (not variant-keyed), so it is a pure function
of `archetype.days`. `MAIN_LIFT_NOMINAL_SETS = 3` is a fixed **structural** working-set
count (NOT deload-scaled) — the credit represents stable structural coverage, matching
how `perMuscleTargets` are structural weekly targets.

**Fractions (CP-3 derived, CP-5 honest-uncertainty).** Default synergist involvement
≈ **0.5 effective sets per direct set** for a clearly-involved synergist (Pelland et al.
2026, PMID 41343037 — fractional/indirect set counting), with the prime mover at 1.0 and
minor contributors lowered to 0.1–0.3. Muscles a main lift does **not** train (biceps,
rear_delts, calves) receive **0 from every role** and are therefore fully protected — the
aesthetic slot still targets them first. See the table in `synergist-credit.ts`; every
entry carries a citation/heuristic comment.

Net effect of A+B together: the aesthetic slot does **isolation work on genuinely
under-covered muscles** instead of duplicate compound work on already-trained muscles —
optimal hypertrophy allocation per unit time.

## The engine-regression invariant

ADR 0026 framed the byte-identical invariant as absolute **for opt-in features**. This
ADR is a **core correctness fix applied to everyone**, not an opt-in feature, so it
consciously and necessarily changes existing prescriptions (the redundant compounds are
the bug). The golden snapshot (`assemble-prescription.golden.test.ts`) is re-blessed with
this ADR cited as the rationale. The safety property we DO hold:

- **Volume-invariant.** Both levers only re-rank/re-target within the aesthetic loop.
  Item count (bounded by `aestheticMaxItems`) and total aesthetic set volume are
  unchanged; only *which movement* / *which muscle* shifts. (Exception, by design: in a
  sparse catalog where a redirected muscle has no isolation candidate, the slot may
  resolve to a different movement or mark the muscle satisfied — never adds volume.)
- **Other passes untouched.** Durability / functional / power selection and all
  non-aesthetic ledger bumps are byte-identical (`demoteCompound` unset; credit only
  seeds the aesthetic gap order).
- **Cross-archetype invariants hold.** No archetype config changes; the "no lower-only
  week at any frequency" and tendon-floor invariants are unaffected (verified by suite).

## Constants (calibration policy)

- `AESTHETIC_COMPOUND_PENALTY = 2 × ACCESSORY_VALUE_BONUS = 16` — CP-1 Stage-A heuristic
  (ordering magnitude), calibration note: revisit if logged movement-selection data shows
  the aesthetic slot under- or over-rotating to isolation.
- `MAIN_LIFT_NOMINAL_SETS = 3` — structural working-set count, CP-1 (stable; not tuned).
- `SYNERGIST_CREDIT[role][muscle]` fractions — CP-3 (derived from Pelland 2026 fractional
  set-counting + anatomy), CP-5 (each carries an explicit confidence/uncertainty comment).

These are added to the CP-2 constants table in both the workspace canonical doc and the
`docs/knowledge` mirror.

## Consequences

- The aesthetic slot becomes honest targeted-hypertrophy work: isolation movements on the
  muscles the program actually under-trains.
- One-time golden re-bless; documented and reviewed.
- Lever B's fractions are the least-certain piece (practitioner-derived) and are the first
  candidate for recalibration once real per-muscle response data exists.

## Phasing

1. **Lever A** — `demoteCompound` flag through `CandidateQuery`; scoped penalty in
   `candidateScore`; set on the aesthetic `findCandidate` call. Unit tests
   (isolation-beats-compound for a shared gap; functional/power still pick compounds).
2. **Lever B** — `synergist-credit.ts` (table + `computeWeeklyCompoundCredit`); optional
   `compoundCoverageCredit` param on `pickAccessoriesForSession` folded into
   `muscleProgress`; computed in `assemblePrescriptionItems` from the archetype. Unit
   tests (credit correctness + redirect + volume-invariant).
3. **Re-bless** golden snapshot; run cross-archetype invariants + full suite; `pnpm
   --filter @hta/web build`.
4. **Docs** — CP-2 table in both mirrors.
