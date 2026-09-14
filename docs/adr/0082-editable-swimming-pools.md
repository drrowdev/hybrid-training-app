# ADR 0082: Editable swimming pools

**Status:** Approved for isolated development and synthetic testing, 2026-09-12.
No existing review or production migration or deployment is authorized.

## Decision

New programmes start with a 50 m pool selected. A programme's default pool and
an individual unstarted workout's pool can be changed through preview and
confirmation. Programme changes affect today's and future unstarted workouts
that have no explicit individual choice. An individual choice can be reset to
the programme default. Past, started, completed and skipped prescriptions are
not rewritten.

Preserve every repeat's physical distance, repeat count, rounds, effort,
equipment, rest and section structure. Convert lengths with exact rational
arithmetic, including native yards. Reject a repeat that cannot fit whole
lengths of the requested pool; never round, merge repeats or manufacture a new
training prescription. An incompatible prescription still requires a separate
explicit workout adjustment; this feature is not a general set editor.

The original setup remains the measurement basis for its comfortable distance
and programme dose. Do not reinterpret its length counts when the preferred
pool changes. Regeneration retains each issued workout's pool, and mixed-pool
week totals use one explicit measurement basis.

Pace targets need an assessment for the exact selected course and supported
stroke/equipment. Otherwise remove targets and the compact calibration, clear
the duration estimate, and recompute only the supported time accounting.
Course-specific history remains separate. This does not add a new assessment
protocol, automatic reassessment policy or replacement progression model.
Assessment entry remains tied to the original programme course, now explicitly
displayed beside that form even when the programme default changes. Changing
the default must never silently relabel a submitted assessment. Independent
assessment selection for every pool is not part of this increment.

## Storage and rollout

There are no new tables or top-level columns. The optional programme default
lives in `swim_plans.state.poolCourse`; an explicit workout choice lives in
`swim_workouts.definition.poolCourse`. These JSONB values are configuration,
not inferred fitness. Original setup, original workouts, result history and
append-only decisions remain intact.

Migration 0151 extends two existing invoker validators and adds an exact
distance-preservation validator plus a read-only readiness probe. It does not
replace the owner-scoped mutation RPC, change its identity lookup, role,
permissions, locks, revision checks or RLS policies. The existing atomic
`swim_update_plan` persists the default, prescriptions and decision together.
SQL independently rejects unaudited pool choices, altered repeat distances and
calibration copied between short- and long-course pools.

Controls and actions require both default-off `SWIM_POOL_EDITING_ENABLED=true`
and the authenticated `swim_pool_editing_ready()` probe. Existing source can
still read old records; no data backfill or migration of existing rows occurs.
New helpers revoke inherited function grants before allowing their intended
callers. The disposable fixture reproduces hosted function defaults and tests
these grants explicitly.
The down migration takes bounded locks and refuses any saved pool-choice
metadata or decision history. Once used, retain history and roll forward.

The source now contains 152 migrations. Historical 150-migration review and
reference profiles remain unchanged and must refuse this source. A new source-
bound rollout, current-main reconciliation and separate owner authorization
are required before touching an existing database.

## Acceptance

DC-SW1/SW2/SW5: exact 50-to-25-to-50 distance conversion, native-yard and rational
course handling, incompatible-repeat refusal, no cross-course pace transfer,
immutable original/history and retained choices through later editing.

Application checks cover preview-only reads, explicit apply, owner/capability
checks, stale revisions, same-day eligibility, exclusion of settled work and
resetting an individual choice. Synthetic browser checks exercise the actual
React controls at mobile and desktop widths with no external service access.

A disposable Postgres CI contract applies the complete source to a fresh
synthetic Auth fixture, exercises actual RPC/RLS/revision/history constraints
and verifies unused down/up and used-down refusal. This is not native
GoTrue/PostgREST, live-account or watch-delivery acceptance.
