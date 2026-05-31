# ADR 0017 — Ranked cardio-modality preference

**Status:** Accepted
**Date:** 2026-05-31
**Phase:** Production (cardio modality follow-up)
**Relates to:** ADR 0008 (modality-aware concurrent interference — establishes that modality affects *recovery cost*, read from logged sessions), ADR 0009 (cardio time-in-zone), the existing cardio-swap engine (`apps/web/src/lib/sessions/cardio-swap.ts`)
**Touches:** `apps/web/src/lib/planner/preferred-cardio-modality.ts` (new — pure resolver), `apps/web/src/lib/planner/cardio-catalog.ts` (new — DB→catalog adapter), `apps/web/src/lib/planner/actions.ts` (read + wire, both block-creation paths), `apps/web/src/lib/settings/cardio-modality-actions.ts` (new — server action), `apps/web/src/components/settings/CardioModalitySettings.tsx` (new — ranked editor), `apps/web/src/app/app/settings/training/page.tsx` + onboarding Equipment step (write surfaces), `packages/db/src/schema/profiles.ts` + migration `0081_profiles_preferred_cardio_modalities.sql` (storage)

## Context

Running is the archetype default for every prescribed cardio day. Users who
prefer cycling, rowing, swimming, or another modality had to manually swap each
cardio movement after a block was created (via the existing per-session
`cardio-swap` flow). There was no way to say "program cycling for me by default."

The user asked for a standing preference, set during onboarding and editable in
the training profile, that the planner honours when it generates a block.

Two facts shaped the design:

- **Load-neutrality (verified).** A prescribed cardio session's stress is driven
  by the day's `cardioKind` (z2 / threshold / vo2 / alactic) + duration + HR cap,
  all from the archetype template — **not** by which modality vehicle is used.
  The modality-weighted concurrent scalar (`computeConcurrentScalar`,
  run 1.0 / swim 0.6 / row 0.5 / bike 0.4) is fed by *logged* `cardio_logs` and
  consumed only in analytics (`lib/stats/muscle-volume.ts`); it is **not** part
  of `buildPrescription`. So substituting the *prescribed* modality at the same
  `cardioKind` is byte-neutral for the strength prescription.
- **Uneven intensity coverage.** The seed catalog gives running / cycling /
  rowing a full intensity ladder (z2 / threshold / vo2 / alactic); swimming /
  rucking / sled / elliptical / stair are z2-only; ski-erg has no zoned entries.
  A swim-preferring user therefore *cannot* be given a swim VO2 interval — there
  isn't one.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Preference model | A **ranked allow-list** (`profiles.preferred_cardio_modalities text[]`, ordered by priority), not a single pick. | Lets a user say "cycling, else rowing, else running" and gracefully covers the uneven-coverage problem without forcing one modality. |
| 2 | Fallback | For each modality in rank order, use the first that has a **feasible same-`cardioKind`** movement (owned equipment + experience tier). If none qualify, keep the archetype default (**running**) — the only modality with a full ladder. | Honest about coverage: a swim-preferring user gets swims on easy days and running on interval days, by design. Never produces an empty/invalid day. |
| 3 | Intensity-preserving | Substitution holds the prescribed `cardioKind` constant; it only changes the *vehicle*. | Preserves the archetype's recovery math and the load-neutrality invariant above. |
| 4 | Empty = identity | An empty / null preference reproduces the pre-0017 prescription **byte-for-byte** (default running slug, no catalog query). | Zero-migration safety; the golden-master harness and all prior pins stay green. The catalog query is lazy — the default path pays nothing. |
| 5 | Bake-at-creation | Read at `createBlock` / `createCustomBlock`, baked into the materialised prescription. Changing the preference affects the **next** block, never an existing one. | Consistent with every other profile-driven generation input (`equipment`, `training_experience`, `effort_preference`). |
| 6 | Determinism | Among equally-ranked, equally-feasible candidates the **lowest slug** wins. If the top feasible modality already equals the default's modality, keep the exact archetype-chosen slug. | A given (user, archetype, tier, equipment) always rebuilds identically; avoids a pointless reshuffle of the curated default. |
| 7 | Not a load constant | This is **selection** logic, not load math. No CP-2 constant is added or changed. | The doc-drift guard stays green; no calibration-policy obligation beyond reusing existing classifiers. |
| 8 | Reuse single-source helpers | Intensity classification (`classifyCardioKind`) and equipment reconciliation (`movementMatchesEquipment`) reuse the existing `cardio-swap.ts` source of truth. | One definition of "what kind is this cardio movement" and "can the user do it." |

