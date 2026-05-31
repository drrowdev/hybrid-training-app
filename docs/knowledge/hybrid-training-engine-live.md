# Hybrid Training App — What the live training engine actually does

*(As of commit `7c10a7b814b56ffbf8985efe88c3a8c936b9ba30`, branch `main`. Repo root: `C:\code\hybrid-training-app`. Every magic number is cited `file:line` so you can re-grep.)*

This is a read-only audit. The goal is to describe — without flattery — what the engine on `main` does **today**, separated from what the v2 spec (`hybrid-training-research-v2.md`) wishes it did. Where the two diverge, the live behaviour wins for the description and the gap is called out.

---

## 1. Actual session load — how a completed session turns into ESL

`apps/web/src/lib/engine/actual-session-load.ts` is the source of truth. `computeActualSessionLoad()` is called server-side from `completeSession`, and also from `editSet` / `deleteSet` / `editCardio` / `deleteCardio` (only when the session is already completed) via the wrapper `recompute-actual-session-load.ts`.

* **Strength**: counts non-warmup `set_log` rows for the session, derives a *session modality* (pure_strength / pure_hypertrophy / pure_z2_aerobic / pure_hiit / mixed_modal), then
  `strengthEsl = hardSets × MODALITY_STRESS_MULTIPLIER[modality]` (`actual-session-load.ts:238`).
* **Modality multipliers**, defined in `apps/web/src/lib/planner/session-modality.ts:94-100`:
  pure_strength `1.0`, pure_hypertrophy `1.0`, pure_z2_aerobic `0.4`, pure_hiit `1.3`, mixed_modal `1.25`. So a hypertrophy set is treated the same as a strength set — there is no per-set tonnage or RPE consideration in the headline ESL number.
* **Cardio**: three-tier preference (`actual-session-load.ts:242-273`):
  1. Use the precomputed `effective_stress_load` on the `cardio_log` if non-null.
  2. Else, `cardioEslFromKind(kind, durationMin)` using the kind from `cardio_logs.kind` (this is the classifier output — Z2 / threshold / VO2 / alactic / mixed / other).
  3. Else, fall back to `durationMin × internalCardioModalityMultiplier(mode)`.
* **Total** = strengthEsl + cardioEsl, written back to `planned_sessions.effective_stress_load`.
* **Back-compat guard**: if a completed session has **0 hard sets AND 0 cardio**, the recompute leaves the prescribed ESL alone (`recompute-actual-session-load.ts:114`). That preserves legacy rows that were stamped at plan time but never logged.

This was shipped by **PR #165** (`feat(engine): recompute effective_stress_load from logged sets and cardio`). Before that, ESL was stamped once at prescription time and never moved.

## 2. Bucket math — how a set becomes ATL/CTL per bucket

`apps/web/src/lib/engine/bucket-load.ts` converts one logged set or cardio piece into per-bucket "load points". The five buckets are **neural, metabolic, impact, axial, tissue** (declared in the same file).

* **RPE multiplier** — applied to every strength set (`bucket-load.ts:49-55`):
  RPE null → `0.5`; ≥10 → `1.0`; ≥9 → `0.85`; ≥8 → `0.7`; ≥7 → `0.55`; ≥6 → `0.4`; else `0.3`.
* **Axial weight** by movement (`bucket-load.ts:85-89`): low `0.0`, moderate `0.5`, high `1.0`. Read from a `SetMovementMeta` argument the callers fill from the `movements` table — bucket-load itself does **not** read the seed `metadata` JSONB; it only sees `axial_load` and `high_strain_tendon` columns piped in by callers.
* **Per-bucket coefficients** (per set, applied on top of `sets×reps×weight×rpeMul × rpeMul…`):
  * **Neural** (`bucket-load.ts:119`): intensity ≥0.85 → `1.0`; ≥0.7 → `0.5`; else `0.15`.
  * **Metabolic** (`121`): reps ≥12 → `0.85`; ≥8 → `0.55`; else `0.2`.
  * **Impact** (`123`): high-strain tendon → `0.5`; else `0.05`.
  * **Tissue** (`125`): tendon → `0.8`; intensity ≥0.85 → `0.4`; else `0.15`.
* **Intensity** comes from `intensityFromRpeAndReps` (`bucket-load.ts:66-83`), a hand-rolled lookup table approximating Helms/Zourdos with ~2 % per extra rep slope. Used both here and for fallback e1RM elsewhere.
* **Cardio** (`bucket-load.ts:151-184`):
  * Magnitude is normalised against strength by `CARDIO_SCALAR = 8` (line 151), an undocumented unit-matching multiplier.
  * Modality multipliers per cardio kind: impact = running `0.8`, walk `0.3`, else `0.05`; tissue = running `0.4`, else `0.05`.

EWMA windows for the five buckets are **ATL = 7 d, CTL = 28 d**, evaluated via `finalEwma` from `@hta/domain` (`apps/web/src/lib/stats/bucket-state-queries.ts:177-178`), over a `LOOKBACK_DAYS = 35` window. Bucket bands (`bucket-state-queries.ts:67-77`):
fresh ≥0.85, ready ≥0.55, lingering ≥0.3, recovering ≥0.1, else heavily-loaded.
Freshness per bucket is `1 - atl / max(ctl, 1)` (`bucket-state-queries.ts:179-180`).

## 3. Region ledger — joint/region load, baseline, freshness

`apps/web/src/lib/engine/region-ledger.ts` is the per-joint analogue of buckets.

* **Seven regions** (`region-ledger.ts:24-32`): `foot_ankle_calf`, `knee`, `hamstring_posterior`, `adductor_groin`, `lumbar_trunk`, `shoulder_scapular`, `elbow_forearm`.
* **Primary/secondary fan-out** (`apps/web/src/lib/engine/set-load.ts:55-56`): `PRIMARY_REGION_WEIGHT = 1.0`, `SECONDARY_REGION_WEIGHT = 0.5`. Each movement contributes full credit to its primary regions and half credit to its secondary regions.
* **Per-set strength load** (`set-load.ts:48`): `sets × reps × weight × rpeMul`. The same RPE ladder as buckets is reused.
* **Cardio per-region load** (`region-ledger.ts:161`): `durationMin × cardioIntensityScalar × 8` — the same `8` constant as in bucket-load, inlined here (not imported), so the magic number lives in two places.
* **EWMAs**: ATL = 7 d, CTL = 28 d. `baseline_tolerance` defaults to CTL when no explicit value is set (`region-ledger.ts:177`).
* **Freshness per region** is `computeRegionFreshness(atl, baseline)` from `@hta/domain` (`region-freshness-queries.ts:44`); bands are the same fresh/ready/lingering/recovering/heavily-loaded ladder as buckets (`region-freshness-queries.ts:46-53`).

## 4. Freshness — bucket vs region, what's actually rendered

`apps/web/src/lib/stats/freshness-mini.ts` is the small per-tile widget; `bucket-state-queries.ts` and `region-freshness-queries.ts` are the larger fan-outs.

The "freshness" rendered on the UI today is the *bucket* freshness (5 buckets), not the joint/region ledger. Region ledger is wired and queryable (see `region-state-snapshot.ts`), but the prominent Today/Plan tiles show the 5-bucket bands. There is **no** unified "global freshness" score; the worst bucket is the headline.

## 5. Cardio intensity — how HR turns into a number

`apps/web/src/lib/engine/cardio-intensity.ts`:

* Bounded by `CARDIO_INTENSITY_MIN = 0.3`, `CARDIO_INTENSITY_MAX = 2.5` (`cardio-intensity.ts:44-45`).
* **Zone weights** (`cardio-intensity.ts:47-57`): Z1 `0.5`, Z2 `0.8`, Z3 `1.2`, Z4 `1.8`, Z5 `2.2`. Now tagged `// heuristic — zone intensity weights (CP-1), pending TRIMP/Seiler calibration` per ADR 0009 D3 (shape follows Edwards 1993 / Lucia TRIMP; exact magnitudes uncited).
* **Math** (`cardio-intensity.ts:cardioIntensityScalar`): when `hr_zones` is present, the scalar is the time-in-zone weighted average `Σ(zoneSec × weight) / totalZoneSec`, clamped into `[0.3, 2.5]`. A fully-Z2 session returns `0.8`; a fully-Z5 session returns `2.2`.
* **Fallback** (no `hr_zones`): `clamp(rpe / 10, 0.3, 1.0)`; if RPE is null, returns `0.5`.

