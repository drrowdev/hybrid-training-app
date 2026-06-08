# ADR 0044 — UX honesty: external-cardio deload tag + secondary-focus retention copy

Status: Accepted (2026-06-08)
Supersedes: none
Related: ADR 0037 (multi-modal deload), the external-cardio path
(`external-cardio.ts`), ADR 0020 (secondary-focus tilt).
Driven by the same deep-research block review (B−) as ADR 0041–0043 — the
product-transparency findings (not engine math).

## Context

Two transparency gaps the review flagged on an external-cardio endurance block:

1. **Misleading "(deload)" tag on external-cardio days.** Every session title on a
   deload week gets a " (deload)" suffix. But an external-cardio day's prescription
   is just "Logged via Runna" — the engine's deload *downgrade* (ADR 0037: VO2 →
   easy Z2, drop the alactic finisher) only applies to engine-generated cardio.
   Tagging an untouched "Logged via Runna" day "(deload)" implies a change the app
   didn't (and can't) make.

2. **"Secondary focus = strength" overstated in a cardio-led block.** The wizard's
   strength/muscle secondary cards promise "Heavier top sets" / "Add visible size".
   In an endurance-led block the lifting volume sits at/below MEV (the engine
   deliberately protects endurance recovery — the review's Section 5 showed every
   group below MEV), so the secondary is **retention**, not development. The copy
   should say so before the user picks it.

## Decision

### #1 — suppress the deload suffix on external-cardio days
In `createBlock` materialization, compute
`isExternalCardioDay = day.kind === "cardio" && cardioSource === "external"` and
pass `isDeload && !isExternalCardioDay` to `descriptiveSessionTitle`. Engine
cardio + strength days keep the tag (they ARE downgraded); only the
app-can't-control external days drop it. The custom-block loop never builds
external cardio, so it's untouched.

### #2 — retention copy on the secondary-focus cards
`secondaryRetentionNote(primary, card)` adds an italic caveat under the strength /
muscle secondary cards **only when the primary goal is `cardio`**: "In a cardio-led
block this maintains strength — it keeps your numbers, it won't add to them" (and
the size variant). Every other primary (where the secondary genuinely develops)
returns null → no copy change.

## Consequences

- Pure presentation: no engine constant, no prescription change, no migration.
- Deload-tag change is scoped to external-cardio days on deload weeks; every other
  title is unchanged.
- Retention copy appears only for a cardio primary; strength/muscle/resilience
  primaries are unchanged.
- Tests: `secondary-retention-note.test.ts` (the copy rule). Full `@hta/web` suite
  3628 green; lint 0 errors; build OK.

## Files
- `apps/web/src/lib/planner/actions.ts` — `isExternalCardioDay` + the
  `descriptiveSessionTitle` deload arg in the standard materialization loop.
- `apps/web/src/components/planner/BlockWizard/Step3Secondary.tsx` —
  `secondaryRetentionNote` + the per-card note render.
- Test: `apps/web/src/components/planner/BlockWizard/__tests__/secondary-retention-note.test.ts`.
