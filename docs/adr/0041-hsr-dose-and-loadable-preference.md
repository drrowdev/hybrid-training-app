# ADR 0041 — HSR tendon dose + advanced-tier loadable preference

Status: Accepted (2026-06-08)
Supersedes: none
Related: ADR 0034 (durability HSR region logic), ADR 0036 (universal pull floor),
ADR 0012 (movement staple value / `isLoadable`), the accessory-intensity matrix.
Driven by a deep-research block review (B−).

## Context

A deep-research review of an `endurance_anchor` block surfaced two real
tier-awareness gaps in the accessory engine:

1. **The durability-floor HSR was too light to be HSR.** Rep-based HSR (calf
   raise, RDL) inherited the archetype's *hypertrophy* rep midpoint (~14) via
   `repsForBucket`'s default branch — the code even assumed "tendon buckets ignore
   the rep number" (true only for *hold-based* items). HSR drives tendon
   adaptation only at ≥~70% 1RM (Bohm 2014; Malliaras 2013), but at a slow tempo
   the achievable load drops below that threshold past ~6 reps (Morrison & Cook
   2022). So "HSR 2×14" was moderate-load endurance work, not tendon loading —
   while the *dedicated* tendon-day HSR is already correct at `3×8 @ 70–85%`.

2. **Floor picks ignored loadable equipment for advanced athletes.** The pull
   floor seated a bodyweight `pull-up-overhand` (2×12 @ RIR 3–4) even for a
   10y+ athlete who owns a +40 kg dip belt — a weak stimulus when a weighted
   pull-up was feasible.

## Decision

### #1 — HSR rep dose (universal)
Add a `tendon` case to `repsForBucket` returning **`HSR_REPS = 8`**, so rep-based
HSR is dosed heavy enough to reach the tendon-adaptation zone (matching the
dedicated tendon-day HSR). Hold-based tendon items (isometrics / Copenhagens)
override reps with `holdSec`, so they are unaffected. RIR autoregulation already
attached to the floor means 8 reps at the same RIR self-selects a heavier load
than 14 — the load follows automatically. **Universal**, not tier-gated: HSR
needs ≥70% 1RM for any athlete; 14 reps was simply wrong for the stated intent.

### #2 — Advanced-tier loadable preference
For **advanced tiers** (`declaredExperienceToTier ≥ 3` → 5y+/10y+), the
functional floor prefers the **externally-loaded variant** of a pick over pure
bodyweight: a soft `EXTERNAL_LOAD_PREFERENCE_BONUS = 40` boost in `candidateScore`
when `preferExternalLoad` is set and `carriesExternalLoad(m)` is true. So a
weighted pull-up / loaded row wins its role when the kit is owned, falling back to
bodyweight when no loaded option is feasible. `carriesExternalLoad` classifies by
equipment (anything outside a small bodyweight-only set — bar / rings / etc. —
carries load). Applied to the **functional floor only** — the sole pass that
defaults to pure bodyweight; the aesthetic / focus passes already seat loaded
isolations (and use `demoteCompound`, which a load-preference would fight).

## Consequences

- **#1 is a deliberate prescription change**: every block with a rep-based
  durability-floor HSR now shows 8 reps (heavier) instead of ~14. The 10 golden
  snapshots were regenerated (diff = only the HSR rep number). Not byte-identical
  — intended.
- **#2 is byte-identical for non-advanced tiers** (`preferExternalLoad` defaults
  off; the realism harness + goldens use null/fixture experience). Only 5y+/10y+
  blocks that own loading kit change — they gain a loaded floor variant.
- **Reps for the loaded variant are unchanged in v1** (the *selection* is the
  win — a weighted pull-up at 12 reps far outstrips bodyweight at 12 for an
  advanced athlete). Tuning the loaded pull/row toward a strength rep range (6–8)
  is a noted follow-up.
- No schema change.

## Science / rationale
- **HSR dose**: Bohm 2014 (tendon adaptation ≥~70% 1RM), Malliaras 2013 (HSR >
  eccentric-only for tendon adaptation), Morrison & Cook 2022 (slow-tempo reps
  beyond ~6 fall below the load threshold; recommend 6–10 reps or clusters). 8
  reps matches the dedicated tendon-day HSR. **HIGH** confidence on direction;
  **MEDIUM/CP-1** on the exact rep count.
- **Loadable preference**: SAID / progressive overload — bodyweight × 12 @ RIR
  3–4 is a maintenance stimulus for advanced trainees; Wilson 2012's elevated
  interference on running-heavy concurrent blocks makes every strength-day slot
  more valuable, so spending it on a loadable variant is the better trade.
  **HIGH** direction; **MEDIUM/CP-1** on the tier gate + the bonus size.

## Files
- `apps/web/src/lib/planner/accessory-picker.ts` — `HSR_REPS`, `tendon` case in
  `repsForBucket`; `carriesExternalLoad`, `BODYWEIGHT_ONLY_EQUIPMENT`,
  `EXTERNAL_LOAD_PREFERENCE_BONUS`, `CandidateQuery.preferExternalLoad`,
  `candidateScore` boost, `advancedTier` + the functional-floor wiring.
- Tests: `adr-0041-hsr-and-loadable.test.ts`; golden snapshots regenerated.
- `docs/knowledge/hybrid-training-design-constraints.md` (+ workspace mirror).
