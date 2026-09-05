# HANDOFF.md

Current-state snapshot. Updated by whoever last touched the repo. Read this before resuming work.

## Standalone pool swimming - 2026-09-05 working branch

ADR 0079 authorizes additive swim storage and access-rule implementation, not a
production migration. This branch implements the standalone slice only. Swim
plans/workouts are independent of primary programs, blocks and seasons. Combined
swimming on a primary program's cardio-only slots is still pending.

Read [`docs/knowledge/pool-swimming.md`](docs/knowledge/pool-swimming.md) and
DC-SW1 through DC-SW9 before extending the track. The generator must continue to
accept explicit slot intents, including zero-slot weeks. Course-specific native
distance and millisecond results are authoritative; generic cardio summaries
exist for compatibility and shared workload only.

The dedicated Stockholm test is available, but its database/admin credentials
have not been supplied. Remote acceptance remains blocked; no database migration
or seeded remote test has run. Do not treat mocked migration/action tests or
local static browser previews as RLS, concurrency or mobile/offline release proof. Do not use
production or rehearsal databases, or generic app-credential fallbacks, to run
seeded tests. Production was not migrated.

New setup uses `POOL_SWIMMING_ENABLED=true` plus the installed schema capability.
Existing swim history and queued finishes remain available when setup is off.
The swim knowledge page lists the dedicated-test variables and catalog
prerequisites. The feature must remain gated until real acceptance passes.

Local work includes domain/engine and web regressions, four package typechecks,
the web production build, and static mobile/desktop previews. These do not
replace the pending authenticated database and browser acceptance.

**Last updated:** 2026-08-17 (Strava integration removal; migrations through 0129 — no new migration)

## Where we are

