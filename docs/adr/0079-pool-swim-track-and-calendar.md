# ADR 0079 - Independent pool swimming, shared calendar and logging

**Status:** Accepted for implementation (2026-09-05). The owner approved additive
swim-data storage and access rules, with swimming filling an existing program's
cardio days. Production migration is not authorized. No swim behavior has shipped.

Related: DC-A1/A5, DC-D1/D2/D7, DC-E1/E3, DC-K4/K5, DC-N2,
DC-S3/S5, DC-V1/V2; ADRs 0032, 0070, 0075, 0076 and 0077.

## Context

The live application supports independent logged sessions, but only one active
primary program, block and season:

- Migration `0144_atomic_user_workflows.sql` enforces all three active-row
  constraints. Its program deployment transaction archives prior active programs
  and blocks. Adding a second ordinary program would not preserve the first.
- `lib/planner/queries.ts:getActiveBlock` selects one block. Today and Plan read
  its planned sessions; Plan redirects a blockless user into program setup.
- `sessions` has no required block reference. The inverse
  `planned_sessions.completed_session_id` link is optional. Existing standalone
  sessions already support completion, offline receipts and shared load.
- `cardio_logs.session_id` is required. Its access policies follow the parent
  session. Its rounded `distance_km` and pace fields cannot preserve native pool
  measurements. `program-core.CardioPlan` is display copy, not structured work.

The proposal was challenged with Claude Opus 5. Incorporated feedback includes
derived rather than incremented adaptation, database-enforced ownership and
single logging, frozen course and decision inputs, and explicit pause/trash
semantics. Suggestions to drop assessment or combined-mode requirements were
not adopted.

## Options

| Option | Decision |
| --- | --- |
| Allow multiple active primary blocks/programs | Reject. Changes existing lifecycle guarantees and old-client assumptions throughout the app. |
| Put swim work inside the current strength block | Reject. Couples swim duration, pause and history to strength replacement and recovery-week insertion. |
| Create a hidden or archived block for active swimming | Reject. Misrepresents lifecycle state to existing readers and cleanup. |
| Independent swim plan, shared calendar and ordinary session logs | Propose. Additive, independently stoppable, and preserves existing primary-program ownership. |

## Ownership and calendar

The swim generator owns swim assessment, workouts and progression. Each existing
program continues to own its own prescriptions, progression and recovery recipe.
No second active `program_instances`, `training_blocks` or `training_seasons`
row is created for swimming.

### Use an existing program's cardio days

The owner's combined-mode example is Tactical Barbell strength with progressive
swimming on its assigned cardio days. This is **replacement of workout content,
not additional training days**. The user selects eligible, unstarted cardio-only
slots; strength and mixed strength/cardio sessions are not replaced wholesale.

A swim workout can bind to one existing planned cardio session through an
owner-checked unique link. The parent slot owns its date and completion identity;
the swim plan owns the detailed pool prescription. The calendar, preview, logger
and planned-volume analytics resolve that slot once. They must not display or
count the original cardio plus a second swim workout.

Keep the parent's stored prescription and program reference intact. Starting
either entry point atomically obtains the same session and links the swim
workout; completion credits the parent's cardio adherence as well as swim
history. Swim adaptation does not run through the strength-only progression
adapter.

Generate each swim week against the actual available cardio slots and their
easy/hard/recovery intent. Fewer cardio slots in a recovery or peak week mean
less scheduled swim work, not missed training or a backlog. The user does not
enter a competing fixed frequency for this mode. Unknown swim pace cannot
support a claimed exact duration fit.

Replanning may replace slot rows. Preserve swim history using non-cascading
links and stable source references; invalidate ambiguous future bindings and
show that scheduling needs review. Never infer a replacement slot by date alone.
A primary program switch requires explicit rebinding or a separate swim schedule,
not an invisible active swim plan or automatic assignment to the new program.

**Owner-selected pause behavior:** pausing swimming returns future unstarted
bound slots to the program's current regular cardio workouts. Resume reviews
eligible slots before reattaching. Stop/remove detaches them permanently.
Started and completed swims retain their swim prescriptions and history. Do not
restore a stale bind-time recipe over a subsequently updated parent prescription.

Claude Opus 5 reviewed this refinement before it was presented to the owner.

### Separate swim dates

Standalone swimming and explicitly added swim days use independent dates.
One platform calendar composer combines primary planned sessions and dated swim
workouts. Today and Plan consume that composition, including standalone swimming
without a primary block. Identities remain distinct; neither source is flattened
into the other's identifiers or week indices. The existing season remains a
primary-program roadmap, not a second swim lifecycle.

Combined setup requires an explicit priority; there is no inferred default.
Existing appointments are not moved automatically. Date-only changes to strength
are proposed when swim has priority and applied through the primary scheduling
boundary with consent. Unsafe moves are filtered before presentation and checked
again on acceptance. Capacity conflicts require another slot, day or frequency;
training trade-offs warn and allow a recorded override under DC-K4.

