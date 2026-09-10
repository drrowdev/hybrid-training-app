# HANDOFF.md

Current-state snapshot. Updated by whoever last touched the repo. Read this before resuming work.

## LATEST — PR805 standalone integration — 2026-09-10

This forward integration retains immutable combined checkpoint
[`064aea85c10efd057e9d2485a5957734dee78c36`](https://github.com/drrowdev/hybrid-training-app/commit/064aea85c10efd057e9d2485a5957734dee78c36)
as a parent and merges main `672e4202792da122281639e3db810029432573f5`.
PR805/head/base and native stack are unchanged; no rewrite, PR811 edit or release.
Only dormant combined activation/schema and its specific contracts are deferred.
Earlier handoffs below remain historical records, not current release authority.

Main's shipped 0145 seed is unchanged. The four unshipped swimming up/down
files move byte-for-byte: standalone145→146, request identity146→147,
shared completion147→148, deferred movement references148→149.
Journal145 is unchanged at1788912000000; new146–149 use +1/+2/+3/+4 milliseconds.
Normal total150 and function-state labels146/147/148 are intentionally distinct.
Pinned bodies/privileges, five phases/four whole DDLs/15 contexts/Auth36,
old-FK necessity proof and frozen26 identities/assertions remain unchanged.

One exact-commit feature workflow now requires core and native identity success
before disposable acceptance. Existing guards, isolation, timeout budgets and
always-cleanup remain unchanged. Failure projection retains structured locations,
adds at most two allowlisted stack locations, and withholds raw diagnostics.
Only the fixed known private-comparison boolean header can yield boolean values;
missing/ambiguous values explicitly remain unavailable.

Validation: one focused five-selector web Vitest batch (storage-migration,
shared-completion-migration, swim-acceptance, swim-browser-acceptance,
swim-rpc-diagnostics) initially passed1247/1248; the one exact report-shape
expectation was updated for explicit unavailable fields. The repaired batch
passed1248/1248. Byte comparisons verified all eight renamed up/down files
against064aea, all146 shipped main SQL files and journal entries, timestamp
ordering, and unchanged frozen e2e files. Native pre-push checks are required
before publication; final source SHA and check results are reported in the
delivery handoff.
No accepted baseline logs were fetched, no acceptance dispatch or services run.
Integrated acceptance is unexecuted. Coordinator exact-SHA gated CI, owner
usability review, native stack landing and release remain separate gates.

Rollback: app first, then down149→148→147→146. Base swimming down refuses
issued plans/results/history; retain schema/data if a data-safe rollback cannot
proceed. No applied-ledger reset, hosted/user DB change or production approval.
DC-SW5/SW7/SW8/SW9: see
[constraints](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05).

## Deferred checkpoint — PR805 dormant primary-cardio link foundation — 2026-09-10

Started from public-reviewed `8c58917f14aaee22e224f257e91dd9c2ff76897f`,
base `e2758dadbb110e03794e49d53b47622a6295e988`, on the assigned805 head.
The owner's accepted standalone evidence is full34490583441 attempt1 at8c589:
all26 once,0unexpected/flaky/skipped,123930ms; exactcore34489951509 first.
All nine standalone gates are covered. Earlier entries below remain historical;
their “not accepted” statements do not supersede this supplied acceptance.
No consumed reference logs or private agent transcripts were retrieved.

Only the dormant foundation in [ADR0079](docs/adr/0079-pool-swim-track-and-calendar.md#dormant-primary-cardio-foundation--2026-09-10)
is added: nullable unique `swim_workouts.planned_session_id`, composite owner FK,
new `planned_sessions(user_id,id)` unique constraint, and column-specific
`ON DELETE SET NULL (planned_session_id)`. The database CHECK requires NULL even
for privileged writes. No binding path, UI, parser, start/completion/lifecycle,
RLS/grant/role/identity/lock-order or browser fixture/case changes.
Old date/slot fields remain. The column's observable purpose is parent cardio-slot
identity; removal requires no live bindings and guarded down. Down preserves all
work/history, requires restored validated dormancy, and drops only introduced
objects with RESTRICT. Later activation must retain source/program provenance
independently of the nullable link and own its reviewed non-destructive rollback.

Normal registered migrations now150 (new0149); source registration already covers
all `packages/db` files, including up/down. Exact hashes/parity/catalog/cleanup
and failure guards remain. Identity DEFINITION levels146/147/148, five phases/
four original whole-file DDLs/15contexts, Auth36 and movement-FK proof unchanged.
Frozen26 identities/bodies/oracles and sixfilecounts2/4/7/9/3/1 are untouched.

Executed on this official worker (no installations):
- `pnpm -r --filter @hta/db --filter @hta/web exec vitest run storage-migration.test.ts swim-acceptance.test.ts dormant-swim-primary-cardio-link.test.ts`: **455 passed** (2 DB schema metadata,47 migration contracts,406 reference contracts).
- `pnpm --filter @hta/web exec eslint scripts/swim-acceptance-guards.ts src/lib/swim/__tests__/storage-migration.test.ts src/lib/swim/__tests__/swim-acceptance.test.ts`: passed.
- `pnpm --filter @hta/db typecheck` and `pnpm --filter @hta/web typecheck`: passed.
- `env -u DATABASE_URL pnpm --filter @hta/db db:check`: offline150 journal/file/hash parity passed.
- `pnpm --filter @hta/db exec drizzle-kit check --dialect postgresql --out ./drizzle`: passed.

These are **source-only** checks, not executed SQL/FK/database acceptance.
No service, DB, Docker, Supabase, app/browser server, browser collection or
workflow dispatch was started. Coordinator owns full saved-source/path review,
fresh refs/writer guards and exact-new-head core before guarded runtime dispatch.
Remaining disposable proof: up/down; cross-owner/duplicate rejection; privileged
dormancy rejection; parent deletion preserving owner/history (with dormancy
removed only in a separately reviewed activation/proof context). Then trace all
start paths and prove shared atomic start/parent completion and planned-slot
mutation serialization under real authenticated races. `startSessionDirect` still
uses separate insert/conditional-link writes; check-then-redirect is not integration.
Selected unstarted cardio-only replacement, current-parent pause restoration,
reviewed resume, independent source-history retention and no date remapping
remain required. Separate dates/priority/recovery coordination are later work.

Isolated development/disposable rollback authorization is not production approval.
Main's applied0145seed watermark1788912000000 still conflicts with unshipped swim
ordering; no reconciliation/ledger reset/native-stack manipulation here.
Backups/external integrations remain deferred. [DC-SW5/SW7/SW8/SW9](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05).

## LATEST — PR805 B9 schedule-version oracle correction — 2026-09-10

Sole805 writer refreshed head `ff133f056d1857e2096da438e7ea71bc460e19bc`
and base `e2758dadbb110e03794e49d53b47622a6295e988`. Prior1acdd/be5ad
remain terminal; their B9 work and unique `main.cp-main` lookups are preserved.
Coordinator-supplied FIRST full26 **34487229136 attempt1@ff133f** executed
all26 once: original25 passed, only B9 failed (7592ms), total147834ms,
0 flaky/skipped, sixfiles2/4/7/9/3/1. Main failed despite both verified cleanups;
the other ten stages passed. Exact-head core34486576111 passed beforehand.
The shared `same()` line71 does not identify the failing caller or phase.
No consumed reference/private agent logs or reports were fetched.

Source-confirmed oracle defect only: real `actions.ts` resume appends a
schedule decision with `ruleVersion=SWIM_SCHEDULE_VERSION`
(`swim-standalone-schedule-1`) and `generatorVersion=SWIM_GENERATOR_VERSION`
(`swim-gen-1`). B9 now imports the existing schedule constant and corrects
only that operand, retaining exact equality and every other assertion.
One existing-runner regression reuses the real resume action with mocked I/O,
captures its appended storage decision, executes B9's source comparison against
it, and proves the old expectation throws while the corrected one passes.

Official-worker validation: one Vitest batch across `swim-actions-refresh`,
`swim-browser-acceptance`, and `swim-browser-collection` with selector
`DC-SW7 confirmed|B9|collects the exact declared mobile cohort`:
**63 passed, 783 unselected**. Private collection26 passed without execution;
scoped ESLint and web typecheck passed. No product/schema/RPC/version semantics,
workflow/config/dependency, diagnostics, timeout/retry or acceptance-case changes.
No workflow dispatch or app/browser/backend/server/DB/Docker/Supabase startup.

Current26 remains **not accepted**, eight of nine standalone gates only.
Historical accepted25@60e5/full34481788221 (143518ms) stays separate.
Coordinator owns saved-source/actual terminal model/ref inspection, then
successful EXACT-HEAD core FIRST and ONE full26 after fresh writer/ref/CI guards.
No unchanged-head rerun. All existing privacy/isolation/runtime/cleanup guards
and owner-confirmed production/migration boundaries below remain unchanged.

## LATEST — PR805 bounded B9 / frozen26 source — 2026-09-10

Sole805 writer starts at refreshed `60e5dede85cc2bdaef05383ef5a80bc256d5ee11`,
base `e2758dadbb110e03794e49d53b47622a6295e988`; prior d512 is not restarted.
Coordinator-accepted full25 **34481788221 attempt1@60e5: all25 passed once,
0 unexpected/flaky/skipped,143518ms**, after FIRST core34481195293.
All11 stages, empty failure ledger, Native16/normal149/catalog/Auth36HTTP,
identity5phases4wholeDDL15contexts, single-FK necessity/down-up/invalid-update/
coreidentity and both cleanups are accepted as supplied. No consumed private
reference/agent logs, transcripts, download URLs, raw rows or media fetched.
Historical accepted24@0a0e/full34460014574 and22@89f63 remain separate;
failed25@fc360/632/524 remain failed. The unchanged-source confirmation VM/SSR
reproduction does not establish a shared cause for all earlier Finish failures.

Exactly one B9 is appended at registry index25 under
[DC-SW5/SW7/SW8](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05).
Frozen26 is sixfiles2/4/7/9/3/1; the accepted25 prefix and A3/A4/A7 diagnostics
are unchanged. B9 has no diagnostic annotations. It reuses B1's settled
history/candidate and A6's independent same-user context pattern, with finite
real-button request capture, one genuine stale rejection per phase before
reload, canonical decision/target checks, and distinct reviewed resume dates.
The schedule oracle follows the actual winning original preview; rejected
input/preview stays visible until reload. Whole state, primary prescriptions/
sets, results and regional rows are retained. No new scheduling UI or product,
schema/RLS, storage fixture/service, dependency, workflow or deadline changes.

Early source checkpoint `ea17f431ae4ac96a7f4fb17eeb376c6edf23ed3c` and complete
code/test checkpoint `af5d4fe99dfcd4827a739c6b93adc5b24adf8ce9` published
with verified local/public allowlisted cloud author and GitHub committer.
Final validation in the official worker:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts src/lib/swim/__tests__/swim-browser-stage.test.ts src/lib/swim/__tests__/swim-hub-view.test.tsx src/lib/swim/__tests__/swim-actions-refresh.test.ts`
  — **932 passed (644/1/66/21/200)**. Includes actual PRIVATE
  Playwright1.60.0 collection26/sixfiles2/4/7/9/3/1, zero execution/errors,
  exact private cleanup. Source proof pins unchanged B1–B8 helpers/bodies and
  exercises B9 decoding with the real pinned Next/React argument encoder.
  The other five accepted spec files were byte-compared to starting60e5.
- `pnpm --filter @hta/web exec eslint e2e/swimming-decisions-offline-mobile.spec.ts scripts/swim-browser-acceptance.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts`
  and `pnpm --filter @hta/web typecheck` — passed.
- `pnpm docs:check-drift` (offline in-repo), `git diff --check`, changed-file secret
  scan — passed. First unit batch exposed remaining B-file count8; corrected
  to9 before the green batch. Existing pre-push identity guard passed across157
  introduced commits before final code publication, without bypass or rewrite.
  CodeQL requested after all code was committed; skipped as test/documentation-
  only, not an analyzed security pass. Final committed diff contains only the
  seven required spec/registry/proof/HANDOFF/wiki/log files, no artifacts.

Collection is NOT runtime. Eight of nine standalone gates are accepted;
B9 runtime is the sole remaining gap before combined. Coordinator complete
source/terminal model/ref inspection, exact-head core FIRST, then ONE frozen26
reference remain pending. No worker browser/backend/server/DB/Docker/Supabase
startup or workflow dispatch. All existing deadlines, isolation, normal149/
identity146–148/Auth/FK/down-up/cleanup guards remain. Getsxc.app existing
accounts and deferred backups unchanged. Current-main/nativeStack804 and
UNSHIPPED-ONLY migration ordering/down plan still require owner confirmation;
disposable evidence confers no production authority.

## LATEST — PR805 confirmed completion repair — 2026-09-10

Sole writer started at refreshed `fc360d4e89a19853fca390657a4c54195e9a4993`,
base `e2758dadbb110e03794e49d53b47622a6295e988`. Prior8788 was not restarted.
Coordinator-supplied full **34478188698 attempt1@fc360 failed: 22/25 passed,
3 failed, 0 flaky/skipped, 134775ms**; preceding core34477706905 passed.
Main failed; other ten stages and both independent cleanups passed. Consumed
reference/agent logs, transcripts, download URLs and raw records were not fetched.
A3's original receipt committed with valid completion time and HTTP2xx but no
result controls. A6 failed the same first-Finish assertion; its DB outcome is
unknown. A7 passed primary completion and all proofs through2186, then failed
the unscoped safety alert at2195. Its unavailable samples are not failed-save
evidence; later start/resume invariance was not reached. Earlier failed runs
remain failed and accepted24 is historical, not this head's acceptance.

Controlled VM/SSR regression executes the actual WorkoutClient completion
handler and WorkoutScreen with synthetic acknowledged completion and held old
started/null-result props. On unchanged production fc360, both Finish/auto-flush
rendered “Swim saved” with no form or result controls (2 intended failures).
This demonstrates the render gap, not causes of historical refresh latency.
The repair carries the existing server-projected view and original pairing
through the shared drain into existing confirmed-view ownership. Missing views
use the existing reload warning, not a second completion write. Only A7's two
safety locations exclude the exact Next route announcer; all other oracles and
bounded observations remain unchanged. Supplied pinned synthetic announcer
proof: all16 passed in the same failed reference; not rerun here.

Checkpoint validation in the cloud, Node22.23.2/pnpm10.33.2:
- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/workout-controls.test.tsx src/lib/swim/__tests__/actions.test.ts src/lib/swim/__tests__/swim-actions-refresh.test.ts src/lib/offline/__tests__/flusher.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts`
  — **935 passed**, including PRIVATE actual Playwright1.60.0 collection25;
  six-file2/4/7/8/3/1 registry unchanged, no browser/backend execution.
- `pnpm --filter @hta/web typecheck` — passed.
- `pnpm --filter @hta/web exec eslint src/components/swim/WorkoutClient.tsx src/lib/swim/actions.ts src/lib/swim/view-types.ts src/lib/offline/flusher.ts src/lib/swim/__tests__/workout-controls.test.tsx src/lib/swim/__tests__/actions.test.ts src/lib/swim/__tests__/swim-actions-refresh.test.ts e2e/swimming-lifecycle-load-mobile.spec.ts`
  — passed.

Early tested checkpoint: `96245055e11855e00d004cd912d52321562543ec`, published
with allowlisted local/public native cloud author and GitHub committer.
Final same six-selector command: **983 passed** (79/37/200/26/640/1).
The VM harness also respects the actual child revision key. Added tests cover
canonical persisted result/notes projection after the original commit and shared
recompute, manual/auto shared-drain delivery and fresh snapshots, offline replay,
held stale then newer incoming views, absent/malformed/mismatched confirmations,
durable accepted-receipt recovery, and post-commit refresh/projection failures.
Pre-existing transient recompute/FIFO/lease/dead-letter behavior is retained.
Only a structurally valid, matching, newer completed server view is adopted;
count-only success never fabricates a result or authorizes a second write.
The one new A7 source test asserts both exact-message/display-region pairs use
the existing probe's positive locator; no probe matrix was run or expanded.
Scoped typecheck and lint passed again, including
`src/lib/offline/__tests__/flusher.test.ts` and
`src/lib/swim/__tests__/swim-browser-acceptance.test.ts` in the lint command
above. Initial added source test used an inline expression rather than the
probe's equivalent `old` alias; corrected, then the complete batch passed.
Final security verification is pending. No workflow dispatch, server/DB startup,
new dependencies, migrations, RLS/safety changes or history rewrite. Coordinator
must inspect saved source and terminal model/refs, then exact-head core before
one full25. Seven of nine standalone gates remain historically covered; new
limitation and reviewed scheduling/proposal concurrency remain open.

## LATEST — PR805 bounded A7 first-Finish observations — 2026-09-10

Started at live-verified `63235ae37fb2fd324a99b8d9840daa46f57012dd`, base
`e2758dadbb110e03794e49d53b47622a6295e988`, sole existing-PR805 writer.
Early tested checkpoint: `6af346d0f70c7debedac428f2b7872813d98ffa7`.
Completed source: `c4f7a6fe1472ab1f3db0324d784443fe299a50be`, tested tree
`e6f39d70d22853449dea94f024a802d85da49864`.

Owner explicitly approved **“Allow two bounded observations (Recommended)”**:
only `a7-finish` / `a7-finish-transport`, index24, within the original first-Finish
five-second result assertion. This is not broader diagnostic or product authority.
Listeners precede the click; the pinned root0/$K/_part_ decoder binds the original
Request to the exact loopback origin/workout path/query, started session and receipt.
One owner/session-scoped receipt read uses AbortSignal and SDK `.retry(false)`;
one finite UI snapshot uses existing closed classifiers. Ambiguous/duplicate/stale
or unpaired evidence stays unavailable; HTTP2xx is not completion proof.
The unchanged result-text assertion starts before observation reads, followed by
the unchanged Edit result assertion. Abort settles owned waits; late resolutions
cannot write outcomes. Only an already-failed page may close for pending browser
reads. No renewed clock, polling, retry, raw diagnostic output or product changes.
Original24/shared spec helpers and A7's remaining oracles are byte-identical;
Notes/navigation fixes remain. Six-key/160char/max16 grammar is unchanged; A7
rejects duplicate/extra/cross-case records. A3/A4 remain at20/21.

Latest executed evidence, supplied by coordinator and corroborated by public
metadata: core **34466774500 attempt1@632 passed**; full
[34467283585 attempt1@632](https://github.com/drrowdev/hybrid-training-app/actions/runs/34467283585)
ran all25 once: **24 passed / 1 failed / 0 flaky / 0 skipped**,134031ms.
A7 alone failed9112ms at original line2011, first-Finish Your swim summary.
Exact restored Notes/whole draft, limitation creation, unchanged swim rows and
restored lengths/time/RPE passed; canonical completion and future rejection
remainder were not reached. Original24, first10 non-browser stages and both
cleanups passed. **Main remains failed, not25/25; no product cause is demonstrated.**
Earlier524/full34464675255 remains failed; accepted24/22 remain historical.
Consumed reference/agent logs, transcripts and download URLs were not fetched;
prior34465718698 was not restarted. Core failed-job lookup returned zero jobs.

Commands from `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/workout-controls.test.tsx src/lib/swim/__tests__/draft.test.ts src/lib/swim/__tests__/swim-alert-membership.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts`
  — **1132 passed**, six files44/13/29/639/406/1. Source-executing VM tests reuse
  A3's EventEmitter/fake-clock/real SDK/pinned FormData mechanisms: fast response,
  unseen/pending/failure, foreign/malformed pairing, exact owner/session/receipt,
  held/late decoder/backend/view reads, success/failure cleanup and original error
  priority. Development runs caught two projection/click expectations and the old
  blanket no-A7-diagnostics source guard; these were narrowly updated.
- Actual private Playwright1.60.0
  `test --list --config=playwright.swim-reference.config.ts --project=mobile-chromium --reporter=json`
  — frozen25/sixfiles2/4/7/8/3/1, original24 prefix, zeroexecution/errors, private
  modes/cleanup passed; safe result success/exit0/unknown/empty sources.
- `pnpm --filter @hta/web exec eslint e2e/swimming-lifecycle-load-mobile.spec.ts scripts/swim-alert-membership.ts src/lib/swim/__tests__/swim-alert-membership.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-acceptance.test.ts`,
  `pnpm --filter @hta/web typecheck`, `pnpm docs:check-drift` (offline) and
  `git diff --check` passed.
  Secret scans clean; native hooks and local/public source identities verified.
  Required CodeQL returned0 alerts but **no usable analysis**: Actions failed,
  JavaScript database too large. This is not a security-analysis pass.

[DC-SW7/SW8/SW9](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05)
oracles and all versions/limits remain unchanged: Node22/pnpm10.33.2,
Next16.2.6/React19.2.4/Playwright1.60.0; 30s case/300s browser/330s command/
590s phase/410s server/35m main+3mcleanup/45mjob, CLI2.116/default12,
loopback/0700dirs/0600files, normal149/separate146–148 identity and existing FK/Auth gates.
No dependencies, services/browser runtime/DB/Docker/Supabase startup, fixtures,
workflow dispatch, delegated chain, migration/RLS changes or history rewrite.
**Collection is not runtime acceptance; diagnostic-only future success is not
a causal product-fix claim.** Coordinator must inspect the complete saved source,
model/refs, then exact-head core before ONE changed-head full25 with exact
`expected_sha`, `swim_acceptance=true`, `migrate_production=false`,
`allow_undeployed=false`. Seven of nine gates covered; A7/concurrency remain open,
no combined work before all9. Production reconciliation and owner-approved
unshipped-only migration ordering/down plan remain required; never reset the
ledger. Existing getsxc.app accounts and deferred backups are unchanged.

## LATEST — PR805 A7 filled Notes selector correction — 2026-09-10

Started at exact live `524c59355f04cfd7849c1f161300f761cd874cdc`, base
`e2758dadbb110e03794e49d53b47622a6295e988`; sole worker on the existing branch.
Source/test saved early as **`5c8b18cbb3e4def42f1979bfc3b8e8bbadf3cc2e`**.
Only A7's two Notes lookups now use the existing exact textbox accessible name
([DC-SW7/DC-SW9](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05)).
Exact retained value, whole-draft equality, canonical notes/receipt/history/load,
restriction/primary/row invariants, future rejections and final-navigation waits
remain unchanged. Other24 cases and the uncontrolled Reason field are untouched.

Coordinator-supplied runtime evidence: exact-head core **34464155869 passed**;
full25 **34464675255 attempt1: 24 passed / 1 failed**, zero flaky/skipped,
155281ms. Original24 passed again. Only A7 failed,9435ms, at original line2005
exact Notes lookup. Start, four stored draft fields, real limitation save/owner
row, unchanged swim rows, return and restored lengths/time/RPE/disclosure passed.
Finish/future Start/resume checks were not reached. All10 non-browser main stages
and both cleanups passed, including Native16, normal149/catalog, identity
5phases4DDL15contexts, Auth36HTTP, FK proof and core/identity. **Main remains failed,
not25/25.** Run metadata confirmed status; only a log URL was requested to satisfy
the required CI investigation, without downloading raw logs or transcripts.
Previously consumed reference records and prior worker were not rerun.

Commands from `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/workout-controls.test.tsx -t 'A7 DC-SW7/DC-SW9: retained Notes'`
  before the spec fix: **1 failed** at the authored-source lookup check. Earlier
  assertions passed: installed Playwright1.60.0 exact label engine finds empty
  Notes but not filled Notes; its role engine finds both and reads the exact
  retained value. Actual WorkoutClient SSR label/textarea, React19.2.4 and the
  existing Capacitor→plist DOM parser are used; selector algorithms are executed
  unchanged from the installed bundle. A limited HTML DOM adapter models the
  isolated, disclosed label. This does **not** execute hydration, the restore
  effect, browser layout or navigation, and does not demonstrate lost notes.
- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/workout-controls.test.tsx src/lib/swim/__tests__/draft.test.ts src/lib/swim/__tests__/swim-alert-membership.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts`
  — **1079 passed**, six files44/13/25/590/406/1. Private installed Playwright1.60.0
  `test --list --config=playwright.swim-reference.config.ts --project=mobile-chromium --reporter=json`
  collected frozen25/sixfiles2/4/7/8/3/1, zero execution/errors; A7index24,
  original24 prefix and A3/A4 diagnostic points20/21 intact. Safe collection
  result success/exit0/unknown/empty sources; private cleanup passed.
- `pnpm --filter @hta/web exec eslint e2e/swimming-lifecycle-load-mobile.spec.ts src/lib/swim/__tests__/workout-controls.test.tsx`,
  `pnpm --filter @hta/web typecheck`, `pnpm docs:check-drift` (offline) and
  `git diff --check` passed. Secret scan clean; mandatory CodeQL skipped test-only
  changes. Native pre-push hooks passed after fetching missing full history;
  source author/committer identities verified locally and publicly.

No product/storage/dependency/fixture/workflow/runtime changes, service startup,
browser execution, delegation, dispatch, hook bypass or history rewrite.
**Collection is not runtime acceptance.** Coordinator must inspect saved source
and exact-head core before ONE new-head full25 with exact expected SHA,
`swim_acceptance=true`, `migrate_production=false`, `allow_undeployed=false`.
Seven of nine standalone gates remain covered; A7/concurrency remainder stays
open. No combined work before all9. Production still needs current-main/native
stack reconciliation and owner-approved unshipped-only ordering/down plan, never
a ledger reset. Existing getsxc.app accounts and deferred backups are unchanged.

## LATEST — PR805 A7 final-return ordering correction — 2026-09-10

Started at live-verified `1d8e13ae7a6019316ba0009790f3ea8a9b9eb0b2`, same feature
branch and exact base `e2758dadbb110e03794e49d53b47622a6295e988`.
Source/test fix saved early as **`3223208393f815ded5d473717ce4aa493a83b036`**.
For [DC-SW7/DC-SW9](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05),
A7's final link click now awaits the exact workout URL and saved-result content
before reload, following A5 without editing it. The spec delta is exactly two
waits; every post-reload result/prescription/row/limitation/primary/load check,
other24 bodies, helpers, cohort and guards remain unchanged.

Commands from `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `git diff --exit-code 1d8e13ae7a6019316ba0009790f3ea8a9b9eb0b2 -- apps/web/e2e/swimming-lifecycle-load-mobile.spec.ts`
  passed before the fix. Then
  `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-browser-acceptance.test.ts -t 'A7 DC-SW7/DC-SW9: the authored final return'`
  **failed against unchanged1d8 source**: reload already called once while
  destination was pending. Same command after correction: **1 passed** (589
  unselected). The regression transpiles/VM-executes the actual final block,
  separately holds destination and result rendering, then proves one reload
  followed by the original saved-result assertion. No browser/network/DB.
- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-alert-membership.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts`
  — **1022 passed**, four files25/590/406/1. Installed private Playwright1.60.0
  `--list`: exact25/sixfiles2/4/7/8/3/1, zeroexecution/errors; safe collection
  result success/exit0/unknown/empty sources. A7index24 and A3/A4points20/21 intact.
- `pnpm --filter @hta/web exec eslint e2e/swimming-lifecycle-load-mobile.spec.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts`
  and `pnpm --filter @hta/web typecheck` — passed; `git diff --check` passed.
  Source secret scan clean; mandatory CodeQL skipped test-only changes.

Initial progress push failed closed on shallow history; fetched full history,
without rewrite or hook bypass. Source publication passed unchanged mandatory
pre-push hooks; local/public cloud198982749 author and GitHub noreply committer
verified. No dependency, product, fixture, workflow, timeout or runtime changes.
**Collection is not runtime acceptance.** Accepted24@0a0e/full34460014574 remains
accepted; previous worker34461618056 completed successfully, not restarted.
Coordinator source/ref/no-writer/CI inspection, exact-head core then ONE full25
remain pending with the existing exact-SHA/nonproduction flags. Seven of nine
standalone gates remain covered; A7 and concurrency runtime remainder, separate
combined/production approvals, owner migration ordering/down-plan and deferred
backups remain unchanged. No browser/server/database startup or workflow dispatch.

## LATEST — PR805 standalone A7 source — 2026-09-10

Verified live source `copilot/new-acceptance-cases@0a0e64fec61074d05651246bb9b6eb1e964d1820`
and base `copilot/prepare-mobile-persistence-tests@e2758dadbb110e03794e49d53b47622a6295e988`.
Only A7 is appended after A6 for
[DC-SW7/DC-SW9](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05).
The accepted24 bodies/identities/assertions remain intact; closed25 uses the same
six files, counts **2/4/7/8/3/1**, A7 index24. A3/A4 points stay at20/21;
A7 has no annotations or diagnostic fields.

Coordinator-supplied accepted evidence, not re-fetched: full **34460014574
attempt1** at exact `0a0e64fec61074d05651246bb9b6eb1e964d1820`,
reference102815361640/projectpr802-34460014574-1: **all24 passed once,
0unexpected/flaky/skipped,159461ms**. A3/A4/A5/A6=12897/6738/8484/7488ms.
All11 main stages passed, empty failure ledger, main and final cleanup verified.
Native16, normal149/catalog, identity5phases4DDL15contexts, Auth36HTTP,
single-FK down/up/necessity/forcedchecking/invalidupdate and core/identity passed;
15 marked safe records consumed once. Exact core34459459983 preceded reference.
Accepted22/full34450901183@89f63 remains accepted. First24/full34454551886@306
remains failed21/24. Saved8c9 corrected A5 navigation and A6 multipart decoding;
0a0e bounded A3 observations are not a proven causal fix.

A7 uses the real injuries Add modal after a real Start, deriving an actual muscle
and region from current constants and both issued exposures. Mild severity is
intentional: the nonempty active region blocks independently of severity.
The genuine local lengths/time/RPE/notes draft is retained, then completed through
UI with canonical receipt/history and once-only shared regional-load oracles.
The primary baseline is nonempty, with completed primary evidence; the protected
baseline is re-captured **after** adding the limitation, allowing that action's
legitimate primary response. No alternate catalog/profile state is seeded.
The unstarted workout has no result fields: its existing skip-reason input is
filled but never submitted, then retained across rejected Start. Target and exact
canonical state are unchanged. Pause and real reviewed future dates exercise
rejected resume application (not rejected read-only preview); exact state equality
covers dates, targets, decisions, status, receipt/history and load, including reload.
All runtime rows/IDs/input values remain in memory; new assertions use booleans
and static safe errors, with permitted positive limitation feedback.

Local validation was checkpointed before lengthy mandatory hooks.
First affected four-selector run:1020pass/1fail (one stale24-slot observation
expectation); scoped lint passed, web types found one nullable ID. Both corrected.
Its installed private Playwright1.60.0 `--list` already collected25 once with
zero execution/errors; **collection is not browser acceptance**. Final verified
commands and counts are recorded below.
Initial progress push hit the unchanged shallow-history guard; only
`git fetch --unshallow origin` was used to load history. No rewrite or hook bypass.
Node22.23.2/pnpm10.33.2 and dependency/runtime/guard settings remain unchanged.

**Still required:** coordinator source/ref/no-writer/CI guards, exact new-head
core, then **ONE full25**, feature ref, `expected_sha` exact,
`swim_acceptance=true`, `migrate_production=false`, `allow_undeployed=false`.
A7's completion, new-start rejection, resume rejection, load and unchanged primary
state still need that runtime proof within existing30s; no pass is claimed here.
No browser/server/SQL/DB/Docker/Supabase startup, hosted services/credentials,
dispatch, deployment or export in this worker. No product/schema/RLS/Auth,
dependency/workflow/guard/fixture/UI-copy/runtime-limit changes.
Seven of nine standalone areas were covered before this source addition; runtime
A7 and concurrent/stale scheduling/proposal acceptance remain unclosed.
Combined waits for all nine. Production current-main/nativeStack804 reconciliation
and UNSHIPPED-ONLY migration ordering/down-plan still require owner confirmation;
no ledger reset or production authority assumed. Backups remain deferred.

### A7 checkpoint validation

Commands from `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-alert-membership.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts`
  — **1021/1021 passed**, four files,25/589/406/1 tests,3.91s.
  Includes rejection of old24 (A7 removed first), older cohorts, same-total A7
  substitutions, duplicate/skip/retry/flaky/wrong-file identities and existing
  privacy/source-attribution/annotation-point contracts.
- That existing collection test invokes the installed private
  `@playwright/test/cli test --list --config=playwright.swim-reference.config.ts --project=mobile-chromium --reporter=json`
  with isolated0700 paths and bounded in-memory JSON. **Playwright1.60.0:
  exact25 once/sixfiles2/4/7/8/3/1, zeroexecution/errors**; safe result
  `[swim-collection]{"success":true,"exit":0,"loaderCode":"unknown","sources":[]}`.
- `pnpm --filter @hta/web exec eslint e2e/swimming-lifecycle-load-mobile.spec.ts scripts/swim-browser-acceptance.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts`
  — passed.
- `pnpm --filter @hta/web typecheck` — passed.
- `git diff --check` — passed. In-memory source comparison against exact0a0e
  proved A1–A6 plus intervening helpers byte-identical; other accepted case files
  are untouched. Changed-file secret scan passed.

Source checkpoint **e509c70d889db19133a978bb3e65f77e4ae9da0b** is published.
The unchanged mandatory pre-push hook passed (identity history, workspace types,
package tests, db schema check, docs drift); no separate full core/build run.
Local and public metadata both show native cloud Copilot author
`198982749+Copilot@users.noreply.github.com` and committer `noreply@github.com`.
Live base remains exacte2758dad. Mandatory CodeQL returned skipped for test-only/
documentation changes, not a runtime safety pass. Final source scope is only
the lifecycle spec, closed reader and its two existing test files, HANDOFF,
pool-swimming wiki and append-only knowledge log.

## LATEST — PR805 A3 first-Finish observations — 2026-09-10

Live source/base verified before editing: `copilot/new-acceptance-cases@8c9e2f9ebfec6814af600c315db6fa1d43933f99`
and `copilot/prepare-mobile-persistence-tests@e2758dadbb110e03794e49d53b47622a6295e988`.
Coordinator evidence: accepted full22 `34450901183@89f63bdd0d6661841eeb24d6f8cc8172299b831d`,
all22 once, zero skips/flaky, 86.599s; all11 main stages and both cleanup passed.
First full24 `34454551886` attempt1 at `306f1ae3a865ce76bb2309617715ae967528cc69`,
reference102797792203: 21pass/3fail, all24 once, zero skips/flaky.
A3 first Finish failed before archive/replacement (line1007, 7843ms);
A5 post-purge reload failed (line1573, 12280ms); A6 identity helper failed
after first edit (line1434, 5975ms), before stale second edit. MAIN FAILED despite cleanup.

Inspected/preserved the saved `8c9e2f9` A5 destination/removed-before-reload
correction and A6 pinned root0/$K/_part_ decoding; neither is reimplemented.
Only A3's first Finish gains two index20 finite observations: original-request
transport and matching canonical receipt/UI/alert sample. Original five-second
Edit-result goal is unchanged and ungated. No causal fix is claimed. Reads are
single response-triggered samples, not continuous coverage; absent, ambiguous
or unreadable receipt pairing stays unavailable. No raw transport/IDs/rows/errors
are persisted. A4 and the other23 bodies remain unchanged.

Early checkpoint: from repository root,
`pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-alert-membership.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts`
passed **994/994** (25/562/406/1), 5.32s. First run was 993pass/1fail due
to a stale index20 projection expectation, corrected before checkpoint.
Private installed Playwright1.60.0 actual `--list` passed exact24/sixfiles
2/4/6/8/3/1, zero execution/errors; safe collection result success=true/exit0.
`git diff --check` and changed-file secret scan passed. Scoped lint/types and
final source-executing pairing checks subsequently passed (below).
Initial progress publication hit the existing
full-history identity guard; `git fetch --unshallow origin` loaded history without
rewriting it. No private worker command/result or historical logs/transcripts
were obtained. Only ordinary CI identity-job metadata/log tail was inspected.
Coordinator still owns exact-head core then ONE guarded full24; collection is
not browser acceptance. No product, services, database, dispatch or guard changes.

### Saved checkpoints and final local validation

`f035f72bd40b0a0e2779ee7b9e6e637b9bbf84c1` saved the observation/docs checkpoint
locally before publication was stopped by FormData ID type narrowing errors.
`cd7c825b7534968e212037e2e745f1dd51b053dd` fixed those errors and added pinned
encoder coverage; both checkpoints are published. Both public/local author emails
are cloud Copilot `198982749+Copilot@users.noreply.github.com`, committer
`noreply@github.com`. The unchanged pre-push identity guard passed (143 commits
at first checkpoint); publication subsequently passed the mandatory hook.
That hook runs workspace typechecks/package tests/db:check/docs drift; no
separate full-suite/build command was requested or run.

Final four-selector command above: **1009/1009 passed** (25 membership,
577 browser-reader/acceptance including source-executing A3 cases, 406 acceptance,
1 actual private collection), **5.64s**. The earlier post-decoder run passed995/995.
Collection remains24/sixfiles2/4/6/8/3/1, zero execution/errors; this is NOT browser
acceptance. Pinned13-mode decoder coverage rejects malformed/ambiguous fields and
invalid IDs. Fourteen source-executing observation modes cover fast original
response, unseen/pending/failed/unpaired transport, wrong origin/path, invalid
pairing, wrong receipt/null or invalid timestamp, aborted SDK read, read failure,
and ambiguous second request. They preserve the original UI error, one unchanged
visibility assertion, abort reads with retries disabled, detach owned listeners,
clear the owned timer and prohibit post-failure samples.

Also passed, from repository root:
- `pnpm --filter @hta/web exec eslint e2e/swimming-lifecycle-load-mobile.spec.ts scripts/swim-alert-membership.ts src/lib/swim/__tests__/swim-alert-membership.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts`
- `pnpm --filter @hta/web typecheck`

Required CodeQL on the published observation source returned zero alerts but
**no usable analysis** (Actions failed; JavaScript database too large), not a
security pass. Final added regression/docs checkpoint does not change that source.
No exact-head core or full24 browser acceptance has run here. Coordinator source/
privacy/ref/no-writer/CI guards, exact-head core, then ONE full24 with exact
expected_sha remain required. Current main/nativeStack804 and production
unshipped-only migration ordering/down-plan still require owner approval;
no migration ledger/production authority assumed. Existing gaps/gates, swimming
in getsxc.app existing accounts, and deferred backups remain unchanged.

## LATEST — PR805 bounded A4 observations — 2026-09-10 — DIAGNOSTICS ONLY

Continued sole writer `copilot/new-acceptance-cases` from exact
`8d16d231472746d5b9549070646667d205c811dc`, unchanged declared base
`copilot/prepare-mobile-persistence-tests@e2758dadbb110e03794e49d53b47622a6295e988`.
Published source/test checkpoint **`b2d1046bab5aa3d250ff92cee0f5fd7d048e6975`**,
exact tested tree **`a003709fa29026cbd846a141c5b3a290f14b7e5d`**;
`apps/web` subtree **`042608d730c5786c9a0c419bce64c1f052c64e17`**.
This subsequent handoff/wiki update changes no source/tests.

Coordinator-provided full34448179711@8d16, reference102777539397 ran ALL22
once: **21 passed, 1 failed, 0 skipped, 0 flaky; total89988ms**.
A2/A3 passed5556/9493ms; B6/B7 passed2035/3330ms. Only A4 failed8343ms at
the original lifecycle1180 Edit-result visibility assertion after reconnect.
All prior A4 offline receipt/second-context archive/stored-state equality steps
passed. Native16/normal149/catalog/identity/Auth36HTTP/FK/core and both cleanup
phases passed per coordinator. **FAILED MAIN RETAINED.** Historical source-line
evidence has no raw error/body/row; no historical logs, log URLs or private
transcripts were fetched. The independently proven shared-flusher correction is
unchanged. Neither its relation to earlier failures nor a cause/fix for A4 is claimed.

### Observation semantics and ownership

Only A4 and imports in `apps/web/e2e/swimming-lifecycle-load-mobile.spec.ts`,
`apps/web/scripts/swim-alert-membership.ts`, and the existing membership/
browser-acceptance unit tests changed in the source checkpoint.

- `a4-replay`: existing source-derived alert/UI classifications; backend
  `reached` only for the exact synthetic owner/session, expected completion
  receipt and valid non-null completion timestamp. Valid incomplete/different
  receipt is `not-reached`; missing/malformed/read failure is `unavailable`.
  Revision remains unavailable. This is not history/load or action-outcome proof.
- `a4-replay-transport`: only the existing C2Transport enum in result; all other
  fields unavailable. Request matching requires loopback origin, exact workout
  path, POST, next-action and all three original queued IDs in memory. Responses/
  failures pair by exact original Request object; later requests cannot replace
  it. That same object remains the later intentional idempotency replay input.
- Both points project only at caseINDEX21. Exactly six keys, strict160-character
  grammar, max16 annotations, old point combinations, case identities/count/order
  and reader privacy remain. No reader modification or emitted identifiers,
  URLs, headers, bodies, rows, query errors, counts or arbitrary text.
- The existing five-second UI assertion runs concurrently with bounded sampling;
  category text and backend/HTTP outcomes never gate positive assertions.
  One deadline/AbortController stops writes, aborts the SDK read (automatic retries
  explicitly disabled), and clears owned timers/listeners. Cleanup drains owned
  promises; only an already-failed page with pending browser evaluations is closed.
  There is no post-failure sampling window, added assertion retry/sleep or raised
  deadline. Annotation/read failures cannot replace the primary UI error.
- All21 other cases and A4's before/after-window source were byte-compared against
  8d16. Empty original queue, exact receipt/completion/history/load, archived-late
  progression exclusion, original-request replay and subsequent equality remain.

### Exact validation (repository root)

Root: `/home/runner/work/hybrid-training-app/hybrid-training-app`.

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-alert-membership.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts src/lib/offline/__tests__/flusher.test.ts src/lib/swim/__tests__/workout-controls.test.tsx src/lib/swim/__tests__/actions.test.ts src/lib/swim/__tests__/lifecycle.test.ts src/lib/swim/__tests__/draft.test.ts`
  — **8 files / 687 passed**: membership22, reader/source541, privatecollection1,
  flusher21, controls43, actions37, lifecycle9, draft13.
- Source-executing VM/EventEmitter/deferred harness uses the official SDK with
  mocked fetch, not SQL or a browser simulator. Covers exact request pairing,
  finite transport classes, receipt vs HTTP independence, category-independent
  sampling, early abort, deadline, pending-read drain, listener/timer cleanup and
  primary-error preservation; parser/reader tests cover strict A4-only projection.
- Existing private collection invoked installed **Playwright1.60.0**
  `test --list --config=playwright.swim-reference.config.ts --project=mobile-chromium --reporter=json`:
  exact22/six files**2/4/4/8/3/1**, zero executed results/errors, private0700
  directory identity/exact cleanup verified. JSON stays in bounded memory;
  reader tests separately verify the unchanged0600 report contract.
  Safe summary `[swim-collection]{"success":true,"exit":0,"loaderCode":"unknown","sources":[]}`.
- `pnpm --filter @hta/web exec eslint e2e/swimming-lifecycle-load-mobile.spec.ts scripts/swim-alert-membership.ts src/lib/swim/__tests__/swim-alert-membership.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts`,
  `pnpm --filter @hta/web typecheck`, `pnpm docs:check-drift` (offline),
  `git diff --check` — passed.
- `printf 'HEAD %s refs/heads/copilot/new-acceptance-cases %s\n' "$(git rev-parse HEAD)" 8d16d231472746d5b9549070646667d205c811dc | node scripts/check-commit-identities.mjs pre-push origin`
  —137 existing commits inspected before source publication. Initial progress
  push failed closed on shallow history; fetched full history, no bypass/rewrite.
  Published source metadata verifies cloud198982749 author/GitHub noreply committer.
- Source secret scan clean. Post-commit nontrivial CodeQL request: **zero alerts,
  no usable analysis** (Actions failed; JavaScript database too large).
  This is not a security-analysis pass.

Scope: [DC-SW7/SW8/SW9](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05).
**DIAGNOSTICS ONLY: not a bug fix, runtime pass, causal diagnosis or release
approval.** Coordinator source/privacy/timebound inspection, exact-head core,
then ONE new-head full22 with safe summary consumed once remain next.
No live browser/SQL/Docker/hosted/production data, dispatch, delegation, branch,
merge, history rewrite, product/action/DB/schema/RLS/auth/grant/fixture/workflow/
dependency/guard/hook changes. CLI2.116/default12/loopback/private0700/0600,
30s case/300s browser/330s command/590s phase/410s server/35m main+3m cleanup/45m
job unchanged. Normal149 vs identity146/147/148; Auth5phases4DDL15contexts36HTTP;
only set_logs FK deferrable; original session_movements RESTRICT/OID and
23503/delete1/forced-check/invalid-update/down-up/restoration/cleanup proofs remain.
Unshipped migration ordering/down-plan still needs separate owner approval;
never reset the ledger. Swimming stays in getsxc.app existing accounts.

## Historical — PR805 initial-Finish coordination regression/fix — 2026-09-10

Continued `copilot/new-acceptance-cases` from exact
`9419d815e671fe7418fa994bfeca95e562f290ff`, declared base
`copilot/prepare-mobile-persistence-tests@e2758dadbb110e03794e49d53b47622a6295e988`.
Implementation checkpoint `3fe00fae27f95006db8dc26f8cce58dd89ba5b61`;
expanded regression checkpoint **`3385edb3ada1aace59a34b7e9433860db07c87c6`**,
exact tested code/test tree **`81ea3eba3308f356b37d4f59e76f40931783c689`**.
This later documentation-only checkpoint does not change that code/test tree.
Only `apps/web/src/lib/offline/flusher.ts`, its existing
`__tests__/flusher.test.ts`, and the three authorized documents changed.

### Runtime provenance, including the previously omitted 9419 source checkpoint

`9419d815` changed only B6/B7's before/after reload snapshots from ambiguous
global `main` to the unique whole workout page `main.cp-main > main`, asserting
one match before and after reload. It preserved exact course/budget assertions
and complete workout-page text plus DB equality. This source correction and the
earlier summary-scoped course correction are **unchanged here**.

Coordinator-provided full34445940362@9419d815 executed ALL22 ONCE:
**20 passed, 2 failed, 0 skipped, 0 flaky**, total case124710ms.
**B6/B7 passed3131/3350ms**, including exact budget/course, entire workout page
before/after reload and DB equality. New failures in unchanged lifecycle source:
A2 at745 in7711ms, initial-Finish `16 lengths · 15:00 · RPE 6` assertion,
BEFORE editing; post-start observation reached, later a2-edit unavailable because
unreached. A3 at1003 in8213ms, initial-Finish Edit result visibility. Both passed
previous runs; all other20 including A4 passed. Native16, normal149,
catalog/identity matched, Auth36HTTP/FK matched, core/identity, main and separate
final cleanup passed per coordinator. **The main browser failure remains failure.**
No raw historical errors, rows or network bodies are available, and none were
inferred. Actions metadata matched the supplied run; no old logs/log URLs or
private transcripts were fetched.

### Demonstrated source invariants, not a retrospective runtime diagnosis

Read the whole `WorkoutClient` submit/queue effect, both shared-flusher consumers
(WorkoutClient and SessionWorkArea), outbox claims/classification/durable action,
`completeSwimWorkoutResult`, `WorkoutScreen` and `nextConfirmedView` before fixing.
Completion still requires a server acknowledgement and refreshed canonical props.
The existing view helper accepts newer completion props and rejects stale ones;
neither the UI nor completion action/view policy needed modification.

Existing Vitest mocks and explicitly resolved promises exercise the **real**
`flushOutbox`/`startAutoFlush`, not a copied algorithm or scheduler sleeps.
The unchanged production implementation, with the first five regression cases:

- **12 passed, 3 failed (15 total).** A pending read held at either the initial
  empty snapshot or the final remaining-count snapshot, followed by a new native
  completion and overlapping flush request, leaves that completion queued without
  sending it. The replacement auto-flush subscriber receives empty completion
  counts instead of the eventual confirmed completion; the stopped callback
  remains suppressed. Both returned/thrown transient-error controls pass.
- An earlier harness run had an unsupported Vitest matcher; it was corrected
  before the substantive baseline above. It is not counted as product evidence.
- The fix shares the active drain's aggregate result and coalesces overlapping
  triggers into a fresh FIFO snapshot before settlement, including triggers
  arriving during the final pending-count read. Merely joining the old snapshot
  would not fix the stranded-entry regressions.
- A transient failure below the retry limit or denied head lease stops the
  entire joined drain: no overlap-driven immediate retry or overtaking. Existing
  terminal/dead-letter behavior and bounded attempts remain. The lock clears on
  settlement/failure; offline/unavailable queues wait for a later trigger.
- Expanded **21 flusher tests pass**: mixed set/cardio/cardio-session/session
  completion/native-swim order, one send per claimed lease, shared canonical
  completion counts, transient failure in the newly discovered batch, occupied
  cross-tab lease, unchanged receipt on later retry, offline recovery, shared
  storage failure/recovery and subscription timer/listener cleanup. Existing
  poison-head/exhausted-budget tests still pass.

These tests prove missed drain/notification behavior at controlled mocked
storage/action boundaries. They do **not** prove either window occurred in
full34445940362, nor that the UI fallback queue check failed. They do not exercise
real IndexedDB, React effects, network delivery, SQL or new-head browser timing.
No flakiness diagnosis, invented saved UI, new diagnostic fields or timeout change.
B2 lost-response and A4 archived-offline source/assertions remain untouched;
source tests are not a new live pass for them.

### Exact source validation

Commands from `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- Baseline: `pnpm --filter @hta/web exec vitest run src/lib/offline/__tests__/flusher.test.ts`
  — corrected baseline12pass/3fail; after fix15pass.
- First fixed checkpoint:
  `pnpm --filter @hta/web exec vitest run src/lib/offline/__tests__/flusher.test.ts src/lib/swim/__tests__/workout-controls.test.tsx src/lib/swim/__tests__/actions.test.ts src/lib/swim/__tests__/lifecycle.test.ts`
  — **4 files104 passed** (15/43/37/9).
- Final tested code/test tree:
  `pnpm --filter @hta/web exec vitest run src/lib/offline/__tests__ src/lib/swim/__tests__/workout-controls.test.tsx src/lib/swim/__tests__/actions.test.ts src/lib/swim/__tests__/lifecycle.test.ts src/lib/swim/__tests__/draft.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts`
  — **12 files653 passed**: flusher21, outbox-core19, durable-action6,
  session-completion4, outbox-upgrade1, client-id1, workout-controls43,
  actions37, lifecycle9, draft13, acceptance-reader498, private-collection1.
- Collection ran installed **Playwright1.60.0** actual
  `test --list --config=playwright.swim-reference.config.ts --project=mobile-chromium --reporter=json`:
  exact22 identities/six files2/4/4/8/3/1, zero execution/errors; private0700
  directory identity and exact cleanup verified. Reader tests retain the private
  0600 report contract; collection output stays in bounded memory.
  Safe result `[swim-collection]{"success":true,"exit":0,"loaderCode":"unknown","sources":[]}`.
- `pnpm --filter @hta/web exec eslint src/lib/offline/flusher.ts src/lib/offline/__tests__/flusher.test.ts`,
  `pnpm --filter @hta/web typecheck`, `pnpm docs:check-drift` (offline in-repo),
  and `git diff --check` — passed.
- `git diff 9419d815e671fe7418fa994bfeca95e562f290ff --quiet -- /home/runner/work/hybrid-training-app/hybrid-training-app/apps/web/e2e /home/runner/work/hybrid-training-app/hybrid-training-app/apps/web/scripts`
  — exit0: acceptance cases/reader/reporting/runner sources unchanged.
- `printf 'HEAD %s refs/heads/copilot/new-acceptance-cases %s\n' "$(git rev-parse HEAD)" 9419d815e671fe7418fa994bfeca95e562f290ff | node scripts/check-commit-identities.mjs pre-push origin`
  — passed, **136 introduced commits inspected** at3385edb3. Initial progress
  publication failed closed on shallow history; full history fetched, no rewrite
  or hook bypass. Both source checkpoints' local/public metadata verify native
  cloud198982749 author and GitHub `noreply@github.com` committer.
- Source secret scans clean. Post-commit nontrivial CodeQL request returned
  **zero alerts but no usable analysis**: Actions analysis failed; JavaScript
  skipped because database size was too large. This is not a security-analysis
  pass. No dependencies or action/ownership/receipt classification rules changed.

Scope respects [DC-SW7/SW8/SW9](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05).
Freeze22 identities/order/six files/all native/history/load assertions. No
domain/engine/training math/DB/schema/RLS/auth/grants/fixture/workflow/identity
guard/hook/AGENTS changes; no browser execution, SQL, Docker, hosted-data,
production, dispatch, delegation, new branch, merge or history rewrite.
CLI2.116/default12services/private0700/0600/loopback and deadlines
30s case/300s browser/330s command/590s phase/410s server/35m main+3m cleanup/45m
job remain. Normal149 vs identity146/147/148; Auth5phases4DDL15contexts36HTTP;
only set_logs FK deferrable, original session_movements RESTRICT/OID,
23503/delete1/forced checking/invalid-update/down-up/restoration/exact cleanup
remain. Main145/unshipped swim145–148 ordering/downplan needs later owner
approval; never reset the ledger. Backups deferred; swimming stays in getsxc.app.
**Next: coordinator inspects this head, exact-head core, then ONE new-head full22.
New-head runtime acceptance and historical A2/A3 causation are not proved.**

## PR805 frozen22 five-failure source correction — 2026-09-10

Continued the existing branch at exact
`6d17df020fee0d772aa00fb7e2852638b4a4a530`, declared base
`copilot/prepare-mobile-persistence-tests@e2758dadbb110e03794e49d53b47622a6295e988`.
Validated code/test tree (before this documentation-only update):
`0d6e7675e72140d4aed0dbbd970dd0729a297dbb`. Only three authorized E2E files,
the existing browser-acceptance unit file, and the three authorized documents
changed. No new cases, product changes, SQL execution, database/hosting work,
browser execution, workflow dispatch, model/agent delegation or history rewrite.

### Immutable runtime provenance and remaining gate

Coordinator-provided evidence: core34440481521@6d17df0 succeeded;
full22 run34440810700@6d17df0, job102755279732 failed after7m0s.
All22 executed once: **17 passed, 5 failed, 0 skipped, 0 flaky**;
sum of case durations183057ms. Original15, E2 and A4 passed.
B6/B7/B8 timed out at30114/30123/30116ms at decisions spec184;
E1 failed in428ms at storage.ts49; A3 failed in12871ms at lifecycle1075.
No underlying E1 raw error/SQL was supplied or inferred.
GitHub Actions metadata confirmed run status and failed-job identity; only the
log URL was requested, not its raw content.
Native16 and normal149 migration/catalog/identity down-up, Auth36HTTP,
single-set_logs-FK down-up/necessity/invalid-update proof passed; core/identity
and both cleanup phases passed. **The main browser failure remains failure.**

All five have source corrections below, not new-head runtime acceptance.
Coordinator inspects this checkpoint, runs current-head core, then ONE guarded
new-head full22. No case expansion before that milestone. All original22
identities/order and six-file counts2/4/4/8/3/1 remain frozen.

### Demonstrated defects and exact corrections

- **B6/B7/B8:** `budgetSetup` filtered the form and selected controls with exact
  label-text matching. `SetupForm.tsx` wraps select/options inside labels;
  option text participates in label text. Use the passing helpers' actual
  `combobox` accessible-name semantics for Pool length, Goal, Swimming
  experience and Assessment stroke. Require exactly one matching form.
  No budget inputs, preview/decision assertions or timeouts changed.
  Selector correction is source-grounded; private collection is not evidence
  of live DOM interaction.
- **E1:** both native unverified observations meet
  `0145_standalone_pool_swimming.sql:274–307` (8×25=200,16×25=400, positive
  integer times, supported labels); null calibration is permitted.
  Create goes through `0146_swim_request_identity.sql:120–165`; E2 used the
  same empty-observation arrangement successfully. The yard completion
  supplied `allowChangedCourse=true` but no `provenance.deviationReason`.
  `swim_validate_result_course`, 0145:536–568, requires BOTH consent and a
  nonblank reason. The 0146 completion calls that validator.
  Existing `storage-rpc.smoke.test.ts:577–585` supplies both for this same
  yard-pool change; canonical `actions.ts:82–102` rejects a missing reason.
  Added only the yard result's reason. Retained both observations, three
  start/completion calls, 8m/16yd/8m lengths, times, snapshots, consent,
  calibration/bests/native-course/history/isolation assertions.
  The new unit executes the actual arrangement and completion source with
  generated E1 workouts, validates native results and compares missing versus
  supplied reason through the real form constructor. This proves a rejected
  fixture input, **not the unavailable historical RPC error or a live SQL pass**.
- **A3:** clicking a plan then immediately reloading could interrupt the
  destination navigation. Assert the chosen link's exact href, await its exact
  URL and selected `aria-current=page` before reload, then assert URL and
  selection again after reload. A source-executing unit models delayed
  navigation and rejects reload while a destination is pending. All positive
  history/issued-work/load assertions and A4 remain unchanged.

### Measured source validation

Commands from `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts src/lib/swim/__tests__/storage.test.ts src/lib/swim/__tests__/actions.test.ts src/lib/swim/__tests__/analytics.test.ts src/lib/swim/__tests__/navigation.test.ts src/lib/swim/__tests__/forms.test.ts`
  — **7 files,574 passed** (498/1/16/37/2/4/16).
  New regression-harness mistakes were corrected before this final green run:
  an unrelated yard fixture replaced the real generated start result, and
  spreading Vitest's matcher object omitted its `toBe` method.
- Existing private collection ran installed **Playwright1.60.0**
  `test --list --config=playwright.swim-reference.config.ts --project=mobile-chromium --reporter=json`:
  **22 exact identities,6files2/4/4/8/3/1,zero executed results/errors**,
  private directory/file identity/modes and exact cleanup checked.
  Safe result `[swim-collection]{"success":true,"exit":0,"loaderCode":"unknown","sources":[]}`.
- `pnpm --filter @hta/domain exec vitest run src/swimming.test.ts src/swim-pool-input.test.ts src/swim-workout-progress.test.ts`
  — **3 files,103 passed**.
- `pnpm --filter @hta/engine exec vitest run src/swimming.test.ts src/swimming-budget.test.ts`
  — **2 files,58 passed**.
- `pnpm --filter @hta/web exec eslint e2e/swimming-decisions-offline-mobile.spec.ts e2e/swimming-persistence-mobile.spec.ts e2e/swimming-lifecycle-load-mobile.spec.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts`
  and `pnpm --filter @hta/web typecheck` — passed.
- `pnpm docs:check-drift` — passed (offline in-repository checks);
  `git diff --check` — passed; log diff verified append-only.
  Seven-file secret scan — no secrets detected.
- `printf 'HEAD %s refs/heads/copilot/new-acceptance-cases %s\n' "$(git rev-parse HEAD)" 6d17df020fee0d772aa00fb7e2852638b4a4a530 | node scripts/check-commit-identities.mjs pre-push origin`
  — passed, **131 introduced commits inspected** before this checkpoint.
  Initial progress push failed closed on shallow history; fetched full history
  without rewriting it. Effective native cloud author198982749 and
  committer`noreply@github.com` are allowlisted; publication retains the hook.

Preserve CLI2.116/default12/private0700/0600/loopback isolation and all existing
30s/300s/330s/590s/410s/35m+3m/45m deadlines. Normal149 versus identity146/147/148;
Auth5phases4DDL15contexts36HTTP; only set_logs FK deferred, session_movements
unchanged; down/up/23503/delete1/forcedcheck/invalid-update/restoration/exactIDcleanup.
No production authority; backups deferred. Main/prod145 seed collision with
unshipped swim145–148 remains a later owner-approved integration gate; never
reset the ledger. Swimming remains inside getsxc.app.

## Historical PR805 frozen A3/A4 integration — 2026-09-10 — then live22 UNRUN

Continued `copilot/new-acceptance-cases` at exact
`1b3653d33442776be18a1923cca0c1813fefcf1e`, base
`copilot/prepare-mobile-persistence-tests@e2758dadbb110e03794e49d53b47622a6295e988`.
**Code/test checkpoint:** `e42ec6900e0cfe33aadded2aa033229eac1cd5cc`;
**tested tree:** `dc8d621d20c7f75080ec3019d20a29ade8ab70b8`.
Code/tests were published at04:49:53Z, before these documentation updates.

Imported ONLY `apps/web/e2e/swimming-lifecycle-load-mobile.spec.ts` from immutable
`4122e86b527b2ad6f4fe863ee64d3366457b1d23`, verified original blob
`954b8718785068a8e18df4292a38d5011bf6d438`. No PR811 merge/history, other source
files or future tip were adopted. Source author:
`copilot-swe-agent[bot] <198982749+Copilot@users.noreply.github.com>`;
committer: `GitHub <noreply@github.com>`. No source-worker validation was assumed.
The final lifecycle blob is `c98b79eb99b1a6c94c40140c7c3bf6bc882f159f`, differing
from that import ONLY in the demonstrated A3/A4 corrections below. Original
A1/A2 bodies/helpers and the shared fixture remain unchanged.

### Frozen cohort and demonstrated source corrections

Under [DC-SW7/SW8/SW9](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05),
A3 appends at20: real old-plan completion/start, Archive, Set up swimming and
new50m plan, preserved old history/issued work/primary training, no duplicate
load. A4 appends at21: offline Finish, stable receipt, second online context
Archive confirmed before reconnect, actual queue POST and identical captured
request replay, one history/result/session/load contribution, and exclusion
of late archived work from progression. These are authored assertions, **not
browser acceptance**. The lifecycle ledger uses `deriveDailyRegionLoad` and
`finalEwma`, including the primary strength set and native stroke exposure.
Extra-context cleanup retains a primary failure; shared user cleanup is intact.

Original20 identities/order and E1/E2 are preserved. Lifecycle indices4/5/20/21;
persistence2/3/18/19; B6/7/12–17; C2index9. Same six files,
**counts2/4/4/8/3/1**, mapped by exact file/describe/title, never grouped offsets.
Old4/6/8/11/12/15/18/20 fixtures remove A3/A4 first, E1/E2 only for old<=18,
then historical B/C filters; actual totals and original retained identities are
asserted. Old20-only and same-total A3/A4 substitutions by original A1/A2 or each
other fail. B/E/C substitutions, duplicates/retries/skips, privacy, source
attribution and existing annotation memberships remain. Closed ledgers require22;
A3/A4 have no new annotations. Existing main/stage closure already fingerprints
the lifecycle file; no closure/workflow/checker change was needed.

Observed red-to-green corrections, without product changes:

1. Initial web run: **598 passed, 2 failed (11 files/600 tests)**. A2's existing
   source slice reached into appended A3/A4; it now stops at A3. The explicit
   annotation array needed two empty slots, not new memberships.
2. Added seven start-day fixture checks through existing Vitest machinery,
   `parseSetupForm`, `generateSwimPlan`, `parseActualForm`, and the transpiled
   real `resultFromForm` source: **600 passed, 7 failed (607 total)**. Literal16
   normalizes to `partial` for the issued first25yd workout. A3/A4 now submit
   the issued whole-length target; queue/native-result lengths match that exact
   target. The strict `completed` assertion is retained, not relaxed.
3. The next run again had **600 passed, 7 failed**: canonical
   `countsTowardAdherence` includes started late-archived completions, whereas
   `countsTowardProgression` excludes them. A4 now expects adherence=true and
   still requires history=true, archivedLate=true, progression=false and no
   week candidate. This matches `swimming.ts:1605–1614` and DC-SW7, not a product
   semantic change. All607 then passed.

The seven fixture checks cover all start weekdays, four valid workouts for
both25yd and replacement50m, no calibration, unchanged30-minute budget, literal16
partial versus issued-target completed, and before/at-archive history/progression
and actual-time inputs. Source inspection also checked start/archive/completion
revision changes in `0146_swim_request_identity.sql`, completion receipt/replay
in actions, and completed/nondeleted-session daily load/EWMA inputs in
`region-ledger.ts`. No SQL was executed and no counts, started-target,
normalization or history-preservation checks were removed.

### Measured validation at the code/test tree

Commands from `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts src/lib/swim/__tests__/lifecycle.test.ts src/lib/swim/__tests__/actions.test.ts src/lib/swim/__tests__/analytics.test.ts src/lib/offline/__tests__/outbox-core.test.ts src/lib/offline/__tests__/outbox-upgrade.test.ts src/lib/swim/__tests__/load.test.ts src/lib/engine/__tests__/region-daily-load.test.ts src/lib/engine/__tests__/recompute-actual-session-load.test.ts src/lib/engine/__tests__/actual-session-load.test.ts`
  — **11 files, 607 passed**: reader496, collection1, lifecycle9, actions37,
  analytics2, outbox19+1, swim load10, daily load4, recompute10, actual load18.
  Every named path exists; all eleven ran in the same invocation.
- The collection test ran installed **Playwright1.60.0**
  `test --list --config=playwright.swim-reference.config.ts --project=mobile-chromium --reporter=json`
  through existing private isolation, independently confirming **22 exact
  identities/six files/counts2/4/4/8/3/1/zero executed results/errors**, directory
  identity/mode and exact cleanup. Safe result:
  `[swim-collection]{"success":true,"exit":0,"loaderCode":"unknown","sources":[]}`.
- `pnpm --filter @hta/domain exec vitest run src/swimming.test.ts src/swim-pool-input.test.ts src/swim-workout-progress.test.ts`
  — **3 files, 103 passed**.
- `pnpm --filter @hta/engine exec vitest run src/swimming.test.ts src/swimming-budget.test.ts`
  — **2 files, 58 passed**.
- `pnpm --filter @hta/web exec eslint e2e/swimming-lifecycle-load-mobile.spec.ts scripts/swim-browser-acceptance.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts`
  — passed; `pnpm --filter @hta/web typecheck` — passed.
- `pnpm docs:check-drift` — passed, offline in-repository checks only.
  `git diff --check` and four-file checkpoint scope review — passed.
- `printf 'HEAD %s refs/heads/copilot/new-acceptance-cases %s\n' "$(git rev-parse HEAD)" 1b3653d33442776be18a1923cca0c1813fefcf1e | node scripts/check-commit-identities.mjs pre-push origin`
  — **130 commits inspected**, full introduced stack against the destination's
  verified default branch at the code checkpoint. Initial progress publication
  hit the shallow-history guard; fetching full history fixed that prerequisite
  without a rewrite or hook bypass.
- Secret scan clean. CodeQL requested after commit: **skipped as trivial
  test/casebook changes**, not a successful security analysis. Vite CJS
  deprecation is a warning, not a failed test.

Local/public metadata for `e42ec690` match the approved source author/committer
above. Both official bots remain approved under the unchanged four-email policy.
Only the four authorized source/test files and these three documentation paths
change; existing credits/history are preserved. No new branch/PR, merge, rebase,
amend, force, identity rewrite, dependency or extra model chain.

### Coordinator/runtime boundary

**Freeze at22. Live22 and live20 remain UNRUN.** Last full reference remains
15/15 at `fdf01d865dc09f38e551925266fa604c56a3d40e`,
[run34351260981](https://github.com/drrowdev/hybrid-training-app/actions/runs/34351260981).
GitHub's recent-run/log query confirms old core34392005044 has zero failed jobs;
that old030160 run does not cover this head. Coordinator inspection/current-core
validation and ONE new-head22 full reference are next. No CI dispatch, live
browser, SQL, Docker, hosted-data query, production/cost/backup change occurred.

Unchanged: normal149 versus identity146/147/148; Auth5phases/4DDL/15contexts/
36HTTP; single set_logs FK proof/down-up/23503/delete1/forced check/UPDATE/
full restoration/cleanup; session_movements. CLI2.116/default12/private0700/0600;
30s case/300s global/330s command/590s phase/410s server/35m total/3m cleanup/
45m job; exact-ID cleanup. No new sleep/retry/force-click or limit growth.
MAIN/production145 seed versus unshipped swim145–148 ordering reconciliation
remains outside this task and required before final main/production integration.
All nine standalone gates precede combined training; Garmin remains later.
Swimming remains inside getsxc.app only. Earlier sections below are historical.

## PR805 pinned E1/E2 integration — 2026-09-09 — live20 UNRUN

Continued `copilot/new-acceptance-cases` from exact
`667349dd2bdffad9fda3a4e243681c5d90920840`, declared base
`copilot/prepare-mobile-persistence-tests@e2758dadbb110e03794e49d53b47622a6295e988`.
**Code/test checkpoint:** `a5a631caed5a91a03b1421b05a2f17a55c584f60`,
**tested tree:** `556b03bc3c93378e433fd6627ab7c72568e900a8`, published before docs.

Imported only `apps/web/e2e/swimming-persistence-mobile.spec.ts` from immutable
source `fee3751810f2b835b221a430a1eabde627daca3d` on
`copilot/copilotswim-course-analytics-proof`; resulting blob is exactly
`2e8f7aca4f21b8a4e0849d29acf0dfbcec207cfd`. Source author:
`copilot-swe-agent[bot] <198982749+Copilot@users.noreply.github.com>`;
source committer: `GitHub <noreply@github.com>`. This is file-source integration,
not a PR811 merge or adoption of its history, policy, workflow or future tip.
The source's correction leaves freshUser deletion to the existing fixture,
without redundant per-case cleanup replacing a primary failure. The public
worker validation report was unavailable; all results below were measured here.

Under [DC-SW1/SW2/SW6](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05),
E1 covers weekly native25m/25yd separation, native result history and compatible
bests; E2 covers ordinary manual200/400-like results in generic/native history
without an inferred pace calibration. Storage arrangement is not evidence of
logging/assessment UI actions. Neither case has been executed in a browser here.
Original18 casebook identities/order and original persistence bodies are intact.
E1/E2 append at18/19: persistence indices2/3/18/19; B indices6/7/12–17;
C2 remains9. Same six files, counts **2/4/2/8/3/1**. Grouped results map by exact
identity, not flattened position. Old4/6/8/11/12/15/18 reports remove E1/E2 first,
then their historical B/C filters, with actual totals and retained identities
asserted. Same-total E substitutions by original persistence cases or each other
are rejected alongside existing B/C/duplicate/skip/retry/failure/privacy checks.
Failure ledgers contain20 cases; E cases acquire no annotation memberships.
The existing main/stage source closure already fingerprints this spec.

### Actual source validation

Commands from `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts src/lib/swim/__tests__/analytics.test.ts src/lib/__tests__/commit-identity-guard.test.ts`
  — **4 files, 522 passed** (480 acceptance, 1 collection, 2 analytics, 39 identity).
  The collection test invoked the installed **Playwright1.60.0** CLI with
  `test --list --config=playwright.swim-reference.config.ts --project=mobile-chromium --reporter=json`
  through existing private isolation. It verified20 exact identities/six files,
  counts2/4/2/8/3/1, zero executed results/errors, private-directory identity/mode
  and cleanup. Safe output: `[swim-collection]{"success":true,"exit":0,"loaderCode":"unknown","sources":[]}`.
- `pnpm --filter @hta/domain exec vitest run src/swimming.test.ts src/swim-pool-input.test.ts src/swim-workout-progress.test.ts`
  — **3 files, 103 passed**.
- `pnpm --filter @hta/engine exec vitest run src/swimming.test.ts src/swimming-budget.test.ts`
  — **2 files, 58 passed**. Existing canonical swimming/budget tests and original
  B6/B7/B8 fixture regressions passed; no duplicate engine math introduced.
- `pnpm --filter @hta/web exec eslint e2e/swimming-persistence-mobile.spec.ts scripts/swim-browser-acceptance.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts`
  — passed.
- `pnpm --filter @hta/web typecheck` — passed.
- `pnpm docs:check-drift` — passed, **offline in-repository checks only**.
- `git diff --check`, exact source-blob comparison and checkpoint scope review
  — passed. Source checkpoint changes only the four authorized code/test files;
  documentation adds only HANDOFF, pool-swimming and this wiki's append-only log.
- `printf 'HEAD %s refs/heads/copilot/new-acceptance-cases %s\n' "$(git rev-parse HEAD)" 667349dd2bdffad9fda3a4e243681c5d90920840 | node scripts/check-commit-identities.mjs pre-push origin`
  — passed, **128 commits inspected** at the code checkpoint, including all
  unmerged stack layers against the destination's verified default branch.
- Secret scan: clean. CodeQL: **skipped as trivial test/casebook changes**,
  not a successful security analysis.

Observed failures/corrections: the initial progress push failed the full-history
guard on the shallow clone; `git fetch --unshallow origin` restored required
history without rewriting or bypassing hooks. Initial import comparison caught
a transcribed E2 heading assertion; it was restored to the exact B source before
tests. The first web invocation mistakenly supplied
`src/lib/swim/__tests__/commit-identity-guard.test.ts`, so only3 files/483 tests
ran despite exit0. Correcting that path produced the four-file/522 result above.
No material B-only defect was demonstrated, and the imported blob is unchanged.
The Vite CJS deprecation notice is a warning, not a test failure.

Local and public metadata for the published code checkpoint match the approved
native cloud author and GitHub committer above. The four-email policy also
allows `223556219+Copilot@users.noreply.github.com` and
`280348738+drrowdev@users.noreply.github.com`. No history repair, identity
substitution, hook bypass, merge/rebase/amend/force or extra agent/review chain.

### Runtime and release boundary

**Live20 is UNRUN; live18 was never runtime-accepted.** Last full reference is
15/15 at `fdf01d865dc09f38e551925266fa604c56a3d40e`,
[run34351260981](https://github.com/drrowdev/hybrid-training-app/actions/runs/34351260981).
Old core [run34392005044](https://github.com/drrowdev/hybrid-training-app/actions/runs/34392005044)
at `030160f8afb883cb650ceb6647c290c93c5b6e56` succeeded (GitHub logs query found
zero failed jobs), but does not cover this integration head. The coordinator
must inspect the exact artifact/current core before dispatching one bounded
full reference. No CI dispatch, browser/SQL/Docker execution, hosted-data reads,
production mutation, backup or paid resource occurred in this source task.

Unchanged: normal149 versus identity146/147/148; Auth5phases/4DDL/15contexts/
36HTTP; single set_logs FK down/up/baseline23503/candidate delete1/forced checks/
UPDATE/restoration; session_movements. CLI2.116/default12/private0700/0600;
30s/case,300s global,330s command,590s phase,410s server,35m total,3m cleanup,
45m job; exact-resource-ID cleanup. No new retry, sleep, force-click or limit.
MAIN/production's `0145_seed_single_leg_rdl_variants` requires reconciliation
with unshipped145–148 before merge/deploy, **not in this task**. All nine
standalone gates precede combined implementation; Garmin remains later.
The earlier checkpoints below are historical, not claims about live20.

## Official Copilot attribution policy — 2026-09-09

Owner decision: **accept both official bots and native author credit**. This
supersedes earlier CLI-only policy, not the historical repair records below.
Both exact Copilot emails (cloud `198982749`, CLI `223556219`) are allowed
alongside the unchanged owner and GitHub addresses. Native bot authorship is
sufficient AI credit; human-authored AI edits still need AI co-author credit.
Existing credits and signatures stay intact. Prior metadata repairs remain as
recorded; **all prior rewrite approvals are consumed**.

Continued PR805 from `030160f8afb883cb650ceb6647c290c93c5b6e56`, base
`copilot/prepare-mobile-persistence-tests@e2758dadbb110e03794e49d53b47622a6295e988`.
**Tested code checkpoint:** `94193697bbc4d4df692786daaee3c55b9400155c`,
tree `2a9c3d74238d9f9b34ab2e8e30d05fa282eb3091`, published before these docs.
Local/public metadata match: author
`copilot-swe-agent[bot] <198982749+Copilot@users.noreply.github.com>`,
committer `GitHub <noreply@github.com>`; signature retained. No identity
substitution, history rewrite or hook bypass. Initial shallow-history push
was blocked; `git fetch --unshallow origin` restored required history.

Commands from `/home/runner/work/hybrid-training-app/hybrid-training-app`:
- `pnpm --filter @hta/web exec vitest run src/lib/__tests__/commit-identity-guard.test.ts`
  — **39 passed**; original negative/history/whitespace/signature/boundary tests
  retained, both bot author/committer pairings accepted, unknown GitHub emails rejected.
- `pnpm --filter @hta/web exec eslint src/lib/__tests__/commit-identity-guard.test.ts`
  and `apps/web/node_modules/.bin/eslint --config apps/web/eslint.config.mjs scripts/check-commit-identities.mjs`
  — passed; existing root React/pages configuration warnings.
- `node --check scripts/check-commit-identities.mjs`,
  `pnpm --filter @hta/web typecheck`, `pnpm docs:check-drift`, `git diff --check`
  — passed; doc drift is offline/in-repository only.

Secret scan clean. CodeQL returned zero alerts, but Actions analysis failed
and JavaScript was size-skipped: **no successful security analysis claimed**.
This policy resolves attribution of legitimate cloud output, **not code quality
or production readiness**. Run `34392005044` validates immutable old `030160`,
not the changed head. No CI dispatch or full reference run; a full reference
must wait for writers to finish, current source inspection and its own appropriate
green CI. All 18 existing source cases remain unchanged; no new runtime claims.
Builder B independently owns only the persistence swimming spec on PR811.
Only the five owner-authorized paths change; no DC-*/OC-*, production or DB work.

## Exact-identity output refinement — 2026-09-09

Continued PR805 from `5946bd020f637f36388109898f162a284eb9ede8`.
**Tested code checkpoint:** `8fac5c3dfac66cb1b5246e5b142e4ed6c1094f60`,
tree `355efedf4575d3ec72fd6f44b2d608b69f27ad45`.
Raw synthetic commits created with `git hash-object -t commit -w --stdin`
proved that Git stores and projects leading author / trailing committer
space, tab, CR and NBSP unchanged. All eight were wrongly accepted before
the fix. Tests compare complete `cat-file` content and untrimmed `git show`
output. Git rejected an exploratory newline-in-email object as malformed;
no validation bypass or retained invalid-object test was used.

The checker removes only one terminal LF, requires exactly two identity
fields, and uses `--no-show-signature`. Added empty-field attribution checks
and Git-trace proof that signature-display config does not invoke a verifier.
The original 22 regressions and all history/boundary/tag policy remain intact.

Commands run from `/home/runner/work/hybrid-training-app/hybrid-training-app`:
- `pnpm --filter @hta/web exec vitest run src/lib/__tests__/commit-identity-guard.test.ts`
  — 33 passed after demonstrated red regressions.
- `pnpm --filter @hta/web exec eslint src/lib/__tests__/commit-identity-guard.test.ts`
  and `apps/web/node_modules/.bin/eslint --config apps/web/eslint.config.mjs scripts/check-commit-identities.mjs`
  — passed (existing root React/pages configuration notices).
- `node --check scripts/check-commit-identities.mjs`,
  `pnpm --filter @hta/web typecheck`, `pnpm docs:check-drift`, `git diff --check`
  — passed; doc drift is offline/in-repository only.

Secret scan clean. CodeQL returned zero alerts, but Actions analysis failed
and JavaScript was skipped for database size: **no analysis pass claimed**.
The initial shallow-history publication was blocked without changing HEAD;
`git fetch --unshallow --no-tags origin` restored history. The signing service
again returned Bad Request; the terminal checkpoint is unsigned, with hooks
enabled, explicit Copilot223556219 author/committer and both AI credits
verified locally and on GitHub. Publication pushed the existing commit.
Only the checker, its tests, this handoff and append-only knowledge log change.
No DC-* / OC-* or swimming source changes; the 18-case source remains unrun.

## Commit-identity recurrence prevention — 2026-09-09

Continued PR805 on `copilot/new-acceptance-cases` from exact
`966b906c83873667b27459ed42575da29ed3b377`, with declared stacked base
`copilot/prepare-mobile-persistence-tests@e2758dadbb110e03794e49d53b47622a6295e988`.
The owner-reported repair is complete: 115 code-identical commits, 88 author
corrections and 68 missing App credits. The old graph remains at
`swim-identity-checkpoint-31364e5`; that approval is consumed. No further history
rewrite, merge, rebase, amend, new branch or PR was performed.

**Saved code/test checkpoint:** `ac209ecb1c8489a65d5626603f866a39e83254f3`,
tree `bdb90c932525e7e6bda6e559ab07a6b3f3473410`. GitHub metadata confirms author
and committer are `Copilot <223556219+Copilot@users.noreply.github.com>` and both
Copilot and Copilot App credit lines are present. Terminal signing initially
failed with the sandbox signing service's Bad Request; the checkpoint was
committed unsigned with explicit identities and hooks enabled. Publication
pushed the existing terminal commit, not a platform-generated replacement.

The shared `scripts/check-commit-identities.mjs` checks both identity fields,
including merges. CI checks exact PR source/base OIDs (not a synthetic merge),
the complete push before/after range, and manual feature history against the
remote-verified default branch. Initial pushes inspect all ancestry; valid
non-fast-forward ranges are supported. Manual default-branch runs explicitly
inspect their current commit. Pre-push includes existing unmerged branch history
even if archive refs already contain it, checks every proposed branch update
before the unchanged pnpm chain, and deliberately permits deletions/no updates.
Tag updates, malformed/missing boundaries, shallow or unrelated feature history,
and destinations without a verifiable default branch fail closed. Errors report
SHA and identity field, not commit messages or disallowed identity values.
Inherited legitimate human commits remain legal without retroactive App credits.

**Validation inside the GitHub worker** (repository root
`/home/runner/work/hybrid-training-app/hybrid-training-app`):

- `pnpm --filter @hta/web exec vitest run src/lib/__tests__/commit-identity-guard.test.ts`
  — 22 passed. Temporary owned Git fixtures cover older-bad/newest-good,
  committer/merge failures, all allowed emails, PR/push/manual boundaries,
  initial/new branches, multiple updates, non-fast-forward updates, malformed
  and unavailable boundaries, shallow history, archive masking, and actual
  local push rejection before either pnpm execution or publication.
- `pnpm --filter @hta/web exec eslint src/lib/__tests__/commit-identity-guard.test.ts`
  and `node --check scripts/check-commit-identities.mjs` — passed.
- `apps/web/node_modules/.bin/eslint --config apps/web/eslint.config.mjs scripts/check-commit-identities.mjs`
  from repository root — passed; existing React/pages configuration notices.
  An earlier invocation from the web directory ignored the root script and was
  replaced by this root-scoped invocation.
- `pnpm --filter @hta/web typecheck`, `pnpm docs:check-drift`, `git diff --check`
  — passed. Document drift was offline/in-repository only, not private-mirror parity.
- Read-only full-candidate author/committer scan against remote-verified
  `main@e6ad3b8a358320b651de65f7b9785b409d10eaf4` — all 121 starting commits
  allowed, including lower stack layers. The initially shallow worker checkout
  was completed with `git fetch --unshallow --no-tags origin refs/heads/main`;
  no branch/history rewrite.
- Actual repository `.husky/pre-push` invoked with the original-to-checkpoint
  update on stdin — passed, inspecting 122 commits before recursive typechecks,
  package tests, offline migration drift (149 journal entries) and document drift.
  `DATABASE_URL` was unset; no hosted SQL was executed.
- Secret scanning — clean. CodeQL reported zero alerts, but Actions analysis
  failed and JavaScript analysis was skipped because its database was too large.
  **No successful CodeQL analysis is claimed.**

Only seven paths are in scope: `.github/workflows/ci.yml` (identity job only),
`.husky/pre-push`, the shared checker, its web Vitest test, `AGENTS.md`, this
handoff and append-only `docs/knowledge/log.md`. No engine DC-* / OC-* behavior
changed. Workflow triggers, other jobs, acceptance routing/inputs, permissions,
pins, swimming source/fixtures, schema, migrations and RLS are unchanged.

**Evidence limits remain:** latest measured swimming milestone is all15 passed
in run34351260981 at original `fdf01d865dc09f38e551925266fa604c56a3d40e`,
completed12:34:10Z. Do not relabel it with a repaired or documentation SHA.
The 18-case source is not newly live accepted; this task proves no new runtime
feature. Normal149/Auth36/single-FK/source bounds are unchanged. Production/main
now contain `0145_seed_single_leg_rdl_variants`; this unmerged branch's swim145–148
ordering still needs later reconciliation. Backup/recovery/monitoring remain
open; no production-readiness claim. No disposable reference, CI dispatch,
Docker/browser execution, hosted access or other builder's branch was used.
The sections below retain historical evidence, including pre-repair SHAs.

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
PR805's latest measured fifteen-case run34351260981 at exact
`fdf01d865dc09f38e551925266fa604c56a3d40e` completed12:34:10Z SUCCESS:
all15 passed once, zero unexpected/skipped/flaky, empty failure ledger.
B3/B4/B5 and C2/C3 passed. The original first setup case passed in21,892ms;
its earlier Pool-length timeout remains unexplained, not attributed to the
semantic-HOLD fix. This closes progression-branch work, not all release gates.
The next eighteen-case source cohort adds B6/B7/B8 below; live18 is **unrun**.
The owner reports production access now works through the getsxc connector.
This source-only continuation did not use it, read hosted data or change production.
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

**Last updated:** 2026-09-09 (measured fifteen-case success; eighteen-case budget/guidance source proof)

### PR805 B6/B7/B8 — eighteen-case source proof, live acceptance unrun

Continues the exact requested `fdf01d865dc09f38e551925266fa604c56a3d40e`
on `copilot/new-acceptance-cases`, base `copilot/prepare-mobile-persistence-tests`
at `4f2aa4af480f61df83bbc38b09f29afbbbf5729b`. No new branch/PR, merge, rebase,
amend or force push.

**Measured milestone:** [run34351260981](https://github.com/drrowdev/hybrid-training-app/actions/runs/34351260981)
at fdf01 completed2026-09-09T12:34:10Z SUCCESS. The coordinator's retained
summary reports all15 passing once, zero unexpected/skipped/flaky, B3/B4/B5
and C2/C3 passing, and an empty failure ledger. Normal149/catalog/
Auth5phases4DDL15contexts/all36HTTP/Native16/single-FK down/up controls and
UPDATE integrity/core/main/final cleanup passed. GitHub metadata corroborates
the head, end time and success. The first setup case's21,892ms pass does not
explain its earlier Pool-length timeout or establish a causal connection to
the semantic-HOLD change. No unchanged rerun was requested or performed here.

Code/test checkpoint **`8fecc50c5f4cdd2349d2d1e425d47d90003707e9`**, tested tree
**`24ae63d66b5b23a1cb794482abf2af952be32af6`**, adds only:

- **B6 / [DC-SW1/SW3](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05):**
  real setup submission with native50m, freestyle/no equipment and a supported
  verified200/400 calibration. Ten-minute endurance work materially scales down
  against the same persisted setup/schedule at a larger budget, retaining whole
  lengths, easy edges and purpose-specific main work. Full canonical storage
  comparisons accompany literal course/budget checks. Accounted time is
  regenerated, fully priced and within the chosen budget, not copied from the
  larger prescription. Actual workout UI and owned rows survive reload.
- **B7 / DC-SW2/SW3:** a separate valid supported calibration produces canonical
  `budget_impossible` at the UI's ten-minute minimum. The real form must show a
  nonempty alert and correction options, retain entries and persist no plan or
  workout. Changing only the budget to a canonically verified bounded value
  creates exactly one plan with whole-length workouts and stable UI/rows.
  An initially considered slower pair failed validation and was discarded;
  invalid calibration is not used as evidence of budget failure.
- **B8 / DC-SW2/SW3:** zero comfortable lengths, no known strokes and no
  assessment/verification yield real nonempty learning guidance in the form's
  status region, with entries retained. The fresh authenticated actor has no
  plan, workout or session before/after: no logged completion, load, invented
  calibration or progression decision. No UI implementation or copy changes.

All three use the existing actor's UTC/onboarding/auth, real setup controls,
today's valid start date, a deterministic two-week Monday schedule, canonical
`parseSetupForm`/`standaloneWeekRequests`/generation and authenticated storage
reads. Reads verify the UI action; they do not replace it. New private equality
assertions inline `expect(isDeepStrictEqual(...)).toBe(true)`.

Original15 identities/order and bodies/fixtures remain unchanged. B6/B7/B8
append at15/16/17; B indexes are6/7/12/13/14/15/16/17 and C2 remains9.
Same six files, counts2/2/2/8/3/1. Independent identity/count pins, old4/6/8/11/12
and new old15 rejection, same-total substitutions, eight-entry B duplicates,
exact-identity mapping, original annotations and privacy checks remain enforced.
Old12 removes all B3–B8 but keeps B1/B2; old15 removes only B6/B7/B8.

Validation inside the GitHub workspace at
`/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts` — **472 passed** (471 reader/pure-fixture tests +1 real collection regression). The pure fixture test exercises all seven possible start weekdays. The installed Playwright1.60.0 CLI actually ran `test --list --config=playwright.swim-reference.config.ts --project=mobile-chromium --reporter=json` in the existing private isolation: **18 identities/six files/zero executed results/errors**, private cleanup verified. An initial reader run exposed one old fifteen-entry annotation expectation; appending three empty entries fixed it without changing original membership.
- `pnpm --filter @hta/engine exec vitest run src/swimming.test.ts src/swimming-budget.test.ts` — **58 passed**.
- `pnpm --filter @hta/web exec eslint e2e/swimming-decisions-offline-mobile.spec.ts scripts/swim-browser-acceptance.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts` — passed.
- `pnpm --filter @hta/web typecheck` and `git diff --check` — passed.
- `pnpm docs:check-drift` — passed offline in-repository checks; private workspace
  mirror parity was not run. Documentation secret scan, exact seven-file scope
  and append-only log prefix checks passed; source stayed unchanged from the
  tested code checkpoint.
- Byte comparison against fdf01 verified the original B1–B5 bodies, describe,
  actor and all existing helpers unchanged; only the four allowed source paths
  changed. Secret scanning passed. CodeQL skipped these test-only changes as
  trivial; **no security-analysis pass is claimed**.

The code checkpoint was saved before documentation. Terminal git explicitly
set author and committer to `Copilot <223556219+Copilot@users.noreply.github.com>`;
both required Copilot and Copilot App trailers are present. Local and remote
identities were verified before continuing; publishing only pushed the already
created commit. No MCP-created commit or extra model/review chain.

Only the seven allowed paths change: B spec, casebook, reader/collection tests,
this handoff, pool-swimming wiki and append-only log. No product, old-case,
fixture, main/stage/protocol/source-closure, workflow/config/dependency,
domain/engine/DB/schema/permission/migration, hosting/network/cost change.
No SQL, Docker, browser execution, CI dispatch, hosted reads or production writes.

**Remaining:** actual live18 acceptance; further standalone lifecycle,
analytics, concurrency and regional-load variants; free-plan backup/recovery,
production migration ordering and monitoring gates. Production connector access
does not close them. Bounds remain30s/case,300s global,330s command,590s phase,
410s server,35m total/3m cleanup,45m job. Eighteen nominal maxima are not a fit
guarantee; a measured overrun must fail, not increase limits.

### PR805 first fifteen-case run — two source fixes, corrected-head runtime pending

Historical checkpoint: the measured fdf01 success above supersedes the pending
runtime and connector-authorization statements in this section.

Continues exact `da81baacb2a72c5471863ea40cd5b60302b07c0b` on the existing
`copilot/new-acceptance-cases`, base `copilot/prepare-mobile-persistence-tests` at
`4f2aa4af480f61df83bbc38b09f29afbbbf5729b`. No branch/base/history change.

**Latest measured evidence:** [run34345964317](https://github.com/drrowdev/hybrid-training-app/actions/runs/34345964317)
ended2026-09-09T11:36:23Z at exactda81. All15 executed once:12 passed/3 failed,
zero skips/flaky cases. B3 plateau Reject passed. B4 failed at shared `same()`
helper line69 (2,955ms); the retained safe output does **not** identify its
precise calling comparison. B5 failed at line856 (2,434ms), the strict
modifications-count assertion after Accept HOLD, after its dose/issued/revision/
provisional checks passed. The original first setup case timed out selecting
Pool length at line19 (30,077ms), after clicking the program-page Pool swimming
link. Its cause is **unknown**, not explained or fixed by these source changes.
The other11 original cases, including latest C2/C3 deletion checks, passed.
Normal149/catalog/Auth5phase4DDL15contexts/all36HTTP/Native16/core/single-FK
controls/UPDATE integrity/main/final cleanup passed. This is the coordinator's
retained safe15-record summary; raw logs were consumed once and discarded,
not reread here. GitHub run metadata corroborates head/end/failure. No
unchanged-head retry. The bb9aa account12 milestone above remains valid.

Code/test checkpoint `61ab8c36d9536257351330d4b7ff0cb0ba1a1621`, tested tree
`7515548bf7c643a5cb5bb82f64b7b0558b53b2c0`:

- **Product / [DC-SW4/SW5](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05):**
  `futureUpdates` reuses the existing pure `prescriptionsEquivalent` instead of
  comparing JSON serialization order. Progression and benchmark callers retain
  their scopes. An equal HOLD can confirm a provisional eligible workout and
  advance its revision without appending a false modification. Actual dose,
  pace, array-content and array-order changes still append exactly one prior
  issued snapshot associated with the decision; existing histories stay intact.
  Eight new typed action cases cover reordered nested objects, confirmation,
  unchanged non-provisional/out-of-scope rows, started/past/today freezes and real
  changes. The benchmark regression now checks the prior snapshot/association.
  All five reordered-HOLD variants failed before the one-line production fix.
- **B4 oracle / DC-SW4/SW5/K4:** only chosen `budget.minutes` must equal the prior
  stopping limit. Domain `SwimBudget` and engine `buildWorkout`/`sectionsTiming`
  define `accountedMs` as derived known time. B4 retains full equality with the
  canonical override and full prior-row equality for unchanged rows; canonical
  accounted time must be lower than both the suggested and previous targets.
  The27-versus33 lengths, warning/audit/frozen-target/no-catch-up checks remain.
  B4's private comparisons are inlined as boolean `isDeepStrictEqual` assertions
  at their call sites, preserving exact operands apart from the budget correction.
  No raw objects/IDs/messages are exposed. This source-proven oracle defect is
  **not** attribution of the retained helper69 failure or proof all B4 bugs are fixed.

Validation in `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/actions.test.ts src/lib/swim/__tests__/swim-actions-refresh.test.ts src/lib/swim/__tests__/proposals.test.ts src/lib/swim/__tests__/safety.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts src/lib/platform/__tests__/forward-rewrite.test.ts src/lib/platform/__tests__/progression.test.ts` — **693 passed**:37 action,191 refresh,7 proposal,6 safety,430 reader,1 collection,16 forward-rewrite,5 platform progression.
- `pnpm --filter @hta/engine exec vitest run src/swimming.test.ts` — **55 passed**.
- `pnpm --filter @hta/web exec eslint src/lib/swim/actions.ts src/lib/swim/__tests__/actions.test.ts e2e/swimming-decisions-offline-mobile.spec.ts` — passed.
- `pnpm --filter @hta/web typecheck` and `git diff --check` — passed after correcting
  the test fixture's standalone definition type.
- Existing isolated collection uses pinned Playwright1.60.0 `--list`:15 exact
  identities in six files, zero executed results/errors, checked private cleanup.
- TypeScript AST comparison verified all B4 private comparison operands except
  the corrected budget unchanged; B1/B2/B3/B5/shared helpers and the complete
  `swimming-mobile.spec.ts` are byte-identical to da81.

Secret scan passed. CodeQL did **not** complete: Actions analysis failed;
JavaScript database too large. No security-analysis pass is claimed. Terminal
git explicitly set author and committer to Copilot223556219 with both AI
trailers; local and remote identities verified. Signing service returned Bad
Request before creating any commit; the saved checkpoint is unsigned.

Only the six allowed paths change: actions/action tests/B4 spec and this
handoff/pool-swimming/log. No comparator, other original/new case, fixture,
registry, collection, main/stage/config/workflow, engine/domain, dependency,
DB/schema/permission or persisted-history rewrite. No SQL/Docker/browser
execution, workflow dispatch, hosted access or extra reviewer/model chain.
The unchanged first setup case stays **mandatory** in the next changed-head
fifteen-case cohort. If it repeats, the coordinator investigates that separate
failure; no sleep/retry/force-click/timeout/navigation workaround. All identities,
ordering and runtime bounds below remain. **No fifteen-case acceptance,
standalone completion or production approval is claimed.**

### PR805 B3/B4/B5 — source/collection checkpoint, live fifteen-case acceptance pending

Historical source checkpoint before the da81 run; the latest outcomes and
separate source fixes above supersede its unrun statements.

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

- Human-authored AI edits need AI co-author credit; native authorship by either
  approved Copilot bot is sufficient without an extra trailer. Example credit:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
- Every change to wiki pages appends to `docs/knowledge/log.md`.
- Every new wiki page is added to `docs/knowledge/index.md`.
- Architectural decisions land as ADRs in `docs/adr/00NN-*.md`.
- Copilot cloud development setup lives in
  `.github/workflows/copilot-setup-steps.yml`. It installs the existing
  pnpm workspace with the root `packageManager` version (`pnpm@10.33.2`),
  installs Playwright Chromium plus Linux browser dependencies, and verifies a
  headless Chromium launch. It does not run full builds/tests, start services,
  configure databases, seed data, configure secrets, change runners, disable
  the integrated firewall, or alter billing. The workflow only becomes active
  for future cloud-agent sessions after the file is merged to the default
  branch; until then it can be exercised as an ordinary Actions workflow on the
  PR branch. If secrets are needed later, configure them in GitHub at Settings
  > Secrets and variables > Agents; local `.env*` files are not uploaded
  automatically. Build-only placeholders remain
  `https://placeholder.supabase.co` and
  `sb_publishable_test_for_ci_build_only`; they do not enable authenticated
  E2E. Real DB/RLS/browser tests require owner-approved dedicated TEST
  configuration and strict target checks.
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

## PR805 B6/B7 summary display correction — 2026-09-10

Latest checkpoint; prior records above remain historical evidence. Continued
exact `32e0f40f44e8aeec815a3a8f2f39cb40179eac13` on
`copilot/new-acceptance-cases`, declared base
`copilot/prepare-mobile-persistence-tests@e2758dadbb110e03794e49d53b47622a6295e988`.
**Exact tested code/test tree before these append-only documentation additions:
`79e3603da420fa7668229eced493545a51f024bd`.**

Coordinator-supplied runtime: full34442610426@32e0f40f,
reference job102760620622 failed after5m36s. All22 ran once:
**20 passed, 2 failed, 0 skipped, 0 flaky**, total case116518ms.
All prior17 plus B8/E1/A3 passed. B6 (3198ms, spec1047) and B7
(3919ms, spec1093) reached the page-global exact `50 m` display assertion
after successful setup/create and strict persisted canonical prescription checks.
Only source line/status was supplied, not the historical Playwright error.
GitHub metadata was checked and a log URL requested; no raw old logs or private
transcripts were read. Core/native16/normal149/catalog/identity matched,
Auth36HTTP/FK matched, main and separate final cleanup verified per coordinator.
**The main browser failure remains failure; this correction is not runtime acceptance.**

Under [DC-SW1/SW2/SW3](docs/knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05),
only B6/B7 now select the link for `stored.workouts[0].id`, await its exact URL,
and scope exact course text to `page.locator("main > section").first()`, matching
the passing persistence helper. WorkoutClient's first section displays the
course; later sections display step distances. Two regressions in the existing
`workout-controls.test.tsx` generate the real calibrated10-minute B6 and
corrected20-minute B7 prescriptions and SSR-render WorkoutScreen: each has
multiple exact `50 m` elements globally, but exactly one in the first section.
This proves the source/SSR distinction, not the unavailable historical error.
Up-to10/20-minute assertions, main-text reload equality, storage equality,
all20 passing cases and all22 identities/order remain unchanged.

Commands from `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts src/lib/swim/__tests__/workout-controls.test.tsx src/lib/swim/__tests__/presentation.test.ts src/lib/swim/__tests__/swim-hub-view.test.tsx`
  — **5 files,567 passed** (498/1/43/4/21).
- Existing private collection invoked installed **Playwright1.60.0**
  `test --list --config=playwright.swim-reference.config.ts --project=mobile-chromium --reporter=json`:
  exact22 identities/six files2/4/4/8/3/1, zero execution/errors,
  private directory identity/mode and exact cleanup verified.
  Safe result: `[swim-collection]{"success":true,"exit":0,"loaderCode":"unknown","sources":[]}`.
- `pnpm --filter @hta/web exec eslint e2e/swimming-decisions-offline-mobile.spec.ts src/lib/swim/__tests__/workout-controls.test.tsx`
  and `pnpm --filter @hta/web typecheck` — passed. Initial SSR regex flag failed
  the existing TypeScript target; replaced with compatible character matching
  before the final green run above.
- `pnpm docs:check-drift` — passed, offline in-repository checks only;
  `git diff --check` — passed.
- `printf 'HEAD %s refs/heads/copilot/new-acceptance-cases %s\n' "$(git rev-parse HEAD)" 32e0f40f44e8aeec815a3a8f2f39cb40179eac13 | node scripts/check-commit-identities.mjs pre-push origin`
  — passed,132 introduced commits inspected before this commit. Initial
  progress push failed closed on shallow history; full history fetched without
  rewrite. Effective native cloud author198982749 and GitHub committer
  `noreply@github.com` are allowlisted; publishing retains the existing hook.

No product, domain, engine, schema, SQL, RLS, auth, fixture, workflow, checker,
hook, dependency, network or timeout changes; no browser/SQL/Docker/hosted-data
execution, dispatch, delegation, merge or history rewrite. Existing isolation,
deadlines, normal149/identity146–148, Auth/FK proofs and cleanup safeguards remain
unchanged. Coordinator inspection, current-head core and ONE new-head full22
are still pending. No extra browser cases, production authority or backup work;
main145/unshipped145–148 integration remains a later owner-approved gate.
Swimming stays inside getsxc.app.

## PR805 isolated review bootstrap tooling — 2026-09-10

Final executable/test source: `1e7c0239ce651f41a3033a051d8ea2fa272f925f`
(initial coherent checkpoint `3cccfe5dc6d80a32b37d79a18f7e934d36ab6b2e`).
Changed paths only: `.github/workflows/ci.yml`,
`packages/db/scripts/prepare-swim-review.ts`,
`packages/db/scripts/__tests__/prepare-swim-review.test.ts`, and this entry.
Starting live head `82337d2b36436bbe15532b4204e3ee96ba55b3f7` and live main
`672e4202792da122281639e3db810029432573f5` were verified before changes.
Application/migration/rollback/acceptance sources remain exactly at accepted
`82337d2`; successful CI34499762054 and its 26 cases belong to that commit,
not this tooling. No DC/OC behavior changes; combined work remains deferred.

After coordinator inspection of the complete saved source, the manual
`ci.yml` input is `prepare_swim_review=true` (default false), job
`prepare-swim-review`, on `copilot/new-acceptance-cases` only. `expected_sha`
must be the full reviewed **current live head**, including this documentation
checkpoint; `migrate_production`, `allow_undeployed`, and `swim_acceptance`
must all be false. Successful `ci` and `identity-guard` are required.
Only environment `swim-review`'s `SWIM_REVIEW_DATABASE_URL` reaches the setup
step. The sole allowed route is project `whwilnhqfiaquwxgkxwt` via its
Stockholm session pooler. Source/head/credential/pristine-state guards precede
canonical 150-migration execution and the unchanged catalog seed CLI.
Postflight requires exact ledger order/hashes, 330 seed entries, 334 global
movements, readiness true, and no user/account/storage data. Unknown state,
partial setup, deadline, or shutdown failure requires inspection, not rerun
or destructive recovery. Raw seed streams are discarded, not retained as
logs/artifacts; only bounded safe phase/status/error-code evidence is emitted.

Offline checks from the repository root:
- `pnpm --filter @hta/db exec vitest run scripts/__tests__/prepare-swim-review.test.ts`
  — **86 passed**, including fake subprocess failures/cancellation and unchanged
  existing workflow-job digest. No database/process-under-test was started.
- `pnpm --filter @hta/db typecheck` — passed.
- `pnpm --filter @hta/db exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --noUncheckedIndexedAccess --noImplicitReturns --skipLibCheck --esModuleInterop scripts/prepare-swim-review.ts scripts/__tests__/prepare-swim-review.test.ts`
  — passed. Adding `--exactOptionalPropertyTypes` exposed the existing
  unchanged `seeds/movements.ts:41` optional-property error; not modified.
- `pnpm --filter @hta/db lint` — existing no-config informational command;
  `git diff --check` and changed-file secret scans passed.
- Automated validation was attempted twice: reviewer binary unavailable;
  CodeQL Actions analysis failed and JavaScript analysis was skipped for
  database size. These are unresolved validation limitations, not clean scans.
  Local and published source commit identities are allowlisted native bot/GitHub.

No database connection, migration, secret retrieval, hosted execution, workflow
dispatch, full acceptance/build matrix, app/browser/server/Docker startup,
Vercel change, user review, or production activity was performed in this worker.
Coordinator source inspection and guarded runtime execution remain unperformed.