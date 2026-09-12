# Goal-led swimming programmes and observed progress

**Status:** evidence-integrity corrections and a synthetic-only, swimming-field
projection and cache-only reader are published and tested with synthetic SQLite
data. Account pairing and immutable observation storage are implemented on the
development branch; the isolated synthetic Postgres contract passed at0961b7ac. Programme
selection, authenticated local sending and the live connection remain unfinished.
**Owner decision:** 2026-09-12.

The owner subsequently selected a qualified coach's programme with explicit
adjustment rules as the training replacement's basis. No such complete
programme has been obtained yet; commissioning a coach or paying for content
is not authorized by that selection.

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

No complete adaptive programme has passed this gate yet. This is a release
blocker, not permission to activate a generic replacement.

The author must specify which available observations drive changes, what
happens when they are missing or incompatible, and when reassessment is
needed. The programme must work with the approved watch-first workflow:
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
| [Swim Ireland published training materials](https://www.swimforamile.com/sfam-training) | Concrete 12-week, three-session progression toward a distance event, with pool-specific versions. | Candidate for a distance-building goal, not yet selected for ongoing fitness alongside strength; adaptive rules and distribution rights need resolution. |

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
local read adapter, not an authenticated sender or a live connection.

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
capture. The local cache reader does not upload yet, and the UI does not claim
that creating a key establishes automatic synchronization.

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

No production or existing review migration is authorized. Use synthetic data;
cross-account and replay acceptance requires isolated real-Postgres CI.

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
