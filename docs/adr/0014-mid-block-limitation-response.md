# ADR 0014 — Mid-block limitation response (deterministic; AI-assist deferred)

**Status:** Accepted
**Date:** 2026-05-30
**Phase:** Production (adaptivity — limitations reach the in-flight block)
**Relates to:** ADR 0012 (accessory value/rotation — same picker, same "never swap for its own sake" restraint), ADR 0013 (shared remaining-sessions rewrite seam). The `feat/limitations-v2-lifecycle` work that added `blockedMuscles`/`allowedMovementIds` is the direct predecessor.
**Touches:** `apps/web/src/lib/planner/limitations-context.ts` (`blockedMovementIds`), `apps/web/src/lib/planner/accessory-picker.ts` (`PickFilters.blockedMovementIds`), `apps/web/src/lib/limitations/actions.ts` (detect-affected + offer + accept), the injuries/limitations UI, the shared remaining-sessions query, session-render warning surface.

## Context

The limitations model is already rich: a `limitations` table with `region` (7-value enum incl. `elbow_forearm`), `severity`, `affected_muscles[]`, `affected_movement_ids[]`, `allowed_movement_ids[]`, `kind`, and a self-serve `/app/recovery/injuries` page. `readLimitationsContext` derives `blockedRegions`, `blockedMuscles`, `allowedMovementIds`, `tendinopathyActive` and the accessory picker honors them.

**But it only runs at block-generation time.** Two concrete gaps:

1. **Mid-block flags don't reach the active block.** Because the block is materialized eagerly at creation, declaring a limitation in week 2 leaves weeks 2–4's already-frozen `planned_sessions` full of the offending movements. The motivating real case: the user suspects **cubital tunnel syndrome** mid-block and wants the app to respond by adjusting upcoming sessions — today it does nothing until the next block.
2. **`affected_movement_ids` is silently dropped.** `readLimitationsContext`'s `select` lists only `region, kind, affected_muscles, allowed_movement_ids` — the user-flagged *specific movements* never become a filter, even at generation. A latent bug.

