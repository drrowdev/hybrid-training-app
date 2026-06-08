# ADR 0038 — Cardio mesocycle progression

Status: Accepted (2026-06-08)
Supersedes: none
Related: ADR 0030 (deload cadence / two waves), ADR 0037 (coherent multi-modal
deload — owns the deload week), ADR 0007 (AMRAP — the strength progress signal).
CP-2 constraints row for the new constants. Grounds in `hybrid-training-research-v2.md`
§4 (engine-biased mesocycle spec) + the polarized-distribution literature in
`hybrid-training-research-new.md`.

## Context

A deep-research review of a regenerated endurance block graded it B and named
its #1 gap: **the cardio prescription is static across all loading weeks** — the
same easy run / bike Z2 / VO₂ 4×4 / 100-min long run for six weeks. For a
cardio-PRIMARY block that is maintenance, not a build.

This is the cardio analog of the strength-progression question we deliberately
REJECTED in ADR 0037 — but the answer is the opposite, and the engine's own spec
already says so. `hybrid-training-research-v2.md` §4 (engine-biased block):

> "Aerobic: add easy volume first (frequency or duration, **~5–10% per week**),
> then add quality to hard sessions. Threshold/VO₂max: **progress interval count
> or density — not both simultaneously**. **Strength: hold.** Hypertrophy: hold."

So the strength "hold" (TB / 5-3-1 static wave, ADR 0037 grounding) is correct
and stays. The **aerobic half was simply never implemented** — `weekProfiles`
carry only strength knobs (`setIntensities`, `strengthVolumeScale`) + a
deload-only `z2DurationMinOverride`. This ADR implements the missing aerobic
progression.

## Decision

Two pure additions, applied at materialization time (`actions.ts`) by building an
effective cardio day — the same mechanism ADR 0037 uses for the deload — so
nothing in the shared `buildPrescription` path or the golden harness changes.

### 1. Focus-scaled easy-volume creep (Z2 days)

A weekly duration creep on easy/Z2 sessions, accruing within each loading wave
and **resetting at the wave boundary**, scaled to how cardio-dominant the block
is (the user's point: a pure-cardio athlete should build faster than someone
also chasing strength). The emphasis is derived from `archetype + secondaryFocus`
by `cardioProgressionTier`:

| Tier | Signal | Creep/step | Cap/wave | Days creeped |
| --- | --- | --- | --- | --- |
| **pure** | `endurance_anchor` + secondary none/cardio | +10% | +20% | ALL Z2 (long + short easy) |
| **mixed** | `endurance_anchor` + secondary strength/muscle | +5% | +15% | long Z2 only |
| **balanced** | `concurrent_hybrid` | +5% | +10% | long Z2 only |
| **none** | strength-led / custom | — | — | — (cardio is maintenance) |

`mult = 1 + min(creepPerWeek × positionInWave, cap)`, applied to the day's
`durationMin`. `positionInWave = 0` (the wave's base week) is always a no-op.

### 2. Peak-week VO₂ interval-density bump

On the **peak week of each wave** (the last build week), a `cardio_vo2` day that
declares a `peakWeek` override swaps in a denser protocol — **count, not
intensity** (VO₂ `4×4 → 5×4`, 35 → 42 min). Progresses one variable per session,
never volume + intensity together. Config-gated: only fires where the archetype
opts in (currently `endurance_anchor`'s VO₂ days), so it never surprises another
archetype.

### Wave detection

The deload cadence (ADR 0030 `expandToTwoWaves`) **concatenates** the build waves
with a single deload at the end — there is no mid-block deload to split on. So
`cardioWaveContext` segments waves by the **repeating intensity-label pattern**:
a new wave starts where the first build week's label recurs (e.g. "Maintenance
base" at W0 and W3). `positionInWave` and `isPeakWeek` derive from that. This
scales to any wave count / cadence without hardcoding week indices.

### Data-driven & no-op safe

Keys off `archetype.id` + `secondaryFocus` + `cardioKind` + `role` + the week's
wave position. Returns `null` (no change) on the deload week, on tier "none", on
the base week of a wave, and on any day the tier doesn't creep — so every
existing block stays byte-identical except the cardio-emphasis archetypes, which
gain the progression. Scales with days/week, frequency, focus, and tier.

## Consequences

- **NOT byte-identical for `endurance_anchor` build weeks** (intended): long Z2
  (and, for pure cardio, all easy Z2) lengthen across the wave; VO₂ peak weeks go
  4×4 → 5×4. Verified end-to-end: mixed = 100 → 105 → 110 long-Z2 + VO₂ bump;
  pure = +20%-cap on all easy days.
- **Deload untouched** — ADR 0037 + `z2DurationMinOverride` own the deload week;
  progression returns `null` there.
- **Strength untouched** — the static wave + between-block TM progression stand
  (TB / 5-3-1). This ADR is cardio-only.
- **No migration / no schema change** — reuses `durationMin` / `protocolNote`
  and a new optional `CardioDay.peakWeek` config field.
- **Goldens unaffected** — the conversion lives in the `actions.ts`
  materialization, not in `buildPrescription`; the pure unit suite
  (`adr-0038-cardio-progression.test.ts`) covers it.

## Science / rationale

Aerobic mesocycle progression (add easy volume ~5–10%/week, then quality; for
intervals progress count/density not both) is standard endurance-periodization
practice and is the engine's own documented spec (`hybrid-training-research-v2.md`
§4; polarized distribution in `…-research-new.md`). The per-tier magnitudes/caps
and the focus-scaling are **CP-1 heuristics** — directionally grounded, un-tuned
against real per-user outcome data. Confidence: **HIGH** for "a cardio-primary
block must progress its aerobic work"; **LOW / CP-1** for the exact %/cap per tier.

## Files
- `apps/web/src/lib/planner/archetypes.ts` — `CardioDay.peakWeek`,
  `cardioProgressionTier`, `CARDIO_CREEP_PARAMS`, `cardioWaveContext`,
  `cardioProgressionPlan`; `peakWeek` config on `endurance_anchor` VO₂ days.
- `apps/web/src/lib/planner/actions.ts` — apply in both materialization loops,
  composed with the ADR 0037 deload plan (deload week vs build week).
- Tests: `adr-0038-cardio-progression.test.ts`.
- `docs/knowledge/hybrid-training-design-constraints.md` (+ workspace mirror) —
  CP-2 row for the new constants.
