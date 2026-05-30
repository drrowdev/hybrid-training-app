# ADR 0013 — Within-block volume autoregulation (the engine acts, not just advises)

**Status:** Accepted
**Date:** 2026-05-30
**Phase:** Production (adaptivity — closing the autoregulation loop within a block)
**Relates to:** ADR 0007 (autoregulated AMRAP top set — load-layer autoregulation), ADR 0008 (modality-aware taper — event-driven scaling), ADR 0010 (next-block nudge — the between-block counterpart), ADR 0012 (accessory value). This ADR is the *volume-layer, within-block* sibling of those.
**Touches:** `packages/db/src/schema/planner.ts` (`Prescription` gains optional `autoregVolumeScale`), `apps/web/src/lib/sessions/actions.ts` (`fillSessionFromPlan` honors the scale), the session/plan renderers, a new remaining-sessions query + bulk-update helper, a Today/ceiling offer banner + accept action, `docs/knowledge/hybrid-training-design-constraints.md` (CP-2 rows).

## Context

The engine autoregulates the **load/intensity** layer well: the GRM top-set recommendation (ADR 0007 + `grm.ts`), deload detection, TM-bump proposals, and the recovery/taper scalers all flex *how heavy* the next session is. What it does **not** do is flex **volume within an in-flight block**.

Prescriptions are materialized **eagerly at block creation** — `createBlock`/`createCustomBlock` loop every week × day and write a frozen `planned_sessions.prescription`. `getCeilingUtilization` (`ceiling-queries.ts`) already computes, every render, how far the user's rolling-7-day strength volume is over the archetype's prescribed cap, with bands:

```
under (<70%) · on-budget (70–90%) · at-line (90–110%) · over (110–130%) · way-over (≥130%)
```

…but **nothing acts on the over/way-over signal**. The existing `prescription_modifications` overlay (taper/recovery) is consulted only inside `assemblePrescriptionItems` at *generation* time, so it cannot reach an already-materialized block. A user who is systematically accumulating more volume than the program budgeted — the classic over-reaching pattern — gets, at most, a passive chip. A world-class coach would *offer to pull back the discretionary work* on the rest of the week.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | **Trigger** = ceiling band | Offer fires when the **strength** band is `over` (≥110%) or `way-over` (≥130%) on the rolling week. Cardio volume is **out of scope** for v1. | The signal already exists, is rolling-week-scoped, and is the established over-reaching indicator in the app. Strength accessory volume is the safe, discretionary lever; cardio trimming interacts with event taper (ADR 0008) and is deferred. |
| 2 | **What gets trimmed** = discretionary kinds only | Scale down `accessory`, `tendon`, `power_potentiation` items. **Never** `warmup`, `main`, `back_off`. | Progressive overload and the strength stimulus live in the mains; SAID + ADR 0012 dec. 6 — the mains are the stable progressive core. Volume autoregulation in the literature (Helms RIR-autoreg; ACSM volume-landmark work, Israetel MEV/MRV) flexes *assistance* volume, not the primary lifts. |
| 3 | **Scope** = remaining sessions, current week | Apply only to `planned_sessions` in the active block that are **not yet started** (`completed_session_id IS NULL`) and fall **after the user's current week/day position**, within the **current rolling week**. Future weeks untouched. | The ceiling is a weekly construct; each future week re-evaluates its own band. Touching only un-started rows preserves anything logged/inspected. |
| 4 | **Magnitude** = one band-step scale | `over` → `AUTOREG_VOLUME_SCALE_OVER` (0.80); `way-over` → `AUTOREG_VOLUME_SCALE_WAYOVER` (0.66). Applied as the existing `strengthVolumeScale` slice shape: keep `round(n·scale)` discretionary items, drop from the end. | Anchors to the deload-scale family already in `archetypes.ts` (0.5–0.75) but gentler — this is a mid-week nudge, not a deload. **Heuristic / LOW confidence:** no study quantifies the optimal within-block volume-trim fraction; flagged as such in CP-2 and revisitable once we have adherence/outcome data. |
| 5 | **Confirm-first, never auto-apply** | A Today/ceiling banner shows the recommendation; the user clicks Apply or Dismiss. Default action is no-op. | Consistent with every other engine offer (deload, TM-bump, taper). Autoregulation that silently rewrites the plan erodes trust and predictability (the same reason ADR 0010 keeps structural change at block boundaries). |
| 6 | **Apply mechanism** = reversible read-time scalar, not destructive deletion | On Apply, write `prescription.autoregVolumeScale` onto the affected future rows (a single optional field on the `Prescription` JSONB). `fillSessionFromPlan` and the renderers apply the slice **at read time** via one shared `applyAutoregVolumeScale(prescription)` helper. Dismiss/undo = clear the field. | Keeps the full item list intact → reversible and auditable without a new table. Gating on field-present means **non-users see byte-identical prescriptions** (the regression invariant). We do **not** reuse the `prescription_modifications` overlay: its consumer runs only at generation and its payload models a date-windowed *event* scalar, not a per-session block adjustment. |
| 7 | **One offer per week** | The accept action stamps the rolling week; re-prompting is suppressed until the next rolling week. | Avoids nagging on every render while the band stays hot. |

