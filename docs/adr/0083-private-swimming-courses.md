# ADR 0083: Private swimming course imports

**Status:** Protected test-site update approved, 2026-09-13.
The owner approved migration 0154 and deployment of untimed imports and distinct
weekly names while preserving existing accounts and programmes. Production,
provider transfer and further account changes remain outside this update.

## Decision

Support a prepared, versioned JSON file from an owner-supplied course. Review
its explicit workouts, dates and pools before one atomic import. This is not a
PDF parser, public programme catalogue or redistribution licence. No protected
course schedules or personal capability details belong in source or fixtures.

Compile the supplied sections, rounds, repetitions, distances, rests and
send-offs without scaling, trimming, inventing pace or duplicating sessions.
Schedule only the workouts explicitly listed for each week. Require enough
chosen days for the busiest week; a shorter final week stays shorter.
Pool conversions require exact whole lengths, including a different initial
pool for an individual workout. A conflicting printed total requires explicit
acceptance of the listed sets, not an invented correction.

Private courses use `swim-course-1`. They have no generated initial dose,
provisional weeks, automatic assessments or generic week recommendations.
Unspecified coaching decisions remain manual. Future unstarted workouts can
be reviewed and edited with a reason; original source, original prescriptions
and every previous issued prescription remain available. Pool/date/lifecycle
controls retain their existing eligibility and history rules. Unknown outcomes
remain unknown. Imported prescriptions are not proof of performed work.

Imported drill text is the instruction, not a legacy generated-drill identifier.
Display it without substituting generic technique, effort or focus advice.
An omitted rest stays unspecified; only an explicit zero means no rest.
These presentation rules do not change saved prescriptions or storage validation.

**Owner refinement, 2026-09-13:** imported courses have no time-available
input, display or enforcement. The swimmer manages time; explicit rests and
send-offs are preserved. New imported setup/prescription budgets use JSON null,
not an invented numeric default. Existing numeric imported budgets stay stored
but do not constrain edits or pool changes. Generated programmes retain their
numeric-budget contract.

Display repeated swims as Week N A/B, using their original source positions,
not scheduled dates. Retain descriptive source titles alongside that prefix.
Do not invent differing effort labels for identical sessions or overwrite
source titles, prescriptions or historical recording-match snapshots.

## Storage and safeguards

No new table or top-level column is needed. `swim_plans.definition.privateCourse`
contains source reference, edition, title and version.
`swim_workouts.definition.courseSource` retains the individual source
prescription. The existing atomic RPC stores these JSONB values with the
schedule, reviewed choices and immutable originals.

Migration0152 replaces the existing plan/workout binding validator and adds a
narrow private-source validator and readiness probe. Ownership, request identity,
RLS, composite FKs, role, mutation RPCs, locks and revision checks are unchanged.
SQL binds the original to its source, checks reviewed initial pools and total
acknowledgement, rejects source replacement and requires explicit recorded
edits rather than generic progression. Newly created helpers revoke inherited
grants before granting only the intended caller.

Both routes/actions and readiness require default-off
`SWIM_PRIVATE_COURSE_ENABLED=true`, migration0152 and existing swimming
capabilities. Later pool changes separately require the existing pool flag.
The down takes bounded exclusive locks, refuses any retained imported plan or
workout, and otherwise restores the exact0151 binding validator. It never
deletes imported history. No existing data is backfilled.

This increment brought the source to153 migrations. Historical150-only execution profiles must
continue refusing appended migrations. Existing-account rollout still requires
current-main/migration-order reconciliation and separate owner approval.

## Acceptance

DC-SW1/SW2/SW3/SW4/SW5/SW8/SW9 and DC-K4: synthetic checks cover strict files,
exact schedules and pool conversion, conflicts and confirmation, unavailable
strokes/equipment, disabled generic regeneration, safety checks, owner/revision
guards, retained source/history and duplicate-save recovery.

The existing isolated Postgres runner covers the complete migration chain,
initial mixed-pool import, rejected conflicting totals, atomic failure, grants,
cross-account denial, explicit edits, stale revisions and used-down refusal.
The existing network-blocked browser runner exercises real import/editor
controls at375/1280, including preview invalidation and failed-save recovery.
These checks do not establish native Auth/server-action or watch delivery.
Preparing and installing the owner's actual file remains a separate step.

## Untimed-course compatibility

Migration0154 permits explicit JSON null only for imported-course budgets in
the existing plan/prescription validators and adds an authenticated readiness
probe. Missing fields and generated null budgets still fail. No table, column,
ownership policy, row, original prescription or history is rewritten.
Imports and manual course edits require this readiness alongside existing
capabilities. The down migration locks both swimming tables with bounded
timeouts and refuses any retained untimed setup or nested prescription history.
Otherwise it restores the exact pre-change validators.

The source now contains155 migrations. The spent150-to154 hosted profile
continues refusing this source. Development and synthetic migration tests were
approved; a new reviewed154-to155 profile and separate owner approval are
required before applying this change or deploying it to the protected review.

The owner subsequently approved the protected test-site update only after
source73ef5be9 passed application CI34758418894 and disposable SQL/control
CI34758418882. The new untimed-update profile pins that application, the current
READY deployment receipt and all four existing branch-only feature IDs. It
checks the entire154-entry ledger, appends only0154 atomically, then deploys.
Inspection remains the default; applying requires explicit selection.
No production change, source reimport, account operation or feature-flag write
is part of this approval.
