# HANDOFF.md

Current-state snapshot. Updated by whoever last touched the repo. Read this before resuming work.

**Last updated:** 2026-05-30 (post PR #222 — Quick workout UX sweep)

## Where we are

**Phase:** Production. Beyond Phase 1. The app is live, multi-user, has
a full mobile UX, end-to-end Strava integration (OAuth + webhook +
history import), a first AI surface (Explain v1) plus an MCP server for
external clients, and a rebalanced engine across all five archetypes.

**Live URLs:**

- Production: <https://hybrid-training-app-web.vercel.app>
- Health check: <https://hybrid-training-app-web.vercel.app/api/health>
- Login: <https://hybrid-training-app-web.vercel.app/login>
- App shell: `/app` (Today), `/app/plan`, `/app/sessions`,
  `/app/stats`, `/app/recovery`, `/app/races`, `/app/profile`
- Settings hub: `/app/settings` — 8 route tiles including
  `/app/settings/integrations` (Strava + AI), `/app/settings/equipment`,
  `/app/settings/zones`, `/app/settings/limitations`, …
- MCP endpoint: `/mcp` (Streamable HTTP, OAuth 2.1 bridge)
- Strava webhook: `/api/integrations/strava/webhook`
- Privacy / Terms: `/privacy`, `/terms`

**External services:**

- GitHub: `drrowdev/hybrid-training-app`
- Vercel project: `prj_l1PzxaQIdTYgRSW0mlch95oxFiXo` on team
  `drrowdevs-projects`. Auto-deploys on push to `main`. Deployment
  Protection disabled.
- Supabase: project URL + keys in `apps/web/.env.local` (gitignored).
  Region `eu-west-1`. Schema currently at migration 0079 (80 files in
  `packages/db/drizzle/`).
- Strava: app registered; one push-subscription per environment.
  Subscription ID is stored in `STRAVA_WEBHOOK_SUBSCRIPTION_ID` (env
  var; not committed). The webhook handler rejects events whose
  `subscription_id` doesn't match. Re-subscribe with
  `pnpm --filter @hta/web run strava:subscribe`; list with
  `pnpm --filter @hta/web run strava:list-subscriptions`.
- AI providers (BYOAI): user-supplied keys for Anthropic / OpenAI /
  Gemini stored in the pgcrypto vault keyed by `AI_KEY_ENCRYPTION_KEY`.
  MCP bearer tokens + auth codes signed by `MCP_TOKEN_SIGNING_KEY`
  (HMAC, ≥ 32 chars).

## Since 2026-05-21 (last doc refresh)

~37 PRs (#178 → #222) merged. Grouped by theme; see `CHANGELOG.md` for
the bullet-level breakdown and `docs/knowledge/log.md` for the
chronological narrative.

- **AI architecture landed (ADRs 0002 + 0003).** BYOAI in-app chat with
  Anthropic / OpenAI / Gemini providers; MCP server at `/mcp` with
  OAuth 2.1 bridge; 8-tool catalogue shared by chat + MCP; orchestrator
  v2 routes the in-app chat through the same tools.
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
- **Settings reorg.** `/app/settings/integrations` sub-hub (Strava +
  AI consolidated); plain-language HR-zone method labels; Cancel
  workout button on empty in-progress sessions; AI master opt-in
  switch dropped in favour of per-provider cards.
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
- **Migrations 0069 → 0079 applied to prod:** AI plumbing, limitations
  v2 lifecycle, MCP tables, MCP consumed codes, drop `ai_opted_in`,
  `cardio_logs` finish-uniqueness, `strava_event_log` + payload
  columns, `prescription_modifications` + RLS-fix follow-up,
  `training_blocks.focus_muscles`.

## Verified live

- `pnpm --filter @hta/web test --run` → **2650 / 2650 passing**
  as of merge of PR #222.
- `pnpm --filter @hta/web build` → clean.
- `pnpm --filter @hta/web lint` → clean.
- `pnpm -r typecheck` → clean across all workspaces.
- `node packages/db/integration-tests/rls.mjs` → still green for the
  RLS contract; new tables (MCP, `strava_event_log`) carry RLS +
  service-role grants as per their migrations.
- `curl https://hybrid-training-app-web.vercel.app/api/health` returns
  `{"ok":true, ...}`.
- Strava webhook reachable + verified end-to-end (webhook event →
  `strava_event_log` row → activity sync → autofill banner on the
  matched session).
- MCP `initialize` round-trip green from a Streamable HTTP client
  through the OAuth bridge.

## Open work / known gaps

- **Wellness scale validation has 0 rows of real-user data.** The
  scales (fatigue / soreness / motivation) shipped, but until enough
  user history accumulates, calibration of `recoveryMultiplier`
  weights is stuck on the prior.
- **E2E RPC smoke tests are gated by the Supabase free-tier 2-project
  cap.** CI runs them against a disposable project; locally,
  contributors need to spin up their own or skip.
- **AI roadmap parking lot.** Items #11 (Training Profile), #12
  (calendar view modes) — partially shipped under different PR
  numbers; the parking-lot file
  (`docs/knowledge/ai-roadmap.md`) should be re-audited next cycle.
- **Anti-abuse / cost controls on BYOAI.** Provider keys are user-
  supplied so usage cost lands on the user, but we still need per-user
  rate-limit telemetry on the orchestrator to surface runaway loops.

## Sensitive files (never commit)

- `apps/web/.env.local` — Supabase URL + publishable key + service-role
  key + `DATABASE_URL` (transaction pooler) + `NEXT_PUBLIC_SITE_URL` +
  `AI_KEY_ENCRYPTION_KEY` + `MCP_TOKEN_SIGNING_KEY` + Strava
  credentials (`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`,
  `STRAVA_WEBHOOK_VERIFY_TOKEN`, `STRAVA_WEBHOOK_CALLBACK_URL`,
  `STRAVA_WEBHOOK_SUBSCRIPTION_ID`).
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
- Migrations are append-only and numbered; never edit a committed one
  except for purely-additive idempotency tweaks
  (`ADD COLUMN IF NOT EXISTS`).
- No external program names anywhere in code, copy, or docs
  (DC-Q6 brand-purity).