# Changelog

All notable changes to this project will be documented in this file.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Cycle covering PRs #178 → #222 (2026-05-26 → 2026-05-30). Doc refresh on
2026-05-30. The previous starting-point block is preserved below for history.

### Added (antagonist-superset accessories, engine machinery — ADR 0026)

- **Pure pairing module + superset-aware duration estimate (P1 + P2 of ADR 0026).**
  Lays the foundation for antagonist supersets (e.g. biceps curl + triceps pushdown
  rested once per round instead of twice) without changing any behavior yet. New
  `lib/planner/antagonist-pairs.ts`: an anatomical reciprocal-antagonist classifier
  (elbow flex/ext, knee ext/flex, horizontal push/pull, ankle plantar/dorsi — true
  isolation antagonists only) plus a pure post-selection pass that tags paired
  accessories via `meta.supersetGroup`/`meta.supersetSlot` and pulls each A2 partner
  adjacent to its A1 (A1 keeps its priority slot). `estimateSessionSeconds` gains a
  meta-gated branch that prices a valid pair as one overlapped rest + a short station
  switch per round (`SUPERSET_TRANSITION_SEC = 15`, a tagged CP-1 heuristic), saving
  ~75 s/round; a "widowed" member whose partner was trimmed (ADR 0013 autoreg slice)
  is priced solo. **No behavior change:** pairing is unwired (lands at P4 behind a
  default-off preference), and with no superset meta present the estimator reduces to
  its exact legacy per-item computation — byte-identical, full suite green.

### Added (intensity-aware concurrent interference — ADR 0025)

- **The concurrent-cardio volume pull-back on the Stats chart is now
  intensity-aware.** Previously the muscle-volume "concurrent" modifier weighted
  cardio by *modality* only, so a week of easy Z2 miles and a week of the same
  duration in VO2/threshold intervals compressed your displayed volume targets
  identically. The interference contribution of each logged cardio block is now
  additionally weighted by a time-in-zone intensity multiplier, anchored at the
  Z2 reference: Z2 → ×1.0 (unchanged), threshold/VO2 → a premium, recovery-zone →
  a discount. The premium is per-minute and hard sessions are short, so long easy
  volume stays the dominant interference source. **Stats/display only** — this
  does not touch `buildPrescription` or the ceiling chain (CP-4: no
  `interference_modifier` is introduced). Only objective `hr_zones` data earns an
  adjustment; RPE-only and no-data blocks fall back to ×1.0, so every user without
  HR-zone data sees **byte-identical** output and all continuity pins hold. Reuses
  the existing `ZONE_INTENSITY_WEIGHTS` (ADR 0009) — no new intensity constants.
  New per-block entry point `computeConcurrentScalarFromBlocks` +
  `cardioBlocksFromLogs` builder; the modality-record `computeConcurrentScalar`
  stays as an intensity-blind back-compat wrapper.

### Added (tendon-floor guarantee — ADR 0024 addendum)

- **The weekly connective-tissue floor is now an enforced, tested invariant.**
  Guarantees every generated week ships the DC-O4 tissue-stack floor (heavy
  isometric, HSR, plyometric, 2× carry) for every archetype × frequency ×
  accessory-volume level × week — so the Low/Med/High lever (or any future
  engine change) can never silently drop below it. The accessory picker already
  filled the durability floor first, so this is mostly a lock-in: a full-matrix
  gap map found exactly one real gap — beginner/novice onboarding-ramp weeks
  dropping the 2nd weekly carry on maintenance — because the ramp shrank the
  per-session budget. Fixed by giving the picker **two caps**: a total ceiling
  that holds a floor/functional reserve **outside** the onboarding ramp, plus a
  separate aesthetic-only cap (`aestheticMaxItems`) that keeps the original
  ramped hypertrophy budget so the reserve can't leak into extra accessory
  volume. **Byte-identical** for every non-beginner prescription (ramp = 1.0);
  golden master unchanged. New pure module `lib/planner/tendon-floor.ts`
  (`contextualFloor` / `countFloorRoles` / `checkTendonFloor`, with plyometrics
  correctly suppressed for tendinopathy + beginner/novice) and a cross-archetype
  invariant test drive the production week path to assert the floor every week.
  Equipment-impossible floors (e.g. bodyweight-only, no loaded carry) remain the
  honest residual covered by the existing runtime tissue-stack warning.