**Phase:** Production. Beyond Phase 1. The app (consumer brand **S×C**,
live at <https://getsxc.app>) is multi-user, has a full mobile UX and a
science-grounded prescription engine. Cardio is user-logged (manual entry
or linking an already-logged activity to a planned slot) — the Strava
integration was removed on 2026-08-17. **Programs, not archetypes:** the
user picks a program — 5/3/1, Tactical Barbell, Green Protocol, HYROX, or
**Hybrid** (the build-your-own concurrent generator) — via the program
wizard (ADR 0046 retired the five standalone archetypes; Hybrid is now
just one program among equals). The wizard owns block-scoped inputs
(training days/week, start date, per-program loadout + benchmarks).

**Live URLs:**

- Production: <https://getsxc.app>
- Health check: <https://getsxc.app/api/health>
- Login: <https://getsxc.app/login>
- App shell: `/app` (Today), `/app/plan`, `/app/sessions`,
  `/app/stats`, `/app/recovery` (Limitations live at
  `/app/recovery/injuries`), `/app/races`, `/app/profile`
- Settings hub: `/app/settings` — route tiles including
  `/app/settings/equipment`, `/app/settings/hr-zones`,
  `/app/settings/profile`, `/app/settings/events`,
  `/app/settings/preferences`, `/app/settings/training`, …
  (`/app/settings/integrations` was retired with its only integration)
- Privacy / Terms: `/privacy`, `/terms`

**External services:**

- GitHub: `drrowdev/hybrid-training-app`
- Vercel project: `prj_l1PzxaQIdTYgRSW0mlch95oxFiXo` on team
  `drrowdevs-projects`. Auto-deploys on push to `main`. Deployment
  Protection disabled.
- Supabase: project URL + keys in `apps/web/.env.local` (gitignored).
  Region `eu-west-1`. Schema currently at migration **0109** (110 files in
  `packages/db/drizzle/`).
- Strava: **removed 2026-08-17.** Strava now charges for API access and
  the owner will not subscribe, so the integration can never sync again.
  No OAuth app, webhook subscription or `STRAVA_*` env var is required or
  read anywhere. The `strava_connections` and `strava_event_log` tables
  are orphaned but intentionally **not dropped** — a drop migration is
  proposed and awaiting owner approval (see the 2026-08-17 entry in
  `docs/knowledge/log.md`). `strava_connections` still holds dead OAuth
  tokens, which is a standing privacy consideration.

## Since 2026-08-06 — Strava integration removal

- **Strava removed end-to-end (2026-08-17).** Ingestion (OAuth callback,
  webhook route, sync/import/match/write modules), every UI surface
  (settings page + Integrations sub-hub, connect/import components,
  sync pill, autofill banner, onboarding step, cmd-K entry) and the
  subscription CLI scripts are gone. Onboarding is now **5 steps**
  (Welcome → Profile → Equipment → Training maxes → Start training).
  HYROX completion is manual-only (the activity matcher was removed).
- **Three Strava-gated analytics cards deleted** by owner decision:
  HR zones, Pace PRs, Run-plan adherence (+ `lib/stats/pace-prs.ts`,
  `run-plan-adherence.ts`). `lib/stats/hr-zones.ts` **survives** — it is
  the shared HR-band math used by the Endurance progress card, the
  HR-zones settings page, cardio classification and cardio summaries.
- **General-purpose cardio logic relocated out of the integration
  folder** into `apps/web/src/lib/cardio/`: `classify-cardio.ts`
  (`cardioEslFromKind` drives cardio ESL; `classifyCardio` powers manual
  activity linking), `modality-region.ts` (`MODALITY_REGION` feeds the
  region ledger) and `hr-histogram.ts` (`zonesFromHistogram` re-buckets
  retained `hr_histogram` when HR bands change).
- **All Strava DB columns retained** — `cardio_logs.strava_activity_id`,
  `external_source`, `hr_histogram`, `hr_zones`, `inferred_kind`,
  `inferred_confidence` and `sessions.strava_activity_id`. This is the
  owner's real training history and `inferred_kind` still feeds ESL.
  No destructive migration was written.

## Since 2026-05-21 (last doc refresh)

~37 PRs (#178 → #222) merged. Grouped by theme; see `CHANGELOG.md` for
the bullet-level breakdown and `docs/knowledge/log.md` for the
chronological narrative.

- **AI and MCP retired (August 2026).** All chat controls, provider settings,
  API/MCP routes, SDKs, stored credentials, chat history, assistant memories,
  observability tables, and OAuth metadata were removed. Migration 0121
  performs the database cleanup.
- **Strava end-to-end.** Push-subscription webhook with idempotent
  dedup, single-activity sync, historical import, onboarding step,
  3-state autofill banner that locks the form after apply so the user
  only has to add RPE + finish.
- **Engine archetype rebalancing (ADRs 0004 + 0005 + 0006).** Endurance
  Focus gets a dual main lift; folding becomes frequency-aware;
  Strength + Hypertrophy anchors demoted so folding is symmetric at low
  weekly frequency.
- **Hybrid completion guard extracted** into a shared
  `sessionPrescribesStrength` helper used by every "did this session
  finish?" path (cardio log, Strava autofill, Strava finish, history
  import auto-link).
- **Mobile UX overhaul.** Scrollable plan calendar; MORE → settings;
  full-screen swipe-dismiss drawer; Today hero glance summary; preview
  workout route; cardio active-session rebuild (Mockup B); shared RPE
  button-grid picker; unified "+ Add to workout".
- **Quick workout entry on Today.** Inline dashed card + bottom-sheet
  picker + 3 server actions for off-plan / rest-day logging. PR #222
  follow-up swept Quick-cardio UX (inline duration chips, single
  `+ Add to workout`, edit page in min + min:sec/km, Strava-readonly
  + prescription-only edit views).
- **Settings reorg.** `/app/settings/integrations` is now Strava-only;
  plain-language HR-zone method labels; Cancel workout button on empty
  in-progress sessions.
- **Limitations v2 lifecycle.** Bilateral side + muscle-level filter +
  per-exercise allow + Today banner.
- **Taper + recovery lifecycle (ADR 0008 / PR #219).** Opt-in banners
  on Today; race check-in card the day after `event_date`;
  `prescription_modifications` table; engine applies active mods
  during `buildPrescription`. `computeRecoveryWindow` honors
  distance × modality × tier × priority per Hikida 1983 / Nieman 2007
  / Byrne 2002 / Newham 1983 / Dupuy 2018.
- **Focus muscle groups (PR #221).** User picks 0–2 muscles per block;
  substitution-with-cap bias keeps total session set count constant
  (per Schoenfeld 2017 + Israetel 2017 + Wernbom 2007); forearm tendon
  gate silently downgrades when elbow/forearm ATL spikes (Baar 2017 /
  Kongsgaard 2009).
- **Today hero unification (PR #220).** Hero card now renders
  `SessionPreviewBody variant="compact"` — same source of truth as
  the Preview page. `TodayHeroSummary` deleted. Quick workout card
  moved above This Week.
- **`.mailmap` contributor consolidation (PR #217).** GitHub
  contributors page collapses to drrowdev + Copilot.
- **Migrations 0069 → 0080 applied to prod:** AI plumbing, limitations
  v2 lifecycle, MCP tables, MCP consumed codes, drop `ai_opted_in`,
  `cardio_logs` finish-uniqueness, `strava_event_log` + payload
  columns, `prescription_modifications` + RLS-fix follow-up,
  `training_blocks.focus_muscles`, `profiles.effort_preference` (the
  ADR-0016 dial, 0080).

## Since 2026-05-30 — engine methodology + conservativeness hardening

A methodology review of the prescription engine produced ADRs 0007–0017
(see `docs/adr/` and the `[Unreleased]` CHANGELOG). Two threads:

- **Methodology ADRs 0007–0014.** Autoregulated AMRAP top set on
  strength/hybrid archetypes (0007); modality-aware taper/peaking (0008);
  real stream-based cardio time-in-zone + display/engine unification
  (0009); next-block periodization-sequencing nudge (0010); hypertrophy
  compound final-set RIR effort-anchor (0011); value-weighted accessory
  variation across blocks (0012); within-block volume autoregulation +
  mid-block limitation response (0013/0014).
- **Conservativeness review → bounded hardening (validated, not a
  rewrite).** A red-teamed review concluded the engine is sound but
  hypertrophy-conservative; fix was 5 bounded steps, all shipped:
  (1) a **golden-master harness** for `assemblePrescriptionItems`
  (`assemble-prescription.ts` extracted as a pure module, all branches
  pinned); (2) **ADR 0015** bounded early-set effort bump on the
  hypertrophy compound (no false RIR); (3) **ADR 0016** a user
  **effort/volume dial** (`profiles.effort_preference` low|standard|high,
  migration 0080) that scales compound effort + accessory volume,
  hypertrophy-only, `standard` byte-identical; (4) **taper/recovery now
  applies** to upcoming workouts on accept (read-time overlay, closes the
  ADR-0008 gap); (5) cosmetic `weekContext → weekAccessoryHistory` rename
  + an assembler ordering/mutation contract docblock.
- **Limitations authoring polish + Quick-workout mobile-native flow.**
  Searchable limitation movement list (the "+N more" dead-end fixed);
  Quick-Strength logging is now a single tap into a mobile-native picker;
  iOS-Safari sub-16px focus auto-zoom suppressed.
- **ADR 0017 — ranked cardio-modality preference.** Users pick which
  cardio forms get programmed, in priority order
  (`profiles.preferred_cardio_modalities text[]`, migration 0081), set in
  onboarding (Equipment step) + `/app/settings/training`. The planner
  substitutes the default running cardio for the top feasible modality at
  the same intensity (owned `equipment.cardio` + experience tier), else
  falls back to running. Selection-only, **load-neutral** (no CP-2 change),
  empty preference is byte-identical. New pure resolver
  `preferred-cardio-modality.ts` + catalog adapter `cardio-catalog.ts`.
- **Parked (await real user data):** dial magnitudes are CP-1 Stage-A
  heuristics; archetype refinements C (upper-body resumption), D (novice
  linear track), E (deload depth).

## Since 2026-05-31 — ADRs 0020–0050, S×C rebrand, cardio/HR fidelity

A large run of engine ADRs plus a consumer rebrand and a settings/cardio
polish cycle. See `CHANGELOG.md` `[Unreleased]` for the bullet-level
breakdown and `docs/adr/0020`–`0050` for decisions. Highlights:

- **Engine ADRs 0020–0045.** Secondary-focus volume/intensity tilt
  (0020/0021); accessory volume units + level (0022/0024); adaptive
  vs pre-generated posture (0023); intensity-aware interference (0025);
  antagonist-superset accessories (0026); aesthetic anti-redundancy +
  goal-weighted profile (0027/0028); quick-generate freshness (0029);
  deload cadence / skippable / coherent multimodal (0030/0031/0037);
  combined load-fatigue proxy (0032); Explain-this-workout AI (0033);
  durability + shoulder-stability + universal-pull floors
  (0034/0035/0036); cardio mesocycle progression + modality specificity
  (0038/0039); interference-aware accessory headroom (0040); HSR dose +
  loadable preference (0041); hinge dedup (0042); focus-subpattern
  diversity (0043); high-accessory-volume hypertrophy (0045).
- **ADR 0046 — archetypes retired, Hybrid is a program.** The five
  standalone archetypes were de-surfaced; the picker shows four live
  programs (5/3/1, TB, GP, Hybrid) + a dimmed HYROX "coming soon", all
  equal peers. Hybrid hardwires the concurrent generator.
- **ADR 0047/0048/0049/0050.** 5/3/1 assistance generation; TB optional
  accessory work; user-initiated deload week; **HYROX program** package
  (scaffolding → quick-generate).
- **S×C rebrand (#544).** App renamed to "S×C", lime → sage palette,
  brand SVGs/icons/splash regenerated; production domain `getsxc.app`.
- **Foreign-program experience gating + staples-first ranking (F1).**
  Assistance/accessory injectors gate foreign movements by an experience
  unlock-floor and rank staples-first (`experienceMin`), so niche
  variants (Meadows/Kroc/archer rows) drop out for advanced lifters.
  Selection-only, **loading-neutral** — a higher tier unlocks movements,
  never makes a session heavier (the Hybrid generator's ADR-0041
  loaded-variant preference is deliberately NOT ported).
- **Cardio / HR-zone fidelity cycle (#556–#564).** Strava history import
  now fetches per-second HR streams (true time-in-zone, not the leak
  model); a new band-independent `cardio_logs.hr_histogram` (migration
  0109) lets HR-zone edits re-bucket all past activities **locally** and
  refresh the region ledger with no Strava re-fetch; an activity-aware
  post-session summary card surfaces distance/HR/pace/time-in-zone for
  cardio. Extends ADR 0009 (see its 2026-06-16 addendum).
- **Settings review.** Removed redundant controls (training-days,
  Preferences→Strava link); de-jargoned HR-zone copy + fixed dropdown
  clipping; consolidated limitations onto `/app/recovery/injuries`
  (deleted the orphaned `/app/settings/limitations` route + its parallel
  toggle write path; added a "Quickly block a region" control).
- **Migrations 0082 → 0109 applied to prod.** Through `hr_histogram`
  (0109); includes HYROX station seeds (0107), experience-band tweaks
  (0108), and the ADR-0025–0045 schema additions.


## Verified live

- `pnpm --filter @hta/web exec vitest run` → **3945 / 3945 passing**
  (376 test files) as of the 2026-06-16 settings/cardio cycle.
- `pnpm --filter @hta/web build` → clean.
- `pnpm --filter @hta/web lint` → clean.
- `pnpm -r typecheck` → clean across all workspaces.
- `node packages/db/integration-tests/rls.mjs` → still green for the
  RLS contract; new tables (MCP, `strava_event_log`) carry RLS +
  service-role grants as per their migrations.
- `curl https://getsxc.app/api/health` returns
  `{"ok":true, ...}`.
- MCP `initialize` round-trip green from a Streamable HTTP client
  through the OAuth bridge.

## Open work / known gaps

- **Daily wellness check-in retired (ADR 0018).** The per-day
  fatigue/soreness/motivation check-in and its ceiling `recoveryMultiplier`
  were removed; the ceiling chain is now two-factor
  (`baseCeiling × confidenceBias`). `wellness` columns are kept for history
  + export, but no surface writes fresh daily fatigue/soreness. If a daily
  readiness signal returns, it should come from a low-friction source
  (e.g. passive HRV) and re-open CP-4 via a new ADR.
- **E2E RPC smoke tests are gated by the Supabase free-tier 2-project
  cap.** CI runs them against a disposable project; locally,
  contributors need to spin up their own or skip.
- **Dial magnitudes are CP-1 Stage-A heuristics (ADR 0016).** The
  ±1 set / +4 early-rep / ±1 RIR numbers in `effort-preference.ts` are
  directional, not data-calibrated — revisit once `effort_preference` ×
  outcome rows exist.
- **Wheelchair / Handcycle / Snowboard cardio modalities.** Explicit
  accessibility gap, deferred by owner choice. (Was previously scoped to
  the retired activity-import mapping; still unaddressed for manual
  logging.)
- **Orphaned `strava_connections` + `strava_event_log` tables.** Drop
  migration drafted but NOT applied — needs owner approval because it
  destroys user rows. `strava_connections` holds dead OAuth tokens.

## Sensitive files (never commit)

- `apps/web/.env.local` — Supabase URL + publishable key + service-role
  key + `DATABASE_URL` (transaction pooler) + `NEXT_PUBLIC_SITE_URL`.
  (The `STRAVA_*` credentials are no longer read by any code and can be
  deleted from local/Vercel envs.)
- `packages/db/.env.local` — `DATABASE_URL` (session pooler for
  migrations).

Both gitignored. `apps/web/.env.example` carries safe placeholders for
every required variable.

## Conventions reminder

- Every code commit AI assistants make includes the trailer:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
- Every change to wiki pages appends to `docs/knowledge/log.md`.
- Every new wiki page is added to `docs/knowledge/index.md`.
- Architectural decisions land as ADRs in `docs/adr/00NN-*.md`.
- **Engine constants + the live engine spec are mirrored in two places:**
  the in-repo `docs/knowledge/hybrid-training-design-constraints.md`
  (CP-2 table) + `hybrid-training-engine-live.md`, AND a private
  canonical workspace mirror. Any CP-2 / engine-live change must land in
  BOTH. `pnpm docs:check-drift` enforces it: CI runs the in-repo half
  (every Accepted ADR that adds a CP-2 row must be referenced in CP-2);
  the pre-push hook runs the full repo↔workspace coverage parity when
  `HTA_WORKSPACE_DOCS` points at the mirror dir.
- Migrations are append-only and numbered; never edit a committed one
  except for purely-additive idempotency tweaks
  (`ADD COLUMN IF NOT EXISTS`).