**Framing guardrail (non-negotiable):** this is **user-directed load management, not medical care.** No copy claims to prevent, treat, diagnose, or rehabilitate any condition. Every surface points the user to a clinician for diagnosis. The mechanism is generic over *any* limitation; cubital tunnel is the test case, not a hard-coded special path.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | **Fix the drop** | Add `blockedMovementIds: Set<string>` to `LimitationsContext` (union of active rows' `affected_movement_ids`) and to `PickFilters`; the picker drops any candidate whose id is in it (allow-list still wins). Wire it into `readLimitationsContext`'s select. | Closes gap #2. Makes the user's explicit per-movement flags authoritative at both generation and the new mid-block path. |
| 2 | **Mid-block application** = swap offer on remaining sessions | On limitation create/edit, scan the active block's **un-started future** `planned_sessions` (shared query with ADR 0013) for items that violate the *current* limitation context (id ∈ `blockedMovementIds`, or movement loads a `blockedRegion`/`blockedMuscle` without allow-list). Present an offer listing the affected upcoming sessions. | A coach told "my elbow's acting up" fixes the *rest of the plan*, not just the next block. Reuses the eager-materialization rewrite seam from ADR 0013. |
| 3 | **What gets swapped** = discretionary items only; mains warn-only | For offending `accessory`/`tendon`/`power_potentiation` items → propose a **picker-derived replacement** (run the existing limitation-aware picker for that day-role/slot, honoring `allowedMovementIds`, keeping sets/reps/structure). For offending `main`/`back_off`/`secondary` items → **warn only**, no auto-swap: surface a non-destructive caution on the session ("your elbow limitation may affect <lift> — consider reducing load/ROM or consult a clinician"). | Mains are archetype-fixed and progression-bearing (ADR 0012 dec. 6 / SAID). Swapping a main mid-block is too consequential, and a main lift's interaction with cubital tunnel is a *load/ROM/grip* decision, not a movement substitution. Picker already does safe limitation-aware accessory selection, so swaps are deterministic and low-risk. |
| 4 | **Confirm-first, in-place swap** | The user reviews proposed swaps and Applies. On Apply, rewrite the affected future rows' offending accessory items with the chosen replacements (in-place `movementId` rewrite via the shared bulk-update helper). Un-started rows only; completed/in-progress untouched. | Structural swap can't be a scalar overlay (ADR 0013's mechanism). The swap *is* the change and should be visible in the plan. Confirm-first matches every other engine offer. |
| 5 | **No auto-revert on resolve** | Resolving the limitation later does **not** auto-swap the safer movement back; the next block regenerates normally. The user can manually edit. | You don't want to auto-restore an elbow-stressful movement the moment a limitation is marked resolved. Leaving the safer pick until fresh generation is the conservative, correct default. |
| 6 | **Deterministic only; no AI** | The condition→movement mapping is driven by the user's structured inputs (region, muscles, specific movement ids) + the picker. **No AI interpretation layer ships here.** | User decision (this session): ship the safe, testable, deterministic core first. The free-text-condition→catalog-movement AI assist (via BYOAI, confirm-first, read-only) is documented as a deferred follow-up, not built. Determinism fits the injury-adjacent safety bar and the calibration policy. |
| 7 | **Medical framing in copy** | Load-management language only; no prevent/treat/diagnose claims; clinician pointer on the limitation UI and the warn-only surface. | Product-safety + the user-established guardrail. |

## Rationale

The deterministic core covers ~all of the real value for the motivating case. Cubital tunnel maps cleanly to `region = elbow_forearm` (+ optional muscle flags biceps/triceps/forearms + specific movement ids the user ticks), and the picker already filters on exactly those. The only thing a static table or AI could add is auto-suggesting *which catalog movement ids* to flag — convenience, not capability — so it is deferred without loss of the load-bearing behaviour.

The split in decision 3 (swap accessories, warn-on mains) is the crucial safety boundary. It keeps structural change confined to the discretionary layer (consistent with ADR 0012/0013), avoids the engine making a consequential call about a primary lift under a suspected nerve condition, and routes that judgement back to the user + their clinician where it belongs.

## Consequences

- **Positive:** limitations finally reach the in-flight block; the `affected_movement_ids` bug is fixed (improves generation too); deterministic + testable; mechanism is condition-agnostic.
- **Negative / risk:** in-place accessory swap is not auto-reversible (mitigated by manual edit + decision 5 rationale); requires a careful "un-started future rows only" predicate (shared, tested with ADR 0013).
- **Deferred (explicit, parked):** BYOAI free-text condition→movement suggestion (read-only, confirm-first, graceful-degrade when no key); curated common-condition table; new movement metadata tags for "elbow flexion under load / direct elbow pressure / grip-intensive" (current granularity is region+muscle, which is coarser but sufficient for v1).

## Regression guard

- Parity: with no active limitation, `LimitationsContext` and all prescriptions are byte-identical (new `blockedMovementIds` defaults empty; `EMPTY_LIMITATIONS_CONTEXT` extended).
- RLS: the detect/offer/accept actions use the user-scoped client, explicit ownership check on the block + rows, Zod `.strict()` input.
- Swap correctness: proposed replacement never re-introduces a blocked region/muscle/id; mains are never swapped; sets/reps/kind preserved.

## As-built notes (implemented)

- **Surface:** the offer renders as `LimitationResponseCard` on the active-block `/app/plan` page (not literally "on limitation create/edit" as the decision table phrased it) — the plan page is the training hub where the swaps/drops/warns are visible, and the offer is derived purely from live state via `getLimitationResponseOffer`. Consequence: like ADR 0013, there is **no decline-suppression ledger**; warn-only items re-surface on reload until the limitation resolves. Acceptable because it's page-scoped, not a persistent Today banner. (Flagged to the user.)
- **Three-way split (refined from the 2-way table):** discretionary offenders → **swap**, or **drop** when `deriveReplacement` finds no safe like-for-like; protected kinds (main/back_off/warmup) → **warn**. Cardio/other kinds are left as-is.
- **`deriveReplacement` scoring (as-built):** shared non-blocked primary muscles ×3 + shared bulletproofRoles ×2 + shared functionalRoles ×1 + compound (+1) + loadable (+1); requires ≥1 shared muscle/role; excludes same id, already-in-session ids, unsupported, and unsafe movements; ties break on `cand.id < best.id` (deterministic).
- **Refactor:** the catalog loader was extracted to `lib/planner/picker-catalog.ts` (`loadPickerCatalog` + `toCatalogMovement` + `CATALOG_SELECT`) and `createBlock`'s inline copy removed; `loadsBlockedRegion` / `loadsBlockedMuscle` exported from `accessory-picker.ts` for reuse by `response.ts`. `offenceFor` mirrors the picker's blocked-region/muscle/movement semantics exactly (region + movement-id offences ignore the allow-list; muscle offences are allow-list-bypassable).
- **Shared primitives:** accept path uses `remaining-sessions.ts` (`getActiveBlockRemainingSessions` + `applyPrescriptionUpdates`) shared with ADR 0013; re-derives the plan server-side (never trusts a client-supplied plan).
- **Tests:** 8 limitation-response unit tests (swap to safe same-target, drop when none, warn-only mains, region vs muscle vs movement offences, allow-list interaction, parity with no limitation). Full suite 2758 green; build green.