### Added (accessory volume — live estimates + recommendation, ADR 0024 addendum)

- **Accessory-volume control now shows on every plan + recommends a level.**
  Follow-up to ADR 0024. The Step 4 control is no longer hidden on cardio-led /
  rebuild / maintenance plans — it renders on **every** priority combination so
  the setting never silently disappears. Each level (Low / Medium / High) now
  carries a **live ballpark time estimate** for one strength workout, computed by
  a new read-only preview action (`estimateAccessoryVolumeMinutes`) that reuses
  the exact engine path — `assemblePrescriptionItems` + `estimateSessionMinutes`
  (the same set-aware estimator the ADR 0020 duration governor uses) — so the
  number the user sees equals what the engine budgets to (High already reflects
  the governor trim). The wizard **pre-selects an engine-recommended level** with
  a one-line reason (strength→Medium, hypertrophy→High, concurrent→Medium,
  endurance/rebuild→Low; a `muscle` secondary bumps up one level), advisory only —
  the reducer never stomps a level the user picked. Archetypes whose accessory
  base is already minimal (endurance / rebuild) show an honest "Low = Medium here,
  High adds the extra work" note; Maintenance (zero accessories) shows the control
  **disabled** with an explanation rather than hidden. Zero engine-regression
  risk: no edits to `createBlock`, the assembler, or the engine — the estimate is
  a separate read-only path and the DB default stays `medium` (byte-identical
  guarantee preserved).

### Added (accessory volume level — ADR 0024)

- **Per-block accessory-volume control (Low / Medium / High).** A new
  block-wizard lever (Step 4 · Review) lets the user dial how much
  *accessory* work a strength day carries, deliberately split from the
  ADR 0016 effort axis — Low trims volume without softening how hard the
  remaining sets are (heavy compounds + AMRAP top sets stay). `Medium` is
  the default and is **byte-identical** to the pre-feature prescription on
  every archetype (migration 0083 backfills `training_blocks.accessory_volume`
  to `'medium'`, and the golden master + every ADR 0011/0015/0016/0020/0022
  pin stays green). `Low` trims exactly one aesthetic accessory movement
  (breadth, not depth — the kept movements keep their full set count, and the
  durability/functional floor is untouched); `High` adds one movement plus one
  set per movement, bounded by the ADR 0020 session-duration governor. The
  control composes additively with the secondary-focus tilt at the same
  assembler site, is floored against each archetype's own accessory profile
  (a no-op on cardio-led / rebuild / maintenance blocks, which are already at
  their accessory floor — the wizard hides the control there to avoid a dead
  knob), and only ever moves aesthetic accessories: main lifts, cardio,
  durability and functional work are identical across all three levels.
  Magnitudes are CP-1 [DEF→cal] heuristics (Schoenfeld 2019 low-volume;
  Currier 2023; Baz-Valle 2022). Supersedes the ADR 0016 hypertrophy-only
  accessory VOLUME axis, which is retired (its EFFORT axis is unchanged).

### Added (stats page redesign — Direction C2, Phase 3 · drawers)

