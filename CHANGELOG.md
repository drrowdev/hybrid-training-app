# Changelog

All notable changes to this project will be documented in this file.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Cycle covering PRs #178 → #222 (2026-05-26 → 2026-05-30). Doc refresh on
2026-05-30. The previous starting-point block is preserved below for history.

### Added (post-#215 wave)

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
