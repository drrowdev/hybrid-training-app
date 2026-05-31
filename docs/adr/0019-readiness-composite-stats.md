# ADR 0019 — Readiness composite stats card (read surface, not a prescription input)

**Status:** Accepted
**Date:** 2026-05-31
**Phase:** Production (stats surface)
**Relates to:** CP-1 (heuristic-pending-data tag), CP-2 (heuristic numeric constants table, `docs/knowledge/hybrid-training-design-constraints.md`), ADR 0018 (two-factor ceiling chain — confirms there is no daily readiness input to draw from), constants table rows #19 (`recovered-weeks`), #22 (EWMA windows), #30 (`REGION_SPIKE_THRESHOLD`)
**Touches:** `apps/web/src/lib/stats/load-balance.ts` (new), `apps/web/src/lib/stats/output-trend.ts` (new), `apps/web/src/lib/stats/readiness.ts` (new), `apps/web/src/components/stats/ReadinessCard.tsx` (new), `apps/web/src/app/app/stats/page.tsx` (wired). No DB migration. No CP-4 chain change. Adds **one** CP-2 row for the ACWR band edges (display thresholds, tagged HEURISTIC / CP-1) — no new prescription-input numeric constant.

## Context

After ADR 0018 retired the daily wellness check-in, the only at-a-glance
"are you absorbing the work?" surface left was the per-region freshness mini
on the dashboard. That number is useful but narrow: it answers "is _this
region_ recovered enough for the next session?", not "is the whole athlete
holding up under the block's load?".

Three existing signals already cover the body-wide picture, but they live
in separate cards and don't corroborate each other:

