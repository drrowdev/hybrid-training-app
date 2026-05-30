# ADR 0009 — Cardio intensity: real time-in-zone source + display/engine unification

**Status:** Proposed
**Date:** 2026-05-30
**Phase:** Production (engine methodology review)
**Relates to:** `apps/web/src/lib/engine/cardio-intensity.ts`, `apps/web/src/lib/integrations/strava/zones-from-summary.ts`, `apps/web/src/lib/stats/hr-zones.ts`
**Corrects:** the methodology review's finding-6 (see "Correction of the record" below)

## Correction of the record

The methodology review graded finding-6 as *"avg-HR buckets a session into ONE zone;
time-in-zone is not used in the load engine."* **That is wrong for the engine and I'm
correcting it.** Reading the live code:

- `engine/cardio-intensity.ts` (post-PR #162/#167) computes a **time-in-zone weighted**
  intensity scalar — `Σ(zoneSec × weight)/totalZoneSec` with z1..z5 = 0.5/0.8/1.2/1.8/2.2 —
  and `bucket-load.ts:159`, `region-ledger.ts`, and `muscle-freshness` all consume it. The
  engine already does the thing finding-6 said it didn't.

So the engine's intensity accounting is *better* than the review credited. What remains are two
**narrower, real** gaps, which this ADR addresses:

1. **The time-in-zone data is an approximation, not measured.** The per-zone seconds come from
   `estimateZonesFromSummary` — a leak model that distributes a session's *average* and *max*
   HR across adjacent zones (avg sits in its band → leak ≤25% to the neighbour; max one/two
   zones up → attribute 15–20%). It never sees the real per-second HR stream. A 60-min "Z2 with
   6×30s Z5 strides" and a steady 60-min Z2 ride can produce near-identical estimated
   distributions, because the summary avg/max are similar — exactly the intensity signal we
   care about for interference dosing is the one the approximation smears.

2. **The display card and the engine disagree.** The stats card (`stats/hr-zones.ts`
   `bucketByZone`) still buckets the *entire* activity into the single zone its **average** HR
   falls in — the crude method finding-6 described. So the engine doses cardio off the
   leak-approximated distribution while the UI shows the user a different, cruder single-zone
   distribution. Same session, two different zone stories.

## Context

Cardio intensity matters in three downstream places: the concurrent-interference scalar
(strength suppression), muscle-freshness/recovery, and the bucket-load ledger. Getting the
*intensity* (not just duration) right is what lets the engine tell a recovery jog apart from a
VO2 session. The engine's weighting machinery is sound; its **input fidelity** and its
**consistency with what the user sees** are the weak links.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Real stream-based TIZ | When a Strava activity has HR streams available, fetch the per-second HR stream and compute true time-in-zone (seconds actually spent in each band), persisting it to `cardio_logs.hr_zones`. The summary leak-model becomes the **fallback** for stream-less / manual activities, not the primary. | Real TIZ is the physiologically correct input; the approximation exists only because streams are rate-limited. This is the audit's parked I3 item, now prioritised. |
| 2 | Unify the display card | The stats HR-zones card reads the same `cardio_logs.hr_zones` distribution the engine uses (sum the per-zone seconds across the window), instead of single-avg-HR bucketing via `bucketByZone`. Keep avg-HR bucketing only as the last-resort fallback when a row has no `hr_zones`. | The number the user sees should be the number the engine acts on. Two methods for one quantity is a latent trust/consistency bug. |
| 3 | Keep the weights, label the confidence | Retain `ZONE_INTENSITY_WEIGHTS` (0.5/0.8/1.2/1.8/2.2) and `CARDIO_INTENSITY_MIN/MAX`, but tag them `// heuristic — zone intensity weights (CP-1), pending TRIMP/Seiler calibration`. | The *shape* (monotonic, steeper at the top) is defensible and matches zone-weighted load tradition (Edwards/Lucia TRIMP), but the exact values are uncited heuristics and must say so per CP-1/CP-5. |
| 4 | Rate-limit posture | Stream fetch is opportunistic and cached: fetch on import/webhook when budget allows; never block a sync on it; backfill lazily. Stream-less rows keep the approximation indefinitely. | Strava stream calls are rate-limited; the engine must degrade gracefully, never hard-depend on streams. |

## Rationale

The engine already weights intensity by time-in-zone — the correct design. The two things that
undermine it are both about *truth of input*, not *shape of formula*:

- **Approximated TIZ** systematically smears intervals. Interval and fartlek sessions — the
  ones with the highest interference cost and the most adaptive signal — are precisely where a
  summary avg/max leak model is least accurate. Pulling the real stream is the single highest-
  fidelity improvement available, and the persistence target (`cardio_logs.hr_zones`) already
  exists, so no schema change is needed.
- **Display/engine divergence** is a credibility problem: a user who sees "you spent 55 min in
  Z2" on the card, while the engine internally modelled a chunk of Z4/Z5 from the max-HR leak,
  has no way to reconcile the two. Unifying on one source is low-effort and removes a class of
  "why does the app think that workout was so hard?" confusion.

I'm deliberately **not** proposing to change the zone weights themselves. They're heuristic but
their ordering and curvature are consistent with zone-weighted training-load tradition, and
re-tuning them without TRIMP-calibrated data would just swap one heuristic for another. Decision
3 makes the heuristic honest in code rather than pretending to precision.

## Evidence base

- **Seiler 2010** (polarised intensity distribution) — **MODERATE/HIGH**: accurate
  time-in-zone is the substrate the polarised-model accounting depends on; a single-zone
  average corrupts the 80/20 split the app surfaces.
- **Edwards 1993 / Lucia TRIMP** (zone-weighted training load) — **MODERATE**: weighting time
  by zone with a steeper top end is the established way to convert HR distribution into load;
  supports the *shape* of `ZONE_INTENSITY_WEIGHTS` while leaving the exact values heuristic.
- Strava stream fidelity vs summary approximation — **practical/engineering**, not a science
  claim: streams measure, summaries estimate.

## Implementation contract (on acceptance)

- **Stream fetch (Decision 1):** add a Strava streams call in the import/webhook path (or a lazy
  backfill job) that, when streams exist, computes per-second TIZ against the user's
  `ZoneBands` and writes `cardio_logs.hr_zones`. `estimateZonesFromSummary` stays as the
  documented fallback; `cardioIntensityScalar` is **unchanged** — it already consumes whatever
  `hr_zones` contains.
- **Display unification (Decision 2):** `getHrZones` sums per-row `hr_zones` distributions over
  the window instead of `bucketByZone(avgHr)`; `bucketByZone` retained only for rows lacking
  `hr_zones`. Card footnote updated ("measured from HR zones" vs "approximated from session
  average").
- **No engine load change.** `ZONE_INTENSITY_WEIGHTS`, the `×8`/`CARDIO_LOAD_SCALAR`, and the
  `[0.3, 2.5]` clamp are untouched. The interference scalar and freshness pipelines get *truer
  inputs*, not new math.
- **Regression guard.** Rows with existing `hr_zones` produce identical engine load before/after
  (only the *source* of future `hr_zones` changes). A pinned test asserts `cardioIntensityScalar`
  is byte-identical for a fixed `hr_zones` input, and that stream-less rows still fall back to
  the approximation then to `rpe/10`.

## Out of scope

- Re-tuning the zone intensity weights to TRIMP/Seiler-calibrated values (separate, data-gated
  ADR — needs real per-user stream data first).
- Power-based (cycling/running power) intensity — HR-only for now.
- Changing the concurrent-interference scalar curve (ADR-era concurrent-scalar stays as is).

## Implications

- Interval/VO2 sessions get correctly costed instead of smeared toward their average — directly
  improves interference dosing and freshness accuracy where it matters most.
- The user sees the same intensity story the engine acts on.
- Closes the parked audit item I3 (real streams) for the cases where streams are available.
- On acceptance: tag the heuristic weights in code, update `hybrid-training-engine-live.md` §16
  (cardio intensity) to state "TIZ from real streams when available, summary approximation
  otherwise; display card unified on the same source," and the canonical workspace mirror. No
  CP-2 numeric change (weights unchanged) — only a confidence-tag addition.