## Coverage table (catalog as of 2026-05-31)

| Modality | z2 | threshold | vo2 | alactic |
|---|---|---|---|---|
| running | ✓ | ✓ | ✓ | ✓ |
| cycling | ✓ | ✓ | ✓ | ✓ |
| rowing | ✓ | ✓ | ✓ | ✓ |
| swimming | ✓ | — | — | — |
| rucking / sled / elliptical / stair | ✓ | — | — | — |
| ski_erg | — | — | — | — |

A preferred modality with no entry for the prescribed kind falls through to the
next preference, then to running.

## Rationale

The honest framing: we have ~0 rows of real preference data, so the conservative
move is to add a **reversible, opt-in selection lever** that defaults to today's
behaviour, rather than re-pick a universal default. Substitution is
intensity-preserving by construction, so it touches no engine load math and
carries no regression risk to the strength prescription — the golden-master
harness (`assemble-prescription.golden.test.ts`) pins the empty-preference path.

## Evidence base

- **ADR 0008 lineage / Wilson 2012** — **MODERATE**: modality affects concurrent
  *recovery cost* (the scalar), which is read from logged sessions, not the
  prescription. This is *why* a prescribed-modality swap at constant `cardioKind`
  is load-neutral, and why the feature is selection-only.
- **Specificity principle (endurance literature, general)** — **practical**:
  programming the modality the athlete actually trains/races improves adherence
  and transfer; running-only defaults under-serve cyclists/rowers/swimmers.

No new CP-2 constants. The 9-modality vocabulary and the ≤8-entry cap are UX
bounds, not calibrated quantities.

## Implementation contract (as built — 2026-05-31)

**Commit:** _(filled on merge)_.

1. **Storage.** Migration `0081` adds `profiles.preferred_cardio_modalities text[]`
   (nullable, no default = byte-identical for existing rows) + CHECK (≤8 entries,
   each a member of the 9-modality vocabulary). Non-journaled, following the
   0078–0080 pattern.
2. **Vocabulary + resolver.** `preferred-cardio-modality.ts` (pure) owns the
   `PreferredCardioModality` vocabulary (running / cycling / rowing / swimming /
   rucking / sled / elliptical / stair / ski_erg), `normalizeCardioModality`
   (raw seed `metadata.modality` → canonical; hyphen→underscore + synonyms;
   null for un-substitutable like jump-rope/other), `sanitizePreferredModalities`
   (de-dupe + rank-preserve + drop-unknown), and `resolvePreferredCardioModality`
   (the fallback walk). Fully unit-tested.
3. **Catalog adapter.** `cardio-catalog.ts` maps `movements` rows
   (`pattern='cardio'`, `user_id IS NULL`) to classified entries via
   `classifyCardioKind` + `normalizeCardioModality`, carrying `id`/`displayName`
   for the planner's slug→movement lookup. `loadCardioCatalog` is queried lazily.
4. **Wiring.** `actions.ts` reads `preferred_cardio_modalities` + `equipment.cardio`
   in both block-creation profile SELECTs; at the cardio branch (archetype path +
   custom path) it calls `resolvePreferredCardioModality` after
   `resolveCardioSlugForTier` and prescribes the returned slug (`cardio_external`
   maps to the non-substitutable `cardio_other`). Empty preference → no catalog
   query, default path unchanged.
5. **Write surface.** Server action `updatePreferredCardioModalities` (user-scoped
   client, ownership filter, Zod `.strict()`, server-side sanitize, empty→NULL).
   `CardioModalitySettings` ranked editor (add / reorder / remove, auto-save)
   mounts on `/app/settings/training` and in the onboarding Equipment step.
6. **Tests.** New unit suites for the resolver and the catalog adapter; wizard
   routing test updated for the new required prop. Golden master unchanged
   (empty-preference identity).

## Consequences

- Cardio-equipment selections (`equipment.cardio`), previously stored but unused
  by the planner, are now **consumed** as a feasibility filter for substitution.
- A user with a thin preferred modality (e.g. swimming only) will see running on
  interval days. The UI states this explicitly so it isn't surprising.
- Future modality catalog growth (e.g. adding cycling alactic seeds) automatically
  widens coverage with no code change — the resolver reads the live catalog.