Shipped by **PR #167** (`feat(engine): HR-aware cardio bucket + region load when zones available`). The engine has weighted by *time-in-zone* (not "one zone per session") since #167 — the doc previously claimed otherwise; corrected per **ADR 0009** ("Correction of the record"). What ADR 0009 changed in May 2026 is the *source* of those `hr_zones` seconds, not the engine math:

* **Webhook path (`syncStravaSingle`, commit `8b3242d`)** — fetches the per-second HR stream via `fetchActivityStreams` and computes true time-in-zone via `zones-from-stream.ts` (`MAX_GAP_SEC = 60` caps a single inter-sample interval, heuristic CP-1). Best-effort: a `null` from the streams call (no stream, rate-limited, network error) silently falls back to the summary leak-model.
* **Bulk `syncStrava` + historical import** — stay summary-only by design (Decision 4 rate-limit posture: one extra streams call per new activity, never per row). These rows keep using `estimateZonesFromSummary` (leak model from avg + max HR).
* **`cardioIntensityScalar` is unchanged** — pinned byte-identical for a fixed `hr_zones` input. The interference scalar and freshness pipelines get truer inputs on the webhook path, not new math.

## 6. Recovery — wellness sliders into a global multiplier

`apps/web/src/lib/engine/wellness-recovery.ts` is the live recovery multiplier.

* Requires `MIN_HISTORICAL_POINTS = 3` (`wellness-recovery.ts:47`) recent rows to build a baseline.
* Hard bounds: floor `0.7` (line 50), ceiling `1.1` (line 52). So the wellness check-in can swing the global ceiling by ±30 % down / +10 % up — note the asymmetry.
* **Delta → multiplier** ladder (`wellness-recovery.ts:120-125`), where delta is `(today.fatigue + today.soreness) − baseline.(fatigue + soreness)` on the 1–9 slider scale:
  delta ≤ −2 → `1.10`; ≤ −1 → `1.05`; < 1 → `1.00`; < 2 → `0.90`; < 3 → `0.80`; else `0.70`.
* Returns null when there's no check-in today or fewer than 3 recent rows.
* Wired into the ceiling explainer by **PR #166** (`feat(engine): wire daily wellness sliders into recoveryMultiplier`). Before that PR the multiplier was hard-coded to 1.0.
* **PR #176** retired the Today-page daily wellness card. The schema, the engine path, and the historic rows are all still in place — but no UI is currently producing new rows, so the multiplier defaults to `1.0` for new users.

A second, distinct recovery signal is `apps/web/src/lib/engine/grm.ts`:
`raw = 1.0 + 0.06×fatigueDelta + 0.04×sorenessDelta`, clamped `[0.8, 1.0]`, threshold `GRM_RECOMMEND_THRESHOLD = 0.96`. **This is on a 1–5 scale**, separate from wellness-recovery's 1–9. The two systems coexist in the codebase.

## 7. Ceiling — what's actually computed today

There are **two** ceiling-related code paths, and the doc is honest about that:

**(a) `apps/web/src/lib/stats/engine.ts:getCeilingExplain`** is the v2-spec-style global ceiling. It returns `{ baseCeiling, recoveryMultiplier, confidenceBias, finalCeiling, basisWeeks, formula, inputs }` and computes
`finalCeiling = baseCeiling × recoveryMultiplier × confidenceBias` (`stats/engine.ts:716`).

The base picker is the pure helper `pickCeilingBase` in `packages/engine/src/recovered-weeks.ts:183`:
* ≥ 3 recovered weeks in last 12 → median of the most recent 3, bias `1.00` (`recovered-weeks.ts:200-204`).
* 1–2 recovered weeks → median of however many you have, bias `0.80` (`recovered-weeks.ts:214-220`).
* 0 recovered weeks → lowest of last 4 weeks × `0.9`, bias `0.80` (`recovered-weeks.ts:236-241`).

"Recovered week" (`recovered-weeks.ts:71-121`) means: ≥1 logged session, 0 skipped, 0 missed, `maxSrpe ≤ OVERREACH_SRPE = 9` (line 64), `avgFatigue < ELEVATED_STRESS = 4` (line 65), `avgSoreness < 4`. NULL fatigue/soreness pass the gate.

So the live "ceiling" formula has **three factors** (baseCeiling × recoveryMultiplier × confidenceBias), not the six-factor product the v2 research note pencils in (no per-bucket headroom, no interference modifier, no anchor-coupling, no sex-specific adjustment). The recoveryMultiplier here is the same wellness-recovery from §6.

**(b) `apps/web/src/lib/stats/ceiling-queries.ts`** is a separate Phase-2 MVP "set-count vs prescribed" surface used in different UI tiles. Bands (`ceiling-queries.ts:28-34`): `<0.7` under, `<0.9` on-budget, `<1.1` at-line, `<1.3` over, `≥1.3` way-over. It compares this-week working-set count to the archetype prescription on a rolling 7-day window. This is **not** the v2 chain; it's a one-factor ratio.

Both exist on `main`. The Today/Plan dashboards render (b); the `/engine` explainer page renders (a).

## 8. Modality stress multiplier — where it lives and what it touches

Defined exactly once in `apps/web/src/lib/planner/session-modality.ts:94-100`. Read by:
* `actual-session-load.ts:238` (strength ESL).
* The session modality is also a label used by the prescription notes and adherence tags, but **not** by per-set bucket math — buckets weight by intensity/reps/tendon, not by session modality.

It does **not** appear in `bucket-load.ts`. So "strength feels different in a hypertrophy session" is not a thing the engine encodes beyond the headline ESL number.

## 9. Tier detection — what inputs feed the user's experience tier

`apps/web/src/lib/engine/tier-detection.ts`:

* 12-week (84-day) rolling window.
* **Declared experience values** (`tier-detection.ts:45-51`): `beginner_lt_6m`, `novice_6m_2y`, `intermediate_2y_5y`, `advanced_5y_10y`, `highly_advanced_10y_plus`.
* Signals folded in:
  1. Declared experience (above).
  2. e1RM relative-strength benchmarks.
  3. **Schedule regularity** = `1 − CV(weekly session counts)`; requires ≥ 3 non-empty weeks.
  4. **Recovery input consistency** = fraction of sessions logged with fatigue OR soreness.
  5. **Anchor adherence** — a planned `planned_sessions.role ∈ MAIN_LIFTS` only counts if the linked session has ≥1 non-warmup `set_log` whose `movement_id ∈ STRENGTH_ROLE_CANDIDATES`. This is the **PR #163 + #164** fix for audit finding H1: previously any non-null `completed_session_id` counted, so a tricep-only session could earn anchor credit.

There is **no "feature engagement" / "BTS"** signal in `tier-detection.ts` — grep confirms. The v2 spec implies one; live does not have it.

## 10. Archetypes — the actual library on `main`

`apps/web/src/lib/planner/archetypes.ts` (1503 lines). Six archetypes are exported as `ARCHETYPES` (`archetypes.ts:1103-1110`):