The composer understands `single`, `am` and `pm` occupancy, the user's two-a-day
setting, recovery windows and events. Two labels alone do not prove a six-hour
gap. Unknown times remain unknown. All sessions remain visible during a conflict.
Schedule-changing transactions share per-user serialization, recheck both tracks
and reject stale proposals. This includes primary deployment, moves, recovery
insertion and season transitions when swimming is enabled.

Recovery coordination is a proposal, not a negotiation framework. Swim reads
actual strength workload and the primary program's declared hard/recovery days.
Shared workload advice continues to see completed swims. The user can ease or
move swim work to match recovery, or invoke the primary program's own recovery
control. Neither track replaces the other's recovery recipe or silently changes
priority. No new ceiling multiplier is introduced.

## Proposed storage

| Surface | Contents and justification |
| --- | --- |
| `swim_plans` | Identity, owner, lifecycle status, dates, revision and timestamps are externally observable/queryable. Typed `definition` stores setup; typed `state` stores observations, accepted assessment, proposal decisions and input snapshots. One active swim plan per user. |
| `swim_workouts` | Identity, owner, plan link, independent local date/slot when unbound, revision, lifecycle markers, optional unique primary cardio-slot link and optional unique session link support the calendar and concurrency. A bound workout reads its date from the primary slot. Typed JSON stores original/issued prescriptions, versions and user modifications. |
| `cardio_logs.swim_result` | Nullable typed JSON for actual native pool work, original observations, optional splits and provenance. Removed only with the result/history under existing deletion rules. Internal swim details do not become separate top-level columns. |

No swim-plan foreign key points to a primary training block. Every new column is
subject to the schema-discipline questions before its migration is finalized.
No table is added for Garmin or for a second derived workload ledger.

New user-owned rows use both `USING` and `WITH CHECK` ownership policies, grants
and query indexes. Composite ownership foreign keys prevent linking another
user's plan or session, including direct authenticated database writes. A
supporting unique `(user_id, id)` session index adds no session column.
Authenticated transaction functions retain RLS; no new service-role write path.

Starting a swim atomically creates and links one ordinary `sessions` row.
That persisted link defines **started**, not a browser cursor or first set.
Accepting changes can only affect future, unstarted workouts.

Completion atomically saves detailed actuals, exactly one aggregate cardio row
and the existing session completion receipt. Reuse the durable FIFO outbox and
its uncertain-response/retry behavior. A repeated completion, including one with
a new client UUID, cannot add another cardio row or advance progression twice.

A partial unique index alone is insufficient: session-level database guards must
also reject generic cardio additions to a structured swim, orphan swim results,
and direct edits that disagree with the native result's derived summary. Guards
serialize on the session so concurrent inserts cannot both pass a pre-check.
Generic edit links route to the swim result editor. Actual-result changes update
summary and shared load through the same write boundary.

## Exact pool data and historical meaning

Store a reduced positive rational native length and its unit (`m` or `yd`), plus
integer whole-length counts. Store original times as integer milliseconds.
Validate bounded values and arithmetic; normalization defines course equality.
For example, 100/3 m and 33.33 m are different pools.

Each issued workout, result and assessment snapshots its own pool, course,
stroke, equipment and protocol. A changed default pool never relabels history.
Pace and best efforts are compared only within compatible categories.
Weekly distance is shown by native pool/course, not as an unlabeled mixed total.

Conversion into existing generic distance/time columns is a documented, rounded
compatibility projection only. It is never read back as exact swim distance or
used for swim benchmarks, personal bests or progression.

Generic historical swims keep contributing to current shared load and history.
Missing course/stroke details are not guessed. Linking one to structured work
requires explicit selection and sufficient native details, and reuses its
existing log instead of creating another load-bearing copy.

## Assessment and progression

Setup collects only inputs the first generator uses: goal, swimming experience,
availability/frequency, time budget, native pool, known strokes, equipment,
recent comfortable whole-length swimming, and optional event/benchmark.
Someone without recent continuous-swim experience takes an easy introductory
path, not an invented ability or mandatory maximal trial.
Someone unable to comfortably swim one length of the selected pool receives
learning guidance rather than an automatically prescribed whole-length workout.

Calibrated pace requires a suitable verified observation and matching course and
stroke. A paired-distance assessment must use its supported protocol and exact
whole lengths; arbitrary short swims are not silently extrapolated. Assessment
uses an optional 200/400 critical-speed field estimate, not a measured laboratory
threshold. The reviewed evidence used metres and trained swimmers; native-yard
estimation is mathematically valid but is a separately labeled heuristic, not
equivalent physiological validation.
An uncalibrated plan gives effort and rest guidance, not fabricated pace targets.
A time budget is not a promise that an unknown swimmer will finish a distance.

Start with technique/base and endurance goals. Pool event date and distance
influence specificity and taper; an infeasible event request surfaces a choice
rather than compressing missed training. DC-D7/DC-N2 still apply: no general
threshold plan outside an explicit, eligible event-preparation window.

Generate a multi-week baseline and identify future unstarted weeks as
provisional. The next-week recommendation is a pure function of settled work,
completion, effort, usable recent volume and shared recovery context. It does not
increment a mutable fitness counter. Persist the exact input snapshot, rule and
generator versions with each proposal so historical reasoning is reproducible.

