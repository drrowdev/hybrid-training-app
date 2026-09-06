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

The current PR802 continuation authorizes disposable localhost services on the
cloud runner only, not hosted credentials. Reference-stack acceptance remains
blocked; see the latest result below. Do not treat mocked tests, static browser
previews or the earlier hand-built stack as reference-platform, concurrency or
mobile/offline release proof. Never use production/rehearsal databases or
generic app-credential fallbacks for seeded tests. Production was not migrated.

New setup uses `POOL_SWIMMING_ENABLED=true` plus the installed schema capability.
Existing swim history and queued finishes remain available when setup is off.
The swim knowledge page lists the dedicated-test variables and catalog
prerequisites. The feature must remain gated until real acceptance passes.

Local work includes domain/engine and web regressions, four package typechecks,
the web production build, and static mobile/desktop previews. These do not
replace the pending authenticated database and browser acceptance.

**Last updated:** 2026-09-06 (prearmed reference diagnosis; acceptance still blocked)

### Latest PR802 runner-local reference acceptance

Executed [reviewed plan 5559384497](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5559384497)
at `ebe4a672a13b86f7490acd7c001463c45a6d31ea`; the UTF-8 API body, preserving
CRLF, matched SHA-256 `77d7312444d6f58572a56e1214f1d05017033f8a16108ceeb618a2d1904a2bb6`.
One official CLI 2.116.0 default-service `start --debug --network-id` ran
13:08:37.300–13:09:41.583 UTC, **exit 1 after 64.28 seconds; zero retries**.
Storage bootstrap again reported
`getaddrinfo EAI_AGAIN supabase_db_pr802-34034907387-reference`.
Postgres 17.6 reached readiness; Realtime exited 0, Storage 1. No application
migration or seed was configured for initialization. This is a platform-bootstrap
failure, not application SQL evidence or diagnosis of the historical stale-update hang.

New discriminating evidence, rather than another unobserved attempt:

| Frozen hypothesis | Observation and limit |
| --- | --- |
| H1: missing advertised DB name | Contradicted at captured bootstrap times. DB `DNSNames` included `supabase_db_pr802-34034907387-reference`, `db`, `db.supabase.internal`, and its short container ID. Healthy DB snapshots at 13:09:35.473, 37.484 and 39.498 retained that metadata during Storage execution. Advertisement is not proof of a successful lookup. |
| H2: different network or early DB disconnect | Contradicted by captured lifecycle/attachment evidence. DB connected at 13:09:20.767, Storage at 13:09:34.641, on the same exact network. Storage exited 1 at 13:09:40.274; DB disconnected afterward at 13:09:40.405. No intervening DB disconnect was recorded. |
| H3: differing runtime resolver behavior despite correct metadata | Unresolved. Read-only archive API captured all three generated resolver files: byte-identical, `nameserver 127.0.0.11`, options `edns0 trust-ad ndots:0`. HostConfig DNS overrides were empty. Realtime exit 0 does not establish a successful DB connection; neither matching files nor endpoint metadata proves DNS forwarding or policy behavior. |

Both daemon event streams were armed before startup: exact project-label
container filter and a separate exact-network-ID filter. Retained 27 container
and 8 network events, plus event-driven/two-second snapshots. The network stream
also included its earlier create event; lifecycle evidence did not depend on a
post-failure history query. DB/Realtime logs and official debug stderr were
retained; Storage's separate container log was unavailable before auto-removal.
No discretionary DNS query, service diagnostic exec, sidecar or network override
was used. Official defaults supplied `host.docker.internal:host-gateway`; no
agent-added hosts/DNS flags were supplied.

