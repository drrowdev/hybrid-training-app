# ADR 0034 — Modality- & pattern-aware durability floor

Status: Accepted (2026-06-07)
Supersedes: none
Related: ADR 0017 (ranked cardio-modality preference), ADR 0024 (accessory volume
level), the DC-O4 durability floor (`accessory-roles.ts`), tendon-floor invariant.

## Context

The weekly durability floor `DC_O4_FLOOR` (`accessory-roles.ts`) is a **static
template** — `{ heavy_isometric:1, hsr:1, plyometric_low:1, carry:2 }` for every
archetype, plus per-archetype `durability.extras` (endurance adds `+1 hsr`). A
pre-launch plan review surfaced two execution gaps:

1. **HSR is role-only, never region/pattern-targeted.** The picker fills the HSR
   slot by role-deficit + block rotation, with no knowledge of (a) the day's
   main-lift pattern or (b) the user's cardio modality. So it can put a slow
   **front-squat** (knee/patellar) HSR on **deadlift** day, and a **runner**
   (4×/wk impact) can get **zero** calf/Achilles HSR even though `hsr-calf-raise`
   (`bulletproofRoles:["hsr"]`, `primaryRegion:"foot_ankle_calf"`) exists.

2. **No modality / main-lift signal reaches the floor.** Cardio modality is
   resolved per cardio day at block creation (ADR 0017; default = running) but was
   never threaded into the durability floor.

For a running-dominant hybrid athlete, Achilles/calf is the highest-probability
overuse site; posterior/patellar tendon loading should be distributed across the
week's patterns rather than concentrated.

## Decision

Add a **soft region preference** to durability fills and two signal-driven HSR
preferences. Phase 3 (a new rotator-cuff/shoulder role) is deferred to a
follow-up ADR.

### Shared plumbing
- `CandidateQuery.preferRegion?: string` — a **soft ranking boost**
  (`REGION_PREFERENCE_BONUS = 50`, above `ROTATION_BASE` so it beats block-rotation
  novelty but below any hard role/limitation/equipment filter). Never a hard
  filter, so it can't force an empty fill.
- Two optional inputs threaded `actions.ts → assemble-prescription →
  pickAccessoriesForSession`: `runningCardio: boolean` and `dayPrimaryRole:
  string`. Both default to no-op (false / undefined) → byte-identical.
- `runningCardio` is computed once per block by `blockUsesRunningCardio` from the
  ADR-0017 resolved cardio modalities (running unless every cardio day is
  substituted away).

### Phase 1 — modality-aware HSR (Achilles guarantee for runners)
When the block runs, the **first HSR of the week** (none picked yet) prefers
`primaryRegion = "foot_ankle_calf"`. Tracked via the weekly `durabilityProgress`
HSR count, so it fires once/week, then yields to Phase 2.

### Phase 2 — day-pattern-aware HSR
HSR fills not claimed by Phase 1 prefer the day's main-lift pattern region
(`HSR_REGION_BY_ROLE`: squat→`knee`, deadlift→`hamstring_posterior`,
press→`shoulder_scapular`). Fixes slow-front-squat-on-deadlift-day; presses have
no HSR yet (Phase 3), so the soft preference simply falls back to any HSR.

### Phase 3 — DEFERRED (follow-up ADR)
Rotator-cuff/shoulder durability needs a NEW role (`shoulder_stability`),
catalogue tagging (external rotations, band pull-aparts, face pulls), and a new
floor magnitude — all CP-1 constants. Out of scope here.

## Consequences

- **Not byte-identical for the general population** (deliberate). Running is the
  default modality, so Phase 1 changes the HSR composition of most
  endurance/concurrent blocks (one HSR slot becomes calf-preferred). This is a
  global engine improvement, not an opt-in feature — justified by injury-risk
  literature.
- **Legacy callers / the golden harness stay byte-identical** — they omit the new
  optional params, so `preferRegion` is never set. Confirmed: the
  `assemble-prescription` golden suite passes unchanged.
- **Tissue-floor counts unchanged** — Phases 1–2 change *which* HSR is picked, not
  *how many* floor items. `DC_O4_FLOOR`, `FLOOR_FUNCTIONAL_RESERVE`, and the
  tendon-floor invariant are untouched.
- **Custom blocks unaffected** — they pass `undefined` catalog, so the dynamic
  picker (and this floor) never runs.
- **No calibration debt** — Phases 1–2 add only structural region preferences;
  `REGION_PREFERENCE_BONUS` is a soft-preference weight, not a dose.

## Science

Running is the #1 Achilles-tendinopathy etiology; HSR (Kongsgaard 2009, already
cited for the `hsr` role) is the evidence-based loading protocol — HIGH confidence
on direction. Pattern-distributed tendon loading follows specificity/SAID —
MODERATE (programming logic). No new magnitude constants in Phases 1–2.

## Files
- `apps/web/src/lib/planner/accessory-picker.ts` — `preferRegion`,
  `REGION_PREFERENCE_BONUS`, `HSR_REGION_BY_ROLE`, `RUNNING_HSR_REGION`, the HSR
  region logic in the durability loop, and the `runningCardio` / `dayPrimaryRole`
  params.
- `apps/web/src/lib/planner/preferred-cardio-modality.ts` — `blockUsesRunningCardio`.
- `apps/web/src/lib/planner/assemble-prescription.ts` — threads the signals.
- `apps/web/src/lib/planner/actions.ts` — computes `runningCardio` (createBlock).
- Tests: `durability-modality-hsr.test.ts`, `preferred-cardio-modality.test.ts`.
