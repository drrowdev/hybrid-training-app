# ADR 0086: Atomic programme and swimming saves

**Status:** Development-only implementation under the 2026-09-14 owner approval.
Hosted migration, deployment and real-account writes remain separately gated.

## Decision

An explicitly selected swimming activity can occupy an open primary conditioning
slot. Migration0156 adds an atomic programme/swim save and durable ownership links.
It reuses the existing primary deployment and swimming creation functions within
one transaction rather than coordinating two independent client saves.

Existing active swimming plans can be attached at their expected revision.
New course files use the primary schedule and start date; there is no second
schedule or available-time input. Every upcoming swim must match an explicitly
selected, unstarted, open-cardio slot by date and single/am/pm placement.
Extra primary slots are allowed. Source workouts are never repeated or truncated.
Course and current-limitation checks precede persistence; database checks reject
changed plans, claimed outcomes and already-associated work under the owner locks.

A request UUID and fingerprint of the original input recover the same result
after an interrupted response. The fingerprint excludes recomputed engine output
and timestamps. Recovery runs before recomputation or the new-save feature gate,
and preserves the original skipped-item count. A changed request or a removed
primary graph cannot masquerade as a successful new save. A failed coupled save
never enters the legacy primary-only fallback.

The transaction covers primary block, planned rows, programme instance, training
max alignment, swimming creation/attachment, links and receipt. Existing optional
post-save rehabilitation/season behavior is not made transactional by this work.

## Schema discipline and retention

| Table / top-level fields | Observable or relational reason | Removal |
| --- | --- | --- |
| Both: user_id | Ownership, RLS and Auth-user cascade. | Account deletion. |
| Bindings: swim_workout_id | Stable swim identity and same-owner foreign key. | Account deletion. |
| Bindings: planned_session_id, block_id | Live primary-slot relationship and same-owner foreign keys. | Null on hard purge of the corresponding primary parent; the original IDs remain in metadata. |
| Saves: request_id | Durable retry identity within the owner. | Account deletion. |
| Saves: block_id, program_instance_id | Recover the original primary result. | Null on parent hard purge. |
| Saves: swim_plan_id | Recover the original swim result and enforce ownership. | Account deletion. |
| Both: created_at | Exported association and save history. | Account deletion. |
| Both: metadata | Original prescription/revision/IDs or request fingerprint/skipped count; no extra engine-only columns. | Account deletion. |

Named SQL and ORM constraints describe the same relationships and metadata shape.
Auth-schema references, RLS/grants and deferred foreign-key/trigger behavior are
explicit migration DDL rather than ORM-generated policy.

Ordinary deletion of a linked planned row is refused while its parent survives,
including legacy delete/reinsert rewrites. Deferred checks still permit whole
primary-block purge and Auth-account deletion after their cascades finish.
Links and receipts retained after primary purge remain exportable; the original
prescription and identity are not erased. Ordinary primary updates cannot log or
skip a linked swim, replace its open-cardio prescription or independently change
its date/slot. Coordinated lifecycle paths must preserve identities, not disable
these checks.

The non-login, non-inheriting `conditioning_writer` has no RLS bypass or service
role membership. Its bounded grants support the existing primary/swim functions
and owner reads, not import credentials or general administrative access.
Authenticated clients can read their own links/receipts and execute the wrapper,
but cannot directly insert, update or delete those records.

The empty-only down migration uses bounded locks and refuses retained records.
It never deletes history to make rollback pass. Once used, disable new creation
and retain the schema rather than running the down migration.

## Availability and acceptance

`SWIM_CONDITIONING_ENABLED=true` and installed storage are both required for new
conditioning saves. Export and receipt recovery do not depend on that flag.
The current server path supports new foreign programmes only; edits, native
programmes and inserted recovery weeks remain unavailable until their coordinated
paths are complete. The real wizard and shared Today/calendar/history surfaces
are not yet connected, so this migration is not release readiness.

The existing disposable GitHub Postgres job exercises same-owner refusal,
rollback after late failure, new/existing course saves, concurrent replay,
retained purge history, immutable client access and account deletion. Local
checks cover closed input, schedule fit, no independent-write fallback and
complete paginated export. No hosted application or usability acceptance is
implied. Relevant constraints: DC-SW3, DC-SW5, DC-SW8 and DC-K4.