Boundary/fidelity: local Docker 28.0.4, Ubuntu 24.04.4, Node 22.23.2 and pnpm
10.33.2; offline frozen install passed with the prior lockfile hash unchanged.
The CLI archive matched the previously pinned digest. Bridge
`pr802-34034907387-loopback`, ID
`0e10f31b49a5be1229a18605d26ccf21e38b0f392816f71bcef205a911b2a98f`,
had only the approved loopback option, default NAT, IPv6 disabled and initially
empty membership. All three observed containers attached only there; the sole
effective publication was `127.0.0.1:54322 -> 5432/tcp`. The unmodified CLI selected
`ghcr.io/supabase/postgres:17.6.1.165` (rather than the prior ECR reference), with
the same recorded digest `sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518`.
Realtime/Storage retained their prior ECR versions and digests. No registry
configuration changed. Full service/API readiness, roles/grants/Auth claims,
public reachability and egress-policy fidelity remain unestablished.

The **entire acceptance inventory below remains unmet**, unchanged from source
`c811a505d4a6b2b06f5d55f1b3b97753aa415cf1`. Before startup, at 13:07:46.493,
recorded all 30 unique expanded RPC names and the broader table; inventory hash
`2bcd0242f51f2a543e8a2add8ff48c7fe583f4d0812ec7a8f84512f8c9d0213c`.
Web-config before/after hash remains `06ec8efe0d66e896cbf9b906882a75fd9c9c1e201b0256710e2d1929f1b05c6d`.
**0/30 RPC cases executed; no application migrations/catalog, RPC validator/ledger,
mobile build/server, authenticated offline/concurrency or actual shared-load run.**
No stale-update request or lock snapshot was applicable. No criterion was waived.

Cleanup verified at 13:11:53 UTC, inside the 20-minute total bound: the official
CLI removed all three exact containers, the DB volume and labeled bridge.
Exact-ID/name checks and exact-label listings confirmed zero remnants.
The observer lingered closing streams after flushing the terminal lifecycle
events; only that exact observer process was stopped. No prune or unrelated
deletion occurred. Raw artifacts remain private outside git (700 directories,
600 files), redacted before reading; they are ephemeral, not durable attachments.
Only evidence documentation changed. No repair, alternate network method, next
task, combined implementation, merge or deployment was attempted in this pass.

### Earlier approved loopback reference attempt

Executed the [owner-approved plan](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5559175285)
under [the updated authority](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5559195573),
starting at exact source `c811a505d4a6b2b06f5d55f1b3b97753aa415cf1`.
Both API comment-body SHA-256 values matched the approved values. The same
PR/head/base were retained; no runtime, SQL, grant, dependency or workflow changed.

**Observed outcome: platform startup failed, not application migration failure.**
One official Supabase CLI 2.116.0 `start --debug --network-id` attempt ran from
12:31:15 to 12:32:53 UTC, exiting 1 after 98.79 seconds within the 20-minute
startup/diagnostic bound. No startup retry, service exclusion, health-check
override, replacement stack or network-policy change followed.
The terminal stdout reported `LegacyDbSetupError: error running container: exit 1`.
Retained stderr identified Storage bootstrap's Node process failing with
`getaddrinfo EAI_AGAIN supabase_db_pr802-c085dcdb-reference`.
Docker events confirm Storage exited 1; Realtime bootstrap and Postgres exited 0.
Postgres 17.6 had logged readiness before the failure. The mechanism behind the
container-name lookup failure (resolver, policy or transient failure) remains
unproven; this evidence does not diagnose the historical stale-update RPC.

Prerequisites and boundary evidence:

