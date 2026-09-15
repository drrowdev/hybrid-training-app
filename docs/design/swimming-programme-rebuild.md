# Goal-led swimming programmes and observed progress

**Status:** private course import/editing, untimed imports and distinct weekly
names are delivered on the protected test site. The selected course was prepared
privately and imported by the owner. Account pairing, the cache-only reader,
preview-first sender, immutable observations and explicit recording matches have
development acceptance. Seven native checks passed with two disposable accounts,
followed by verified cleanup, as recorded below.
The shared programme/Today/history integration is now on the same protected
site. Its integrated disposable-account check remains pending.
Real swimming-data transfer and watch delivery remain unfinished and held.
**Owner decision:** 2026-09-12.

The owner selected a finite coach-authored course, with unspecified coaching
decisions remaining manual. Full prescriptions stay private rather than entering
the public catalogue. One-time private preparation is complete;
no PDF parser, paid commissioning or external processing service is authorized.
[ADR 0083](../adr/0083-private-swimming-courses.md) records the approved
development-only import/storage extension.

## Outcome

Create a swimming programme by selecting a goal. The owner's current goal is
endurance and fitness alongside strength, not a hardcoded goal for every user.
Review and edit the programme in getsxc; execute swims on the watch. Keep
in-app swim logging removed.

Swimming must be either a standalone programme or the selected activity for
eligible cardio days in another programme. It must not remain a detached
calendar with a shortcut inside the strength editor.

No programme guarantees a result. Acceptance requires traceable training
prescriptions and correct responses to observed progress, not just passing tests
of arbitrary rules.

### Personal-use and pool decisions

The owner clarified personal use outside the US. Focus on metric recreational
fitness/endurance alongside strength, not a commercial programme catalogue or
military selection targets. Personal use does not authorize publishing protected
plan text in this public repository. Select a suitable authored progression
and documented adjustment rules; a complete published software algorithm for
every possible edge case is not required. Unspecified coaching decisions remain
manual rather than receiving invented thresholds.

The owner usually swims in a 50 m pool and sometimes uses 25 m. New setup now
selects 50 m. [ADR 0082](../adr/0082-editable-swimming-pools.md) defines reviewed
programme-default and individual-workout pool changes, exact distance retention,
course-specific pace and history, and the separately approved development-only
database-rule extension. Controls remain off until the new migration and
explicit feature flag are available. Existing account databases are untouched.

## Training-method gate

The owner rejects the current generic progression heuristics. Do not disguise
new numerical rules as established practice by citing general research.

Before enabling each new programme, record:

- Its published or qualified-coach-authored source, edition and exact sections.
- The supported goal, entry capability, weekly frequency, duration and pool
  conditions. Do not stretch a three-session programme into arbitrary schedules
  and imply that its original evidence still applies.
- The actual sequence of training and recovery sessions, not just a distance
  ramp. Identify what develops: technique, repeatability, continuous distance,
  pace or event performance.
- The source's advancement, repetition, recovery and reassessment rules.
  If an adjustment is unspecified, it remains unspecified; no invented
  percentage, effort cutoff, fitness score or unconditional weekly increase.
- Any permission needed to distribute workout content. Publicly downloadable
  material is not automatically licensed for redistribution.
- Which rules are coaching prescriptions and which are software safeguards
  such as exact measurements, ownership, replay protection and history retention.

The selected finite course does not require a complete adaptive algorithm.
Its original content still needs private preparation and review before
installation; selection is not proof of a working import or released programme.

Any automated change requires a source-defined rule and compatible observations.
Where those rules are unspecified, use an explicit manual decision rather than
inventing them. The programme must work with the approved watch-first workflow:
swimming-only distance, timing, stroke, pool and workout references, without
requiring routine in-app workout logging or silently importing more health
data.

### Evidence and applicability