- **Endurance & Consistency tiles now open detail drawers, and the
  bottom deep-dive grid is demoted to a slim footer (Phase 3c).** The
  Endurance tile gains a "Detail →" drawer showing a weekly easy-pace
  sparkline (the per-week mean-pace series `classifyPaceSlope` already
  computed internally and discarded — now exposed as `weeklyPace[]`,
  display only), the easy/dropped run counts, and the **full
  time-in-zone breakdown** (absolute minutes per zone, the user's bpm
  band edges, polarised easy/threshold/hard split, activity count and
  whether the distribution is measured vs estimated) — far more than the
  tile's relative bars. The Consistency tile gains a drawer with a
  week-by-week rhythm list, current-streak / weekly-target / active-weeks
  / strength-to-cardio summary stats, and a deep link to the full
  Adherence dashboard. With every tile now interactive, the four
  prominent deep-dive **cards** at the page bottom collapse into a single
  low-emphasis "Full pages" text-link row (PRs · Engine · Blocks ·
  Adherence) — the full subpages stay reachable, just de-emphasised.
  No prescription path touched; all new surfaces are read-only history.

- **Recovery & load tile now opens an acute:chronic drilldown drawer.**
  The Recovery & load tile's header "Engine →" link is replaced by a
  "Detail →" affordance that opens a side drawer (same shared
  `BottomSheet` primitive). The drawer surfaces the readiness verdict +
  confidence ("N of 3 signals agree" / "building baseline"), the
  acute:chronic workload ratio on a 0–2.0 gauge with band threshold ticks
  (0.8 / 1.3 / 1.5) and a Gabbett-2016 sweet-spot legend, a cold-start
  notice when there is &lt;4 weeks of load history, and the three
  corroborating signals (load balance, sRPE drift, output trend) the
  readiness verdict is composed from. A footer states the readiness signal
  is **display only — it never feeds workout prescription** and deep-links
  to `/app/stats/engine` for the full internals. Reuses the existing
  `getReadiness` payload — no new query, no engine input.

- **Strength tile now opens an e1RM detail drawer.** The Strength
  progress tile gains a "Detail →" affordance that opens a side
  drawer (reusing the shared `BottomSheet` primitive — desktop
  right-panel / mobile bottom-sheet, Escape + backdrop + scroll-lock).
  Each main lift shows a `Sparkline` of its estimated-1RM trend, the
  kg/week slope + direction, session count and latest e1RM, and a "Full
  history →" deep link to `/app/stats/movements/{slug}`. The series is
  the **same** top-set-per-session e1RM data the tile's verdict is
  already fit over — `getStrengthProgress` computed it internally and
  previously discarded it; it now exposes `points[]` + `slug` per lift
  (display only, never an engine input). No prescription path touched.

### Changed (stats page redesign — Direction C2, Phase 2)

