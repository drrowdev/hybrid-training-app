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

The original twelve-case reference at exact `bb9aa524f3132ac392b963fc9166f2cc90acfcf3`
passed in run34339663834, completing 2026-09-09 at10:25:00Z. C2 app deletion and
C3 linked Auth deletion, owner integrity and survivor checks passed. This closes
the account-deletion blocker, not all standalone requirements or release.
PR805 now appends B3/B4/B5: fifteen-case source and collection are validated, but
the new cohort has **not executed**. This continuation is source-only; no hosted
resources/credentials or Auth changes. Production's OAuth reauthentication need
is unrelated to this work.
Do not treat mocked tests, static browser
previews or the earlier hand-built stack as reference-platform, concurrency or
mobile/offline release proof. Never use production/rehearsal databases or
generic app-credential fallbacks for seeded tests. Production was not migrated.

New setup uses `POOL_SWIMMING_ENABLED=true` plus the installed schema capability.
Existing swim history and queued finishes remain available when setup is off.
The swim knowledge page lists the dedicated-test variables and catalog
prerequisites. The feature must remain gated until real acceptance passes.

Local work includes domain/engine and web regressions, four package typechecks,
the web production build, and static mobile/desktop previews. These do not
replace the pending browser and full standalone acceptance.

**Last updated:** 2026-09-09 (bb9aa twelve-case milestone; fifteen-case source unrun)

### PR805 B3/B4/B5 — source/collection checkpoint, live fifteen-case acceptance pending

Continues exact `bb9aa524f3132ac392b963fc9166f2cc90acfcf3` on the existing
`copilot/new-acceptance-cases`, base `copilot/prepare-mobile-persistence-tests` at
`4f2aa4af480f61df83bbc38b09f29afbbbf5729b`. No branch/base/history change.

