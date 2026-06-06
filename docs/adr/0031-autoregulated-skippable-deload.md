# ADR 0031 — Autoregulated, skippable deload (Phase 2)

Status: Accepted (2026-06-06)
Supersedes: none
Related: ADR 0030 (deload cadence — two waves); ADR 0013 (within-block volume
autoregulation — the offer/accept pattern this mirrors); the recovered-weeks
classifier (DC-K1, `packages/engine/src/recovered-weeks.ts`); the reactive
auto-deload (`apps/web/src/lib/engine/deload.ts`)

## Context

ADR 0030 set a ~6-week (two-wave) accumulation cadence before a volume-led
deload. But the grounded programs treat even that deload as **autoregulated, not
mandatory**: 5/3/1 explicitly lets recovered/advanced lifters skip it, and
Tactical Barbell keeps accumulating *"for a lengthy period"* while the lifter
*"rarely feels over-trained."* A deload exists to **dissipate accumulated
fatigue** — a user who hasn't accrued much shouldn't be forced to take it.

The app already collects the signals to decide this:
- the **recovered-weeks** classifier (DC-K1) — a week is "recovered" iff it had
  logged sessions, no skips/misses, max sRPE ≤ 9, avg fatigue < 4, avg soreness
  < 4;
- the **reactive auto-deload** state (`tm_history.reason = 'deload'`) — if it
  fired this block, the user genuinely needed to back off.

## Decision

**Offer to skip the programmed deload when the recent loading weeks logged as
recovered.** Accepting converts the deload week's un-started sessions into a
normal loading week. The default is always to take the deload — this only ever
**surfaces a choice**.

Eligibility (pure gate, `isDeloadSkipEligible`):
1. the block has a deload week (maintenance / no-deload blocks never offer);
2. the user is in the deload week or the week before;
3. the deload week still has un-started, not-already-skipped sessions;
4. **no** reactive auto-deload fired this block;
5. the most-recent `DELOAD_SKIP_RECOVERED_WEEKS` (= 2) logged weeks all recovered.

### What "skip" does (the key implementation choice)

The deload week's reduced %TM + volume are **baked into the eagerly-materialised
`planned_sessions.prescription`** — there is no per-week scale flag to clear, so
a true skip needs a *loading-week* prescription for that week. Rather than
re-run the block generator mid-flight (a large, risky refactor of `createBlock`),
the accept action **copies the block's own wave-opener** — the first loading
week (`weekIndex 0`) — onto the deload week's un-started sessions, matched by
`(day_index, slot)`.

This is exact and safe because day templates + movement resolution are
**per-block, not per-week**: week 0 and the deload week share the same
`(day_index, slot)` shape and the same movements, so week 0's prescription *is*
a valid loading week for the same context. We reuse the engine's own validated
output instead of regenerating it. A `prescription.deloadSkipped = true` marker
provides idempotency (the offer stops surfacing; the week no longer reads as a
deload). `session_modality` + `effective_stress_load` are copied from the opener
so the ceiling engine sees the loading-week load.

Choosing the **wave opener** (a 5s ramp) as the replacement continues the wave
sequence — the natural "next cycle" week (5/3/1 restarts each cycle at 5s),
on-thesis for submaximal accumulation.

## Implementation

- `apps/web/src/lib/planner/deload-skip.ts` — pure logic: `deloadWeekIndexFor`,
  `isDeloadSkipEligible`, `DELOAD_SKIP_RECOVERED_WEEKS`, `DeloadSkipOffer` type
  (no I/O, unit-tested — mirrors `autoreg-volume.ts`).
- `apps/web/src/lib/planner/deload-skip-offer.ts` — server read: active block →
  deload week → un-started/not-skipped sessions → reactive-deload guard →
  recovered-weeks signal → eligibility.
- `apps/web/src/lib/planner/deload-skip-actions.ts` — `acceptDeloadSkip`:
  re-derives the offer, copies the wave-opener prescription (+ `deloadSkipped`)
  onto the deload week's un-started sessions.
- `apps/web/src/components/plan/DeloadSkipCard.tsx` — Plan-page offer card +
  confirm modal (mirrors `VolumeAutoregCard`). "Keep my deload" dismisses.
- `packages/db/src/schema/planner.ts` — `Prescription.deloadSkipped?: boolean`
  (JSONB, no migration).

## Consequences

- Reversibility: a skipped deload is recoverable by re-creating the block; the
  marker prevents accidental re-treatment as a deload. Started/skipped sessions
  are never touched.
- No migration, no generator changes, no read-time behaviour change for users
  who don't accept the offer (byte-identical).

## Calibration (CP-2, row 52)

`DELOAD_SKIP_RECOVERED_WEEKS = 2` is a `[DEF→cal]` Stage-A heuristic — a
conservative "two clean weeks of evidence" gate. Confidence: **HIGH** that a
recovered athlete can train through a deload (5/3/1 / TB practice); **MEDIUM** on
the exact window. Validation: offer acceptance rate; reactive-deload trigger
rate in the weeks AFTER an accepted skip (if elevated, the gate is too loose).