- **`/app/stats` is now a command-center bento.** The flat card grid is
  replaced by an answer-first hero band — **Progress** verdict ·
  **Readiness** composite · **Consistency** streak — over a six-tile
  bento (Strength progress · Endurance progress · Recovery & load ·
  Consistency rhythm · Bodyweight · Training volume). Endurance is now
  co-equal with strength rather than buried. Phase 1 (PR #226) shipped
  the five new tested query modules (`strength-progress`,
  `endurance-progress`, `progress-verdict`, `weekly-rhythm`, `streak`);
  this phase wires them into the new `StatsCommandCenter` client
  component and rewrites the `/app/stats` server page. The global range
  toggle (30d / 90d / all-time, URL-synced) is preserved.
- **Honesty posture (no hardcoded numbers).** Every value traces to a
  real query. There is deliberately **no "stress budget" meter** — the
  Recovery & load tile and the hero Readiness cell render the
  ACWR-grounded readiness composite (`readiness.ts`), not a fabricated
  budget percentage. The sixth tile is **Training volume** — weekly
  tonnage (Σ weight × reps, working sets only) from `getVolumeForRange`,
  range-aware like the rest of the bento. Cold-start states ("building" /
  "no run data") are honored rather than rendering misleading zeros.
- **Decision-trace card pulled from the overview (honesty fix).** The
  earlier "Why today looks like this" tile read as if the engine adapts
  the session day-of; in reality every workout + prescription is
  materialized at block creation (`createBlock` → one bulk
  `planned_sessions` insert) and `getDecisionTrace` only *describes* the
  fixed plan. Rather than reword a forward-looking card on a page whose
  job is retrospective overview + historical deep-dive, the tile is
  removed from `/app/stats` and replaced by the Training volume tile. The
  decision trace still lives on the **Engine internals** deep-dive
  (`/app/stats/engine`), an appropriate power-user surface;
  `getDecisionTrace` and its tests are untouched.
- **The 20-week training heatmap is removed from the overview.** Its
  `TrainingHeatmap` component + `training-heatmap-data` query are kept
  (with tests) for a potential Phase-3 drawer but no longer mount on the
  page. This **supersedes** the earlier Readiness-card placement note
  below ("between the current block strip and the training heatmap"):
  the readiness composite is now the hero's middle cell. The
  `calendar-heatmap` e2e spec is dropped and `stats-overview-desktop`
  is rewritten for the new bento.

### Removed (engine + UX simplification — ADR 0018)

- **Retired the daily wellness check-in and dropped the ceiling chain to
  two factors.** The per-day fatigue/soreness check-in (whose input card
  was already retired in PR #176) is gone end-to-end: the daily
  `recoveryMultiplier` engine path (`wellness-recovery.ts`) and its
  `/app/stats/wellness` view are deleted, and the global ceiling is now
  `finalCeiling = baseCeiling × confidenceBias` (was
  `× recoveryMultiplier ×`). Because no surface had written fresh daily
  fatigue/soreness since #176, that multiplier was a constant `1.0` for
  everyone — so the removal is **behaviour-neutral on every prescription**.
  The daily log is reduced to bodyweight only. **No DB migration:** the
  `wellness` table columns (`fatigue` / `soreness` / `motivation` /
  `notes`) are retained for history + data export, and
  `wellness.bodyweight_kg` stays a live feature. The per-session GRM
  (`grm.ts`, deload/advisory) is a separate, untouched signal. AI
  knowledge, both system prompts, `getEngineState`, glossary, cmd-k, and
  privacy copy updated to the two-factor chain. CP-4 updated from "stays
  at 3 factors" to "stays at 2 factors".

### Added (post-#215 wave)

- **Readiness composite stats card (ADR 0019).** A new body-wide
  "are you absorbing the work?" surface at the top of `/app/stats`
  (between the current block strip and the training heatmap). It
  combines three honest signals that were already collected as a side
  effect of normal logging — EWMA-ACWR over `region_state` (body-wide
  ΣATL / ΣCTL with `detraining / productive / pushing / spiking`
  bands), sRPE drift (`rising / stable / easing / no-data` from the
  existing 4-week-vs-4-week query), and PR cadence (recent 28d vs prior
  28d unique-movement count) — into a single verdict
  (`building / detraining / productive / pushing-tolerated / watch /
  overreaching`) with a confidence chip (`agree` when all three signals
  point the same way as the band, `mixed` otherwise, `building` below
  4 distinct ISO weeks of data). Banded acute:chronic gauge with
  triangle marker, expandable drill-down with scalar Fitness / Fatigue
  / Form, four signal cards, formula, and inline citations. **Hard
  constraint:** does NOT feed `buildPrescription` or
  `getCeilingExplain` — read-only stats overlay; CP-4 stays two-factor.
  Bands (0.8 / 1.3 / 1.5 — Williams 2017 / Gabbett 2016 lineage with
  Lolli 2019 / Impellizzeri 2020 critique) are tagged HEURISTIC / CP-1
  with per-user calibration deferred to v2. 30 new pure unit tests
  pin the band boundaries, cold-start gate, and verdict matrix.
  Doesn't measure autonomic recovery (no HRV, no sleep) — the card
  states this caveat verbatim. CP-2 row #45.

- **Hardened, versioned data export (`export-v1`).** The "Export my data
  (JSON)" download (Settings → Account) now covers **every** user-authored
  table — training maxes + their history, training blocks, planned sessions,
  off-plan session movements, races, AI memories + chat history, bodyweight
  progression, prescription edits, and engine overrides — not just the
  previous 8-table subset, making the GDPR Art. 15/20 "complete record"
  claim honest. Adds a `format_version: 1` integer with an additive-only
  stability contract, a self-describing `excluded` section (secrets +
  derived/recomputable tables are listed, never dumped), portable movement
  slugs on every movement-referencing row, a new `docs/export-format.md`
  contract doc, and a route test that fails CI if a covered table is dropped
  or a secret/derived table ever leaks in. Read-path only — no migration, no
  new write surface, no engine math.
- **Ranked cardio-modality preference (ADR 0017).** A new setting
  (Settings → Training → "Cardio types", also offered in onboarding)
  lets you pick which cardio forms the planner programs by default — in
  priority order — instead of always defaulting to running. The planner
  substitutes the prescribed running movement for your top feasible
  modality at the **same intensity** (gated by owned cardio equipment +
  experience tier); if no preferred modality has a movement of the
  needed intensity it falls back down your list and finally to running
  (the only modality with a full intensity ladder). Selection-only and
  **load-neutral** — a cardio session's training stress comes from its
  kind + duration + HR cap, so swapping the movement changes no engine
  math. Leaving the preference empty reproduces today's behaviour
  byte-for-byte. Stored in `profiles.preferred_cardio_modalities`
  (migration 0081).
- **Hypertrophy early-set effort bump (ADR 0015).** The earlier
  (non-final) compound sets of the hypertrophy archetype — previously
  ~RIR 6–10 junk volume — now get a bounded rep bump (`+2`, capped at
  12) and an honest "make it challenging" cue on non-deload weeks.
  Deliberately **no** RIR-3-4 label: inverting the Helms/Zourdos RPE
  chart shows literal RIR 3–4 at these light loads (54–67% 1RM) would
  mean ~12–15 reps/set — a volume explosion the default avoids. Loads,
  the ADR 0011 final-set anchor, the deload week, and folded
  secondaries are unchanged. True RIR 3–4 / higher volume becomes
  opt-in via the effort/volume dial (ADR 0016).

- **Effort & volume dial (ADR 0016).** A new profile setting (Settings →
  Profile → "Effort & volume": Easier / Balanced / Harder) lets you tune
  how hard and high-volume the hypertrophy archetype's muscle work is.
  One control moves two axes together — compound proximity-to-failure
  (the ADR 0015 early-set bump + the final-set RIR) and accessory
  sets-per-movement. "Balanced" is the default and reproduces today's
  plan exactly; "Harder" pushes toward the productive 10–12 sets/muscle
  range (but never to failure on a compound — RIR is floored at 1);
  "Easier" backs both off for fatigue-heavy phases. Hypertrophy-only and
  applied to your next created block; every other archetype is
  unchanged.

- **Quick workout UX sweep (PR #222).** Inline duration chip picker
  (30 / 45 / 60 / 90 / Custom) on the QuickWorkoutSheet replaces the
  30-min hardcoded default; single `+ Add to workout` button replaces
  the parallel `+ Add off-plan movement` regression; edit cardio page
  shows Duration in minutes and Pace in `M:SS/km` (or `/mi` per
  profile units) via a new shared `lib/cardio/units.ts` helper;
  context-aware edit page (prescription-only fields when no metrics
  logged, full fields after, read-only when Strava-synced); strength
  empty-state placeholder; "Edit cardio block" renamed to "Edit cardio
  session"; hybrid finish bar now says "Log at least 1 strength set
  to finish".
- **Today hero card uses `SessionPreviewBody` (PR #220).** New
  `variant="compact"` strips chrome, keeps the structured rows. Killed
  the bespoke `TodayHeroSummary` to eliminate alignment drift between
  hero and Preview. Dropped the "Preview workout" secondary link (now
  redundant) and the standalone `~N min` topline (duration lives in
  the structured row). Moved Quick workout card above This Week.
- **Focus muscle groups (PR #221).** Per-block aesthetic specialisation:
  user picks 0–2 muscles from a 12-group allowlist; engine applies a
  substitution-with-cap bias that pushes focus muscles toward
  concurrent-adjusted MAV while pulling non-focus muscles down to
  preserve total session set count (invariant pinned by tests).
  Includes a forearm tendon-gate that silently downgrades forearm
  volume when elbow/forearm regional ATL is elevated. Wizard Step 2
  chip multi-select + Plan-page edit modal + Today hero focus badge.
  Migration 0079 (`training_blocks.focus_muscles text[]` with size + 
  allowlist CHECK constraints).
- **Taper + post-race recovery lifecycle (PR #219).** Replaces the
  advisory taper card with an interactive opt-in banner on Today
  (Apply / Decline / Undo states), adds a `RaceCheckInCard` the day
  after `event_date` (raced / partial / skipped), and a
  `RecoveryBanner` with the same opt-in pattern. `computeRecoveryWindow`
  scales recovery duration by event distance × modality × user tier ×
  priority (running 5K/10K/HM/marathon/ultra anchors; cycling 0.5×;
  swim/row 0.35×). Engine integration applies active modifications in
  `buildPrescription` (taper / recovery / ramp scaling). Migrations
  0077 (`prescription_modifications` table) + 0078 (RLS policy fix
  caught by review).
- **Cardio hero card consistent for all kinds (PR #218).** Z2, tempo,
  alactic, and mixed sessions get the same hero treatment as VO2 (was
  bare HR cap line). New `cardioOneLinerForKind` short-form
  descriptions + kind-based Intensity fallback in `cardio-preview-rows`
  so the Intensity row is always emitted. Cross-kind regression test
  iterates every key in `CARDIO_DESCRIPTIONS`.
- **`.mailmap` contributor consolidation (PR #217).** Non-destructive
  remap collapses 11 historical author identities to drrowdev + Copilot
  on GitHub's contributors page.
- **Shared strength-prescription helper fully unified (PR #214).**
  `finishStravaAppliedSession` was the one remaining call site with an
  inline `session_items` count instead of `sessionPrescribesStrength`;
  external code review caught it. Now all 4 hybrid-completion guard
  paths consume the shared predicate.

### Migrations (post-#215)

- **0077** — `prescription_modifications` (taper + recovery audit table)
- **0078** — RLS policy fix for `prescription_modifications` (review-219 catch)
- **0079** — `training_blocks.focus_muscles text[]` with size + allowlist CHECK

### Added

- **AI architecture — Explain v1 + BYOAI (ADR 0002).** In-app chat surface
  (ChatFAB → drawer) backed by a pluggable `LlmProvider` (Anthropic /
  OpenAI / Gemini) with bring-your-own-key storage in a pgcrypto-encrypted
  vault. New `getEngineSnapshot` tool, eval fixtures, and observability
  scaffolding. User keys never leave the server vault; the orchestrator
  speaks to providers from the edge runtime. Migration 0069 (AI plumbing).
- **MCP server + 8-tool catalogue (ADR 0003).** Streamable HTTP MCP
  endpoint at `/mcp/[...mcp]/route.ts` with OAuth 2.1 authorization-code
  bridge, PKCE, scope gating, and a shared 8-tool catalogue used by both
  the in-app chat and external MCP clients. Authorization codes are
  single-use (`mcp_consumed_codes`), bearer tokens are HMAC-signed via
  `MCP_TOKEN_SIGNING_KEY`. Orchestrator v2 (PR #195) routes the in-app
  chat through the same tool catalogue. Migrations 0071, 0072.
- **Strava integration end-to-end.** Push-subscription webhook
  (`/api/integrations/strava/webhook`) with idempotent
  `strava_event_log` dedup, single-activity sync on create / update,
  full historical import, an onboarding step (second-to-last), and a
  3-state autofill banner on cardio sessions (suggested → applied →
  ready-to-finish). Manual `pnpm --filter @hta/web run strava:subscribe`
  registers the subscription once per environment. Migrations 0075, 0076.
- **Engine — archetype rebalancing.**
  - **ADR 0004:** Endurance Focus now prescribes a *dual* main lift
    (squat + hinge) post-Huiberts 2024; companion fix trims the
    Concurrent Hybrid template to match.
  - **ADR 0005:** frequency-aware dual-main-lift *folding* — when the
    weekly slot budget is tight, secondary main lifts fold into the
    primary day instead of being dropped.
  - **ADR 0006:** demote bench-press / overhead-press anchors in
    Strength + Hypertrophy archetypes so folding can balance low-
    frequency weeks symmetrically.
- **Hybrid completion guard.** Shared `sessionPrescribesStrength` helper
  prevents hybrid sessions from auto-completing on a cardio log alone.
  Adopted by `logCardioSession`, `applyStravaAutofill`,
  `finishStravaAppliedSession`, and the `importStravaHistory` auto-link
  path. Migration 0074 adds a `cardio_logs` finish-uniqueness
  constraint as a belt-and-braces backstop.
- **Mobile UX overhaul.**
  - Scrollable `/plan` calendar + mobile nav cleanup (#200), month-view
    prev/next + title (#201), MORE tab → settings + week-only plan
    view + full-screen swipe-dismiss drawer (#202).
  - Preview-workout route — secondary CTA shows session details rather
    than the whole plan (#203, #204).
  - Today hero at-a-glance summary, deduped HR cap, copy unified on
    "workout" (#206, #207).
  - Cardio session rebuild — in-session log form + descriptions +
    layout (#208), full active-session UX overhaul + Strava autofill
    wiring (#209), Mockup B + shared RPE button-grid picker + unified
    "+ Add to workout" affordance (#210).
- **Limitations v2 lifecycle (#189).** Bilateral side + muscle-level
  filter + per-exercise allow + event lifecycle (active / paused /
  resolved) + Today banner. Migration 0070.
- **Per-region load-spike warning banner on Today (#184).**
- **Beginner-only accessory volume ramp for the first 3 weeks (#183).**
- **Quick workout entry on Today (#213).** Inline dashed card + bottom-
  sheet picker + three server actions (`startQuickCardioSession`,
  `startQuickStrengthSession`, `repeatRecentSession`) for off-plan and
  rest-day logging without going through the planner.
- **Settings — Integrations sub-hub + cancel workout (#215).** Strava
  and AI consolidated under a single `/app/settings/integrations` hub;
  plain-language labels on the HR-zone method picker (%Max / %HRR /
  %LTHR); a Cancel workout button surfaces on empty in-progress
  sessions so abandoned starts no longer pile up in history.
- **HR-zone configuration (#161, #162, #172).** Three methods (%Max,
  %HRR, %LTHR) with editable percentages per method; cardio logs from
  Strava populate `hr_zones`; engine consumes HR-aware buckets and per-
  region load when zones are available (#167).
- **External cardio source plumbing (#159, #160).** Planner reserves
  cardio days and defers prescription when the external source is the
  ground truth; classifier infers cardio kind from HR + duration.

### Changed

- **AI settings UI.** Dropped the master opt-in switch in favour of
  collapsible MCP + BYOAI cards (#196); rewrote the key-storage
  disclaimer for end users (#190); added an inline `i` button explaining
  storage + privacy (#188); adopted the punchier "Bank-level encryption"
  framing (#191). Migration 0073 drops the legacy `profiles.ai_opted_in`
  column.
- **Engine — modality-aware concurrent-training scalar (Stage A,
  #181).** Continuous scalar replaces the prior discrete buckets.
- **Engine hygiene (#178, #180).** Consolidated actual-session-load
  reads onto a single helper; deduped `CARDIO_SCALAR`; tightened the
  alactic classifier; documented the recovery-scale split.
- **Daily wellness sliders feed `recoveryMultiplier` (#166).**
- **Effective stress load recomputed from logged sets + cardio (#165).**
- **Cardio-swap UX (#168, #158, #157).** Excludes unclassified
  movements from the intensity-matched picker; per-card swap; plain-
  language cardio protocols; larger disclosure arrows.
- **Wellness — retired the standalone daily check-in card on
  Today (#176)** now that the engine reads sliders directly.
- **Retroactive `performed_at` + late-logged adherence breakdown (#174).**
- **Plan overdue badge + always-today agenda cursor (#173).**
- **`/plan` polish (#205).** Remove block tooltip, add overdue count,
  unify history link styling.

### Fixed

- Use the shared strength-prescribed helper in
  `finishStravaAppliedSession` so a hybrid session whose strength block
  is unlogged can't be marked complete from a Strava finish (#214).
- Anchor adherence requires a logged anchor set and uses main-lift role
  names for the filter (#163, #164).
- Mobile preview-workout readability + truly hide the desktop plan
  timeline on mobile (#204).

### Security

- `MCP_TOKEN_SIGNING_KEY` (≥ 32 chars) is a hard runtime requirement on
  any deployment that exposes `/mcp/*`.
- Strava webhook handler validates `subscription_id` against
  `STRAVA_WEBHOOK_SUBSCRIPTION_ID` and dedupes on
  `(subscription_id, event_time, object_id, aspect_type)` via the
  `strava_event_log` unique index (0075, 0076).
- BYOAI key vault uses pgcrypto with `AI_KEY_ENCRYPTION_KEY` as the
  master key; vault RPCs scope every read/write to the calling
  `user_id` (defense in depth on top of RLS).
- Hybrid completion guard prevents a cardio log from prematurely
  marking a strength-bearing hybrid session as complete.

### Removed

- `profiles.ai_opted_in` (migration 0073) — replaced by per-provider
  configuration in the AI settings card.

### Migrations

0069 AI plumbing · 0070 limitations v2 lifecycle · 0071 MCP server
tables · 0072 MCP consumed authorization codes · 0073 drop
`profiles.ai_opted_in` · 0074 `cardio_logs` finish-uniqueness ·
0075 `strava_event_log` · 0076 `strava_event_log` payload columns.

---

### Added — Phase 1 starting point: movement catalog (commit pending)

- **0002_movement_metadata migration** applied live to Supabase: 22-value `muscle` enum (DC-T1 priorities), `axial_load` enum (DC-D3), `stability` enum (DC-O5), 7 new columns on `movements` (`primary_muscles`, `secondary_muscles`, `high_strain_tendon`, `axial_load`, `stability`, `bilateral`, `body_weight_loaded`). GIN indexes on muscle arrays for the aesthetics dashboard.
- **`packages/db/seeds/`**: 275-movement seed catalog organised into 3 files (strength patterns / isolation / cardio+plyo+olympic+tendon+cuff+drills), with category-helper builders for terse per-movement overrides. Includes 28 squat, 24 hinge, 24 press, 25 pull, 6 carry, 87 isolation, 38 cardio (cycling/running/rowing/sled/ruck/swim/etc.), 12 plyometric, 8 Olympic, 9 tendon-resilience (Baar isometric / Kongsgaard HSR / Alfredson eccentric protocols), 8 rotator-cuff, 6 run drills, 6 grip. 42 flagged `high_strain_tendon` for DC-J5 6h refractory.
- **Seed runner** (`pnpm --filter @hta/db db:seed`): idempotent upsert via `ON CONFLICT (user_id, slug) DO UPDATE`, with pre-flight sanity checks (no duplicate slugs, every non-carry movement has ≥ 1 primary muscle) and post-seed `\dt`-style verification by pattern.
- **Seed-shape Vitest suite** (`seeds/movements.test.ts`): 24/24 pass — uniqueness, region coverage, primary-muscle coverage per priority (every DC-T1 muscle has ≥ 3 movements), Olympic-implies-compound, cardio-has-interference-cost.

### Phase 0 → Phase 1 transition
Phase 0 closed (live at https://hybrid-training-app-web.vercel.app). Phase 1 movement-catalog foundation now in place. Next: `sessions` + `set_logs` + `cardio_logs` + `wellness` tables + the logging UI.
