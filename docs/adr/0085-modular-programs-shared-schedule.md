# ADR 0085: Modular programs and a shared training calendar

Date: 2026-09-22
Status: Owner-approved architecture; implementation and release qualification in progress.

## Decision

Keep one visible active primary program in the existing
`training_blocks` / `program_instances` / `planned_sessions` graph and a
separate standalone swimming program in `swim_plans` / `swim_workouts`.
The primary program can be authored Strength, Running or Hybrid, or an existing
supported template. A Hybrid workout keeps its ordered strength, running,
machine and rehab work in one planned/session identity. Activity navigation
does not manufacture parallel programs or logging identities.

This supersedes the unmerged linked-swimming draft and the earlier
strength-only first-release restriction. Neither its migrations nor its
historical environment ledger is a source baseline. Main through
`0155_seed_kettlebell_hip_flexor_raise` is the source baseline.

Authored definitions use existing JSON fields. The pure domain compiler emits
existing granular strength sets, linked-circuit rounds and typed cardio parts.
Movement identities come from the owned catalog. Prescriptions retain authored
part identity, explicit doses, rest and an editable workout snapshot. User names
are display labels, not new canonical methodology identifiers. No new
physiological coefficients, progression algorithm or swimming generator is
introduced.

Whole-program edits use the existing forward-only rewrite rules. Scoped edits
address one unstarted workout or that workout and its future unstarted matching
occurrences. Started/completed sessions retain their issued prescription and
history. Cancelling a draft performs no writes. Unfinished sessions are never
discarded because the server lacks set logs: the device may hold offline work.

## Shared scheduling boundary

Migration `0156_modular_training_schedule` adds a user-owned schedule snapshot,
atomic dispatcher and atomic primary-session start. It adds no tables, columns,
RLS policies or data backfill, and retains the main0144 active-primary indexes.
All dates include non-strength work, standalone swims, one-offs and explicit
planned rest. Rest is not an automatically recommended training vacancy.
Primary weekday indices remain Monday-based; swimming remains Sunday-based.

The shared lock is the existing main0144
`pg_advisory_xact_lock(hashtextextended('program-deploy:' || user_id, 0))`.
Primary deploy/update therefore acquire the same reentrant lock, not an
oppositely ordered second lock. Statement triggers cover direct mutations of
the six scheduling/identity tables and both set/cardio log tables. Eight existing swimming RPCs acquire the
common lock before their swimming-specific and row locks. The migration
requires their exact normalized main0147 body fingerprints and preserves their
OIDs, owner, security mode, search path and ACL. It does not widen access to
`swim_request_user_id()`.
Shared completion, mixed-station actuals, recovery-week insertion and batched
bodyweight logging also acquire this lock before their row/bodyweight locks.
Their exact main0148/main0144/main0136 bodies and unchanged attributes are
verified on installation and unused rollback.

Preview captures a revision before dependent reads. Save checks that revision
inside the write transaction. Explicit overlap consent is separate from any
saved two-a-day preference. A newly occupied date cannot be committed without
acceptance; an unchanged previously accepted overlap does not become a new one
because an archived program's session changes display category. Replacement
consent identifies the particular prior primary block. Swimming import still
refuses another active swimming plan instead of silently replacing it.

Request UUID, operation, semantic input hash, accepted overlaps and result are
stored in existing `engine_override_events.context`. Exact retries return the
receipt before stale-preview checks. Reusing an ID for different input fails.
No cross-program lifecycle cascade is introduced.

## Rollout and refusal

The repository deploys application code before migrations. A missing named
0156 RPC is a specific unavailable state for new setup/review, not an empty
calendar. Home retains its existing surfaces when the new shared-week panel is
unavailable. Existing history and the logger remain accessible. Primary start
retains the old conditional-link path only for the exact missing new RPC;
permission, connection and other errors never use that fallback.

The unused down migration refuses any modular receipt or authored instance,
including archived ones. It removes only the exact lock prefixes and verifies
the restored main0147 function bodies and unchanged attributes. Once used,
retain storage and repair forward. App rollback does not require schema down.
An environment containing the historical draft's conflicting0155-0158 lineage
must fail preflight; never renumber applied SQL or reset its ledger.

Release qualification belongs to the coordinator. Local checks do not qualify
real PostgreSQL, native Auth/RLS, browser execution or production deployment.
The disposable storage rehearsal covers down/up, privileges, replay/staleness,
bidirectional overlaps, opposite-order concurrent legacy swim/primary writes,
concurrent starts, shared-completion/actuals lock order, history retention and
independent lifecycle.
The native modular browser profile requires its exact six mobile cases with
no skipped, duplicated, missing or retried cases. No private course or protected
account is an acceptance fixture.

The coordinator-owned modular updater is a separate, disabled-by-default manual
operation. It accepts only the verified 213-entry production history plus the
single0156 append (214 total), preserving the complete existing ledger under an
exclusive transaction lock. Its release candidate must pass storage and native
qualification; the deployed app must be the exact two-parent main/candidate merge
with the qualified candidate tree and READY live alias. Application deployment
precedes this storage append. No automatic down migration follows use or an
ambiguous commit, and no user settings/data are rewritten by this operation.

The original validated training-day CHECK is preserved for every existing
program. Only an `authored` block may additionally have exactly one training day.
Migration0156 guards the exact original definition before this extension; its
unused down guards the installed definition and refuses any one-day block,
including hidden history, before restoring the original CHECK. Existing rows
are never rewritten, and the profile's two-to-seven-day preference is unchanged.

## Remaining release gates

The first source publication is a draft, not a release claim. Existing template
wizard shared review/replay integration, remaining schedule-writer coverage,
the six-case authenticated browser journey, real SQL execution and release
environment qualification must be completed before merge/deploy approval.
Imported swimming outcomes and provider/watch integrations must not be implied
by the authored builder or by matching an imported recording.

Related contracts: [DC-K4](../knowledge/hybrid-training-design-constraints.md#k-engineering--data-hygiene),
[DC-SW7/DC-SW8](../knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05).