* **`strength_anchor`** (Strength Focus) — 4 weeks; four main lifts (squat / horizontal_press / deadlift / vertical_press), polarized cardio added when day budget allows. Wave week profiles 0.65→0.75→0.85, 0.70→0.80→0.90, peak 0.75→0.85→0.95, deload 0.40→0.50→0.60 with `strengthVolumeScale 0.5` (`archetypes.ts:366-374`). **ADR 0006 folding behavior:** `foldedSecondaryMaxSets = 5`; bench + OHP are `priority: "optional"` (rank 7/8) so at `freq < 6` the trim collapses toward squat + deadlift anchors and `foldDualMainLifts` (ADR 0005) attaches the missing upper patterns onto the present strength days (squat↔OHP, deadlift↔bench rack-ergonomic pairing). At `freq = 6` (max) all four strength days return and fold is a no-op.
* **`endurance_anchor`** (Endurance Focus) — 4 weeks; long Z2 + VO2 intervals anchor the week. **Per [ADR 0004](../../code/hybrid-training-app/docs/adr/0004-endurance-anchor-dual-main-lift.md) (2026-05-28)**, the two strength days are now dual-main-lift: Tue = Squat (primary, full wave) → Overhead Press (secondary, ≤3 sets); Thu = Deadlift (primary, full wave) → Bench Press (secondary, ≤3 sets). Pair chosen for rack ergonomics (same J-cup height supports both lifts in a superset). Lower lift always first. Intensity stays in the maintenance band (0.75–0.90, explicit "Maintenance" intensity labels, `archetypes.ts:581-589`). Driven by Huiberts 2024 *Sports Med* HIGH meta (concurrent endurance does not impair upper-body strength) + Androulakis-Korakakis 2020 HIGH (1 set/wk at ≥75% 1RM maintains 1RM). **ADR 0005 folding behavior:** `foldedSecondaryMaxSets = 3`; fold is a structural no-op here because the static ADR 0004 secondaries already populate every strength day and the skip-if-already-present guard preserves them verbatim.
* **`hypertrophy_anchor`** — opts into the legacy accessory pool (`accessoriesByDefault`); concrete week profiles per the file. The only archetype that defaults `accessoriesByDefault = true`. **ADR 0006 folding behavior:** `foldedSecondaryMaxSets = 4`; bench + OHP are `priority: "optional"` (rank 7/8) so at `freq < 5` the trim collapses toward squat + deadlift anchors and `foldDualMainLifts` (ADR 0005) attaches the missing upper patterns at the per-set hypertrophy cap. At `freq = 5` (max) all four strength days return and fold is a no-op. **ADR 0011 effort-anchor:** on non-deload weeks the **final** compound working set is RIR-anchored (week 0 → 12 reps @ RIR 2; week 1 → 10 reps @ RIR 2; week 2 → 8 reps @ RIR 1) so the compound actually reaches the hypertrophy stimulus window (Schoenfeld 2021 / Helms 2018); loads stay inside the 60–75% TM band. Earlier sets keep fixed reps as volume, deload week is excluded, and the anchored set carries `isAmrap: false` so the renderer shows the RIR chip — never a "+" — and `detectAmrap` does not consume it as a TM-bump signal. **ADR 0015 early-set bump:** on non-deload weeks the **earlier** (non-final) compound sets also get a bounded rep bump (`+2`, capped at 12) + an honest submaximal cue ("Build set — make it challenging…") but **no `targetRir`** — inverting the Helms/Zourdos RPE chart shows literal RIR 3–4 at these loads (54–67% 1RM) lands at ~12–15 reps/set, so the engine deliberately under-claims early-set effort rather than explode volume; per-week effect W0/W1 `[10,10,8]` → `[12,12,10]`, W2 `[10,8,8]` → `[12,10,10]`. True RIR 3–4 / higher volume is opt-in via the effort/volume dial (ADR 0016).
* **`concurrent_hybrid`** — paired strength + cardio days, two-a-day variant defined. **ADR 0005 folding behavior:** `foldedSecondaryMaxSets = 3`; this is the archetype that actually exercises folding in production. At `daysPerWeek = 2` the trim returns only squat + deadlift anchors — fold attaches OHP onto the squat day and bench onto the deadlift day (ADR 0004 ergonomic pairing) so all four canonical patterns are covered weekly.
* **`rebuild`** — capped intensity, tendon "DC-D7" days, easy Z2 only (no threshold), comment cites Kongsgaard 2009 (`archetypes.ts:603`). **ADR 0005 folding behavior:** `disableFolding = true` — the archetype's whole point is a sub-strength-driving load with tendon-day anchors carrying the recovery budget; folding contradicts that intent.
* **`maintenance`** (`archetypes.ts:1027-1100`) — 2-week block, only 2 strength + 2 short Z2 days at 65–70 % TM with `strengthVolumeScale 0.6`, no two-a-day variant; explicit "doing less, not more density" comment. **ADR 0005 folding behavior:** `disableFolding = true` — adding a folded secondary main lift would convert the archetype into a normal training block.

Each archetype declares `days: DayTemplate[]`, optional `twoADayDays`, `weekProfiles[]`, and either `accessoriesByDefault` or `accessoryProfile`. Strength days are role-based and pull candidate slugs from `STRENGTH_ROLE_CANDIDATES` (`archetypes.ts:198-235`). The user picks the variant by setting a TM on a specific movement; the planner uses whichever variant has a TM.

There is **no explicit "hard-conditioning budget" field** on the archetype type (no `hardCardio`, no `interferenceLevel`, no anaerobic quota — `Select-String` confirms). The archetype-level signal for conditioning is whatever `kind: "cardio"` days the archetype's `days` array contains and what `cardioKind` those have. So an archetype like **Maintenance**, which contains only Z2 cardio days, has zero "hard conditioning" — but nothing in the schema labels it that way; the absence is implicit.

## 11. Volume landmarks — the muscle table

`apps/web/src/lib/stats/muscle-volume.ts:72-95` declares 21 muscles, each with `{ maintenance, building, productive, limit }` set numbers (per-week hard sets). Selected examples (from the table — full list in file): chest, back, quads, hamstrings, glutes, shoulders, biceps, triceps, calves, forearms, abs, etc., each with explicit numbers.

* **Modality-aware continuous scalar** (`apps/web/src/lib/engine/concurrent-scalar.ts`). Replaced the legacy binary `CONCURRENT_SCALAR = 0.7` (which fired on `≥3 cardio sessions OR ≥240 min`). The new helper computes a weighted dose `Σ(minutes_m × MODALITY_INTERFERENCE[m])` and maps it through a piecewise-linear curve: `1.0` at zero, `0.70` at 300 weighted min (matches the legacy run-heavy trigger point), `0.60` floor at ≥600 weighted min.
* **`MODALITY_INTERFERENCE`** (`concurrent-scalar.ts`): per-modality coefficients — `run 1.0` (Wilson 2012 baseline), `ruck 0.8`, `other_cardio/other 0.7`, `swim 0.6`, `row 0.5`, `bike 0.4` (Wilson 2012 — cycling did not produce significant decrements), `ski/ski_erg 0.4`, `walk 0.3`. Aliases (`ski_erg`, `ruck`, `other`) are kept for forward-compat with hand-authored event modalities outside the `cardio_logs.modality` enum.
* **`isConcurrentScaled(scalar)`** (`concurrent-scalar.ts`): replaces `isConcurrentWeek(sessions, minutes)` for the UI info-pill — true when the computed scalar is < 0.99.

So the engine now has a modality-aware continuous interference model (per-modality coefficients × piecewise-linear dose curve), but it is still not muscle-specific (calves vs biceps both receive the same compression) and not sex-specific. Coefficient *magnitudes* remain heuristic — Stage B is calibration against prospective user-outcome data.

## 12. Adherence — definitions, ranges, late-logged

`apps/web/src/lib/stats/adherence.ts` and `adherence-detail.ts`:

