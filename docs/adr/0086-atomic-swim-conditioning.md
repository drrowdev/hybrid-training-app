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
max edits and alignment, swimming creation/attachment, links and receipt. Existing optional
post-save rehabilitation/season behavior is not made transactional by this work.
For coupled swimming, the wizard submits edited benchmarks in the same original
intent instead of calling the independent training-max action first. The shared
context builder overlays validated edits in memory, so the actual engine and
whole-course fit checks run before any benchmark or programme write.

The unshipped0156 wrapper inserts or updates those owned benchmarks within the
programme/swim transaction. Manual edits clear derived provenance; existing
percentages survive until the normal alignment pass. New rows use the target
programme's basis from the existing canonical helper. Replay runs before these
writes, so an interrupted-response retry cannot overwrite a later benchmark edit.
There is no existing-user backfill or new top-level column.

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
Revision-column UPDATE grants on the two swim tables permit PostgreSQL row locks;
the wrapper does not use them to change revisions or receive table-wide updates.
The writer can insert owned training-max rows and read movement ownership columns;
it refuses missing or foreign private movements. Existing training-max RLS remains
unchanged. The down migration removes these grants along with the unused wrapper.
Authenticated clients can read their own links/receipts and execute the wrapper,
but cannot directly insert, update or delete those records.

The empty-only down migration uses bounded locks and refuses retained records.
It never deletes history to make rollback pass. Once used, disable new creation
and retain the schema rather than running the down migration.

## Availability and acceptance

`SWIM_CONDITIONING_ENABLED=true` and installed storage are both required for new
conditioning saves. New saves also require `swim_conditioning_benchmarks_ready()`,
so an earlier0156 implementation cannot silently ignore submitted benchmarks.
Export and receipt recovery do not depend on that flag or the new readiness check.
The current server path supports new foreign programmes only; edits, native
programmes and inserted recovery weeks remain unavailable until their coordinated
paths are complete. The real wizard now mounts a conditional fifth step for
eligible new open-conditioning programmes, with the existing pool/experience
controls inline and one final action. Its date and source changes invalidate
review; file selection and entered values survive Back and interrupted saves.
Linked swims now use the primary identity in Today, the shared week rail/calendar
and programme history. A security-invoker view joins the binding, current outcome,
current match and latest recording in one database statement. The domain outcome
rule remains the authority: stopped-early work is settled but not fully completed;
changed or removed evidence requires review. Native session IDs, completion times,
measurements and workload are not synthesized. Standalone lists exclude bindings,
including retained associations after primary purge.

The existing drawer opens the swim prescription and retains Today/Plan/history
return context through matched recordings. It does not offer native one-tap
completion, prescription editing or independent swim edits for linked work.
Coordinated lifecycle operations and the complete authenticated journey remain
unfinished; this is not release readiness.

The existing disposable GitHub Postgres job exercises same-owner refusal,
rollback after late failure, new/existing course saves, concurrent replay,
retained purge history, immutable client access and account deletion. Local
checks cover closed input, schedule fit, no independent-write fallback and
complete paginated export. No hosted application or usability acceptance is
implied. Relevant constraints: DC-SW3, DC-SW5, DC-SW8 and DC-K4.

Source `00fa09d3` passed core34890112070 and storage34890112131, including all24
SQL stages and cleanup. The mounted wizard has separate synthetic browser
coverage at375/1280 for new/existing courses, review invalidation, file replacement,
unchanged retry, duplicate prevention and disabled-feature behavior. Those
browser actions use synthetic fixtures and no server account; they do not
establish authenticated transport, native-device usability or owner acceptance.
The benchmark extension at `50750d51` passed core34928353200 and disposable
storage34928353211. The subsequent shared presentation has focused state/read-model
checks and synthetic375/1280 drawer coverage. Its extended unshipped0156 view still
requires exact-source PostgreSQL acceptance, including invoker isolation, current
recording/claim changes, retained purge history and cleanup.
