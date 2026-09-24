# ADR 0086: Explicit standalone swimming outcomes

Date: 2026-09-23
Status: Owner-approved source implementation; storage/native qualification pending.
Hosted migration and outcome activation require separate approval.

## Decision

A matched recording does not complete a workout. The owner explicitly confirms
Completed or Stopped early, can correct that decision, and can remove it.
These append-only claims belong to the standalone swim workout; they do not
create a primary program, native session, cardio log, distance, pace or load.
Imported observation, scheduled date and actual recording date remain distinct.

Migration0157 adds `swim_import_outcomes` and two security-invoker read views.
The existing0000-0156 SQL and ledger records are unchanged. The journal timestamp
is strictly after0156, independent of the superseded linked-swimming draft.

## Schema discipline

Top-level fields are externally observable ownership, identity and ordering:

| Field | Purpose and removal |
|---|---|
| `id` | Request/replay receipt; account deletion removes it. |
| `user_id` | RLS and account cascade boundary. |
| `workout_id` | Stable owned standalone target; account deletion removes it. |
| `match_id` | Original owned recording-match identity; null marks removal. |
| `revision` | Unique owner/workout history order and optimistic concurrency. |
| `created_at` | Receipt creation time, not an invented workout time. |
| `metadata` | Outcome, prior receipt and confirmed workout revision. |

Derived status is not persisted. Composite foreign keys retain ownership and
the original match/workout relationship. Deferred target links permit the
existing account cascade. Authenticated callers can read only their rows and
cannot insert, update or delete receipts directly. The existing `swim_writer`
owns the bounded confirmation function; no existing role/RLS grants widen.

The function acquires the existing `program-deploy:` lock before `swim-import:`
and row locks. It checks the current receipt, original match, latest import and
workout revision. Exact current-request replay returns the same receipt;
changed input, stale state and superseded replay fail explicitly.

## Read and navigation contract

`standaloneSwimTrainingState` in the domain package is the single outcome
projection. Visible native history takes precedence. A stale recording,
changed prescription or removed/rematched association requires review, while
retaining the original receipt and recording date. Removing confirmation
restores the ordinary scheduled/paused/ended state.

Swimming, workout detail, Home, shared week, calendar and activity history use
this projection and shared labels. Next swim excludes confirmed/stopped work
and unresolved claims. History and Home recent activity use the original
recording date and link to that recording with the owned workout context.
Existing native sessions appear once; claims add no native measurements.

The default-off `SWIM_IMPORT_OUTCOMES_ENABLED` gates new confirmation/correction,
not owned historical reads, removal or export. Only an exact missing capability
may use the pre0157 view; unreadable/malformed installed storage fails visibly.
Export v2 retains every claim, correction and removal.

## Rollout and evidence

The independent down refuses any receipt, including corrections/removals.
Unused down/up retains the migration ledger and verifies original catalog
identities. No automated down follows use. The normal runner retains one outer
transaction across all pending files. Existing GitHub storage CI must prove
normal fresh158, incremental157-to158, precommit rollback, ownership, replay,
stale claims, account deletion and unchanged settings/roles.

Frozen native six passed at5446db2/run35802903845 before this change. An added
M7 must exercise actual import, explicit decisions, shared views, retained
history, removal and export. All original six assertions and runtime/media
bounds remain unchanged. Only the disposable native app enables creation.
The existing0156-only production updater remains closed to this158-entry source;
this ADR does not authorize its widening, hosted DDL or activation.

Related: [ADR0084](0084-explicit-swimming-recording-matches.md),
[ADR0085](0085-modular-programs-shared-schedule.md),
[DC-SW5/SW6/SW7/SW8](../knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05).