* "Adherent" = completed (linked `completed_session_id` non-null, and — per PR #163 — for anchor sessions specifically, ≥1 non-warmup set in a main-lift movement).
* Numerator semantics per the original Phase-1 brief: **Skipped counts as MISSED** in the numerator (i.e. user-initiated skips don't reduce the denominator).
* The detail surface (`adherence-detail.ts`) breaks completed-late into a three-way split shipped by **PR #174**: `onTime` / `lateLogged` / `accidentallyMissed`.
  * `isLateLogged` (`apps/web/src/lib/sessions/late-logged.ts`): true when `performed_at`'s calendar date *in the user's tz* is strictly after `planned_sessions.date`.
  * **14-day retro-window** cap on `startSessionDirect` (PR #174 description): a user cannot back-date a session more than 14 days. Older planned sessions can't be retroactively claimed.
* Range selector (`adherence-range.ts`): 12 weeks, 26 weeks, or "all".

## 13. Cardio classifier — Strava + manual cardio into a kind

`apps/web/src/lib/integrations/strava/classify-cardio.ts`:

* **ESL per kind** (`classify-cardio.ts:73-89`): `cardio_z2` = `0.5 × min`, `cardio_threshold` = `1.3 × min`, `cardio_vo2` = `2.0 × min`, `cardio_alactic` = `1.0 × min`, `cardio_mixed` = `1.0 × min`.
* **Kind picker** (`classify-cardio.ts:101-128`):
  * `alactic` if `maxPct ≥ 0.95` AND duration `< 1200 s` (20 min).
  * `vo2` if `avgPct ≥ 0.80` OR `maxPct ≥ 0.92`.
  * `threshold` if `0.70 ≤ avgPct < 0.80` AND (`maxPct` null OR `maxPct < 0.90`).
  * `z2` if `avgPct < 0.70`.
* **Confidence**: both avg + max HR known → `0.85`; one known → `0.6`; if max HR came from the age-220 fallback → multiplied by `0.7`.

`apps/web/src/lib/sessions/cardio-swap.ts` introduces the `cardio_other` catch-all (PR #168) so unclassified or sled/ruck/swim sessions can't accidentally be offered as Z2 swaps.

PR #160 added the classifier itself, #162 wired it into populating `hr_zones` on cardio rows, #168 fixed the swap exclusion.

## 14. Deload — when and by how much

`apps/web/src/lib/engine/deload.ts`:

* `GRM_FATIGUE_THRESHOLD = 0.93` (`deload.ts:41`).
* `DELOAD_FACTOR = 0.9` (`deload.ts:42`) — a deload week prescribes 90 % of the would-be load.
* **AMRAP top set (ADR 0007, commit `21038f4`)** — on STRENGTH_ANCHOR, CONCURRENT_HYBRID, and custom strength waves (`fives` / `threes` / `peaking_wave`), the final primary top set on non-deload weeks now carries an explicit `PrescriptionItem.isAmrap = true` plus the cue "As many clean reps as possible — stop ~1 in reserve, not to failure." Renderer surfaces a "+". Endurance / rebuild / maintenance / hypertrophy carry `isAmrap: false` so the bump path does not key off a positional fixed top set. The marker is typed (rather than the ADR's proposed `reps: "N+"` string) so it composes cleanly with the existing `PrescriptionItem.reps: number` schema and persisted prescriptions. `detectAmrap` short-circuits on the explicit flag in both strategies; the e1RM → TM bump path (`one-rm.ts` → `tm-bump.ts`) is unchanged.
* "Real miss" = AMRAP top set reps below target OR weight below `prescribed × 0.95`. Now keyed off the explicit `isAmrap` flag (not a positional guess), so the reactive-deload net is a real safety mechanism on real AMRAPs.
* Two consecutive real misses on the same lift → **−10 % TM**, rounded to 0.5 kg (`tm-bump-actions.ts`).
* Deload weeks are also declared up-front in each archetype's `weekProfiles` (e.g. Strength Anchor week 3 at 0.45/0.55/0.65). The engine deload is the reactive layer on top of the scheduled one.

## 15. PR detection — what counts as a personal record

`apps/web/src/lib/engine/pr.ts`:

* **Three kinds**: `weight` (heaviest single ever), `reps_at_weight`, `e1rm`.
* **Grinder exclusion**: `GRINDER_RPE = 10` — sets at RPE 10 are excluded from e1RM PR candidates (treating max-grinders as noise).
* **e1RM PR** requires the new e1RM to exceed the prior best by `+0.05` (about 50 g equivalent in 1RM-space) to filter rounding noise.

`apps/web/src/lib/engine/one-rm.ts`:
* **Epley**: `w × (1 + reps / 30)`, valid reps `1..12`.
* RPE chart (Helms / Zourdos style).
* Conservative pick = `min(Epley, RPE-chart)`.
* TM = `0.9 × 1RM`, rounded to plate increment (default 2.5 kg via `roundToPlate` in `archetypes.ts:1112`).

`apps/web/src/lib/engine/tm-anchored-pr.ts`:
* `TM_PR_EPSILON_KG = 0.5` (line 39) — TM PR flashing in-session uses the SAVED 1RM as the anchor, not the running max from history. That's deliberate so a single noisy heavy single doesn't immediately retire the TM.

TM-bump (`tm-bump.ts`):
* `COOLDOWN_DAYS = 28`, `SCORE_THRESHOLD = 3` points. e1RM excess ≥7 % over current TM-implied 1RM contributes 2 points, etc.
* Block-complete bumps (`block-complete.ts`): `COMPLETION_THRESHOLD = 0.75`, `COOLDOWN = 28 d`. Defaults: squat / hinge → +5 kg, else +2.5 kg.

## 16. HR zones — methods, percentages, edits

`apps/web/src/lib/stats/hr-zones.ts`:

* Three methods: `max`, `hrr` (Karvonen), `lthr`.
* `DEFAULT_ZONE_PCTS` (`hr-zones.ts:80-83`):
  * `max`: `{0.6, 0.7, 0.8, 0.9}` (Z1/2/3/4 lower bounds; Z5 above 0.9).
  * `hrr`: `{0.5, 0.6, 0.7, 0.85}`.
  * `lthr`: `{0.81, 0.89, 0.93, 0.99}`.
* Pct range is `(0, 1.5]` — over-100 % is allowed for LTHR-anchored Z5.
* **PR #161** added the three methods.
* **PR #172** made the percentages user-editable per method (no longer hard-coded; stored in profile).

**Display / engine unification (ADR 0009 D2, commit `8b3242d`).** `getHrZones` now **prefers each cardio row's stored `hr_zones`** distribution (the same value the engine doses off) via `accumulateZoneTotals` + `coerceStoredZones`, and falls back to single-avg-HR `bucketByZone` only for rows that lack a stored distribution. The card returns a `source` discriminator — `"measured"` (every contributing row used stored zones), `"approximated"` (every contributing row fell back to avg-HR bucketing), or `"mixed"` — surfaced in the card footnote as "Measured from per-second HR streams." / "Approximated from session-average HR; per-second streams will refine this when available." / the mixed-source line. Same number on the card, same number in the engine.

## 17. Late-logged & retroactive performed_at

Already covered structurally in §12. The mechanics:
* `isLateLogged` is **derived, never persisted** (`late-logged.ts:9`) — read-side comparison of `performed_at` (calendar date in user tz) vs `planned_sessions.date`.
* Retroactive picker lets the user back-date a session up to 14 calendar days; older planned dates can't be retroactively claimed.
* Adherence breakdown surfaces three buckets: `onTime`, `lateLogged`, `accidentallyMissed`.
* The ESL recompute path (`recompute-actual-session-load.ts`) runs on the late-logged session too, so the load lands on the *planned* date's row, not on the calendar day the user pressed Save.

This is the PR #174 / #175 line of work.

## 18. v2 spec deltas — what `hybrid-training-research-v2.md` calls for that `main` does not do

Reading `hybrid-training-research-v2.md` against the live engine:

* **Ceiling is 3-factor, spec calls for ~6.** Live: `base × recoveryMultiplier × confidenceBias` (`stats/engine.ts:716`). Spec adds per-bucket headroom, sex-specific interference modifier, anchor-coupling, and a tier-aware compression. None of those live in either ceiling code path.
* **Interference modifier is a single global 0.7× scalar** triggered by ≥3 cardio sessions OR ≥240 min/wk (`muscle-volume.ts:99-134`). Spec wants modality-specific (Z2 vs threshold vs VO2 vs HIIT vs alactic carry different mTOR / AMPK / nervous-system costs) and per-muscle-group.
* **Tier detection lacks the "feature engagement / BTS" signal.** The four live signals are declared experience, e1RM, schedule CV, recovery-input fraction (§9). The spec's behavioural / build-the-system engagement input is absent.
* **HR zone time-in-zone is used and on the webhook path is now stream-measured.** §5 / §16 — `cardio-intensity.ts` weights by time-in-zone, and ADR 0009 made the source per-second-measured on `syncStravaSingle` (with the summary leak-model as fallback elsewhere). Older "doc said single-zone bucketing" claim was incorrect for the engine; corrected per ADR 0009.
* **No sex-specific modifiers anywhere** — spec wants different volume-landmark scaling and interference cost for female lifters. `Select-String` for `female|sex|male` in the engine finds nothing.
* **No archetype-level "hard conditioning budget" field** (§10). Spec wants archetypes to declare a quota the user can monitor against. Live archetypes only contain concrete day templates.
* **GRM (1–5) and wellness-recovery (1–9) coexist** as two separate recovery systems (§6). Spec wants one unified signal.
* **Modality stress multiplier is per-session, not per-set** (§8). Spec wants the bucket math to differ for hypertrophy vs strength sets within the same session.
* **PR detection's e1RM ε = 0.05 absolute** (§15) — spec wants relative epsilons that scale with the lifter's absolute strength.

## 19. Overconfident constants — places where the code claims more than it cites

* **`CARDIO_SCALAR = 8`** (`bucket-load.ts:151` and again inlined at `region-ledger.ts:161`) — the constant that makes cardio comparable to strength in load units has no calibration note, no citation, and lives in two places. Change one without the other and bucket vs region freshness drift apart silently.
* **Bucket coefficients** (`bucket-load.ts:119-125`): neural/metabolic/impact/tissue per-set multipliers (0.15, 0.5, 0.85, 0.2, 0.05, 0.4, 0.8 …) are engineering-eyeball defaults despite the file header citing Pareja-Blanco, Gabbett, Wilson, etc. None of the constants are tied back to those papers.
* **RPE → multiplier ladder** (`bucket-load.ts:49-55`): a six-step staircase that is plausible but uncited; null-RPE → 0.5 is a particularly significant call (half-credit by default).
* **Recovery delta bands** (`wellness-recovery.ts:120-125`): six bands (−2, −1, 1, 2, 3) on the **1–9 slider** that the slider was originally documented as 1–10. The module comment admits the half-unit slip is "below band granularity," but it's still an undocumented scale mismatch.
* **Floor 0.7 / ceiling 1.1 asymmetry** on the recovery multiplier (`wellness-recovery.ts:50, 52`): the engine can punish a bad check-in 3× harder than it can reward a good one. No source given.
* **Cardio classifier thresholds** (`classify-cardio.ts:101-128`) — `0.95 maxPct ∧ <1200 s` for alactic, `0.92 maxPct` for VO2, etc. — are reasonable but have no citation in the file.
* **CONCURRENT_SCALAR — superseded.** The legacy `0.7` / `≥3 sessions ∨ ≥240 min` trigger was replaced by the modality-aware continuous scalar in `apps/web/src/lib/engine/concurrent-scalar.ts` (see §11). Magnitudes there are still uncited Stage-A heuristics; *structural form* (continuous + modality-weighted) is now cited (Wilson 2012, Chen 2024, Schumann 2021).
* **Bucket bands** (`bucket-state-queries.ts:67-77`) — five bands on freshness (0.85, 0.55, 0.3, 0.1) — uncited.
* **Volume-landmark numbers** (`muscle-volume.ts:72-95`) — 21 muscles × 4 thresholds = 84 magic numbers. The file does not cite which Schoenfeld / RP source each row tracks.
* **TM-bump scoring weights** (`tm-bump.ts`) — points for each signal are engineering defaults.

## 20. Recent PR audit trail — what shipped #160–#176 that touched the engine

(`gh pr list --state merged --limit 25`, then `gh pr view` for each.)

* **#160** `feat(strava): classify external cardio from HR + duration` — adds `classifyCardioKind` (§13).
* **#161** `feat(stats/hr-zones): max / hrr / lthr methods` — three HR zone methods (§16).
* **#162** `feat(cardio): populate hr_zones on cardio_logs from Strava` — wires classifier into row inserts.
* **#163** `fix(engine): anchor adherence requires logged anchor set` — audit finding H1 fix for `tier-detection.ts`.
* **#164** `fix(engine): use correct main-lift role names for anchor adherence` — completes #163 by fixing the role-name list.
* **#165** `feat(engine): recompute effective_stress_load from logged sets and cardio` — §1, the biggest engine fix in this batch.
* **#166** `feat(engine): wire daily wellness sliders into recoveryMultiplier` — §6, replaced the hard-coded 1.0.
* **#167** `feat(engine): HR-aware cardio bucket + region load when zones available` — §5.
* **#168** `fix(cardio-swap): exclude unclassified movements from intensity-matched swap picker` — `cardio_other` catch-all (§13).
* **#169 / #170 / #171** — RLS and seed cleanups; not engine math.
* **#172** `feat(settings): editable zone percentages per HR method` — §16.
* **#173** — UX overdue badge; not engine math.
* **#174** `feat(sessions): retroactive performed_at + late-logged adherence breakdown` — §12, §17.
* **#175** — PR #174 follow-ups (small).
* **#176** `chore(today): retire daily wellness check-in card` — UI gone, engine path intact; §6 note.

So in the last 17 merged PRs, the headline engine moves are: ESL recompute (#165), HR-aware cardio (#167) plus the HR-zones plumbing (#161/#162/#172), wellness wired into ceiling (#166) and then UI-retired (#176), anchor-adherence tightened (#163/#164), and late-logged surfaced (#174/#175). The audit findings J3, B4, H1, and Finding 1 in `engine-actual-vs-prescribed-audit.md` are closed by this batch. The remaining audit/spec gaps (per §18) are not addressed.

**ADR 0004 (2026-05-28): `ENDURANCE_ANCHOR` dual-main-lift redesign** — strength days restructured as Squat→OHP / Deadlift→Bench (paired for rack ergonomics, upper lift capped at ≤3 sets via the new `StrengthDay.secondaryMaxSets` field). `CONCURRENT_HYBRID` `daysForFrequency` trim bug fixed in the same PR (bench + OHP demoted from anchor to optional so freq=2 collapses to the two highest-priority compounds).

**ADR 0005 (2026-05-29): Frequency-aware dual-main-lift folding** — generalises ADR 0004's secondary-slot pattern as a dynamic post-trim transformation. New module `apps/web/src/lib/planner/main-lift-folding.ts` exports `foldDualMainLifts(archetype, trimmedDays)`, wired into both `createBlock` (after `daysForFrequency`) and `createCustomBlock` (after `compileCustomArchetype`). When the trimmed strength-session count drops below 4 and any of the four canonical patterns (squat / deadlift / horizontal_press / vertical_press) is missing, the function folds the missing pattern(s) onto existing strength days using ADR 0004's ergonomic pairing (squat ↔ vertical_press, deadlift ↔ horizontal_press). Per-archetype caps via new `Archetype.foldedSecondaryMaxSets` field: ENDURANCE = 3, CONCURRENT = 3, STRENGTH = 5, HYPERTROPHY = 4. New `Archetype.disableFolding` opts REBUILD + MAINTENANCE out entirely. Skip-if-already-present guard preserves ADR 0004's static ENDURANCE_ANCHOR templates verbatim. Same evidence base as ADR 0004 (Huiberts 2024 / Spiering 2021 / Androulakis-Korakakis 2020 HIGH); confidence HIGH-MODERATE.

**ADR 0006 (2026-05-29): demote bench + OHP from anchor in STRENGTH_ANCHOR + HYPERTROPHY_ANCHOR — closes ADR 0005 audit gap** — data-only change in `apps/web/src/lib/planner/archetypes.ts`: in both archetypes' `days` and `twoADayDays`, bench (`dayIndex 1`) and OHP (`dayIndex 4`) drop from `priority: "anchor"` to `priority: "optional"` with `rank: 7` / `rank: 8`. Squat + deadlift remain anchors. Activates the `foldedSecondaryMaxSets` caps already set in ADR 0005 — at `freq < max` the trim collapses toward squat + deadlift anchors and `foldDualMainLifts` attaches the missing upper patterns at the per-archetype cap (5 for STRENGTH, 4 for HYPERTROPHY). At each archetype's max freq (STRENGTH=6, HYPERTROPHY=5) all four strength days return and fold is a no-op. Cross-archetype invariant test asserts every non-`disableFolding` archetype ships balanced (4-pattern coverage) at every freq in `[2..max]`. Same evidence base as ADR 0004 / ADR 0005; confidence HIGH-MODERATE.

**ADR 0011 (2026-05-30, commit `262ccba`): effort-anchor the hypertrophy compound's final working set** — surgical change in `apps/web/src/lib/planner/archetypes.ts`. New pure helper `applyHypertrophyEffortAnchor(items, archetype, profile)` rewrites the **last** compound working set on `HYPERTROPHY_ANCHOR` non-deload weeks per `HYPERTROPHY_FINAL_SET_BY_WEEK` (week 0 → 12 reps @ RIR 2; week 1 → 10 reps @ RIR 2; week 2 → 8 reps @ RIR 1; deload week untouched). The anchored item carries `targetRir`, `intensityCue` ("Last set: take it close to failure — leave about N reps in reserve"), and (after ADR 0007) `isAmrap: false`. Loads stay unchanged inside the 60–75 % TM band — the Decision-3 "nudge load up" is delivered as a **rep nudge at constant %TM**. Earlier sets keep fixed reps as accumulated volume; folded secondaries and accessories are untouched. Constants tagged `// heuristic — hypertrophy compound effort anchor (CP-1), per Schoenfeld 2021 / Helms 2018`. Test count 2650 → 2659 (+9).

**ADR 0015 (2026-05-31): effort-bump the hypertrophy compound's early (non-final) sets** — extends `applyHypertrophyEffortAnchor` in `apps/web/src/lib/planner/archetypes.ts` to also transform the earlier sets, which sat at ~RIR 6–10 (junk volume). New `HYPERTROPHY_EARLY_SET = { repBonus: 2, repCap: 12, cue }`: on non-deload weeks each early set's reps rise `+2` (capped at the e1RM model's 12-rep ceiling) with an honest submaximal cue, but **no `targetRir`**. The honesty matters — inverting the Helms/Zourdos RPE chart (`one-rm.ts`) shows literal RIR 3–4 at the archetype's light loads (54–67 % 1RM) lands at ~12–15 reps/set, a volume explosion inappropriate for a concurrent block, so the engine deliberately under-claims early-set effort instead of stamping a false RIR-3-4 label or raising load out of the 60–75 % TM band. Per-week effect: W0/W1 `[10,10,8]` → `[12,12,10]`, W2 `[10,8,8]` → `[12,10,10]`; loads unchanged; deload untouched; final-set anchor (ADR 0011) and folded secondaries preserved. True RIR 3–4 / higher volume is opt-in via the effort/volume dial (ADR 0016). Constants tagged `// heuristic — hypertrophy compound EARLY-set effort bump (CP-1), per Schoenfeld 2021 / Refalo 2023`. Test count 2797 → 2804 (+7).

**ADR 0016 (2026-05-31): user effort/volume dial for the hypertrophy archetype** — a single `profiles.effort_preference` enum (`low | standard | high`, DEFAULT `standard`; migration `0080`) that scales BOTH the compound **effort** axis and the accessory **volume** axis together, **hypertrophy-only**, baked at block creation. New `apps/web/src/lib/planner/effort-preference.ts` owns the type, resolver, and all magnitudes (CP-1): `hypertrophyEffortConfig(pref)` drives `applyHypertrophyEffortAnchor` (`buildPrescription` gained a trailing `effortPreference` param), and `hypertrophyAccessorySetsPerItem(pref, base)` is applied in `assemble-prescription.ts` by clone-spreading the hypertrophy `accessoryProfile.aesthetic` with the scaled `setsPerItem` before the picker (movement **selection** unchanged — only sets-per-movement moves, so picker role/focus/dedup invariants hold). `standard` is **byte-identical** to post-ADR-0015 (golden master + ADR-0011/0015 pins green; new params default `"standard"` so existing callers are untouched). `high`: early bump `+4` cap 15 + final-set RIR `−1` **floored at 1** (never failure) + `setsPerItem` `+1`; `low`: skip the early bump + final-set RIR `+1` + `setsPerItem` `−1`. No-op for non-hypertrophy archetypes and on deload. The dial deliberately exposes the under-determined effort/volume constants as a reversible user lever instead of re-hardcoding a default (review framing: HIGH inter-individual variability, ~0 data rows). Write surface: `EffortPreferenceAutoSave` radio (Easier / Balanced / Harder) on the profile settings page. Evidence: Baz-Valle 2022 (10–20 sets/muscle/wk zone → bounded `+1` set), Schoenfeld 2021 / Refalo 2023 (proximity-to-failure → RIR-1 floor), Wilson 2012 / ADR 0008 (concurrent interference → hypertrophy-scoped, opt-in). Test count 2804 → 2815 (+11).

**ADR 0007 (2026-05-30, commit `21038f4`): autoregulated AMRAP top set on strength + hybrid archetypes** — extends the prescription schema with `PrescriptionItem.isAmrap?: boolean` and the archetype schema with `Archetype.solicitTopSetAmrap?: boolean` (set on `STRENGTH_ANCHOR` + `CONCURRENT_HYBRID`; custom strength waves — `fives` / `threes` / `peaking_wave` — also solicit). New `applyTopSetAmrapMarker(items, archetype, profile)` stamps `isAmrap: true` on the final primary top set for soliciting archetypes on non-deload weeks, plus the cue *"As many clean reps as possible — stop ~1 in reserve, not to failure."* Non-soliciting archetypes (endurance / rebuild / maintenance / hypertrophy) and deload weeks get `isAmrap: false` so the renderer shows a fixed top set (no "+") and the bump path does not key off them. `detectAmrap` honours the explicit flag in both strategies (legacy unflagged items unchanged → backward-compatible with persisted in-flight prescriptions). The display layer was extended with a main-lift RIR chip and main-lift cue block so both the AMRAP cue (0007) and the hypertrophy RIR target (0011) actually surface. Implementation deviated from the ADR's proposed `reps: "N+"` string (`reps` is typed `number` — a string would ripple through every renderer/logger/e1RM path); the typed boolean is strictly less blast-radius. Test count 2659 → 2670 (+11).

**ADR 0008 (2026-05-30, commits `67066ee` + `233143a`): modality-aware taper/peaking** — extends `taper.ts` with `TaperModality = "endurance" | "strength" | "mixed"` and a `taperModalityForEvent` mapper (only the literal `"strength"` event-UI string maps to strength; everything else, including `null`, defaults to endurance — preserving the pre-ADR-0008 curve for every existing row). `computeTaperRecommendation` now branches on `event.modality ?? "endurance"`:
* **Endurance branch (`endurancePhase`)** — current Mujika/Bosquet curve verbatim, 14-day max window, polish drops to `intensityAction: "minimal"`. Pinned by the existing-behaviour tests.
* **Strength branch (`strengthPhase`, heuristic — Pritchard 2015 MODERATE / Travis 2020 MODERATE-LOW)** — 10-day max window; volume cuts graded **−30 % / −45 % / −50 %** across approach / deep / polish; `intensityAction: "hold"` at **every** phase including polish (the key fix vs endurance, which drops max-effort work at 3d out); day 0 returns `"hold"` with the "openers and activation — the heavy work is banked" detail rather than a runner's rest.
* **Mixed branch (`mixedPhase`)** — endurance volume curve (−20 / −40 / −60 %) but `intensityAction: "hold"` at polish so one heavy strength primer survives. Day 0 falls back to endurance `"minimal"`.
* **B-priority** halves the volume cut and clamps the window to 7d in every modality.

Decision 5 (realization microcycle) was **redirected** to ADR 0010 by commit `233143a` — `taper.ts` carries no realization-week branch. The realization peak is delivered as an opt-in **nudge** under ADR 0010 (`suggestRealizationWeek`) and does not auto-reshape the planner block. Combined ADR 0008 + 0009 test count 2670 → 2698.

**ADR 0009 (2026-05-30, commit `8b3242d`): real stream-based time-in-zone + display/engine unification** — corrects the methodology-review claim that "TIZ is not used in the load engine": the engine has weighted by time-in-zone since PR #167 (see §5). What 0009 ships is (a) per-second-measured TIZ on the webhook path, and (b) display/engine unification on the same stored `hr_zones` distribution. New `apps/web/src/lib/integrations/strava/zones-from-stream.ts` (pure `zonesFromStream({hrStream, timeStream, bands})`; `MAX_GAP_SEC = 60` heuristic caps inter-sample gaps so an auto-pause can't dump an hour into a zone). `client.ts` adds `fetchActivityStreams` (best-effort `/streams?keys=heartrate,time&key_by_type=true`; returns `null` on any failure). `sync.ts` calls it **only** on the `syncStravaSingle` webhook path — bulk `syncStrava` and history import stay summary-only by design (rate-limit posture). `lib/stats/hr-zones.ts` adds `accumulateZoneTotals` / `coerceStoredZones` so `getHrZones` prefers stored `hr_zones` and surfaces a `source: "measured" | "approximated" | "mixed"` field used by the `HrZonesCard` footnote. `cardio-intensity.ts` math is **byte-identical** (only the source of `hr_zones` changes); `ZONE_INTENSITY_WEIGHTS` now carry a CP-1 heuristic tag pending TRIMP/Seiler calibration. See §5 + §16. Combined ADR 0008 + 0009 test count 2670 → 2698.

**ADR 0010 (2026-05-30, commits `8682844` core + `e93de1f` surface): next-block suggestion nudge** — advice-only macrocycle guidance. New pure module `apps/web/src/lib/planner/next-block-suggestion.ts` exports `suggestNextArchetype(input) → {archetypeId, reason} | null` and `suggestRealizationWeek(input) → {reason} | null`. Server glue `next-block-suggestion-server.ts:getNextBlockNudge(supabase, userId, recentArchetypes, todayYmd)` gathers inputs under a user-scoped (RLS-enforced) client. Surface: `apps/web/src/app/app/plan/page.tsx` renders a `NextBlockSuggestionCard` on the **no-active-block** branch above `PlanNewSwitch`. New heuristic constants in `next-block-suggestion.ts` (all CP-1 practitioner-consensus, NOT RCT-calibrated): `REACTIVE_DELOAD_BACKOFF = 2`, `ACCUMULATION_RUN_FOR_CONSOLIDATION = 2`, `STALENESS_RUN = 3`, `REALIZATION_MIN_STRENGTH_RUN = 2`. **Rule priority (first match wins):** recovery-aware → event-aware → phase-sequence (accumulation → strength) → anti-staleness (complementary) → null. Test count 2698 → 2726 (+28).

Three deliberate scope-downs from the ADR text — recorded here so the live spec matches the code:
1. **Recommend, not pre-select.** The nudge surfaces a recommendation card but does NOT pre-select the wizard archetype control (the ADR's literal "pre-select" language was scoped down to avoid an `archetypeId → {goal, secondary}` reverse-map the wizard does not yet expose). Pre-select is a follow-up.
2. **Realization week is surfaced, not auto-applied.** `suggestRealizationWeek` fires after ≥ 2 consecutive event-less `STRENGTH_ANCHOR` blocks (and is suppressed when an A-event already drives a real taper). It is **not** wired to auto-reshape the planner block; the copy now routes the user to the **manual custom-block path** ("set that up as a short custom block"). The automatic terminal-week reshape (volume down / heavy singles) is a deferred follow-up — `taper.ts` and `buildPrescription` are untouched.
3. **Recovery-aware rule is LIVE.** The pure function honours `recentReactiveDeloads >= 2`, and `getNextBlockNudge` now passes the real count: it queries `tm_history` for `reason='deload'` rows since the oldest recent block's start and counts distinct `session_id` values (deload *episodes*, not rows). Read-only + user-scoped (RLS preserved). All four rules can now fire in production.

---

## Headline gaps the user should focus their critique on

1. **The "ceiling" formula is 3-factor (`base × recoveryMultiplier × confidenceBias`), not 6.** `stats/engine.ts:716`. No per-bucket headroom, no sex/interference modifier, no anchor-coupling. The v2 research note assumes a richer chain than `main` ships, and the simpler `ceiling-queries.ts` Phase-2 MVP that the Today tile renders is a different, even cruder, set-count ratio.
2. **`CARDIO_SCALAR = 8` is a magic magnitude-matcher with zero calibration, duplicated in two files.** `bucket-load.ts:151` and `region-ledger.ts:161`. It single-handedly decides whether cardio load is "comparable" to strength load in every freshness/ceiling computation. No citation, no test pinning it.
3. **Interference is now modality-aware and continuous, but coefficient magnitudes remain heuristic.** `apps/web/src/lib/engine/concurrent-scalar.ts`. Stage A of the concurrent-scalar refactor (PR `feat(engine): modality-aware continuous concurrent-training scalar (Stage A)`) replaced the binary global 0.7× trigger with `Σ(minutes_m × MODALITY_INTERFERENCE[m])` mapped through a piecewise-linear dose curve. Structural form is cited (Wilson 2012 HIGH, Chen 2024, Schumann 2021); per-modality coefficients and curve params are still heuristic and explicitly tagged `// heuristic, magnitude chosen for continuity`. Still not muscle-specific (calves vs biceps receive the same compression) and not sex-specific. Stage B will calibrate against prospective user-outcome data.
4. **Wellness-recovery uses asymmetric bounds (floor 0.7, ceiling 1.1) on the wrong slider scale.** `wellness-recovery.ts:50, 52, 120-125`. The slider is 1–9 in code but was originally specced 1–10; the band edges (−2, −1, 1, 2, 3) are uncited engineering defaults; and a bad check-in can punish 3× harder than a good one rewards. With PR #176 retiring the UI, the multiplier defaults to `1.0` for almost everyone anyway — meaning ceiling computation is effectively running with no wellness input today.
5. **Tier detection is missing the "feature engagement / BTS" input and `STRENGTH_ROLE_CANDIDATES` is the only protection against gaming anchor adherence.** `tier-detection.ts:45-51` lists the four live signals (declared experience, e1RM, schedule CV, recovery-input fraction). The behavioural-engagement input the v2 spec calls for does not exist. Anchor adherence is now correctly gated (PR #163/#164) but a determined user can still bench-only their squat anchor with any movement that happens to be in `STRENGTH_ROLE_CANDIDATES.squat`, which is curated by hand in `archetypes.ts:198-235`.


## 21. Per-block focus muscle groups (migration 0079) — substitution-with-cap bias

**Shipped:** `feat(engine): focus muscle groups — substitution-with-cap bias for 1-2 user-chosen muscles per block`.

**Surface:** The block wizard's Step 2 has a new "Focus muscle groups (optional)" section with a chip multi-select (max 2). The Plan page (/app/plan) shows the active block's focus + an "Edit" affordance that opens a modal with the same chip selector and calls the new `updateBlockFocus` server action. The Today page hero renders a small pill ("🎯 Focus: Biceps, Forearms") next to the block eyebrow.

**Storage:** `training_blocks.focus_muscles text[] NOT NULL DEFAULT '{}'` with two CHECK constraints:
1. `array_length(focus_muscles, 1) IS NULL OR array_length(focus_muscles, 1) <= 2`
2. `focus_muscles <@ ARRAY['biceps','triceps','side_delts','rear_delts','front_delts','calves','glutes','upper_chest','traps','forearms','quads','hamstrings']::text[]`

Empty array = no focus → engine produces the pre-PR baseline exactly (regression-guard test pinned).

**Engine module:** `apps/web/src/lib/planner/focus-muscle-targets.ts` — `defaultMuscleTargets(opts)` is now the single source for the per-muscle target map fed into `pickAccessoriesForSession`. Signature:

`defaultMuscleTargets({ focusMuscles, concurrentLoadMod, elbowForearmAtlRatio }) → { targetsByMuscle, forearmGateActive, substituted }`

Logic:
1. **Baseline** — every muscle in `AESTHETIC_TARGET_MUSCLES` (the legacy 11) gets `DEFAULT_MUSCLE_TARGET = 6` sets/week. Focus muscles outside that universe (quads / glutes / front_delts / traps) are folded in at the same default so the substitution accounting has a consistent pre-bias starting point.
2. **Focus targets** — for each focus muscle `m`, the target becomes `min(LANDMARKS[m].productive, round(LANDMARKS[m].limit × concurrentLoadMod))`. The `min()` preserves the productive-zone ceiling so a no-concurrent week can't push above MAV.
3. **Substitution** — sum the per-focus deltas, then pull that many sets from the non-focus aesthetic pool in round-robin, never dropping any muscle below `LANDMARKS[m].maintenance` (Bickel 2011 detraining-threshold floor). If the pool runs out of headroom (rare: two high-volume focus muscles with tight floors), the focus targets are capped so the invariant still holds — the engine refuses to over-prescribe even if it means slightly lowering the focus ceiling.
4. **Forearm tendon-gate** — if `forearms ∈ focus` AND `elbowForearmAtlRatio > 1.25` (the existing `REGION_SPIKE_THRESHOLD = 0.25` from `region-spike-detector.ts`, re-used so the trigger is single-sourced), the forearm target is silently capped at `LANDMARKS.forearms.building` (MEV). The UI surfaces a banner: "Focus reduced this week due to elevated elbow/forearm load — let it settle." Per Wernbom 2007 + Baar 2017 — tendon adaptation lags muscle by 6–12 wk and can't tolerate rapid weekly load escalation. The gate is the only place in the engine where the invariant is intentionally broken (forearm volume gets dropped without padding the other muscles back up — the goal is less total work this week, not the same work elsewhere).

**Substitution invariant** — `|sum(biased targets) - sum(baseline targets)| ≤ 1 set` is THE critical correctness property. If it breaks, the engine's stress budget silently overflows by ~11–22 sets/week and the existing `concurrent_modifier` (~0.7) is bypassed for the focus group. Pinned by 39 vitest cases across every single-focus combo + a 6-pair dual-focus sample + the input-hardening edge cases.

**Plumbing:** `createBlock` and `createCustomBlock` (`apps/web/src/lib/planner/actions.ts`) accept `focusMuscles` via FormData.getAll, validate with `focusMusclesSchema` (Zod mirror of the DB CHECK), persist to `training_blocks.focus_muscles`, fetch `elbowForearmAtlRatio` once per block-generation via the new `getElbowForearmAtlRatio` helper in `apps/web/src/lib/stats/region-spike-queries.ts`, and forward both values to `assemblePrescriptionItems` → `pickAccessoriesForSession` via the existing `perMuscleTargets` parameter. The ATL helper fails open to `1.0` (no spike) when the user has less than 28 days of `region_state_history` — the gate never fires noisily on cold-start.

**Block-mid edits:** `updateBlockFocus` writes to `training_blocks.focus_muscles` but does not re-materialise already-generated planned_sessions. Currently the planner emits every session row eagerly at block creation, so an edit applies cleanly to the NEXT block; mid-block edits update the column for stats / history but the existing prescriptions stay put. Documented behaviour — re-materialising would invalidate notes / drawer state on rows the user has already inspected.

**Constants flagged:** `FOCUS_LANDMARKS` (Stage A heuristic per Israetel 2017 RP volume landmarks, inherits the calibration plan from CP-2 row #26) and `FOREARM_GATE_ATL_THRESHOLD = 1.25` (heuristic, single-sourced from the existing CP-2 row #30 — same 0.25 spike threshold, just re-cast as a multiplier). Both rows referenced by the new CP-2 row #34.

### Accessory variation across blocks (ADR 0012)

**Problem:** the accessory picker previously demoted a movement used in the *previous* block by a flat `+100` score penalty (lower is better), with no notion of movement value. That churned high-value compound staples (weighted chin-ups, dips, rows) just as eagerly as redundant isolations — variation for its own sake, which the literature does not support (Baz-Valle 2019; Kassiano 2022).

**Engine:** `apps/web/src/lib/planner/accessory-picker.ts` now scores recency as a **value-weighted** penalty. `movementValueNorm(m) = (2·isCompound + 1·isLoadable) / 3` ∈ [0,1]: compound+loadable = `1.0` (sticky staple), compound-only = `0.67`, loadable-only = `0.33`, isolation = `0`. A movement used in the previous block for the same day-role gets `ROTATION_BASE · (1 − value)` added (`ROTATION_BASE = 40`), and every candidate gets a `−ACCESSORY_VALUE_BONUS · value` selection bias (`ACCESSORY_VALUE_BONUS = 8`, kept `< ROTATION_BASE` so it never overrides region/limitation filters or the structural phase order). Net effect: a recently-used staple scores `−8` (kept), a recently-used isolation scores `+40` (rotated). The same gated formula is mirrored in `findPowerCandidate` and in `power-emphasis-transform.ts`'s `score()`, so all three picker scoring sites agree. Value model is **compound + loadable only** — the seeded-dead `stim_to_fatigue_score` (SFR) column was deliberately not revived.

**Parity guard:** the *entire* ADR-0012 computation is gated on `recentlyUsedMovementIds.size > 0`. With an empty recency set the feature is fully inert, so a user's first-ever block (and any path that doesn't pass recency) is byte-identical to the pre-ADR-0012 picker.

**History source:** `apps/web/src/lib/planner/accessory-history-queries.ts` → `getPreviousBlockAccessoryIdsByRole(supabase, userId)` returns `Map<role, Set<movementId>>` for the user's most-recent block (`accessory` + `power_potentiation` kinds, grouped by `planned_sessions.role`). Read-only, user-scoped (RLS client, never service-role), fails open to an empty map when there's no prior block.

**Plumbing:** `actions.ts` plumbs `movements.body_weight_loaded` onto the `DbMovement` type → `toCatalogMovement.isLoadable` → the `createBlock` catalog SELECT. In `createBlock` the recency map is computed **before** the prior block is archived (so "most recent" is genuinely the previous block) and only when the archetype declares an `accessoryProfile`; it's threaded per day-role into `assemblePrescriptionItems` and on into both the accessory-picker and power-primer filters. `createCustomBlock` passes `catalog: undefined` → the dynamic picker is skipped → recency is inert for custom blocks.

**Constants flagged:** `ROTATION_BASE = 40`, `ACCESSORY_VALUE_BONUS = 8`, and the `ACCESSORY_VALUE_WEIGHTS {compound:2, loadable:1}` / `ACCESSORY_VALUE_MAX = 3` weighting are all `// heuristic CP-1` (CP-2 row #40). Per-block (not per-session) variation is MODERATE-confidence; the magnitudes and the compound+loadable value model are Stage-A heuristics.

### Within-block volume autoregulation (ADR 0013)

**Problem:** the ceiling (§7) *measured* when a user was over budget but the engine never *acted* on it — the over/way-over signal was display-only. A world-class coach trims discretionary work mid-week when fatigue is outrunning the plan.

**Engine:** `apps/web/src/lib/planner/autoreg-volume.ts` adds a reversible read-time scalar `prescription.autoregVolumeScale`. When this week's **strength** ceiling band is `over` (110–130%) or `way-over` (≥130%), the engine offers to stamp the band's scale (`AUTOREG_VOLUME_SCALE_OVER = 0.8`, `AUTOREG_VOLUME_SCALE_WAYOVER = 0.66`) onto the user's remaining **un-started current-week** sessions. `applyAutoregVolumeScale` then trims discretionary items (`accessory`/`tendon`/`power_potentiation`) to `round(d · scale)`, slicing from the END of the discretionary subsequence — mirroring the `strengthVolumeScale` deload shape but confined to discretionary kinds. Mains, back-off, warm-ups, and all cardio are never touched.

**Read seams:** the scalar is applied at the two points that turn a stored prescription into what the user sees / logs — `fillSessionFromPlan` (`lib/sessions/actions.ts`, the verbatim-copy into `set_logs`) and the planner display readers `getPlannedDays` / `getPlannedSessionById` (`lib/planner/queries.ts`) — so the trimmed view always matches what gets logged.

**Offer/accept:** `lib/planner/autoreg-offer.ts:getVolumeAutoregOffer` (read-only) surfaces the banner on the active-block plan page; `autoreg-actions.ts:acceptVolumeAutoreg` re-derives the band + scale server-side (never trusts the client) and writes the field via `applyPrescriptionUpdates` (user-scoped, re-asserts the un-started predicate per row). Accepting is reversible: clearing the field restores the full prescription.

**Parity guard:** absent / `>= 1` ⇒ `applyAutoregVolumeScale` returns the input unchanged, so every legacy prescription is byte-identical. The offer naturally fires once per current week (once accepted, the rows carry the field and stop qualifying).

**Constants flagged:** `0.8 / 0.66` are `// heuristic CP-5` / LOW confidence (CP-2 row #41) — no study quantifies the optimal within-block trim fraction; they're anchored to the deload-scale family but gentler. The *mechanism* (act on the ceiling, don't just display it) is sound.

### Mid-block limitation response (ADR 0014)

**Problem:** blocks are materialized eagerly at creation, so a limitation added/edited *mid-block* couldn't reach the already-frozen future sessions — they kept loading the newly-flagged tissue. Also, `limitations.affected_movement_ids` was captured by the table but `readLimitationsContext`'s SELECT never read it, so per-movement flags were silently ignored even at generation (latent bug).

**Engine:** `apps/web/src/lib/limitations/response.ts:buildLimitationResponse` (pure) scans the active block's un-started sessions and classifies each item against the limitation context (region / muscle / movement membership, reusing the now-exported `loadsBlockedRegion` / `loadsBlockedMuscle` picker predicates plus `blockedMovementIds`). Discretionary offenders (`accessory`/`tendon`/`power_potentiation`) are **swapped** for a limitation-safe same-target movement (`deriveReplacement` — shared non-blocked primary muscles ×3 + bulletproof roles ×2 + functional roles ×1 + compound/loadable bonuses, ties on id; never re-introduces a blocked region/muscle/id or a movement already in the session) or **dropped** when no safe like-for-like exists. Main-lift / back-off / warm-up offenders are **warn-only** — load/ROM/grip on a primary lift is a clinician call, never auto-rewritten.

**Bug fix + new field:** `lib/planner/limitations-context.ts` now reads `affected_movement_ids` and exposes it as `blockedMovementIds` (unconditional — the allow-list does NOT bypass it; if the user flagged that exact movement, it's dropped). Plumbed into the accessory picker (`findCandidate` / `findPowerCandidate`) and power-emphasis primer so it applies at generation too.

**Offer/accept:** `lib/limitations/offer.ts:getLimitationResponseOffer` (read-only) surfaces the banner on the active-block plan page; `lib/limitations/actions.ts:applyLimitationResponse` re-derives the plan server-side and persists swaps/drops via `applyPrescriptionUpdates`. Swaps preserve sets × reps and all effort cues — only the movement identity changes.

**Shared catalog:** `lib/planner/picker-catalog.ts` (`loadPickerCatalog` + `toCatalogMovement` + `CATALOG_SELECT`) is the single catalog loader, de-duplicating the copy that previously lived inside `createBlock`.

**Parity guard:** no active limitations ⇒ `buildLimitationResponse` returns an empty plan; the offer/accept paths short-circuit. Framing is **load management, not medical care** — the UI carries a clinician pointer and uses no program names. No new numeric constants (CP-2 row #42 documents the rule-based remediation + scoring weights).