Progress, hold and reduce decisions must produce demonstrably different future
work for different result histories. Change one main dose lever at a time,
bound changes, and never accumulate missed volume. Benchmark updates require
accept/reject; accepted updates affect future unstarted work only. Accepted,
rejected and overridden decisions remain auditable. Issued prescriptions remain
authoritative on workout rows; decision history cannot evict their versions.

Scaling retains warm-up, cool-down and purpose-specific main work in valid whole
lengths. An impossible budget returns a specific conflict, not a broken workout.
Exact dose/ramp/rest/recovery numbers are versioned heuristics until outcome data
supports them; document signals and revision thresholds with the swim knowledge
page. Do not claim scientific calibration.

## Independent evidence and limits

- [Nikitakis et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6359490/)
  compared 200/400 m critical speed with maximal lactate steady state in trained
  young swimmers. Individual sustainability differed. Moderate support for the
  field method; no validation of adult-novice or native-yard applicability.
- [Swim England adult learning framework](https://www.swimming.org/learntoswim/swim-england-adult-learn-to-swim-awards/)
  supports distinguishing water confidence and short independent swimming from
  stamina. [USMS beginner guidance](https://www.usms.org/fitness-and-training/articles-and-videos/articles/best-swimming-workouts-for-beginners)
  supports rest-based work and warm/main/cool structure, not universal doses.
- [Feijen et al. 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC6961642/)
  supports individualized swimming-load monitoring, particularly for adolescent
  shoulder complaints, but supplies no universally safe progression percentage.
  [Arsoniadis et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8953612/)
  reviews swimming/resistance-training interactions without establishing a
  universal session order or spacing interval.
- [USMS pool measurement requirements](https://www.usms.org/volunteer-central/guide-to-local-operations/event-management/top-10-and-records-and-tabulation/pool-length-form-and-measurement-procedures)
  distinguish course types. Rational storage is an engineering choice, not a
  claimed sporting-body requirement.
- [Garmin's swim-workout FIT recipe](https://developer.garmin.com/fit/articles/cookbook/encoding_workout_files.html)
  documents pool, stroke, equipment and repeat/rest fields.
  [Developer-program access](https://developer.garmin.com/gc-developer-program/program-faq/)
  requires application and approval. File-format support does not establish
  cloud access or universal watch compatibility.

## Lifecycle and safety

- Pause retains all issued workouts. Paused planned dates are excluded from
  missed-work and adherence calculations. Resume previews new dates for consent
  rather than stacking overdue work. Completed work during a pause still counts
  toward actual load and history.
- Finish/archive/remove stop future scheduling without deleting completed
  history. Replacing strength does not archive swimming, or vice versa.
- A started workout remains resumable after plan pause/archive. A late offline
  completion is accepted as actual history and workload, but cannot progress a
  replacement plan.
- Use existing session trash/undo. Soft deletion retains the workout/session
  link; completion visibility derives from session state. Hard purge may clear
  the link while preserving the planned target. Account deletion purges swim
  data with the account; account export includes both new tables and results.
- Reuse the current limitation and region rules at generation and start.
  Structured stroke/equipment attribution must cover relevant shoulder, elbow
  and lower-body exposure through the shared load path. Do not invent a separate
  limitation system or retrospectively reject an actual historical log because
  a limitation was added after the swim.

## Delivery and acceptance gates

1. Standalone: setup, assessment/effort path, multi-week workouts, readable
   mobile poolside view, optional set progress/splits, fast offline-safe finish,
   and a visible accepted hold/progress/reduce decision.
2. Combined: progressive swim content on selected existing cardio days, or
   explicitly added separate dates, in the same Today/Plan calendar; explicit
   priority, conflict and recovery proposals, independent lifecycle, and honest
   native swim analytics.
   Both gates are required before calling the first release complete.
3. Garmin: only after the core works. Keep the internal prescription/result
   format versioned and isolate later mapping behind a small adapter. Official
   access is not assumed; no speculative integration tables or other wearables.

Release evidence must include fixed multi-week improving, plateaued and
missed/high-effort simulations with exact expected outputs; unit/course and
scaling invariants; benchmark accept/reject and historical targets; counted-once
load through edits/trash/undo; new limitations; concurrent start/move/accept;
offline reload/replay and archived completions; two-user policy and cross-owner
link rejection; export/deletion; and unchanged primary prescriptions absent an
explicit primary-owned action. Playwright must exercise standalone and combined
mobile paths. Skipped database/browser cases are not proof of acceptance.

## Rollout and approval boundary

The owner approved additive user-data/RLS implementation on 2026-09-05 and
selected return-to-regular-cardio when swimming is paused. Approval to implement
is not approval to migrate a production database.
Use a dedicated non-production database for migration and isolation acceptance.

Ship behind a server capability/feature gate until the additive migration is
present and validated. Disabled users retain the existing path. New structured
writes have no generic-data fallback when migration support is missing.

The down-migration removes only empty new storage; it fails loudly rather than
dropping swim history or removing protections from retained structured records.
Turning off new setup does not strand existing results or queued completions.
Any later data conversion or destructive cleanup requires separate approval.
