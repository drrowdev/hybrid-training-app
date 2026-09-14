# ADR 0085: Confirmed imported swimming outcomes

**Status:** Approved for development-only implementation, 2026-09-14.
Hosted migration/deployment and real-account writes require separate approval.

## Decision

After explicitly matching a recording, the user can separately confirm
Completed or Stopped early. This records a user statement about the prescription,
not a native measured result. Matching by itself remains neither outcome.
Native pool, active duration, pace, load and assessment must not be inferred.

An append-only outcome ledger references the exact owned match, which already
references immutable imported evidence and an issued-workout snapshot. One
current event per workout replaces or removes a prior claim, without erasing it.
Removal events remain in the current projection so old confirmations cannot
resurface. Several matched recordings are not automatically combined.

The latest outcome is usable only while its exact recording, match and workout
revision remain current. Corrections or rematching require review; retained
claims remain history, not permission to silently complete another workout.
Confirmation cannot replace an existing native result or settle started work.
Replay returns the original receipt only for identical, still-current input.

## Schema discipline and isolation

Migration0155 adds `swim_import_outcomes` with these top-level fields:

| Field | Observable or relational reason | Removal |
| --- | --- | --- |
| id | Durable request/retry identity. | Account deletion. |
| user_id | Ownership and account-delete cascade. | Account deletion. |
| workout_id, match_id | Same-owner composite FKs; the match must belong to that workout. | Account deletion. |
| revision | Per-workout event order and optimistic concurrency. | Account deletion. |
| created_at | Exported outcome history. | Account deletion. |
| metadata | Outcome, previous event ID and reviewed workout revision. | Account deletion. |

No backfill, original prescription rewrite, shared session creation or load
write occurs. The existing non-login `swim_writer` receives only SELECT/INSERT
on the new table. Authenticated users receive owner-filtered reads and RPC
execution, not direct writes. All other inherited grants are revoked.
The existing identity helper, owner import lock and workout row lock serialize
confirmation with corrections, rematches and prescription edits.

Foreign keys defer ordinary parent-deletion checks until transaction end, not
cascade outcome history away. The explicit auth-user cascade allows deletion
of the account's entire owned graph. The down migration uses bounded locks and
refuses any retained event, including removal. It deletes no history to force
rollback. Disable new confirmations and retain schema when history exists.

## Integration and acceptance

The ledger alone is not the integrated product. Wizard/primary-slot persistence,
Today/history projection, lifecycle handling, export and confirmation UI must
be wired before exposing the feature. Existing native results remain readable.
Default-off rollout must include real Postgres isolation, replay/correction,
concurrency, used-down refusal and account-deletion tests, plus isolated browser
acceptance. No completion or release acceptance is claimed by schema authoring.