| Source | Supported use | Limit |
| --- | --- | --- |
| [Training intensity distribution, volume and periodization in elite swimmers, 2021](https://doi.org/10.1123/ijspp.2020-0906) | Event-specific training emphasis and periodized variation. | Nine studies of elite swimming; not a numerical prescription for recreational swimmers alongside strength. |
| [Reverse periodization systematic review, 2022](https://doi.org/10.1186/s40798-022-00445-8) | Comparison of established periodization approaches. | Does not establish reverse periodization as universally superior. |
| [US Masters Swimming beginner guidance](https://www.usms.org/fitness-and-training/articles-and-videos/articles/best-swimming-workouts-for-beginners) | Technique, rest, repeatability and understanding intervals. | Individual workouts and coaching guidance, not an adaptive multiweek algorithm. |
| [Critical-speed assessment study, 2019](https://doi.org/10.3390/sports7010025) | Bounds on interpreting the paired-distance estimate. | Children and adolescents; an estimate is not a measured threshold or a whole programming method. |
| [Swim-training volume and shoulder pain review](https://pmc.ncbi.nlm.nih.gov/articles/PMC6961642/) | Individual loading and avoiding abrupt changes. | No universal safe weekly percentage; association is not proof of causation. |
| [Swim Ireland published training materials](https://www.swimforamile.com/sfam-training) | The linked 2021-labelled, 2022-built 25 m/50 m PDFs contain 34 preparatory sessions over 12 weeks, technique feedback and an 800 m time trial/event estimate. | Fixed course, not an adaptive ongoing programme. Conditional progression/recovery, pool-edition discrepancies and distribution rights remain unresolved. |

Research comparisons stay outside the repository. Product and engine identifiers
remain original and methodology-neutral.

## Feedback connection

The owner explicitly approved an opt-in, swimming-only connection from the
existing local dashboard to the owner's getsxc account. This replaces a
requirement for routine manual activity-file uploads; it does not authorize a
live transfer, account inspection or Garmin calendar writes during development.

### Direction and allowed data

The local connector initiates outbound HTTPS. Do not expose the dashboard's
HTTP server or SQLite database to the Internet. The hosted application must not
attempt to contact a user's localhost.

Transfer only swim activity identifiers, dates, pool/stroke information,
distance, elapsed/active timing, rest and available workout references, together
with import coverage and source-version metadata. Exclude credentials, names,
notes, GPS, sleep, heart rate and other health information. Do not upload raw
dashboard rows, complete detail files or unrestricted tool responses.

Garmin authentication stays in the dashboard. A getsxc connection must be
explicitly paired, account-bound, narrowly scoped and revocable. A connection
must not obtain general account access or permission to alter prescribed work.

### Source inspection

Dashboard source `f074712ab98a50afe7cfed35cabece05af3ee02a` contains cache-only
activity detail, per-lap distances/times/strokes/length counts/step references,
sync freshness and conservative planned-workout matching.

Important gaps must be handled explicitly:

- The current summary and planned-workout projection uses metres and can lose
  native yard-course information. Do not reconstruct an exact native course
  from a rounded conversion. Preserve explicit original conditions where
  available; otherwise mark them unknown and do not calibrate from them.
- A lap's fallback duration may include rest. Preserve whether active time was
  reported; do not turn a fallback into a verified moving-time measurement.
  The activity summary's unspecified duration is not labelled elapsed or active;
  the reader retains the source duration without inventing that distinction.
- Stroke classification, equipment, exact timestamps and prescription identity
  may be incomplete. Same day or similar distance is not sufficient to
  automatically complete a scheduled workout.
- A generic average pace is not an assessment, race result or technical-skill
  measurement. Mixed-stroke, drill and rest-heavy sessions cannot silently
  change pace targets.
- Cache-only reads must not trigger Garmin fetches. Failed or incomplete detail
  retrieval stays visible. When the local computer is off, data can be stale.

### Explicit recording matches

[ADR0084](../adr/0084-explicit-swimming-recording-matches.md) adds the owner's
approved manual association of an existing recording with a planned workout.
The user chooses a date filter and then a workout; neither dates, distance nor
the source workout reference selects a match automatically. Corrections and
removals preserve prior evidence and the prescription snapshot that was selected.
Matching changes no workout status, results, pace, workload or coaching decision.
Migration0153 and default-off `SWIM_IMPORT_MATCHING_ENABLED` are isolated
development only. History/export and undo remain available when matching is
disabled. Native account/watch acceptance and hosted rollout remain separate.

### Local reader development

`scripts/swim_dashboard_cache.py` reads an explicitly selected SQLite cache
with `mode=ro` and query-only access. It imports no dashboard modules, discovers
no accounts/paths/environment and performs no network requests. Python 3.10+
and its standard library are sufficient. It accepts an explicit date range
of at most 31 inclusive dates and at most 50 swimming activities. Details and
the whole projected output each have a 2 MiB limit; a detail may contain at
most 2,000 splits. Exceeding a bound fails the entire batch, never silently
truncates it. Missing detail is distinct from malformed or unreadable detail.
Database locking waits at most one second; a SQLite progress handler interrupts
queries after five seconds rather than retrying or returning partial results.

The development CLI prints only the projected observations as JSON on success;
fixed error codes go to stderr without source rows, paths or exception text.
That output is still personal swimming data when used with a real cache:
do not run it on owner data, capture it in CI or attach it to a public issue.
Current validation uses disposable synthetic SQLite files only. This is the
local read adapter; the separate sender below reuses its projection.

### Bounded local sender

`scripts/swim_dashboard_send.py` defaults to a count-only preview. It reads the
same explicitly selected cache and date range, validates the entire batch
before any request, and adds the receiver's version envelope. Each request
is at most 1 MiB; total request bodies remain at most 2 MiB. No observation is
truncated or skipped to make a batch fit.

Development preview, using deliberately nonexistent example paths:

```powershell
python -I -B .\scripts\swim_dashboard_send.py --database "C:\example\activities.db" --details "C:\example\detail" --since 2026-09-01 --until 2026-09-30
```

Actual sending additionally requires `--send` and an explicit `--endpoint`.
The only accepted destinations are the exact HTTPS `/api/swim/import` URLs
on getsxc.app and the existing fixed protected-review hostname. Requests do
not follow redirects, use proxy environment variables or bypass review
protection. The receiver must separately have its migration and explicit
ingestion flag; this implementation does not enable either.

The import key is entered through a hidden terminal prompt, with no echoed
fallback. A noninteractive caller can supply `SWIM_IMPORT_KEY` through a
trusted process-secret source. Do not put it in command arguments, shell
history, logs or a plaintext configuration file. The sender saves no key,
receipt IDs, observation files or checkpoints. Its isolated child receives
the key only through stdin and inherits only basic OS/path/temp variables.

Each connection has a 30-second socket timeout. A 180-second process deadline
also bounds DNS, TLS and slow response reads, terminating only the owned
sender child. The first failed or unconfirmed request stops the batch without
automatic retries. Output contains fixed status codes and aggregate counts,
not dates, activity IDs, receipt IDs, source paths or server error text.
On a hard timeout, confirmation counts are explicitly unknown; some requests
may have committed. Repeating the same selection is safe through the server's
existing replay/correction rules, not a local guessed deduplication cache.

Successful responses require the exact closed receipt, a valid revision/ID,
and agreement between HTTP status and replay flag. HTML, redirects, oversized
or compressed responses, extra fields and malformed receipts are failures.
Cleanup failure remains visible without hiding an earlier failure or a
confirmed receipt.

Synthetic tests exercise actual reader output and HTTP request construction,
the receiver's real validation schema, fail-fast partial sends, key isolation
and termination of a disposable sleeping child. They do not establish a live
account connection, automatic synchronization or delivery to a watch. No owner
cache, live transfer, provider change or new scheduler is authorized here.

The existing isolated pool-control browser runner also exercises the real
connection component at mobile and desktop widths with synthetic actions and
blocked networking: create/copy/disconnect, pending-state duplicate prevention,
failed-disconnect retry, key disappearance after remount/revocation,
disconnect while ingestion is disabled, and clipboard/manual-copy recovery.
These checks are not native Auth, server-action transport or live-account proof.

### Account pairing and observation capture

[ADR 0081](../adr/0081-swimming-import-connection.md) adds two account-owned
tables in migration 0150, after the unchanged 150-file baseline. A signed-in
user can create one narrow import key and disconnect it. Only the hash is
stored; plaintext is displayed once in memory and excluded from export.
The settings link remains available after ingestion is disabled.

The default-off `/api/swim/import` receiver accepts one closed, minimized
observation, bounds its body and request time, validates the evidence and
derives ownership from the key. It accepts no account identifier. A repeated
observation returns its original receipt; a correction appends an immutable
revision. Reconnecting does not reset duplicate identity.

Imported revisions are visible in settings and export, but do not complete
planned workouts, alter targets, enter shared workload or calibrate pace.
Planned-workout links remain a later slice, not a guessed side effect of
capture. The local sender is an explicit one-shot tool; creating a key does
not establish automatic synchronization.

The independent `Swimming import storage` CI workflow uses a fresh loopback
Postgres service with synthetic Auth identities and no provider credentials.
It applies the exact migration and checks ownership, privileges, replay,
corrections, concurrency, revocation, deletion and the history-preserving down.
It produces only a closed status summary. This is database-contract evidence,
not native Supabase Auth/PostgREST, browser, device or owner-data acceptance.
The old one-shot review bootstrap still refuses any source beyond 150 files.

### Approved development-only storage boundary

Imported evidence must not be represented as a manual result, a fabricated
in-app Start/Finish, or a Strava activity. Existing source and atomic completion
contracts do not support this connection as-is.

Prepare a separate ADR and reversible migration proposal covering account-owned
connection records, minimal immutable import revisions and explicit workout
links. Provider IDs and replay keys must be unique within their proper account
scope. All links must enforce common ownership. Domain observations live in
versioned JSON; any relational column must satisfy plan section 6.8.

The owner approved isolated development and synthetic testing of this
account-owned pairing/import/link storage on 2026-09-12, including cross-account
isolation, duplicate protection and a rollback that refuses to erase history.
The ADR and migration must include export, account deletion, disconnect and
corrected imports. A rollback must refuse to erase issued prescriptions or
imported history; disable the new application path and retain evidence when a
data-preserving down is impossible.

Production migrations remain unauthorized. Cross-account and replay development
acceptance uses synthetic data in isolated real-Postgres CI.

### Protected existing-review update

On 2026-09-13 the owner approved implementing and running a guarded update of
the protected test site, including existing migrations0150-0153 after acceptance.
This does not authorize production, actual account imports or Garmin access.
The existing review contains account data: its historical150-only bootstrap,
seed and spent refresh operations must not be reused.

The dedicated update checks the exact source and unchanged current-main
boundary, accepted deployment/alias receipt, protected environment metadata,
Auth settings and review database identity. It requires the complete canonical
150-entry ledger prefix, appends only the four approved migrations in one
transaction under a bounded exclusive ledger lock, and verifies the154-entry
result, owned RLS policies, restricted writer and authenticated-role readiness.
It never reads or changes existing account rows.

Only after database acceptance may it create the four named swimming feature
flags on the review branch, build one exact-SHA Preview and update the existing
protected alias. It preserves the previous deployment, account data, signup
restriction and production environment. Mixed-operation dispatches fail in
prerequisite CI; the old jobs and profiles remain unchanged. Every mutation
rechecks source and protected state. Ambiguous failures retain their attempted
and confirmed status and stop for reconciliation, without automatic retries,
deletion or ledger repair.

Existing downs remain history-preserving and ordered0153 through0150. Once
new features hold data, disable new-entry capabilities and roll forward with
compatible readers rather than erase history or deploy an old reader that
cannot understand it. Native account review and physical-watch acceptance
remain separate from database-role probes and CI.

## Implementation order and acceptance

| Stage | Deliverable | Acceptance |
| --- | --- | --- |
| 1. Evidence integrity | Distinguish unknown results, explicit skips, partial swims and completed swims in the existing domain and UI. | Unimported swims never cause a reduction or fabricated success; incomplete weeks have no adherence percentage; historical work and explicit skips are retained. |
| 2. Source-defined programmes | Goal selection backed by programme sources passing the training-method gate. | Exact expected prescriptions and adjustment decisions trace to source sections. No unsupported goal silently uses another goal's plan. |
| 3. Local result connection | A minimal export adapter, paired transport and approved account-owned storage. | Synthetic source-contract tests; no excluded fields; retries are idempotent; corrections preserve prior evidence; two-account isolation; disconnect stops future transfers. |
| 4. Observed progression | Programme-specific decisions consume eligible imported observations and assessments. | Improved, unchanged, difficult, partial, stale, missing and incompatible observations follow documented rules. Every changed target retains its evidence and prior version. No repeated advancement from one observation. |
| 5. Programme integration | Standalone programme selection or replacement of eligible primary cardio slots. | One schedule, no duplicate cardio, shared recovery context, preserved original cardio and issued history, reviewed future changes. |
| 6. User acceptance | Updated isolated review followed by a separately approved live connection/watch pilot. | Actual goal choice, schedule, a swim, its import and the justified next prescription are reviewed end to end. CI is not owner or device acceptance. |

Calendar delivery to Garmin is separate from activity import. Neither a local
dashboard connection nor a file export establishes that a future workout
reached Connect's calendar or the watch.

Existing plan versions and audit entries remain readable. Replacing the
generator must not silently regenerate existing plans. The current legacy
numeric rules remain compatibility behavior pending the source-defined
replacement; the evidence-integrity fix does not validate those rules.

The session scheduler remains removed. Implementation stays in the current
isolated worktree; no new model, cloud agent or implementation session is part
of this plan.

### Existing-review recovery

Read-only is the default for the guarded upgrade dispatch. It verifies the
same protected snapshot and 150-entry ledger but never
appends migrations, creates flags or deploys. Applying requires an explicit
`review_upgrade_read_only=false` after acceptance. Snapshot failures retain only
closed check/code/HTTP-status diagnostics, never raw responses.

The approved operation completed at `daec45dbae033abbca94cd2180378c2a124f96e4`
in run34746629650. The protected review now has154 migrations and the four
branch-only features enabled. This150-entry/previous-deployment profile is
spent; do not rerun it. Account import, native acceptance, production and
Garmin delivery remain separately gated.

### Imported-course control refinement

The owner requested removal of available-time controls and limits from imported
courses and distinct names for repeated weekly swims. New imports store explicit
null budgets; older numeric imported budgets remain in history but no longer
constrain imports, manual edits or pool changes. Generated swimming budgets and
authored rests/send-offs are unchanged. Stable Week N A/B display labels follow
source position even after rescheduling, without altering saved source titles.

Migration0154 is an additive validator/readiness change with no data backfill.
Its down refuses retained null-budget plans or nested prescription history.
Development and synthetic tests are authorized; protected-review migration and
deployment require separate approval and a current154-to155 operation profile.
The spent150-to154 profile must remain closed to this source.

After source73ef5be9 passed CI34758418894 and disposable SQL/control
CI34758418882, the owner approved the protected-site update only.
`update_untimed_swim_review=true` selects the new154-to155 operation; all other
operations must be false. `review_upgrade_read_only=true` is the default.
The profile requires the current protected deployment/alias, exact existing
feature receipts, unchanged Auth/isolation and full canonical ledger. Only0154,
the branch build SHA and the fixed protected alias may change.
The same guarded append helper is rehearsed with existing synthetic data and
injected transactional failure before hosted use. Earlier jobs and spent
profiles remain unchanged; production and account operations remain excluded.

The update completed at856b9b60 in run34760308225: migration0154 committed,
the155-entry ledger was verified, and the new READY deployment and fixed
protected alias were confirmed with unchanged Auth, access protection and
isolation. The154-to155 operation is now spent too. Neither migration profile
may be replayed against the current review.

### Bounded synthetic account acceptance

On 2026-09-13 the owner approved two disposable accounts and synthetic swims in
the existing protected test environment, followed by account removal. This
permission excludes the existing owner programme, real dashboard data, Garmin
and production. It does not permit schema, role, Auth-setting, feature-flag,
alias or deployment changes.

The default-off account-flow job uses the same exact-source, core/identity and
shared-review locks. It verifies the accepted protected configuration and155
ledger read-only, then builds the unchanged application on the GitHub runner.
The browser exercises the runner's loopback server with real review-project
Auth and PostgREST; it neither bypasses Vercel protection nor changes redirect
settings. Admin access is limited to two run/source-bound fixture identities,
their onboarding precondition and explicit post-deletion zero-row checks.
No user listing or existing-account inspection is allowed.

The bounded journey covers native password sign-in, three prepared synthetic
workouts per account, one reviewed edit with source/history retention and stable
names, native pairing, receive/replay/correction, explicit match/undo, cross-account
denial, unchanged other-account state and disconnect rejection. It uses no
in-app swim logging, external source cache, provider action or generated coaching.

Both accounts must be absent with their owned rows removed. Cleanup verifies
server-owned fixture metadata before deletion, continues with the second account
if the first fails, and is independently callable after the main step. That
cleanup retains immutable source/context checks but can survive a changed live
branch. Main failure cannot be hidden by successful cleanup. Only bounded
counters and fixed diagnostics are reported; no credentials, account rows,
screenshots, traces or raw errors are retained.

This acceptance covers native application/Auth/storage transport for synthetic accounts,
not the protected-alias browser session, a real local-cache transfer or a watch.

The first native run34762904789 signed in both accounts but stopped during
course import. Both Auth deletions and absence rechecks succeeded; the final
table-absence check did not. Migration0153 intentionally withholds
`service_role` table access to matching history, so that API check was invalid.
The owner then approved read-only, parameter-bound absence checks using the
existing review database connection. No grant or RLS change is made. The two
previous run-bound identities must be confirmed absent before another pair is
created; only boolean absence results and fixed import-step diagnostics leave
the runner. That first run did not establish native import or complete-journey
acceptance.

Run34765192325 at8cdccbd2 subsequently passed all seven native checks and all
eleven main stages. Both accounts imported three workouts with untimed budgets
and stable weekly names; an edit preserved source/history and the other
account's work. Pairing, receive/replay/correction, explicit match/undo,
cross-account denial and revoked-key rejection passed. Main cleanup and the
independent cleanup both verified account and six-table absence. The earlier
run pairs were also verified absent. Browser, server, build and database
connections closed. No deployment, permission or schema change was made by
these tests; the protected site remains at856b9b60.

### Read-only production preflight

After native acceptance, the owner approved inspection of production deployment
settings and migration history only. No personal records, merges, deployments,
database changes or permission changes are authorized.

The default-off exact-source inspection uses the existing Vercel reader and the
repository-scoped production database secret only in its final CI step. It
shares the protected-review workflow lock and the production-migration job lock.
Vercel requests are limited to fixed metadata GETs, with environment decryption
disabled. The current `getsxc.app` alias must point to a READY production build
for the verified main commit. Settings and alias/deployment metadata are checked
again after the database read.

The sole data query reads bounded migration-history metadata inside a read-only
transaction. It checks the ordered hashes and timestamps against the unchanged
146-entry main prefix and the155-entry candidate journal, without accepting
unknown or duplicate history as harmless. Only counts, canonical-prefix status
and pending count are retained. No user/Auth table, seed, migration, ledger
repair, environment write or deployment API is available. The existing
app-first production migration job remains unchanged and separately held.

The first inspection, run34767421905 atf5aa4231, confirmed the expected READY
main deployment and found no bindings for the seven selected production flags.
Flag values were not read. The database-history read failed the strict ledger
shape check; its connection closed, and no writes were attempted. This does
not establish the ledger count or release readiness.

The same bounded query now reports aggregate shape, duplicate, unknown-hash,
order and timestamp mismatch counts before strict validation. It retains no
ledger rows or hash values and does not accept any previously refused history.
Only a changed-source diagnostic inspection is eligible; the failed head is
not rerun, and migration-history repair remains unauthorized.

The changed-source diagnostic run34768570211 at74089d04 confirmed a history
mismatch, not a successful preflight. Its first156 ordered rows reached the
query limit: one hash had an unexpected format, eleven hashes were repeated,
and51 well-formed hashes were absent from the candidate journal. It also found
144 position mismatches and65 timestamp mismatches against known source
entries. These counts overlap and describe only the capped read, not the
complete ledger. The source journal itself has155 distinct hashes.

The database connection closed and no writes were attempted. The total ledger
size, safe pending-migration count and actual schema compatibility remain
unknown. Production release is blocked pending separately scoped historical
and schema-metadata reconciliation and a data-preserving remediation proposal.
Do not reset history, treat the old membership-only check as acceptance, or
apply the candidate's migrations blindly. Real account-data and watch work
remain separately held.

The owner then approved a bounded read-only reconciliation of schema metadata
and up to512 migration-history entries, followed by a data-preserving repair
proposal. The explicit `production_readonly_scope=reconciliation` choice uses
the same default-off operation, locks, exact-source checks and final-step
credentials. The original preflight remains a separate strict155-prefix check.

Reconciliation compares the bounded history with current migrations and SQL
blobs reachable from the pinned main commit, including LF/CRLF variants.
It reads only named catalog metadata for five swimming tables, seven routines,
the swim-result column, the shared completion body classification and two
movement-reference constraints. It never executes application routines or
reads personal tables. A repeatable-read, read-only transaction and the existing
connection deadlines bound all four queries.

Only source-tag classifications, counters, a history fingerprint and closed
schema metadata leave the runner. A512-row result is incomplete and refused.
Successful collection is not schema compatibility or production readiness:
both remain explicitly false. The existing disposable storage CI rehearses
the exact catalog queries before a hosted reconciliation. No history rewrite,
repair, migration, deployment, flag activation or permission change is approved.

### Data-preserving production proposal

The authorized reconciliation completed in run34770948980 at0d25f5d6, with all
seven stages passed, unchanged deployment metadata and a closed read-only
connection. The complete inventory has203 records:150 rows cover all146 current
main migration hashes,50 rows match historical source variants, two hashes
remain unmatched and one value is not in canonical hash format. Eleven repeated
hash rows overlap those groups;65 canonical-hash rows have different timestamps
from the current journal. No history was rewritten.

None of migrations0146-0154 is recorded. All nine timestamps are later than the
latest recorded timestamp; no already-recorded main migration is later than
that boundary. The five named swimming tables, seven selected swimming routines
and swim-result column are absent. The shared completion body matches the
pre0148 version; both inspected movement references retain their original
validated, immediate RESTRICT configuration. This is targeted metadata evidence,
not proof of the entire production schema or owner usability.

**Proposed approach, not approved for execution:**

1. Preserve all203 existing records byte-for-byte, including original IDs,
   hashes and timestamps. Do not reset, deduplicate, normalize or relabel the
   history. The two unmatched hashes and noncanonical-format record remain
   explicit audit exceptions, not verified migrations. Adopting this exact
   legacy baseline requires owner approval or further investigation first.
2. Build a dedicated default-off updater that checks a fresh complete history
   fingerprint, all146 main hash memberships, the exact nine pending source
   files and timestamp boundary, and every affected schema precondition.
   It must refuse any changed baseline or unexpected existing swimming object.
   The old strict155-prefix check remains failed; do not weaken it to obtain
   acceptance. Rehearse the new legacy-baseline operation with synthetic history
   and injected failures in the existing disposable Postgres CI.
3. Preserve the existing main-only, app-first deployment order: a separately
   approved release must first have a successful Vercel-created Production
   deployment for the exact approved main SHA. Keep swimming activation off
   through deployment and database preparation; verify effective settings
   rather than inferring them solely from missing environment bindings.
   No `allow_undeployed` bypass is part of this proposal.
4. Under separate production approval, use the existing production migration
   lock and a bounded transaction to append only0146-0154. Take a bounded
   exclusive database ledger lock and recheck the fingerprint inside that same
   transaction before any DDL. Keep credentials confined to the final operation
   step, after installation and source checks. Rehearsal must first
   prove that the whole batch can commit or roll back atomically. A successful
   append would retain the original203-record prefix and add exactly nine rows,
   for212 total; it would not replace that history with a155-row ledger. Verify
   source hashes, new schema, ownership/RLS, role privileges and readiness
   before any separately approved swimming activation.
5. A failed transaction must leave the baseline unchanged and stop, without
   automatic retries or ledger repair. After a committed update, the default
   recovery is to disable new entry and roll forward with compatible readers.
   Existing reverse0154-to0146 down proposals remain unused-only and require
   fresh approval and evidence that no prescriptions, results or import history
   would be erased. No automatic destructive database rollback is proposed.

The owner subsequently selected guarded updater development and rehearsal,
as recorded below. That approval does not authorize production changes.
Real account-data transfer, Garmin/watch acceptance, combined training and
backup work remain outside this task.

### Guarded updater development

The owner approved developing and rehearsing the proposal only. Production
execution and acceptance of the live legacy exceptions are still separate
decisions.

The new default-off `update_swim_production` operation is main-only and requires
`accept_legacy_swim_history=true`, an exact reviewed source, core/identity
success and no other selected operation. Its source guard preserves the
historical review defaults. It verifies both a Vercel-created successful GitHub
Production deployment and the current READY Vercel alias for the exact release.
Swimming and fixture bindings must remain unset; the frozen application source
defaults them off. An encrypted binding is refused even if someone says its
value is false. No flag, alias, deployment or permission is changed by the updater.

Only the final operation receives credentials. Inside one bounded transaction,
it locks the ledger, rechecks the203-record fingerprint and source/timestamp
boundary, refuses existing swimming objects, appends only the nine unchanged
migrations and verifies the212-row result, all five new owner policies, writer role and
authenticated capabilities. Source and deployment guards are repeated before
commit. Attempted, staged and confirmed work remain distinct; any failure after
a mutation attempt requires reconciliation, even if connection closure succeeds.
Sequence gaps after rollback are allowed and are never reset.

The existing disposable pool-storage runner rehearses the same updater from
the146-migration main schema using203 artificial history rows and an existing
synthetic profile. It covers changed-baseline rejection, mid-batch rollback,
a real SQL lock-timeout failure, precommit rollback, postcommit failure with
confirmed data, replay refusal and a successful nine-file commit. Unused downs
and fixture-only cleanup restore the test baseline; the production helper
contains no history update, delete, truncate or sequence reset.

**Access remains blocked:** current secret-name metadata shows the Vercel reader
only in the branch-restricted `swim-review` environment, not in `Production` or
repository scope. Main execution therefore refuses missing reader access before
connecting to the database. No credential was retrieved, copied or re-scoped.
A suitable read-only production verification path needs separate approval.
No production updater dispatch is authorized by development or rehearsal.

The real-Postgres rehearsal passed in
[run34776769214](https://github.com/drrowdev/hybrid-training-app/actions/runs/34776769214)
at `886dc7fe`, including the existing storage and browser journeys and container
cleanup. It exercised each rollback, postcommit-failure, replay and retention
case above. This validates the synthetic baseline, not live production execution.
The parallel source check found a test-only shallow-checkout dependency: its
old-job comparison tried to read a historical Git object unavailable in CI.
The comparison now uses the full historical job body's SHA-256, preserving the
same exact-content assertion without requiring history.

Corrected source `f3c29120` passed
[core, identity and general browser CI34777061287](https://github.com/drrowdev/hybrid-training-app/actions/runs/34777061287)
and [storage CI34777061280](https://github.com/drrowdev/hybrid-training-app/actions/runs/34777061280),
including the updater rehearsal, pool-runner typecheck, existing controls and
container cleanup. Development and isolated rehearsal are complete. This is
not a production dry run or authorization to accept the unexplained live history.

The next boundary is production verification access, followed by separate
approval for the exact legacy baseline and release. Do not widen the review
environment's branch policy or transfer its credential under development
approval. A later approved merge must preserve `08f89f05` ancestry for the
main-only source guard; squash or rebase integration would be refused.
No production dispatch, activation or owner-programme transfer has occurred.

### Staged release and stopped database update

On2026-09-14 the owner added the Production verification token and approved the
staged release, explicitly retaining the203-record history and its unresolved
exceptions while keeping swimming disabled. PR805 merged as `549110bc`, with
the exact `635ee9ff` tree and reference ancestry preserved. Vercel Production
deployment6430719935 succeeded for that source.

Fresh read-only run34807281322 confirmed the original history fingerprint,
pending nine migrations and unset swimming/fixture bindings before merge.
Main source, identity and browser checks passed; the drift job reported exactly
the nine pending additions.

Guarded updater34808199183 verified source, credentials, the live alias and
disabled features, then stopped with `P0001` during0148. Two changes were staged
inside the transaction; no commit was attempted or confirmed. The connection
closed. This is not a successful update or independent proof of rollback.
The result was consumed once into a safe receipt; it must not be rerun blindly.

The owner approved a separate read-only rollback/diagnostic check. The
`post_update` inspection profile pins deployed main `549110bc` and accepted
source reference `635ee9ff`; historical profiles retain their original main
boundary. It uses the existing branch-restricted inspection environment and
bounded read-only transaction. One additional catalogue query reports fixed
completion-function attribute comparisons, permission counts and effective
access for named roles, plus remaining swimming-object presence. It never
returns routine bodies, arbitrary role names, personal rows or raw errors.

Rollback verification covers the original history fingerprint and inspected
schema/body footprint, not an assertion about uninspected data or permission
policy. The metadata report cannot authorize a retry. Migration SQL, permission
guards, production settings and deployment remain unchanged. The additional
query and detection of altered metadata are rehearsed only in the existing
disposable pool-storage test.

Read-only run34812371814 at `5517fa6c` passed all eight stages and verified the
original203-record fingerprint and inspected schema/body footprint. All nine
additions remain absent. The live app remains `549110bc`; swimming and fixture
bindings remain unset.

All23 inspected shared-function attributes match0148. Its ACL has the expected
postgres, authenticated, service-role and PUBLIC entries, with matching grantors
and options, but no direct anon entry. Anonymous EXECUTE is nevertheless already
effective through PUBLIC. This is a concrete mismatch with0148's exact pre-ACL
list, not a lack of effective access. No unexpected role grants or default grant
options were observed in the bounded inspection.

A possible repair is a tightly guarded, same-transaction preparation of that
equivalent ACL representation before the unchanged0148 migration revokes both
PUBLIC and anon. It must require the exact observed state, preserve every other
guard and migration hash, and demonstrate no effective-access widening. This
permission-related repair, a further protected merge and a new production
attempt require fresh authorization. The diagnostic itself authorizes none.

The owner subsequently approved the guarded compatibility fix, its rehearsal,
merge/deployment and one new update attempt, with swimming still disabled.
The preparation accepts only the canonical ACL or the observed equivalent ACL
with PUBLIC EXECUTE present and the direct anon entry absent. It checks all 23
shared attributes, exact remaining membership, grantors/options, named effective
privileges and default-grant bounds. Any other state is refused.

Only the equivalent case receives a direct anon grant, from postgres, inside
the existing migration transaction immediately before unchanged 0148. A second
catalogue check requires the canonical representation and unchanged effective
access. The original migration then revokes both PUBLIC and anon, with its full
original pre/post checks intact. No migration source or hash changes, and no
extra permission survives the successful batch.

Preparation attempt, staging and verification are recorded separately. Future
failures can expose only the existing closed SCID diagnostic, not raw errors.
The disposable rehearsal retains canonical-path coverage and adds refusal
without PUBLIC access, rollback of the redundant grant, and successful update
with the original final permissions and 203-record history retained.

### Production update completed - 2026-09-14

Repair source `dab7624b` passed exact-source CI 34814413709 and the real-Postgres
rehearsal 34814413726. PR813 was merged as `8d431198`, preserving the tested tree
and approved authorship. The exact app source reached a successful Vercel
Production deployment before the database attempt.

The single authorized update, run34815744151/job103886961627, passed all five
stages. The equivalent-ACL preparation was staged and verified; the transaction
committed all nine unchanged migrations. All 203 original history records were
retained, with nine appended for 212 total. Final permission, policy and capability
checks passed, and the connection closed. No reconciliation is required.

The existing read-only drift job was then refreshed against the changed database.
Run34814905742 attempt2/job103887551022 verified all 155 canonical journal entries
online. Only that job executed again; the successful source/browser/RPC results
retained their original execution timestamps. The updater was not replayed.

Swimming was still disabled at this checkpoint; the subsequent activation is
recorded below. Private programme transfer remains separately held. Both the old
203-record updater profile and the post-failure diagnostic pinned to `549110bc`
are historical, spent profiles and must not be replayed.

### Authorized production activation

The owner subsequently approved enabling the reviewed swimming features for
existing getsxc.app accounts. Private programme transfer remains separate.
The activation runner is feature-branch tooling, not a new production app
revision: it pins the deployed application to `8d431198` and checks that live main
has not moved. Existing Production environment protections and secrets are used
without changing access policies.

After a read-only check of the 212-record history and final storage capabilities,
the runner may create only the five swimming flags for production, with value
`true`. These non-secret flags use plain values so they can be verified directly.
Existing settings, preview bindings and the protected review alias must remain
unchanged; fixture and build-SHA overrides stay absent. A fresh production build
uses the pinned main source, not the activation runner's feature revision.

The workflow has one non-cancelling production-operation slot, a ten-minute
runtime, at most 60 bounded HTTP requests, one flag-creation attempt and one
deployment attempt. Failures after a write require reconciliation, not replay.
No migrations, application/Auth rows, account provisioning or private files are
part of activation. The final receipt must verify the ready deployment and
getsxc.app alias before claiming activation.

### Production activation completed - 2026-09-14

Tooling source `ef0a78ac` passed CI 34820629716 and SQL rehearsal 34820629649,
including the read-only storage check and refusal of a read-write transaction.
The single owner-approved activation, run34821521831/job103905224340, passed all
eight stages. Its read-only verification accepted the unchanged 212-record
history and final capabilities, then closed the database connection.

The five approved production flags were created and verified. A fresh build of
the existing main source `8d431198` reached READY as
`dpl_5G7ZMAyyg9JzZAYgPJEwgAKnHcH4`, and getsxc.app was verified against that
deployment. Other settings, protection and the protected review alias were
preserved; fixtures and build-SHA overrides remained absent. The safe receipt
was consumed once: 31 HTTP requests, no errors and no reconciliation required.
The activation profile is now spent and must not be replayed.

The public `/app/swim` entry reaches sign-in with its return path retained.
This is reachability evidence, not owner-account visual acceptance. The private
16-workout programme remains on the protected test site; no transfer, account
provisioning or application/Auth-row access occurred during activation. PR814
contains the operational tooling, not a new production app revision, and is
not merged as part of this release.

### Approved conditioning integration - 2026-09-14

The owner approved implementing the reviewed built-in journey. The main
programme's Schedule step supplies the eligible conditioning days; a conditional
Conditioning step assigns activities and exposes swimming options without a
second wizard, weekday selector or start date. One final save must persist the
programme and swimming relationship together. Today, the calendar and history
must refer to one workout, not parallel conditioning and swimming entries.

The owner subsequently approved development-only database ownership checks and
backward-compatible migration/down files. No hosted apply, production deployment
or real-account mutation is authorized. Explicit slot identities, source
prescriptions and prior results must survive edits, removal and lifecycle changes.
Unsupported course fit must be shown before saving, never handled by truncating
or repeating workouts.

Recording remains outside GetSXC. The owner approved a separate Completed /
Stopped early confirmation after matching an imported recording, not restored
measurement entry. Existing imports do not establish native pool length or
verified active time. Matching, outcome confirmation, recorded measurements and
any shared workload projection must therefore remain distinct. No native result,
pace or workload can be fabricated from missing evidence.

Implementation includes pure eligibility/date/identity validation, controlled
activity selection and a reusable wizard progress control. The main wizard now
mounts a default-off fifth step for eligible new open-conditioning programmes.
Existing course selection and source import use shared inline pool/experience
controls, the primary dates and the same final save. Drafts survive Back;
changed dates, files and pools require a fresh review. Imported-outcome
confirmation has default-off UI, action, export and append-only storage code;
its development checkpoint `4387d026` passed core CI34878088126 and disposable
storage CI34878088068. Those SQL stages are not the frozen browser casebook.

The default-off single programme/swim transaction includes the
server-action connection, stable retry receipts and exported ownership links
([ADR0086](../adr/0086-atomic-swim-conditioning.md)). Local slot deletion cannot
detach a swim, while whole primary purge retains original association history.
Native programmes and recovery-week insertion remain unavailable in this new
path; the bounded programme edit is described below. Source `00fa09d3` passed core
CI34890112070 and disposable storage CI34890112131, including24 SQL stages.
The mounted wizard's synthetic375/1280 browser journeys cover new/existing
sources, draft recovery, unchanged retry and the flag-off path.

The complete isolated authenticated journey remains outstanding.
A follow-up to unshipped0156 moves the wizard's edited benchmarks
into the same transaction. The context builder uses them without writing during
engine preparation and whole-course fit validation; unchanged retry returns the
original receipt without overwriting later benchmark changes. A separate
readiness check prevents older storage from ignoring the new inputs. That
extension passed exact-source core34928353200 and PostgreSQL34928353211 at
`50750d51`.

The shared development checkpoint projects linked swims through Today, the shared
rail/calendar drawer and programme history. The original planned identity leads
to the swimming prescription and imported recording, with bounded internal return
navigation. A security-invoker view reads current matching evidence and the latest
claim together; domain rules distinguish complete, stopped early and stale evidence.
It creates no native result, measured duration or workload. Linked entries are
excluded from the separate swimming list, including retained associations.
Native completion controls and independent date writes are not exposed for these
links. Source4cad18c0 passed core34935940196 and storage34935940221.

The owner confirmed on2026-09-15 that pausing swimming must keep the primary dates
and end. No independent continuation, extension or catch-up is allowed. Unconfirmed
past swims remain unknown/incomplete; skip/undo is explicit. Development0157 adds
atomic paired date changes, fixed-calendar pause/resume and retained retry history.
Ending the primary programme also finishes its linked swimming in the same
transaction. Shared drawer/workout controls use the existing components and
reviewed pool, course and date editors. Lifecycle and ordinary Sessions/Recent
activity history passed exact-source core34944116720 and storage34944116919 at
2bdffde7, including schema reversal/reinstallation and cleanup.

The owner separately chose moving future unstarted swims with changed primary
training days. The normal Edit plan path now prepares one paired rewrite,
preserving linked identities, prescriptions and settled work. Paused plans remain
paused. Weekday activities retain their order; frequency, programme length and
single/am/pm placement stay fixed. A frozen swim cannot silently remove new
strength work. Current saved choices reopen the editor without historic weekdays.
Source410ea93c passed core34947730470 and storage34947730472, including paused
multi-moves, stale snapshots, concurrent saves, occupied destinations, late
transaction rollback, claimed-history protection and synthetic cleanup.
The authenticated full journey and hosted delivery remain outstanding.
No physical-device or owner usability acceptance is claimed.

### Approved protected conditioning update - 2026-09-15

The owner approved updating the protected test site and exercising the complete
journey with disposable accounts. The existing private course and all existing
history must remain untouched. Production, private-data transfer, watch work and
backups remain outside this approval.

The new default-off `update_conditioning_swim_review` operation pins application
410ea93c and its successful core run. Only declared tooling/docs may differ.
It requires an exact clean feature source, unchanged main, the current protected
deployment/alias receipt, existing Auth/protection settings and all155 canonical
ledger records. A fresh read-only preflight must pass before an apply dispatch.
Historical update profiles remain spent and unchanged.

One bounded transaction appends only0155-0157 and verifies the158-entry ledger,
owner policies, restricted writer and authenticated capabilities. It cannot
rewrite the existing ledger or modify owner rows. The updater may then create
only `SWIM_CONDITIONING_ENABLED` and `SWIM_IMPORT_OUTCOMES_ENABLED`, both encrypted
and scoped to the review branch's Preview environment. The existing guarded
refresh changes its build SHA, creates one exact-source Preview and updates the
same protected alias. All previous flags and unrelated settings are preserved.

An attempted or partial write is reported as requiring reconciliation; no
automatic retry or destructive down is allowed. The existing PostgreSQL service
fixture rehearses precommit rollback, preservation, replay refusal and unused
downs on synthetic data only. Native disposable-account integration and owner
usability are separate acceptance gates, not inferred from this update.

Read-only34950941881 passed at9d42be34 with the expected155-entry ledger and no
mutation attempts. Apply34952341296 then passed: the original155 records were
retained,0155-0157 appended, both new Preview flags created and READY deployment
`dpl_BiNzLA4dsCDBqe3TjT8D5zhcC28V` assigned to the same protected alias.
The operation window was2026-09-15T09:29:50Z to09:32:28Z. Auth, access protection
and isolation checks passed; storage closed without reconciliation. This profile
is now spent. Production remains8d431198 and no existing course/history was edited.

### Integrated disposable-account acceptance

A separate default-off operation pins that deployment and both flag receipts.
It reuses the existing GitHub-hosted Next/Auth runner, not a local database or
the owner's account. It creates two marked synthetic accounts, limits the run
to18 minutes, browser traffic to750 requests, client traffic to100 and admin
traffic to70. Only loopback and the exact review Supabase origin are allowed;
WebSockets and persisted browser media remain disabled.

The owner approved changing only the integrated browser limit from500 to750
on2026-09-15. Native34992320955 and34996088187 reached history but exhausted500
after both imported outcomes survived reload. Real navigation already replaced
all full-page loads except initial sign-in and required outcome reloads. The
seven cases, two accounts, other traffic/time limits and cleanup remain unchanged;
the standalone runner retains500. This is authorization for remaining protected
acceptance, not production or private-course changes.

The seven integrated checks cover native sign-in, programme creation with an
inline synthetic course, Today/shared-calendar navigation, completed and
stopped-early import confirmations, ordinary history and isolation, future
programme edits while paused followed by fixed-date resume, and import-key
revocation. Mobile375x812 and desktop1280x900 are browser viewports, not physical
devices. No native measurements or workload are invented.

Main cleanup and independent `always()` cleanup verify removal of both fixture
accounts and their swimming, conditioning, primary programme, benchmark, session
and cardio rows. Cleanup retains immutable-source and ownership checks while
allowing a moved live ref; it cannot turn a failed main journey into success.
Output is a closed, source-bound summary with fixed phase codes, never user rows,
raw errors, keys, recordings or screenshots. This checks the same application
source against the protected database; it is not yet owner usability acceptance
or a browser test through Vercel's protected hostname.

Native34973187607 confirmed that the combined Save is denied access to schema
`auth`. The earlier restricted identity helper was not used by the new combined
writer. The owner approved a bounded protected-site repair. Additive0158 reuses
that unchanged helper, preserves RLS and function attributes, and grants no
managed-auth access. Its paired down preserves all history. The GitHub PostgreSQL
fixture now reproduces this missing-schema-access condition and exercises
repair/down/restore before the full save/lifecycle/isolation suite.
Read-only34978569711 and database-only repair34979248193 subsequently passed.
All158 prior ledger records were preserved and only0158 appended, reaching159.
Deployment9d42be34, flags, Auth and user rows were unchanged. Both the deployment
updater and database repair are spent and cannot be replayed.

The complete seven-case native journey passed atfd9c01f3 in35005360323
(job104505373816), following exact core35004291663/storage35004291658.
Both accounts created programmes through the normal picker, found their swims
in Today/Plan, matched recordings, confirmed different outcomes through reload,
and revisited ordinary history. Isolation/no-invented-native-row checks, future
programme editing while paused, fixed-date resume and key revocation passed.
Traffic was651 browser/40 client/14 admin requests within the approved bounds.
Both accounts/all15 tables and independent cleanup passed; all main processes
closed. This is GitHub-loopback acceptance against protected storage, not a new
Vercel deployment, physical-device validation or owner usability acceptance.

A separately observed Today query requests `movements.name` instead of
`display_name`. That query supplies movement-region/slug maps for recovering-region
warnings; it is not the recording-matching path. It remains a general Today
follow-up, not silently included in this completed frozen acceptance scope.
Production/private-course changes remain held.