**Preserved measured milestone:** [run34339663834](https://github.com/drrowdev/hybrid-training-app/actions/runs/34339663834)
at exactbb9aa completed10:25:00Z SUCCESS. All original12 passed once, with zero
unexpected/skipped/flaky cases, measured total **63,937ms**. C2 real app deletion,
C3 linked Auth deletion, owner integrity and survivor checks passed.
Native16/normal149/catalog/Auth five phases/four DDL/fifteen contexts/all36HTTP/
core/main/final cleanup passed. Single-FK down/up, baseline23503/set-logs,
candidate Authdelete1 plus forced success, UPDATE23503/set-logs with row1 plus
forced checks, and every schema/fixture restoration passed. GitHub run metadata
confirms success; detailed evidence here is the coordinator's safe record, not
reread private logs. This supersedes the historical C2/C3 blockers below.

Code checkpoint `b29c9cc399e4db21341eea2dbf96969485a3105e`, tested tree
`c7e14f0b844f0faefd527f013479bbb5f880ef73`, adds actual decision-UI cases for
[DC-SW4/DC-SW5](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05)
and DC-K4, without changing B1/B2 or existing fixture/helper implementations:

- **B3:** both source swims completed at RPE7; literal HOLD12×2/rest25.
  Reject retains all issued/original work and actual history; exact audit and
  reload/re-review prove one rejection with no next-week application.
- **B4:** a genuinely unstarted past swim plus native partial18/35 lengths at
  RPE9; literal REDUCE11×2/rest25 (33 total lengths). The form accepts integer
  main repeats, so none lies between11 and12. Choose8×2/rest25 (27 total lengths):
  the nearest downward choice exceeding the seven-length advisory cap, producing
  the existing recorded/displayed warning without added catch-up. Canonical
  validation precedes the UI action; one started target remains frozen.
- **B5:** completed native source results retain null effort; literal
  HOLD12×2/rest25 (35 total lengths). UI Accept confirms only the eligible target,
  allowing canonical issue/revision/provisional metadata while freezing started
  work, original history and calibration. Reload/re-review cannot advance again.

Original12 identities/order are unchanged: C2index9, Dindex10, C3index11;
B3/B4/B5 append at12/13/14. Six files have counts2/2/2/5/3/1. The reader
regressions map grouped B/C results by exact file/describe/title, not flattened
position. Old4/6/8/11 and old12-only rejection, same-total missing-new-case
substitutions, attempts/skip/flaky/privacy and per-point annotation gates remain.
No main/workflow/stage/config/DB/identity/dependency/product change.

Validation in `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts` — **431 passed** (430 reader,1 collection).
- The collection test invokes installed Playwright**1.60.0** CLI `test --list --config=playwright.swim-reference.config.ts --project=mobile-chromium --reporter=json` in its existing isolated environment: **15 exact identities/six files/zero executed results/errors**, checked private cleanup.
- `pnpm --filter @hta/engine exec vitest run src/swimming.test.ts` — **55 passed**.
- `pnpm --filter @hta/web exec eslint e2e/swimming-decisions-offline-mobile.spec.ts scripts/swim-browser-acceptance.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts` — passed.
- `pnpm --filter @hta/web typecheck` and `git diff --check` — passed.
- `pnpm docs:check-drift` — in-repo checks passed; private workspace parity not run.

Secret scan passed. CodeQL classified the test/casebook-only change as trivial
and skipped analysis; not a full security-analysis pass. Explicit terminal
author/committer overrides and both AI trailers were verified locally; GitHub
remote metadata confirms both identities as Copilot223556219.

No SQL/Docker/browser execution, workflow dispatch, hosted access or additional
model/reviewer chain occurred. **Live fifteen-case reference remains pending**;
source/collection closes no standalone gate. Other lifecycle/analytics/scaling/
concurrency variants and release approval remain. Time limits are unchanged:
30s/case,300s browser global,330s command,590s phase,410s server,35m total with3m
cleanup,45m job. Fifteen nominal maxima exceed300s, as twelve did;63,937ms is
historical measurement, not a fit guarantee. A future over-budget run must fail,
not waive limits.

### PR805 reversible movement-reference candidate — historical source checkpoint before bb9aa acceptance

The pending statements in this section describe the earlier source checkpoint;
the twelve-case/down-up/account evidence above supersedes them.

Continues exact `0b3b7401ec2a485ee1ea1f0304d2d3e0f09544a8` on
`copilot/new-acceptance-cases`, without branch/base/history changes.
Latest coordinator-supplied safe evidence:
[run34336292485](https://github.com/drrowdev/hybrid-training-app/actions/runs/34336292485),
ended09:47:27Z, passed normal149/catalog/Native16/Auth5phase4DDL15contexts/all36HTTP/
core and durable initial/down/up. The first set-logs-only partial candidate
**succeeded**: Auth session/current role matched, exactly one Auth row deleted,
forced ALL checks completed, full schema restored and every generated fixture ID
absent after rollback. The two-FK necessity guard correctly stopped before the
second probe, UPDATE integrity and browser12. Main/final cleanup verified.
Safe14 records only; consumed raw logs were not reread and no unchanged-head
retry was dispatched. The qualification correction now yields valid evidence,
not unavailable. Structural success is not GoTrue equivalence or app acceptance.

Within the existing “up to two” disposable approval, the unmerged0148 up/down
files are narrowed in place to **only set_logs_movement_id_fkey**. Prior candidate
stacks were disposable and destroyed. Up changes RESTRICT/NOT DEFERRABLE to
NO ACTION/DEFERRABLE INITIALLY DEFERRED; down restores it. Both references are
guarded before mutation; session_movements must always retain its original
definition and OID. An unexpected two-deferred-FK schema fails, not normalizes.
All original148 SQL files, journal tags and total149 remain unchanged.

The existing helper and main call site remain. Initial candidate → exact down
file → original snapshot → exact up file → candidate snapshot remain durable.
Only the set_logs FK OID/mode bits are normalized; session_movements belongs in
full unchanged metadata. `bool_and(props.matched)` remains qualified.
Exactly two rollback controls replace the obsolete necessity modes:
`baseline` uses exact down SQL and requires23503/set-logs; `candidate` uses the
single-deferred schema and requires Auth-role success, one row and completed
forced ALL checks. Each uses the same intact synthetic graph with fresh IDs,
followed by fresh schema/fixture-absence verification even after disconnect.
No fallback, repair or compensation; one original snapshot remains authoritative.

The dedicated UPDATE-integrity assertion now mutates the generated set_logs row,
filtered by set/session/original-movement IDs, to the generated absent movement
ID. It requires one affected row and forced23503/set-logs plus verified rollback.
Setup failures, zero rows and incomplete results do not qualify.
C3's separate authenticated session_movements UPDATE remains the existing RLS
zero-row check. C2/C3, all twelve normal browser cases and the Auth cohort remain
unchanged. No role/grant/RLS/Auth callback, user-data or production change.

Source validation and final scan results are recorded in the latest
[knowledge log](docs/knowledge/log.md). Implementation checkpoint:
`11c94dedc0ea71e6cea44827db289c96e9904164` (parent is exact0b3b7401).
1175 targeted tests passed; final helper/main rerun524 passed. Lint, typecheck,
offline149, docs drift, diff and secret checks passed. CodeQL did not complete:
Actions analysis failed; JavaScript database too large. Not a security-analysis pass.
No live SQL, Docker, browser execution or
workflow dispatch by this worker. The coordinator owns the next exact-head
normal149/down/up/baseline/candidate/UPDATE/Auth36/browser12 run.
**Full acceptance and production approval remain pending.**

### PR805 two-FK candidate and SQL repair — historical, superseded

The following records the preceding source checkpoints, not the current scope.

Owner approved the reversible disposable candidate, at most two existing FKs.
[ADR 0080](docs/adr/0080-deferred-custom-movement-references.md) records scope,
timing audit, lock/validation/down guards and the required proof. Code/test
checkpoint: `24e10035d4a1f060369ef8384a5d0befc12b65e7`.

**Latest runtime evidence (coordinator-supplied safe record):**
[Run34333221283](https://github.com/drrowdev/hybrid-training-app/actions/runs/34333221283)
at exact `65050755d7160fc2a355736489a2ea249f99dc70`, ended09:14:26Z:
normal149 migrations/catalog, original Auth5phase4DDL15contexts/all36HTTP,
Native16 and core passed. Initial candidate snapshot, whole down file, original
snapshot, whole up file and restored candidate snapshot passed
(`initial/down/up=true`). First set-logs-only necessity returned the Node outer
catch's `unavailable/none/none/false/false/false` default, not a mapped SQL
exception; fresh schema restoration and fixture absence passed. No second
necessity, UPDATE integrity or browser case executed. Main/final cleanup verified.
Safe14 records retained; raw logs consumed once and discarded, not reread here.

**Source-proven collision and repair:** shared `catalog()` projected `matched`
and aggregated `bool_and(matched)` inside necessity `$guard$`/`$setup$` and
`$update_integrity$`, each declaring a PL/pgSQL `matched` variable.
[PG17 variable substitution](https://www.postgresql.org/docs/17/plpgsql-implementation.html#PLPGSQL-VAR-SUBST)
requires qualification or distinct naming at the default conflict setting.
The aggregate is now `bool_and(props.matched)` only. Ordinary snapshots have no
PL/pgSQL variable scope; durable up/down use a direct expression, explaining why
their passes did not validate these composed blocks. The first guard precedes
tuple capture, consistent with the catch default. Runtime SQLSTATE was not
observed; no claim that safe evidence reported42702. Variables, alias, predicates,
NULL/count semantics, fingerprints, tuples, query layout and callers are unchanged.

Repair code/test commit `28db9073897243d68ac3873e443bcec6e25c694a`, tested tree
`918154ca482ede5dc1a6cdc17c2b620b69861919`. Commands run from
`/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-movement-reference-roundtrip.test.ts src/lib/swim/__tests__/swim-acceptance.test.ts` — **498 passed** (92 durable-helper,406 main).
- `pnpm --filter @hta/web exec eslint scripts/swim-movement-reference-roundtrip.ts src/lib/swim/__tests__/swim-movement-reference-roundtrip.test.ts` — passed.
- `pnpm --filter @hta/web typecheck` — passed.

The focused regression covers both snapshots, both necessity strings and UPDATE
integrity, including retained `DECLARE matched` in all affected DO blocks.
All prior assertions remain. Secret/diff checks passed. CodeQL did not complete:
Actions analysis failed; JavaScript database too large, not a security-analysis pass.
Code/test saved before docs; author and committer explicitly Copilot223556219,
with required AI trailers. Only the helper/test and HANDOFF/pool-swimming/index/
append-only log change. No SQL, Docker, browser execution/collection or workflow
dispatch here; no unchanged-head rerun. The coordinator owns the next exact-head
live run. Necessity, UPDATE integrity, authenticated RLS denial and positive C2/C3
remain unproved. Disposable-only approval remains; no production change.

**Resolved verification mismatch:** migration0059 has no session_movements UPDATE policy.
Migration0063 grants UPDATE but documents that RLS blocks real updates; no later
migration supplies that policy. The requested authenticated C3 reference UPDATE
therefore cannot yield23503 at request end. The coordinator directed proof at
the actual layers without changing permissions: C3 retains four reachable23503
requests, then separately requires the owner UPDATE's no-error/empty returned
array with exact owned filters, fresh unchanged rows and no missing-parent
reference. The owned SQL helper separately requires an actual one-row UPDATE
and forced ALL rejection23503/session-movements on the current candidate.
No policy/grant/role, migration, real fixture or browser registry was changed.
This method was resolved by `65050755` without permission changes.
**Live UPDATE integrity, authenticated RLS denial and C2/C3 remain unrun.**

[Run34321670984](https://github.com/drrowdev/hybrid-training-app/actions/runs/34321670984)
at `1bb56`, ended07:03:52Z: prerequisites matched; baseline RESTRICT and immediate
NO ACTION both rejected23503/set-logs; both deferred references allowed exactly
one Auth deletion and forced ALL constraints. All three transactions rolled back,
schema and fixture absence verified. Native16/normal148/catalog/Auth5phase4DDL/
15contexts/all36HTTP/core/main/final cleanup passed. Intentional nonqualifying
stop only; original12 unrun. Both FKs changed together, so necessity of the
second FK remains unmeasured. This does not prove GoTrue/app success.

The source now appends migration0148 (normal total149), with exact guarded down
file; all original148 SQL files/entries remain. Identity levels146/147/148,
five phases/four files/fifteen contexts and checkAuthBoundary148 are unchanged.
The rollback-only switch/helper/test are removed, normal db:migrate and the
ordinary browser call restored. A new private-command stage durably down/ups
verified exact files, compares semantic target definitions despite fresh OIDs,
and demands both transactional one-FK necessity rejections plus fresh restoration/
absence checks. The separate `updateIntegrity` result reuses the four-ID fixture
builder in one ROLLBACK transaction, checks candidate metadata and the existing
reference, and verifies the generated set UUID is absent from movements.
Setup errors are not UPDATE evidence; row-count-one and forced-check flags are
mandatory. Fresh separate-connection schema/metadata/fixture-absence verification
is mandatory even on error/disconnect, without compensating deletes. A valid
not-attempted result is initialized before work; overall matched requires all
proofs. The two necessity modes remain exactly two and unchanged.
C3 adds authenticated request-boundary integrity assertions;
C2 and the twelve identities/six files remain.

Earlier GitHub source validation for the UPDATE/RLS correction commit
`123fd1765c8eee33f1e28bad4d622cc631836226`, tested tree
`f0ccfad5161a68c900fcb54c568c0c1bd1abed02` (commands from repository root):

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/storage-migration.test.ts src/lib/swim/__tests__/swim-movement-reference-roundtrip.test.ts src/lib/swim/__tests__/swim-acceptance.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-identity-roundtrip.test.ts src/lib/swim/__tests__/swim-rpc-diagnostics.test.ts` — **1148 passed**, including91 durable-helper tests.
- `pnpm --filter @hta/web typecheck` — passed.
- `pnpm --filter @hta/web exec eslint scripts/swim-movement-reference-roundtrip.ts src/lib/swim/__tests__/swim-movement-reference-roundtrip.test.ts e2e/swimming-account-mobile.spec.ts` — passed without warnings.
- `pnpm exec playwright test --config=playwright.swim-reference.config.ts --list`
  from `apps/web`, using `buildBrowserEnv`, nonfunctional synthetic JWTs and owned
  0700/0600 paths under `/tmp` — **12 identities / six files / zero executed results**.
  Exact collected identities compared to `SWIM_BROWSER_CASES`; no collection
  errors. Private report:
  `/tmp/swim-update-collection-Iwkwnj/swim-acceptance-pr802-34331599918-1/browser.json`.

Secret scan and diff checks passed for the code checkpoint. Author and committer
explicitly set and verified as `Copilot <223556219+Copilot@users.noreply.github.com>`
with both AI trailers; checkpoint saved unsigned. The three code/test paths are
`apps/web/e2e/swimming-account-mobile.spec.ts`,
`apps/web/scripts/swim-movement-reference-roundtrip.ts` and
`apps/web/src/lib/swim/__tests__/swim-movement-reference-roundtrip.test.ts`.
Only ADR0080, this HANDOFF, pool-swimming and the append-only log follow as docs.
No SQL, Docker/stack, browser execution or CI dispatch by this
source worker. At that checkpoint the live candidate was unrun; run34333221283
above now proves normal149/catalog/Auth36 and durable down/up, but not necessity,
UPDATE integrity, authenticated RLS denial or C2/C3. Production is separately
gated. No automatic extra model review chain.

### PR805 temporary rollback-only route — historical, superseded

The remainder of this section records earlier authorization and source states,
not current instructions. The candidate above supersedes the old mode and its
“no migration149” boundary; historical148 evidence remains unchanged.

Owner approved rollback-only checks, not a repair or migration149. Source
checkpoint `c74b5a3f4029f66d0c8c17558a129d476fe9f3db` (tested tree
`bbd5127fe57a6042fc2a30321c3b92c5910d00cf`) adds the injected helper and
source-pins `ROLLBACK_PROBE_ONLY = true`. The exhausted Drizzle diagnostic mode
stays false. That delivery changed only its seven approved source/test/doc files.

[Run 34312943325](https://github.com/drrowdev/hybrid-training-app/actions/runs/34312943325)
at `6fd1d43cccc00d7790ea9de55ea245fc1bb5ec15` ended 05:00:59Z: the initial
read-only snapshot parsed, then the grouped prerequisite assertion failed.
The safe record was `status=failed`, `probes=[]`; no baseline, synthetic fixture
or candidate DDL was attempted. Native16/normal148/catalog/Auth5phase4DDL/
15contexts/all36HTTP/core and both cleanup paths passed. This is not setup-failed,
a deletion error, an observed role attribute or a named FK cause.

Attribution-only checkpoint `2749a1c227ebd44833296c1c8b20260b93fe1112`, saved tree
`005d8bdf9ce54169141a516768a7c75759938765` (**not a tested tree**), appends
26 fixed-order mismatch flags to the private snapshot and a strict
`prerequisites` union to the existing safe record. All original composite guards,
first six snapshot positions and restoration comparisons remain. Only an
explicit atomic FALSE produces an ID; unknown-only failures can have
`matched:false, mismatched:[]`. Malformed evidence remains `observed:false`.
No runner/main-test, browser case, fixture, role, permission or FK pin changes.
This correction's write scope is the helper, its tests and these three docs.

The earlier attribution checkpoint did not run targeted validation; that was
not a restriction on this GitHub workspace. [Run 34316110081](https://github.com/drrowdev/hybrid-training-app/actions/runs/34316110081)
at `b9806ec695640c7c8c837d11bd0086e22e4a561e` ended 05:48:27Z with
`observed:true, matched:false, mismatched:["owner-super"]`, `probes:[]`.
The initial session/current identity was `postgres`, without the required
superuser attribute. No baseline/fixture/candidate DDL ran. Safe15 records were
retained; official raw logs had already been consumed once and discarded.
Native16/normal148/catalog/Auth5phase4DDL15contexts36HTTP/core/main/final cleanup
passed. This identifies no application deletion cause.

Accepted source-grounded correction `1b691eeb082be47af789d2ed3d5204bd9ae69b45`,
tested tree `fafaf4479d0857584a37b067b6ed2fa9ae08955a`, binds the helper's
local psql argv, snapshot identity pins and pre-fixture/setup guard to one
source-owned `supabase_admin` constant. `--no-password` fails noninteractively;
the owned DB ID, injected supervisor and implicit Unix socket remain unchanged.
The image already supplies this bootstrap superuser; no credentials, fallback,
role/ACL/owner/policy/config change or main-runner user change is introduced.
`owner-super` and all Auth/FK pins remain mandatory. The DELETE still uses
`SET LOCAL SESSION AUTHORIZATION supabase_auth_admin` with both identities checked.
See [pinned source evidence](docs/knowledge/pool-swimming.md#bootstrap-identity-correction--2026-09-09).

In this GitHub workspace, from the repository root:
- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-fk-rollback-probes.test.ts src/lib/swim/__tests__/swim-acceptance.test.ts` — 493 passed (87 probe, 406 main).
- `pnpm --filter @hta/web exec eslint scripts/swim-fk-rollback-probes.ts src/lib/swim/__tests__/swim-fk-rollback-probes.test.ts` — passed.
- `pnpm --filter @hta/web typecheck` — passed.

Diff/secret checks passed. CodeQL remains incomplete (Actions failed; JavaScript
database too large), not a security-analysis pass. Code/test author and committer
were explicitly set and verified as Copilot with the 223556219 address and both
AI trailers. No runtime SQL, Docker/stack/browser or workflow dispatch occurred.
The accepted synchronous Opus consultation replaces the unavailable old handle;
no duplicate review or additional model consultation is required. Coordinator
inspection of exact completed source, real core and fresh whole-path guards
still precedes the one corrected isolated run. No same-head rerun or further
identification-only experiment; any future failed pin still stops closed.

The unchanged Native16 prerequisite and normal148/catalog/Auth five-phase,
four-DDL, fifteen-context/36HTTP path still precede the new stage. The stage uses
the same supervised owned `docker exec`/psql connection, then terminates
**NONQUALIFYING before the twelve-case UI/API suite**. Those twelve sources are
unchanged and are **not run, never passed** by this diagnostic route. Scope,
safe probe artifact and terminal summaries state `diagnosticMode="rollback-only"`
and `qualifying=false`; even successful measurements or an inconclusive baseline
cannot make application acceptance green. Genuine errors retain primacy through
exact cleanup.

[Reference run 34287396820](https://github.com/drrowdev/hybrid-training-app/actions/runs/34287396820)
at `7d0fb2c` failed C2/C3. C3's native-only control deletion passed; the linked
account remained intact before direct Auth admin deletion returned 5xx at line614.
That API error supplied neither SQLSTATE nor a named constraint. The other ten
flows and normal148/36HTTP/Native16/core/cleanup passed; this is not evidence that
either candidate FK mode is correct.

The helper measures baseline RESTRICT, then (only after expected23503 plus
verified restoration/absence) NO ACTION NOT DEFERRABLE and NO ACTION DEFERRABLE
INITIALLY DEFERRED, in separate bounded rollback transactions. Fixture creation,
including the synthetic Auth row/profile trigger, is inside each transaction.
It reproduces the four-reference custom graph, not the full native C3 fixture or
GoTrue transaction. See [probe contract and interpretation](docs/knowledge/pool-swimming.md#rollback-only-fk-diagnostics--temporary-source-route).

Source-only validation at that checkpoint: two targeted Vitest suites passed
450 tests; scoped ESLint and `tsc --noEmit --incremental false` passed; secret
scan passed. Both author/committer identities were explicitly set and verified
as Copilot with the 223556219 address and both requested AI trailers.
No SQL, Docker/stack, browser suite, production access or workflow dispatch ran
in this source task. Exact-final-head Opus/core review and fresh full-path guards
remain required before **one** rollback-only run through existing workflow
279507729 on this branch/expected SHA, `swim_acceptance=true`, both production
flags false. No new route or protection bypass.

**Remove the temporary source mode, not merely flip it, before any repair-head
or release acceptance.** No measurement selects a permanent mode; in particular
an immediate-mode success is not a trigger-order guarantee. A separately
owner-approved repair must still pass positive C2/C3 Auth API/UI acceptance.

### PR805 expanded browser cohort — historical eleven/twelve-case checkpoints

The immutable eight-flow milestone is `95cbfb537884e65e2ec3ba6b67cf3c7ff303628a`:
[full run 34258502119](https://github.com/drrowdev/hybrid-training-app/actions/runs/34258502119)
passed at 17:44:42Z, after
[core 34258052509](https://github.com/drrowdev/hybrid-training-app/actions/runs/34258052509).
All eight passed once, without unexpected/skipped/retried/flaky-labelled cases,
in 5039/2831/4215/7711/4466/5175/3274/4474ms (37185ms total).
Native16/all148/catalog/5phase4DDL/15contexts/36HTTP, core, main and final cleanup
passed. The prior A1 Preview click timeout remains **unexplained**, not fixed by
the shared 5s readiness checkpoint. Keep that checkpoint and all eight flows
unchanged in later cohorts. PR806 was closed unmerged as superseded; its
`32947ae5eb9e99070006e3a74b5c4df0a33dce60` source branch is retained.

Code checkpoint `2e831c2313689f44424811aa3ff439be35ebac22`, tested tree
`3ab5bd91777c36b62916f556be7ad635c38751a3`, imports exactly:

- C: PR807 `327444f02c1849e26b89051c9c755411a0fb760a`,
  account blob `045205b5852cbd36f613286cad7465531f7ba03b`.
- D: PR808 `bddddd16e355ce5df5a9dcbf50e81c272503b583`,
  assessment blob `a2f19c74c1cac7534fed57c67bb7a83e068e5011`.

That checkpoint appended C1/C2/D after the original eight: eleven identities/six
files, counts 2/2/2/2/2/1. Only three closed source IDs were added. The existing
single fingerprint invocation includes all declared specs. Only owned Next
start receives a new environment object binding the already validated local
service key; shared/build/browser environments remain unchanged.
[DC-SW2/SW5/SW6/SW8](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05)
are covered by the imported positive cases; SW7/SW9 regressions remain intact.

**Earlier collection was BLOCKED at `d5936320`:** the one targeted four-file run passed
771 helper/fingerprint/synthetic-stage tests, but the real pinned Playwright
1.60.0 `--list` through the same dedicated config exited 1. Existing safe summary:
`success=false`, `loaderCode=unknown`, source
`apps/web/e2e/swimming-account-mobile.spec.ts`. Eleven exact collected triples,
zero report results/errors, and successful checked collection cleanup are not
established by that failed regression. Both exact blobs were preserved; no loader
or source repair was attempted at that checkpoint. Typecheck, scoped lint and secret scan passed.
CodeQL did not complete (Actions failed; JavaScript database too large).
No live browser/app/server/DB/Docker/CI invocation or additional worker occurred.

**Earlier eleven-case collection PASSED:** source commit `e2e4862bed308e4ea1270b50d6aaac9bac565ba6`,
tested tree `84f95c16324bdeb903ad5acbc49b539817233f24`, moves the same account
privacy comment and `test.use` options to file scope and removes only the obsolete
three-line header. Playwright 1.60.0 rejects these worker-scoped media options
inside `describe`. Ordered trimmed non-empty comparison against `d5936320`
(439 lines), exact expected bytes and inspected diff passed. New C blob:
`911c4ca2c32bea51e6b709311f7752aac34a25af`; D remains the exact blob above.
The existing dedicated pinned `--list` regression passed eleven exact triples/six
files, zero executed results/errors and checked private cleanup:
`success=true`, exit 0, `loaderCode=unknown`, `sources=[]`. Web typecheck and
scoped lint passed. No case executed; no app/account-deletion/cascade failure was
observed in either collection attempt.

**Current evidence and C3:** [run 34283532254](https://github.com/drrowdev/hybrid-training-app/actions/runs/34283532254)
at `9fe3e4da` passed 10/11 UI flows, including A1/B1/D, A2, offline recovery and
export. Only C2 failed (7402ms, account source line 479): Account POST HTTP5xx
headers, still on Account, exact synthetic Auth user present at the bounded later
sample. This does not locate an Auth error, SQL cause or exact throw site.
Native16/normal148/catalog/5phase4DDL/15contexts/36HTTP/core/main/final cleanup passed.

Code `bc4ce939ea610563ac515540ac46371eb4572d77`, tested tree
`a247d1df538a01c76cb1ac329837d989fa95e860`, appends only C3 after the original
eleven registry identities (C2 index9, D index10, C3 index11): twelve cases/six
files, 2/2/2/2/3/1. These are **eleven UI flows plus one direct Auth-API acceptance
case**, not twelve UI flows. C3 uses fresh control/custom-linked accounts and the
unchanged arrangements, deletes each once via the existing harness admin, and
requires Auth404 and exact row disappearance, with linked-user preservation
between deletions. Separate inline API assertions retain safe source attribution.
No C1/C2/fixture/product/schema/configuration change or new diagnostic protocol.
All 414 targeted helper/collection tests passed, including actual Playwright 1.60.0
`--list`: twelve exact identities/six files, zero executed results/errors and
checked private cleanup. Web typecheck/scoped lint/secret scan passed.
No live deletion was run; teardown is never acceptance. See the
[C3 outcome boundaries](docs/knowledge/pool-swimming.md#shared-completion-integration--current-148-status).

**C2 remains OPEN**: no deletion/cascade/survivor or foreign-key-cause claim.
Custom movement and both references remain until the real Delete action;
failure-preserving teardown is not product proof. D's rejection, native history,
future-only acceptance, original/started targets and both reloads are unchanged.
All nine standalone gates remain incomplete; wider progression, concurrency,
lifecycle, analytics and safety/load variants still require evidence.
No production readiness or combined-swimming acceptance is claimed.

All limits, configured workers/retries and privacy/resource safeguards remain
unchanged; file-level media overrides also apply under generic collection, only
to the account file. Identical worker hashes or zero recycling are not claimed.
The coordinator next owns actual Astra START+TERMINAL/artifact even on failure,
then one complete integration+remainder exact-head Opus review and core-only CI.
Accepted full head/core and fresh guards/full execution-path review are required before
one normal Native16/14836/twelve-case reference through workflow `279507729`,
the existing branch route, exact `expected_sha`, and both production flags false.
PR807/808 remain frozen source artifacts, not merge candidates; only the
coordinator may close them unmerged after eventual live acceptance.

#### Earlier PR805 wiring and recovery

The earlier six-flow milestone `e46c443e8e06cb31616cb6082c3d0fbbbca7c050` passed
[full 34244354544](https://github.com/drrowdev/hybrid-training-app/actions/runs/34244354544)
at 15:29:26Z after core 34243771485, with all six passing once (41391ms total)
and native/database/main/final cleanup passing.

The original four cases plus normal 148 migrations, 15 service contexts and
36 HTTP cases passed in [run 34176424048](https://github.com/drrowdev/hybrid-training-app/actions/runs/34176424048)
at `4f2aa4af480f61df83bbc38b09f29afbbbf5729b`. Opus 5 turn 19 accepted the
integration; turn 20 accepted both A source cases.

Wiring checkpoint `3c060e3d` declares exactly those unchanged four plus A1
([DC-SW7](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05))
and A2 (DC-SW9), across three files. Catalog-derived equality gates require all
six to pass exactly once, without retries, skips or errors. Safe ledgers include measured
`durationMs` for the final attempt alongside `attempts`, not summed retries or
a runtime guarantee. All execution limits remain unchanged.

[Run 34182254665](https://github.com/drrowdev/hybrid-training-app/actions/runs/34182254665)
at `a67123db2f237b82b378c1eb0b9070adb45155c1` passed normal 148 migrations,
15 service contexts, 36 HTTP cases and the original four browser cases; cleanup
was verified. A1 failed at the checked `deleteUser` error assertion (8.596s);
A2 failed at Log swim visibility after Start (7.809s). These were not test
timeouts. Actual error values and causes remain unknown.

Recovery code `4e778395809c88504cd2379b0c189712af642547` reads exactly one
global `bench-press-flat` row for A1, retaining all five nonempty snapshots and
checked cleanup. Start swim now waits for readiness, with a specific SSR-disabled
button regression; A2 polls the owned saved workout for `started` and a nonempty
session link before its unchanged Log swim assertion. This is not proof of the
exclusive A2 cause. **Custom-movement account-deletion regression remains OPEN
in C as a privacy/release concern**; no deletion fix or passing regression is claimed.

265 targeted component/pure tests, web typecheck, scoped lint and secret scanning
passed on the GitHub runner; the new SSR test failed before the guard and passed
afterward. CodeQL analysis was skipped because its database was too large.
No live browser/server/DB/Docker run, credential access or CI dispatch occurred
in this recovery. Its pending six-case reference was subsequently satisfied by
the e46 milestone above. All nine standalone gates and production acceptance
remain unproven.

### PR803 browser integration — earlier checkpoint

The coordinator confirms the database milestone passed. The first four-case
mobile browser execution is wired: sealed reports after command reaping,
child-only validated browser cache, complete bounded source inputs, and awaited
shutdown with delay observations distinct from failures. R1 remains unchanged.

Code checkpoint `230f09b0`: 575 focused stage/acceptance/helper tests, web
typecheck and scoped lint passed on the GitHub runner. These are static results,
not browser execution. The coordinator owns combined R1+R2 exact-head review and
core CI in parallel, then **one normal-148 + four-browser-case reference** after
all gates and fresh checks. No browser/database execution or workflow dispatch
occurred in this slice. Full standalone
[DC-SW1–SW9](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05)
and production acceptance are not established.

The collection-only regression added from source
`5f82776876a2bb60b607a9c2dc04d0c3b80416a9` reproduced exit 1 with the
config/browser-helper/reporting/migration-evidence paths associated with the
failure (loader code unknown). Extracting the unchanged shared error primitives
removed that import boundary: pinned Playwright `--list` now collects exactly
four mobile cases from two files, with zero executed results. The Next 16.2.6
own-stop exit-143 fix is committed separately. Missing reports are classified
only after ticket/root validation, not described as “never written.”
256 scoped synthetic/collection tests, web typecheck and scoped lint pass.
No browser, server, database or workflow dispatch ran in that slice; the later
first-four milestone is recorded above.

### PR802 anonymous completion correction — earlier checkpoint

[Run 34154417199](https://github.com/drrowdev/hybrid-training-app/actions/runs/34154417199)
at `4b1f51afffa4976c26016097ca939661e9417112` produced complete `P0001` evidence
at migration 147, statement 0: `SCID` acl/pre/shared `ftfttttt`. Direct `anon`
and `PUBLIC` grants exist; the old exact set fails, while grantor/EXECUTE/
no-grant-option checks match. Other unexpected grantees are not ruled out.

0147 up/down now require the exact prior normalized set including `anon` and
`PUBLIC`, revoke both on up, and restore both on down. Missing/extra grantees
or wrong grantor/options still abort; raw ACL ordering is not promised.
Helper grants, function bodies, RLS and journal are unchanged. Completion now
returns its existing auth result before RPC only for positively absent identity,
including the official missing-session error. Other Auth errors still reach the
cookie-bearing RPC; signed-in permission errors remain transient.

Normal acceptance is restored in source; the diagnostic branch stays dormant.
522 focused static tests, web typecheck and scoped lint passed. All five phases,
15 service contexts and 36 HTTP cases remain unchanged. Runtime acceptance is
pending exact-final-head review and the coordinator's ordinary 148 run; no
database/container execution, workflow dispatch/rerun or merge occurred here.

### PR802 migration syntax repair — earlier checkpoint

Nonqualifying [run 34137048733](https://github.com/drrowdev/hybrid-training-app/actions/runs/34137048733)
at `07ef1d5e4a695352621d1c945050d137c2aa3413` produced complete structured
native SQLSTATE `42601`, phase `migrate`, migrationIndex `147`, statementIndex `0`,
with no SCID. Shutdown and main/final cleanup closed; Core CI passed.
No HTTP cases executed. The bare shared-body-hash `IF CASE` exposed its internal
`THEN` to the PL/pgSQL condition parser. The up/down repair adds only parentheses
around that CASE; bodies, attributes, ACLs and the journal remain unchanged.
This is not evidence of an ACL cause.

Normal acceptance is restored in source; the diagnostic branch remains dormant
and unchanged. Ordinary migration/catalog/round-trip/service/HTTP acceptance
is still pending exact-head review and coordinator-owned execution. No runtime
acceptance or release claim is made. The integration notes below are historical
checkpoints, not proof that the repaired path has run.

### PR802 shared completion — current 148 status

The [approved remainder](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5569058128)
is implemented on accepted runtime checkpoint `b338e0d7`; HTTP/proof checkpoint
`df790b09` preserves that runtime and every original 30 RPC case. The helper now
requires Alice's and Bob's exact authenticated own IDs, retains anonymous denial
and service UUID-or-null callability, and adds non-swim owner completion/receipt/
same-and-new-entry replay, cross-owner empty-result/non-mutation, and anonymous
shared-completion denial. Six mandatory names require at least 36 cases.
Collection-only inspection found **36 unique cases** (33 literal `it` declarations
plus three `it.each` rows); none were executed against a database.

All three runner counts remain 148. Closed 146/147/148 evidence distinguishes
helper absence, original private-helper access, and amended authenticated own-ID
access/shared anonymous denial. The five phases are initial148 → first147 →
rolled-back146 → restored147 → restored148, with exact ordered **0147 down,
0146 down, 0146 up, 0147 up** and **15 isolated service contexts**. New synthetic
tests flip all 11 shared fields at every level, reject 147↔148 evidence, and
separately reject restoration drift while restored147/restored148 boundaries match.

**526 focused static tests**, web typecheck and scoped ESLint passed. This is
implemented integration, **not real temporary-stack acceptance**. Last actual
[147 run 34096598017](https://github.com/drrowdev/hybrid-training-app/actions/runs/34096598017)
remains **24/33 passed**; `40001` and remaining completion behavior are not proved
resolved. No SQL/runtime/production changes, database/container execution,
workflow dispatch or merge occurred. Exact-head review and the subsequent
temporary run belong to the coordinator. Full standalone acceptance still
precedes combined swimming and Garmin.

The Slice A/B notes below record earlier checkpoints, not current run results.

### PR802 identity integration — Slice A

Core `5e3c938f23fcefcca5e51f09937e93ee68d92664` (0146, rollback, journal and
core tests) is independently accepted and unchanged here. The owner-approved
service-role compatibility amendment is included in that core.
[Slice A](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5566040440)
is implemented: all three runner counts require 147, and closed catalog evidence
covers the four service capabilities, private helper boundary and ten functions'
attributes/original/up body equivalence. Legitimate helper absence retains the
other evidence; only a caller-owned rolled-back expectation accepts it.
NULL ACLs use default PUBLIC EXECUTE and fail the up boundary, not observation.

The observation remains read-only/no-throw with the same private paths, 8 MiB
capture cap and 5-second SQL/10-second command bounds. The runner records the
boundary before RPC but enforces it only after the canonical RPC stage is attempted.
RPC failure stays primary; boundary failure is separately recorded. A successful
RPC stage cannot override unavailable or mismatched boundary evidence.

All 315 focused acceptance-helper tests, web typecheck and scoped lint pass.
These synthetic/source checks do **not** prove the repair works. Last actual
[run 34063418887](https://github.com/drrowdev/hybrid-training-app/actions/runs/34063418887)
tested `1af9874f7e88700a2b8687beadffd79b28818d59`: **2 passed, 28 auth-schema
failures**. The original 30 RPC tests were neither changed nor executed here.

### PR802 identity integration — Slice B

[Slice B](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5566424679)
is implemented on accepted Slice A `45533beb`. The runtime checkpoint is
`39519785`. The runner uses the same owned private postgres channel for one exact,
source-verified 0146 down/up round trip after normal 147 migrations and seed.
DDL uses unchanged whole-file `psql -c`, command-local 30s statement/5s lock
timeouts and the existing deadline. No journal bookkeeping or migration rerun.

Initial-up, rolled-back/before-reapply and restored-up evidence includes the
accepted boundary, private normalized ten-function ACL comparison and three
isolated service-role contexts per phase. Both invokers use native same-request
identity/date checks; missing-identity safety accepts only the authored domain
exception. These synthetic callers are not JWT/RLS or writer-repair proof.
`manifest.identityProof` exposes only closed outcomes/counts, not private values.
DDL/consistency failure stops before RPC; ordinary failed proof is enforced only
after RPC once restored, preserving the RPC failure as primary.

The unchanged original 30 HTTP cases have three additive helper-access cases.
The existing canonical gate remains intact; an additional check requires all
three named cases and at least 33 total cases. A 404 is non-invocability only,
not ACL proof. Focused helper/config/report tests, typecheck and scoped lint are
static validation only; the HTTP suite was not executed.

At this earlier checkpoint, real 147-migration/native-RLS/RPC/service/down-up proof
was pending and the last run was **2 passed / 28 auth-schema failures**. Independent
exact-integrated-head review precedes the coordinator's one temporary run.
No database, Docker, Supabase, workflow execution or merge occurred.
Full standalone DC-SW1–SW9 acceptance still precedes combined swimming; Garmin
also remains later.

### Earlier PR802 read-only auth privilege evidence

[Run 34061180463](https://github.com/drrowdev/hybrid-training-app/actions/runs/34061180463)
at `fc364e2534e361c378e0f88a887c3504b44bc009` passed core/identity, official
default-service readiness, all 146 unchanged migrations, catalog consistency
and both cleanup paths. The RPC ledger remains **2 passed, 28 failed, none
pending/todo, no timeout**. Complete diagnostics identify schema `auth` in all
28 failures, with zero invalid records and zero unknown permission kinds.
This supersedes the unknown-denied-object status below.

[Authorization 5562400372](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5562400372)
is implemented as one fixed catalog observation after migration/catalog checks
and before the unchanged RPC invocation. It uses the verified owned DB container
and existing private postgres command channel: READ ONLY, 5-second statement
timeout, at most 10 seconds under the existing deadline/cleanup reserve, and the
unchanged 8 MiB capture cap. Only validated booleans and closed classifications
reach `manifest.authPrivileges`. Missing/ambiguous catalog data, malformed output
and process failures are explicit unavailable evidence, never an acceptance gate.
No permissions, migrations, reporter vocabulary, workflow or cleanup changed.

Actual owners, grant options and effective privileges remain **unobserved**.
Effective EXECUTE on `auth.uid()` may come from PUBLIC or inherited grants; it
cannot prove migration 0145's grant applied. See the
[query contract and interpretation limits](docs/knowledge/pool-swimming.md#read-only-auth-privilege-evidence).
All 293 targeted acceptance-helper tests, web typecheck and scoped lint passed;
synthetic fixtures are reporting tests, not database acceptance.
Independent exact-head review and fresh execution guards must precede one
new-head manual run. No database/container/workflow execution occurred here.
If that observation is insufficient, record the missing evidence and reassess,
without an identical rerun or diagnostic expansion. Access correction is a
separate owner decision with independently reviewed additive migration/rollback.
Full standalone DC-SW1–SW9 acceptance remains required before combined work.

### PR802 safe RPC failure diagnostics

[Run 34059019498](https://github.com/drrowdev/hybrid-training-app/actions/runs/34059019498)
at `418beb8f662a7f8267609d73fac9c4b32a7452f3` passed official
12-service readiness, all existing HTTP probes, all 146 unchanged migrations,
catalog seed/consistency and cleanup. All 30 authenticated RPC cases executed:
**2 passed, 28 failed, none pending/todo; no process timeout**. All 28 failures
share SQLSTATE `42501`, category `permission`,
one fingerprint and `swim_create_plan`. Diagnostics were complete with zero
invalid records. The denied object remains unknown, not 28 established defects.

[Authorization 5561913579](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5561913579)
adds a third Vitest reporter, an exclusive private 0600 diagnostic sidecar and
strictly validated grouped evidence in the existing sanitized manifest. Only
canonical case identities, fixed classifications/allowlists and normalized-message
SHA-256 fingerprints may be published; no raw backend messages or sidecar contents.
Bounds and missing/invalid evidence produce explicit partial/unavailable status.
Canonical JSON, process outcome, the 30-case gate and cleanup remain authoritative.

[Authorization 5562164313](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5562164313)
expands only source-anchored diagnostic identifiers and adds a closed `deniedKind`
from the selected `42501` cause's own bounded message. It appears only in
associations; code/category/fingerprint grouping is unchanged. Unknown permission
kinds are counted separately from invalid records and collector failure.
Static grants do not establish runtime privileges; missing `P0001` does not prove
`auth.uid()` completed. No SQL/access-policy repair is identified or approved.

All 458 targeted reporter/helper/report/config tests, web typecheck and scoped lint
passed; synthetic evidence is not real RPC acceptance. Independent exact-head
delta review must precede the coordinator's one new-head reference run; none ran
here. If richer diagnostics still lack a relevant target, stop this approach and
propose bounded read-only privilege evidence, not a third vocabulary pass or a
guessed grant. Any remedy needs owner approval and an additive migration with
rollback. Full standalone acceptance still precedes combined work.

### PR802 pinned-default service correction

Our prior 13-service default assumption incorrectly included optional imgproxy.
[Authorization 5561453075](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5561453075)
corrects the pinned CLI 2.116.0 contract to 12 services, not an acceptance waiver.
The [native init/gate source anchors](docs/knowledge/pool-swimming.md#pinned-default-service-contract)
establish the defaults. Fresh config is checked before startup without changing
service flags; strict service/membership equality, readiness, ownership,
publications and cleanup remain. Current inspected expected/observed/missing/
unexpected names are retained before readiness assertion. Both existing HEAD
probes and all GET probes remain unchanged.

[Run 34051805797](https://github.com/drrowdev/hybrid-training-app/actions/runs/34051805797)
at `9257aeb20582edf681aac49b2a00d3a5f9efc226` passed core/identity, official startup
and cleanup, then failed `Incomplete default service set` before application
migrations/catalog/RPC. Its historical snapshots show 12 permanent names without
imgproxy plus an earlier temporary job, not final current membership or proof of
exclusive runtime causation. The correction has only helper/static validation;
the coordinator must review the delta before one new-head run. All 146 unchanged
migrations/catalog, 30 actual RPC cases and the frozen standalone acceptance
inventory remain required. No runner/container/DB, workflow dispatch or merge
was performed in this correction turn.

### PR802 manual Actions implementation

Implemented [authorization 5560014710](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5560014710):
the existing CI workflow has an isolated, manual `swim_acceptance` job with an
`expected_sha` gate, a disposable reference runner and pure guard tests. See the
[execution instructions](docs/knowledge/pool-swimming.md#manual-actions-reference-acceptance).
This turn did not dispatch a workflow or start Docker/Supabase. The coordinator
must review the committed execution path independently before dispatch.

The new job can prove only reference startup, unchanged migrations/catalog and
the complete RPC file. Standalone mobile/offline/two-context, lifecycle,
benchmark and actual-load acceptance remain outstanding. Identity/core CI remain
enabled; the older identity allowlist may fail independently and still blocks
merge. No production migration, runtime swim, SQL, fixture or dependency changed.

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