- **Acute vs chronic training load (ACWR)** — `region_state` already carries
  per-region 7-day ATL + 28-day CTL (EWMA, per ADR 0009 / CP-2 row #22). Sum
  across regions and you get a body-wide ACWR.
- **sRPE drift** — `lib/stats/rpe-drift-queries.ts` already computes whether
  the same work is feeling harder over time (`stable / rising / easing /
  no-data`).
- **Objective output** — `lib/stats/prs-range.ts` already counts unique
  movements with a fresh top-set or top-three PR in any window.

None of these is conclusive on its own. ACWR alone is noisy at low N and the
band edges are population averages. sRPE drift is honest-but-subjective.
PR cadence is a delayed, sparse signal. **Corroboration across all three is
much stronger than any one** — and is exactly the kind of single-card
synthesis the user has to do manually today.

This ADR adds a **read-only Readiness composite card** to `/app/stats` that
combines the three signals into one verdict + confidence chip, with a
banded gauge and an explicit "does the evidence agree?" stack so the user
sees the underlying corroboration (or lack thereof). It does **not** add a
new input, a new write path, a prescription multiplier, or a CP-4 ceiling-
chain factor.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Surface type | **Read-only stats card** at `/app/stats`. No write, no input UI, no settings. | Honors ADR 0018's framing: re-introduce a readiness signal _only_ behind a less intrusive input than a daily check-in. ACWR + sRPE drift + PR cadence are all already collected as a side effect of normal logging — zero new friction. |
| 2 | Engine wiring | **Does NOT feed `buildPrescription` or `getCeilingExplain`.** Verdict is a display string and a number; nothing reads it back into prescription. | Pure stats overlay. The 4-quality + 5-archetype + 7-region engine stays the only thing that decides ceilings and sessions. Re-introducing a daily readiness multiplier is explicitly out of scope (ADR 0018 / CP-4 stays two-factor). |
| 3 | ACWR primitive | Sum `region_state.atl` and `region_state.ctl` across all rows for the user; `ratio = acute / chronic`. Aggregator is pure (`aggregateLoadBalance`), I/O is a thin wrapper. | Mirrors `lib/engine/recovered-weeks.ts` pure-aggregator pattern. ATL/CTL come back as strings from PostgREST; the aggregator coerces. |
| 4 | Band thresholds | `LOAD_BAND_THRESHOLDS = { detrainingMax: 0.8, productiveMax: 1.3, pushingMax: 1.5 }` → `detraining / productive / pushing / spiking`. Tagged HEURISTIC / CP-1. | Williams 2017 / Lolli 2019 / Gabbett 2016 lineage: the 0.8 / 1.3 / 1.5 edges are the most widely cited EWMA-ACWR "sweet spot" boundaries but are derived from team-sport populations on TRIMP-like loads and **do not** transfer cleanly to a hybrid strength + cardio athlete. The card surfaces this as a caveat; the magnitudes go into CP-2 (single row) tagged for calibration. |
| 5 | Building-data gate | If `weeksOfData < 4`, verdict short-circuits to `building` / confidence `building` regardless of ratio. | An EWMA-ACWR built from < 4 weeks of distinct ISO weeks is dominated by the 28-day chronic ramp; the band classification would mislead. 4 weeks ≈ one full chronic-EWMA window. Threshold lives next to the composite logic as `READINESS_BUILDING_WEEK_THRESHOLD = 4` for explicit calibration. |
| 6 | sRPE drift signal | Reuses `getRpeDriftBundle` (4-week recent vs 4-week prior, weighted slope). Already shipped; no new query. | One read seam, already user-scoped. |
| 7 | Output-trend signal | Heuristic PR cadence: `getPrsForRange(28)` vs `getPrsForRange(56) − getPrsForRange(28)`. Pure classifier `classifyOutputTrend` returns `rising / flat / falling / no-data`. Tagged HEURISTIC / CP-1, no calibration. | Cheapest signal that reads as "objective output is keeping up with effort". A full e1RM slope per movement would need a new ledger walk; PR cadence is a defensible v1 proxy. Documented in module JSDoc as a heuristic; the "broader minus recent" arithmetic biases slightly toward "rising" (conservative for the confidence framing). |
| 8 | Composite verdict | Matrix on `(band, rpeDrift, outputTrend)` → `building / detraining / productive / pushing-tolerated / watch / overreaching`. Implemented in `composeReadiness` as a pure function on the three signal records. | Same pure-aggregator split as ADR 0017's classifier: keeps the logic Vitest-pinnable without Supabase. Specific rules: `detraining` band always wins; `pushing/spiking + sRPE rising + output falling = overreaching` (the only red verdict); `pushing/spiking + sRPE stable/easing + output rising/flat = pushing-tolerated` (productive overload); `productive + sRPE rising + output falling = watch`; default = `productive`. |
| 9 | Confidence chip | `signalsAgree = count of signals pointing the same way as the band`. `confidence = signalsAgree >= 3 ? "agree" : "mixed"`. `building` is its own confidence value. | The user sees the corroboration count explicitly; "mixed" carries less weight in the copy than "agree". Honest framing beats false certainty when N is small. |
| 10 | Empty / cold start | Shows the existing `EmptyState` card with body "Log a few sessions" — same convention as `FreshnessCard`. | One copy pattern across stats cards. |
| 11 | Drill-down | Expandable panel with scalar Fitness / Fatigue / Form (chronic / acute / chronic − acute) + four signal cards + formula + citations. **Not** a 90-day daily PMC chart in v1. | Scalar PMC is enough for the corroboration story; a full daily SVG chart needs a new ledger walk and is deferred. Citations are inline so the reader can audit the heuristic on the spot. |
| 12 | CP-2 table | Adds **one** CP-2 row for `LOAD_BAND_THRESHOLDS` (the three ACWR band edges). These are display thresholds, not prescription inputs. | The bands are real numeric constants in code (`load-balance.ts`) tagged HEURISTIC / CP-1, so they belong in the CP-2 honesty table per project convention. They drive a band label on a read surface, not an engine input — flagged as such in the row. |
| 13 | Card placement | Render in `/app/stats` directly after `CurrentBlockStrip` and before `TrainingHeatmap`. | High in the page because it frames everything below (heatmap consistency, adherence, PR cadence, volume) with a single "are you absorbing this?" headline. |

## Rationale — the science and its limits

**EWMA-ACWR for load balance.** The acute-to-chronic workload ratio (ACWR)
literature is dominated by Gabbett 2016 (*BJSM* 50:273) and the Hulin
2014–16 cricket / rugby cohorts: weeks where acute load is more than ~1.5× a
4-week rolling chronic average carry a markedly elevated soft-tissue injury
risk in the **following** week. Williams 2017 (*BJSM* 51:209) showed that
exponentially-weighted moving averages (EWMA) recover the same relationship
with less coupled-pair noise than rolling averages, which is why the engine
already stores 7d-EWMA ATL + 28d-EWMA CTL per region (CP-2 row #22). The
0.8 / 1.3 / 1.5 band edges are the widely-cited "sweet spot" boundaries —
but Lolli 2019 (*BJSM* 53:1471, mathematical coupling critique) and
Impellizzeri 2020 (*IJSPP* 15:142, target-and-context critique) are clear
that they are population averages from team-sport TRIMP-like loads and
**do not generalise cleanly** to a hybrid strength + cardio athlete. The
card therefore (a) shows the bands so the user can audit them, (b) labels
the verdict "Bands tuned to your history" as a deferred v2 (per-user band
calibration), and (c) marks the constants HEURISTIC / CP-1 in code.

**sRPE drift as the "is it actually feeling harder?" channel.** Foster's
session-RPE methodology (Foster 2001, *J Strength Cond Res*; Foster 2017
monotony/strain framing) is the most-validated subjective load metric in
strength + endurance training. The `rpe-drift-queries` module already
implements a weighted-slope analysis of recent-vs-prior sRPE for the same
work; the composite uses its `rising / stable / easing / no-data` verdict
directly.

**PR cadence as the objective-output proxy.** The Banister / TrainingPeaks
PMC literature uses fitness (CTL) and fatigue (ATL) to predict performance,
but a true performance-test cadence isn't available without a dedicated
testing schedule. PR rate on existing main + accessory lifts is the closest
zero-friction proxy: if the same movements are setting fresh top-3 sets in
the recent 28-day window vs the prior 28, the athlete is still expressing
output. Pareja-Blanco 2017 / 2020 (velocity-loss and proximity-to-failure
work) supports the framing that adaptation is happening when measurable
expression is still present.

**Corroboration trumps any single signal.** Each of ACWR, sRPE drift, and
PR cadence has a defensible critique:

- ACWR is famously noisy at low N and the 1.5 edge is a smoothed proxy for
  a continuous risk gradient.
- sRPE is honest but subjective and prone to mood / sleep noise on any
  single rating.
- PR cadence is sparse (you won't PR every week) and biased toward novelty
  movements early in a block.

But **three independent signals pointing the same way** — high ACWR _and_
rising sRPE _and_ falling output — is exactly the overreaching pattern the
classical Banister / Meeusen 2013 (overtraining-syndrome consensus
statement, *MSSE* 45:186) literature describes. Three signals pointing in
**different** directions is the "mixed" case where the right answer is
"don't act on this read; it's not a clean signal yet". That is exactly
what the confidence chip surfaces.

## What this is NOT

- **NOT a daily readiness check-in.** ADR 0018 deliberately retired that.
  No new input UI; signals are byproducts of logging.
- **NOT an autonomic-recovery proxy.** No HRV, no sleep, no resting HR
  here. This measures load **absorption** (am I keeping up with the
  training stress I've imposed?), not autonomic readiness for a hard
  session today. The card states this caveat verbatim.
- **NOT a prescription input.** `getCeilingExplain` and `buildPrescription`
  do not read `getReadiness`. CP-4 stays at two factors. There is no
  silent autoregulation behind the chip.
- **NOT a population-calibrated verdict.** The 0.8 / 1.3 / 1.5 bands are
  team-sport averages. Confidence chip + caveat say so.
- **NOT a per-region card.** Per-region freshness already lives in
  `FreshnessCard`. This is the body-wide read.

## Deferred to v2 (when there's real per-user data)

- **Per-user band calibration.** Replace the 0.8 / 1.3 / 1.5 magic with
  per-user percentiles fit to that user's own ACWR distribution; alert
  on deviations from their own norm rather than the population edge.
- **Monotony + strain.** Foster's monotony (mean / SD) and strain
  (load × monotony) are natural next signals; would slot in as a 4th
  corroborator with no new write path.
- **e1RM slope per movement.** A true output trend would walk the set
  ledger and fit a Bayesian slope per main lift; replaces the PR-cadence
  proxy when ledger-walk cost is acceptable.
- **Daily PMC chart drilldown.** 90-day daily Fitness/Fatigue/Form chart
  (vs the current scalar view).
- **Backtest.** Once there's ≥ 6 months of multi-user history, validate
  that the `overreaching` verdict actually precedes user-reported
  symptoms / forced deloads at a meaningfully higher rate than chance.

## Test coverage

30 new pure unit tests (`load-balance.test.ts` 10, `output-trend.test.ts`
8, `readiness.test.ts` 12) pin the band boundaries, the cold-start gate,
the verdict matrix on every (band × drift × output) cell that matters,
and the gauge-marker math. The card itself is rendered by the Server
Component page; the existing stats-page render tests cover the wiring
path. New test count: 2835 (was 2805).

## References

- **Gabbett TJ 2016** — *The training–injury prevention paradox*, _BJSM_
  50(5):273–280, PMID 26758673. **HIGH.** ACWR sweet spot 0.8–1.3, danger
  zone > 1.5.
- **Hulin BT 2014, 2016** — *J Sci Med Sport* 17:466 (cricket fast
  bowlers); *BJSM* 50:231 (rugby). **HIGH.** ACWR > 1.5 → ~2–4× injury
  risk in the following week.
- **Williams S 2017** — *How much rugby is too much?*, _BJSM_ 51(3):209.
  **HIGH.** EWMA outperforms rolling averages for ACWR; basis for the
  engine's 7d/28d EWMA windows.
- **Lolli L 2019** — *Mathematical coupling causes spurious correlation
  in the ACWR*, _BJSM_ 53(23):1471. **HIGH critique.** Why the bands
  must not be over-interpreted.
- **Impellizzeri FM 2020** — *Acute:chronic workload ratio: conceptual
  issues and fundamental pitfalls*, _IJSPP_ 15(6):907. **HIGH critique.**
  Same: target-and-context dependent; treat as one signal among several.
- **Foster C 2001** — *A new approach to monitoring exercise training*,
  _J Strength Cond Res_ 15(1):109–115, PMID 11708692. **HIGH.** Session-
  RPE methodology, monotony, strain.
- **Banister EW** / **TrainingPeaks PMC** — fitness/fatigue/form chart
  framework (CTL = fitness, ATL = fatigue, CTL − ATL = form). Practitioner
  standard since the late 1990s. **HIGH** for the framework; magnitudes
  are user-specific.
- **Meeusen R 2013** — *Prevention, diagnosis, and treatment of the
  overtraining syndrome*, _MSSE_ 45(1):186, PMID 23247672. **HIGH
  consensus.** Overreaching presents as multi-domain decline — exactly
  the three-signal corroboration this card looks for.
- **Pareja-Blanco F 2017, 2020** — velocity-loss / proximity-to-failure
  RCTs, _Scand J Med Sci Sports_ + _J Strength Cond Res_. **HIGH.**
  Output expression as adaptation proxy.
- **ADR 0018** (this repo) — confirms the deliberate absence of a daily
  readiness input; this ADR honors that constraint.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
