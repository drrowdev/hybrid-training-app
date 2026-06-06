# ADR 0032 — Combined-load fatigue proxy → early-deload recommendation (Phase 3)

Status: Accepted (2026-06-06)
Supersedes: none
Related: ADR 0030 (deload cadence), ADR 0031 (skippable deload — the symmetric
inverse); the reactive auto-deload (`apps/web/src/lib/engine/deload.ts`); the
cardio interference scalar (`concurrent-scalar.ts`, ADR 0025); the recovered-
weeks classifier (DC-K1)

## Context

Phases 1–2 gave a ~6-week cadence and a *skip* when recovered. The remaining
gap is the **opposite** direction: a user who is **accumulating fatigue faster
than the schedule assumes** — especially from concurrent **endurance volume**,
which the strength-only reactive auto-deload (2 AMRAP misses → TM −10%) is blind
to (cardio load never shows up as an AMRAP miss).

The grounded principle (ADR 0030 citations) is that deload need is proportional
to **accumulated combined load**, and that the *dominant load driver* is
archetype-specific (endurance = aerobic volume / interference; strength =
tonnage ramp / intensity). Phase 1 deliberately deferred this differentiation
because hardcoding per-archetype cadence is LOW-confidence; Phase 3 earns it
with a **live signal** instead of a guessed constant.

## Decision

Compute a **normalised [0,1] combined-load fatigue proxy**, archetype-weighted,
and when it crosses a threshold *with loading still left before the scheduled
deload*, surface an **advisory recommendation to bring the deload forward**.

- **Advisory + conservative.** The scheduled deload is the **fixed fallback**
  and always remains. The proxy only ever surfaces a choice, gated to require
  enough data (≥ 3 logged weeks), real loading left (≥ 2 weeks to the scheduled
  deload), and no deload already this block.
- **Three terms** (each normalised 0–1), combined by per-archetype weights:
  - **load ramp** — acute (most-recent week) tonnage ÷ chronic (trailing mean);
    an ACWR-style spike (Soligard 2016 basis, same as the region-spike banner);
  - **cardio interference** — `1 − concurrentScalar` (the endurance-load term
    nothing else feeds into the deload decision);
  - **subjective** — the worse of the recovery check-in (fatigue/soreness) and
    peak sRPE.
- **Archetype weights** (the differentiation): endurance weights cardio
  heaviest (0.5), strength weights load-ramp + subjective heaviest
  (0.5 / 0.4, cardio 0.1), concurrent balanced, rebuild/maintenance low.

### What "accept" does

Mirrors ADR 0031 in reverse: copies the block's already-materialised
**deload-week** prescription onto the **current** week's un-started sessions
(matched by `day_index, slot`), marked `earlyDeload: true`. No generator re-run,
no migration. The scheduled deload remains — if the user recovers by then, the
Phase 2 offer lets them skip it, so the two features **compose** to "move the
deload earlier" without ever removing a safety deload.

## Implementation

- `apps/web/src/lib/planner/fatigue-proxy.ts` — pure: `computeFatigueProxy`,
  `shouldRecommendEarlyDeload`, `fatigueArchetypeKey`, term normalisers,
  `EARLY_DELOAD_THRESHOLD`, per-archetype weights (unit-tested).
- `early-deload-offer.ts` — server read: gathers acute/chronic tonnage +
  subjective from `getWeeklyRecoveryRollup`, the cardio scalar from
  `cardioBlocksFromLogs` + `computeConcurrentScalarFromBlocks` over the trailing
  14 days, then the proxy + gate.
- `early-deload-actions.ts` — `acceptEarlyDeload`.
- `apps/web/src/components/plan/EarlyDeloadCard.tsx` — Plan-page advisory card.
- `packages/db/src/schema/planner.ts` — `Prescription.earlyDeload?: boolean`.

## Consequences

- Catches combined-load fatigue (esp. cardio) the reactive strength deload
  misses — the genuinely novel value for a hybrid app.
- Byte-identical for users who don't accept; started/skipped sessions immutable.

## Calibration (CP-2, row 53)

All weights + `EARLY_DELOAD_THRESHOLD = 0.7` + `MIN_WEEKS_FOR_PROXY = 3` are
`[DEF→cal]` Stage-A heuristics. Confidence: **MEDIUM** that combined accumulated
load (volume-dominated, endurance-additive) should drive deload need (Wilson
2012 interference dose-response; Bell/Rogerson autoregulated triggers);
**LOW** on the exact weights + threshold. Shipped **advisory-only** precisely
because the magnitudes are uncalibrated. Validation: recommendation acceptance
rate; reactive-deload trigger rate in the weeks AFTER ignoring vs accepting the
recommendation (the ground-truth for whether the proxy predicts real fatigue);
re-fit the weights/threshold once Stage B has outcome data.