- Ubuntu 24.04.4, local `unix:///var/run/docker.sock`, Docker client/server
  28.0.4, Node 22.23.2 and pnpm 10.33.2 were verified on this runner.
  [Setup job 101486151083](https://github.com/drrowdev/hybrid-training-app/actions/runs/34033086318/job/101486151083)
  reports successful dependency and Chromium installation/launch steps; its
  running-job log endpoint returned 404, so the exact setup checkout command
  was not independently recovered.
- Offline frozen installation succeeded using the installed store. Repository
  and installed lockfile hashes both remained
  `5e495320c855704b2e065f0d7b4c95b22ed07c3b8ad0e390705573b9550f9130`.
  No ordinary online install was needed. No inherited database/Supabase target
  overrides, repository environment files or active config credential references
  were present.
- Official CLI archive digest:
  `5b3031cb297d51b25be4c284e4c852254460ec722ec221d3b81b07d55acfd158`.
  An initialization-only executable/directory name collision was corrected by
  separating `bin/` and `project/` before any service start. Generated defaults
  were retained except the unique project ID. Disposable migration paths were
  empty and the default seed file absent; none of the 146 application migrations
  was available to automatic platform initialization.
- Created exactly one task-labeled bridge, `pr802-c085dcdb-loopback`, ID
  `16a8eaad4c15bd2eac403a3c9fc94d25c3604cc108464aa23819c5e3ca2679e3`.
  Verified `host_binding_ipv4=127.0.0.1`, default NAT, IPv6 disabled and empty
  initial membership. No existing network/daemon/firewall/DNS configuration
  was changed. Docker's normal temporary bridge rules were within approval.
- All three containers recorded by project-labeled Docker lifecycle events
  were captured on that bridge alone: Postgres `17.6.1.165`, Realtime
  `v2.129.3`, Storage API `v1.70.3`. The sole captured published mapping was
  `127.0.0.1:54322 -> 5432/tcp`; neither bootstrap helper published a host port.
  Database-internal wildcard listeners are not host-published wildcard bindings.
  This is a partial startup manifest, not a healthy default-service manifest.
  The failed startup auto-removed containers before final live socket/API/DB
  verification; no full readiness, public-reachability or egress-fidelity claim
  is made.

**Acceptance inventory fixed before startup, all application criteria unmet.**
At the source SHA above, ADR 0079's delivery gates (lines 263–284), DC-SW1–SW9
and the swim wiki remain authoritative. The private pre-execution inventory
recorded every current RPC case name and these separate pass conditions:

The inventory was written at 12:30:34 UTC, before the 12:31:15 startup; its
SHA-256 is `a7846389c8030b34674139e01f52e5d3c087a84b6297b20f0af601db4253c6e8`.
The unchanged web config's before/after SHA-256 is
`06ec8efe0d66e896cbf9b906882a75fd9c9c1e201b0256710e2d1929f1b05c6d`.

| Required evidence | This pass |
| --- | --- |
| Exact native courses/whole lengths/timings; suitable verified assessment or effort/learning path (DC-SW1/2) | Unexecuted |
| Purpose-preserving scaling/slot budgets; fixed improving/plateau/missed-high-effort simulations; bounded no-catch-up progression (DC-SW3/4) | Unexecuted |
| Real benchmark/progression accept/reject/override, auditable versions, immutable started targets, stale/concurrent start/move/accept rejection (DC-SW5/8) | Unexecuted |
| Native analytics, compatible best efforts and generic history without inferred calibration (DC-SW6) | Unexecuted |
| Pause/resume/finish/archive/replacement, archived offline finish, trash/undo/purge and unchanged primary prescriptions (DC-SW7) | Unexecuted |
| All 30 source RPC cases, authenticated ownership/isolation, atomic receipt/summary, same/new-UUID replay, export/account deletion (DC-SW8) | **0 executed; all 30 blocked**, not passed or skipped acceptance |
| Both existing mobile cases plus real persistence/reload/scaling, durable FIFO offline reload/replay and two-context server-canonical isolation | **0 executed; both blocked**; authored cases alone do not cover all obligations |
| Actual `region_state` effects once across finish/replay/edit/trash/undo, stroke/equipment regions, generic history and new limitations (DC-SW9) | Unexecuted; action `ok` would not prove recomputation |
| Healthy official services, unchanged 146 migrations/catalog, roles/grants/Auth claims, fresh successful canonical RPC ledger | Blocked before application migration; no RPC report/validator or mobile build/server invoked |

No pure test, typecheck or lint result from an earlier pass is counted as fresh
acceptance here. The web config and 20-second test/hook limits stayed unchanged.
No SQL/REST stale-update diagnostic or activity/lock snapshot was applicable:
the RPC suite was never reached.

Raw stdout/stderr, incremental container/database logs, image digests, config
metadata and lifecycle events were retained outside git in a mode-700 ephemeral
directory with mode-600 evidence files, scrubbed before inspection/publication.
These temporary paths are not durable artifacts. The official CLI removed the
three recorded containers and database volume; the exact empty task bridge was
then removed. Final checks found **zero task containers, volumes or networks**
and no relevant host listeners. No prune, unrelated deletion or process-name
kill was used. No further task, combined work, merge or deployment was initiated.
The coordinator can review the concrete startup evidence; the failed method
does not authorize an alternate network method.

### Earlier 2026-09-06 acceptance report (non-reference stack)

Historical report, not independently reproduced in the latest continuation.
The 19/24 ledger is incomplete: three non-passing case identities are unknown.
It does not establish official platform fidelity or standalone readiness.

Ran in a GitHub-hosted cloud sandbox with **no live/test cloud credentials** and
**no local-filesystem access**. Did not touch production, billing, or any hosted
Supabase project. Nothing here was merged; this is a follow-up PR against the
feature branch.

What actually ran, against real Postgres:

- Full migration chain (all 146 migrations, including `0145_standalone_pool_swimming.sql`)
  applied cleanly to a disposable, throwaway Postgres 17 container (official
  `supabase/postgres` image) started via plain `docker run` on the runner —
  **not** `supabase start` (see blocker below). Movement catalog seed ran
  successfully against it (333 movements, including `swim-easy`/`swim-intervals`).
- A minimal hand-built Auth (GoTrue) + REST (PostgREST) + reverse-proxy (nginx)
  stack was stood up manually, pointed at that same disposable Postgres, to
  emulate a single hosted-style Supabase URL. This let the actual
  `apps/web/src/lib/swim/__tests__/storage-rpc.smoke.test.ts` suite run for
  real against real RPC/Postgres for the first time (previously always skipped
  for lack of environment). Result: **19 of 24 tests passed** executing real
  SQL/RPC round trips (ownership, cross-user visibility, exact-once
  completion, pause/resume/archive, trash/undo/purge, limitations gating, etc.
  all verified against live Postgres, not text assertions).
- One genuine, 100%-reproducible **test bug** was found (not an app bug): the
  "enforces two-user visibility..." test expects a `23503` (foreign-key
  violation) from a cross-user `session_id` reassignment, but `swim_workouts`
  also has a plain `UNIQUE` constraint on `session_id` — since the target
  session already belongs to another workout, Postgres raises `23505` (unique
  violation) before the ownership FK is ever reached. The migration's
  constraints are correct and intentional; the test's expected error code for
  that specific fixture is unreachable. **Not fixed in this pass** — flagged
  here rather than silently reworking the assertion under time pressure.
- **New, reproducible finding, not resolved in this pass:** calling
  `swim_update_plan` twice in a row with the *same* (now-stale) arguments
  — the exact sequence the "appends decisions and issued versions atomically
  and rejects stale or started edits" test exercises to assert a `40001`
  (`serialization_failure`) rejection — reliably **hangs** rather than
  returning quickly, both under the manual gateway and via a minimal
  standalone Node/`@supabase/supabase-js` repro script that bypassed vitest
  entirely. All other calls in the same script (create/update/read) return in
  under 100 ms. Root cause remains unknown: database locks, transport retries
  and manual-platform effects are hypotheses, not findings. The
  RPC/E2E hosted-ref guards' new narrow **local-only test mode**
  (`SWIM_RPC_TEST_LOCAL=true` / `E2E_SWIM_LOCAL=1` +
  `SWIM_TEST_PROJECT_REF=local`, loopback-only, added this pass) is what made
  it possible to discover this at all — it is real, additive test-harness
  capability, not a workaround.
- Playwright `apps/web/e2e/swimming-mobile.spec.ts` (authenticated mobile
  browser scenarios) and `packages/db/integration-tests/{rls,region-ledger}.mjs`
  were **not** reached in this pass given the time spent stabilizing the
  manual Auth/REST gateway and root-causing the two findings above.
- **Blocker (environment, not code):** `supabase start`/the Supabase CLI's own
  compose-style stack could not be used because this sandbox's Docker
  embedded DNS resolver (127.0.0.11) does not resolve container names
  (confirmed via a minimal repro: two containers on a custom bridge network,
  `nslookup` returns `REFUSED`); the CLI's edge runtime also cannot reach
  `deno.land` (blocked domain here). Worked around with a hand-wired,
  IP-addressed set of standalone containers instead. This did not establish
  reference-platform fidelity and must not be repeated as acceptance.
- A narrow, additive fix was needed to run the movement-catalog seed
  (`packages/db/seeds/db-ssl.ts` + updated `packages/db/seeds/run.ts`): it
  only allows skipping TLS when `PGSSLMODE=disable` **and** `DATABASE_URL`'s
  host is loopback, preserving the existing hosted/`verify-full` behavior
  otherwise.
- **Standalone gate: not yet ready to declare green.** Schema/migration/seed
  layer and the majority (19/24) of RPC smoke coverage now have genuine
  Postgres-backed acceptance evidence for the first time. The two findings
  above (a test-fixture bug and a real suspected hang) and the not-yet-run
  Playwright/RLS-script suites remain open before that claim can be made.

### Earlier 2026-09-06 limited PR802 follow-up

Started at approved HEAD `53ebc46de0c5efbe8b050a5e29a9ee50f37440f7` on the
same PR/head/base branches. No SQL, schema, RLS, grants, workflow or runtime
swimming behavior changed.

- Local E2E fixture/app URLs now require identical normalized origins,
  including ports. Existing HTTP/loopback/URL restrictions remain.
- Split ownership/isolation into independent RPC cases. The session FK uses
  an unlinked Bob-owned ordinary session and requires `23503`; duplicate
  same-owner links separately require `23505`. Rejected writes must preserve
  links/state. These RPC assertions are **unexecuted**, not fixed-and-green.
- The [swim wiki](docs/knowledge/pool-swimming.md#per-case-rpc-report-on-the-disposable-local-reference-stack)
  documents the actual web Vitest config, unchanged 20-second test/hook
  limits, serial/no-retry JSON reporting and timeout/cleanup caveats.
- Pure guard validation: **108/108 passed** using the existing Vitest 2.1.9
  and web config. Frozen pnpm installation failed on checked-in
  `ms-feed-*.pkgs.visualstudio.com` tarball DNS resolution. Four exact
  lockfile-pinned native test-tool packages were installed only in `/tmp`
  to run those guards; no lockfile rewrite. Full web typecheck/lint remain
  dependency-blocked. In-repo docs drift and whitespace checks passed.
- RPC reporter verification with execution disabled failed before collection
  (`@supabase/supabase-js` unresolved): **0 cases collected, 1 failed suite**.
  All 30 current RPC cases remain unexecuted; none is counted as passing or
  skipped acceptance. The PR delivery comment carries the observed ledger.
- One official attempt: Ubuntu 24.04.4, Docker 28.0.4, Supabase CLI 2.116.0,
  default generated config in `/tmp`, five-minute outer bound. Image pulls
  encountered rate limits then completed; `supabase start` exited 1 during
  schema initialization and cleaned up its containers/network/volumes.
  The retained stderr ends at `Initialising schema...` / `Stopping containers...`;
  stdout was discarded to avoid recording credentials, so the terminal cause
  was not retained. Do not infer a confirmed DNS or SQL cause from this run.
  No retry, bypass, substitute stack or grant patch followed.
- No application migrations/catalog, JWT/REST/grant/Storage checks, stale-RPC
  direct SQL/REST/client comparison, mobile scenarios or actual load-ledger
  checks ran. The reference stack never became healthy. Further environment
  attempts need renewed authorization; any diagnosed SQL change needs an
  independently approved additive migration/rollback proposal.

Standalone acceptance remains blocked; PR802 remains draft. Combined swimming,
Garmin, production changes and merging are not authorized by this follow-up.

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