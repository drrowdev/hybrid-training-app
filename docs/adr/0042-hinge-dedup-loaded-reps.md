# ADR 0042 — hinge-day durability de-dup + loaded floor-pull strength reps

Status: Accepted (2026-06-08)
Supersedes: none
Related: ADR 0034 (durability HSR region logic), ADR 0041 (HSR dose +
loadable preference), ADR 0036 (universal pull floor).
Driven by the same deep-research block review (B−) as ADR 0041 — its
"do all follow-ups" tail.

## Context

Two further accessory findings from the `endurance_anchor` review, both about a
highly-advanced athlete on a running-heavy week:

1. **Redundant axial hinge on the deadlift day.** The durability HSR on a hinge
   (deadlift) main day seated `hsr-rdl` — a second *axially-loaded hinge*
   immediately after the trap-bar deadlift, on the day already carrying the
   heaviest posterior-chain load and preceding three consecutive running days.
   Wilson 2012 shows running-based concurrent training drives the greatest
   lower-body interference, so an avoidable posterior-chain fatigue amplifier on a
   strength day is a poor recovery trade. The deadlift already maxes the posterior
   chain; the HSR slot should *distribute* tendon work to another region, not
   double the hinge.

2. **Loaded floor pull dosed for hypertrophy, not strength.** ADR 0041 made the
   functional pull floor prefer the externally-loaded variant (weighted pull-up)
   for advanced tiers, but left the reps at the archetype hypertrophy default
   (12). A weighted pull-up / loaded row for a 10y+ athlete is a *strength*
   stimulus and reads better in a low rep range.

## Decision

### #1 — hinge-day HSR distributes off the axial hinge
In the durability loop's HSR region preference, the **deadlift** day is handled
explicitly (removed from `HSR_REGION_BY_ROLE`): it steers to a tendon region
*distinct* from the squat day rather than to the posterior/hinge region.
- Non-running block: squat day → **knee**, deadlift day → **calf/Achilles**
  (`foot_ankle_calf`) → two distinct tendons, no second RDL.
- Running block: day 1's first HSR already claims the calf (ADR 0034 Phase 1), so
  the deadlift day takes **knee** instead — still two distinct tendons, still no
  redundant axial hinge.

The preference is **soft** (`findCandidate` falls back to any in-role HSR when no
region match exists), so a thin catalog still fills the slot. Ideal future state —
a seeded *non-axial* machine hamstring-curl HSR so the posterior chain keeps a
tendon option without an axial hinge — is deferred to a catalog addition.

### #2 — loaded floor pull → strength reps
When the functional **pull** floor seats an externally-loaded movement
(`carriesExternalLoad`), override reps to **`LOADED_FLOOR_REPS = 8`** (a heavy set
of 8) instead of the archetype hypertrophy range. Bodyweight floor picks keep
their default reps, so this only fires alongside the ADR 0041 advanced-tier loaded
preference.

## Consequences

- **Hinge de-dup changes deadlift-day prescriptions** for blocks that reach the
  durability HSR slot: the HSR is a calf/knee tendon movement instead of an RDL.
  Pure byte-identical guarantee holds for everyone *not* hitting that slot; the
  realism/golden fixtures were unaffected (their fixture catalog + variety penalty
  already steered off `slow-rdl`), so no snapshot regeneration was needed.
- **Loaded-rep change is scoped** to floor pulls that are *both* externally loaded
  *and* selected (i.e. advanced tiers owning loading kit, per ADR 0041). Everyone
  else is byte-identical.
- No schema change.

## Science / rationale
- **Hinge de-dup**: Wilson 2012 (running-concurrent interference is greatest in
  the lower body; r = −0.26…−0.75 for endurance frequency/duration vs.
  hypertrophy/strength/power) — avoid stacking avoidable posterior-chain fatigue
  on a strength day in a running-heavy block. Distributing tendon work across
  regions also follows SAID (broaden tendon resilience rather than doubling one
  pattern). **HIGH** direction; **MEDIUM/CP-1** on the exact region pairing.
- **Loaded reps**: standard strength-rep prescription — a loaded compound pull for
  an advanced athlete belongs near 6–8 reps, not 12. **HIGH** direction;
  **MEDIUM/CP-1** on the exact count (8).

## Files
- `apps/web/src/lib/planner/accessory-picker.ts` — explicit deadlift branch in the
  HSR region preference (+ removed `deadlift` from `HSR_REGION_BY_ROLE`);
  `LOADED_FLOOR_REPS`; `repsOverride` on the loaded functional-pull `buildPick`.
- Tests: `adr-0042-hinge-dedup-loaded-reps.test.ts`; updated
  `durability-modality-hsr.test.ts` (ADR 0034 Phase 2 deadlift expectation).
- `docs/knowledge/hybrid-training-design-constraints.md` (+ workspace mirror).