## Rationale

The honest framing for the user (delivered verbatim in the assessment turn that motivated this work): the app already autoregulates load strongly and adapts structure *between* blocks, but it is **not dynamic within a block** because the plan is frozen at creation. This ADR closes exactly that loop for the one dimension where mid-block flex is both safe and literature-supported — **assistance volume** — while deliberately leaving structure (movement selection, day layout) and the primary lifts stable within the block. That boundary is intentional: progressive overload needs a stable target, and autoregulation research is about flexing *dose*, not *plan shape*.

Decision 6 is the load-bearing engineering choice. Because blocks are materialized eagerly and the existing overlay can't reach them, the only ways to make a mid-block change "stick" are (a) rewrite the rows or (b) add a read-time transform. We choose a **reversible scalar field read at fill+render** rather than destructive item deletion so that the regression invariant holds for free (absent the field, behaviour is bit-identical) and Undo is a field-clear, not a re-materialization.

## Calibration policy (CP-2)

Two new constants, both **CP-5 heuristic / LOW confidence**, citationed as practitioner-anchored not RCT-derived:

- `AUTOREG_VOLUME_SCALE_OVER = 0.80`
- `AUTOREG_VOLUME_SCALE_WAYOVER = 0.66`

Band thresholds reuse the existing `bandFor` cutoffs (no new constant). Revalidation gate: real adherence/outcome data (parked alongside the PR #166 wellness-threshold revalidation).

## Consequences

- **Positive:** the engine now *acts* on accumulated-fatigue signal instead of only displaying it; reversible and parity-safe; no schema migration if `autoregVolumeScale` rides the existing JSONB (no DDL).
- **Negative / risk:** trim magnitude is a guess; mitigated by confirm-first + easy undo + LOW-confidence labelling. Read-time slicing adds a transform to `fillSessionFromPlan` — covered by parity tests (field-absent ⇒ identical inserts).
- **Out of scope (v1):** cardio volume trimming; auto-apply; trimming across future weeks; raising volume when `under`-loading (the inverse nudge — deferred, weaker safety case).

## Regression guard

- Parity test: a prescription with no `autoregVolumeScale` produces byte-identical `set_logs` from `fillSessionFromPlan` and identical render output.
- Trim test: mains/back-off/warmup counts are invariant under any scale; only discretionary kinds shrink, from the end.

## As-built notes (implemented)

- **Surface:** the offer renders as `VolumeAutoregCard` on the active-block `/app/plan` page (the training hub where the over-budget impact is visible), fetched via `getVolumeAutoregOffer` alongside the limitation offer in a single `Promise.all`. It is a pure function of live state — there is **no decline-suppression ledger**, so the banner re-appears on reload until the band drops out of `over`/`way-over` or the user accepts (acceptable since it's page-scoped, not a persistent Today banner).
- **Scope:** triggers on the **strength** ceiling band only (cardio volume trimming remains out of scope as designed).
- **Read seams:** applied at `fillSessionFromPlan` (log copy) **and** the display readers `getPlannedDays` / `getPlannedSessionById` so the rendered plan matches what gets logged. Added `hasDiscretionaryVolume` to gate the offer (no banner when there's nothing trimmable).
- **Shared primitives:** accept path uses the `remaining-sessions.ts` helpers (`getActiveBlockRemainingSessions` + `applyPrescriptionUpdates`) shared with ADR 0014; both re-derive server-side and re-assert the un-started predicate per row.
- **Tests:** 8 autoreg-volume unit tests (band→scale, end-slicing, mains/cardio invariance, absent-field parity). Full suite 2758 green; build green.
