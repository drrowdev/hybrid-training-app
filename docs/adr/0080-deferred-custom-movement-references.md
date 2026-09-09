# ADR 0080 — Deferred custom movement references

**Date:** 2026-09-09  
**Status:** Owner-approved reversible candidate; verification-layer correction complete in source, live acceptance unrun.
Production remains separately gated. ADR 0080 was free at assigned head
`1bb56a5b96a2209624125d811965e609c837b9e8`.

## Authority and measured basis

The owner approved “Approve the reversible fix in the disposable environment
(Recommended)”: at most two existing movement-reference FKs, with apply/undo
restricted to the owned disposable environment. No new Auth callback, deletion
implementation, role/grant/RLS/Auth-trigger, credential, network, or data-cleanup
authority follows from that approval.

[Run 34321670984](https://github.com/drrowdev/hybrid-training-app/actions/runs/34321670984)
at `1bb56` ended 07:03:52Z. On actual tables with transactional synthetic
Auth/profile/custom-movement/session/set/reference records and tested
`session_user = current_user = supabase_auth_admin`:

| Both references | Measured result |
|---|---|
| RESTRICT, not deferrable | 23503, set-logs |
| Immediate NO ACTION | 23503, set-logs |
| NO ACTION, deferrable initially deferred | Exactly one Auth row deleted; forced ALL constraints passed |

All three transactions rolled back; original schema and fixture absence were
verified. Native16/normal148/catalog/Auth five phases, four DDL files, fifteen
service contexts/all36HTTP/core/main and final cleanup passed. The intentional
nonqualifying stop failed the run; all original twelve cases were unrun.
Both FKs changed together: there is **no independent measured necessity proof
for the second FK**, and structural SQL success is not GoTrue or app success.
Earlier run `34287396820` at `7d0fb2c` passed ten of twelve cases and failed C2/C3;
the native-only C3 control deleted and linked data was preserved before failure.

## Decision

Migration `0148_defer_custom_movement_references.sql` and its matching down file
change only:

- `public.set_logs.set_logs_movement_id_fkey`
- `public.session_movements.session_movements_movement_id_fkey`

Forward: `ON DELETE RESTRICT NOT DEFERRABLE` → `ON DELETE NO ACTION
DEFERRABLE INITIALLY DEFERRED`. Down requires the exact candidate first and
restores the original forms. GoTrue does not issue `SET CONSTRAINTS`, hence
initially deferred rather than a caller-dependent initially-immediate mode.
Neither reference cascades nor sets null.

Each whole file uses the existing no-breakpoint/Drizzle transaction convention,
with one guarded DO operation and no transaction-ending COMMIT. Fixed-order
ACCESS EXCLUSIVE locks on set_logs then session_movements precede catalog
inspection; lock wait is 5s and statement wait 30s. DROP+ADD is necessary to
change the delete action. Normal validation scans remain; no NOT VALID,
disabled triggers, retries, ignored lock failures, or data cleanup.

Both definitions must match before either mutation. Guards pin exact names,
endpoints, UUID/non-null columns, NO ACTION update, MATCH SIMPLE, validated/local/
no-parent/no-inheritance properties, equality operators, referenced primary index,
canonical constraint text under catalog search_path, and expected postgres table
owners. Unexpected constraints, missing/repointed definitions and unknown modes
fail closed. The normal migration connection remains postgres; native DDL
permissions apply. No auth-helper-specific superuser caller guard is imposed
on the migration itself.

## Timing audit

Deferral changes INSERT/UPDATE/DELETE error timing globally for these references,
not only account deletion. Errors may emerge at transaction completion or a
forced check rather than at the individual statement. Committed orphans remain
forbidden.

The original 148 SQL files contain no `23503`/`foreign_key_violation` handler;
the sole `EXCEPTION WHEN` is unrelated `0115 duplicate_object`. Reconfirmed
`0061 add_session_movement` and `0144` atomic set-log routines propagate errors.
Their session action wrappers consume RPC/PostgREST request results, returning or
throwing errors; missing-RPC fallback is not an FK-error fallback. The application
23503 handler is for rehab protocols, not these references; 23505 idempotency is
unchanged. Historical `0138` repoints references before removing its duplicate.
No statement-local FK catch-and-continue dependency was found in these coupled
paths. Discovery of one would block this candidate. Arbitrary external SQL
clients have **not** been audited.

## Durable proof and real acceptance

Normal `db:migrate` has 149 files/entries; original 148 files and journal entries
are retained. `ACTIVE_MIGRATION_TOTAL = 149` controls main count checks/manifest.
Identity levels `146 | 147 | 148`, `checkAuthBoundary(..., 148)`, all five phase
names, four identity DDL files, fifteen service contexts and all36HTTP remain
unchanged: those levels describe identity definitions, not migration totals.

The obsolete rollback-only switch/helper/test are removed. Before the unchanged
twelve-identity/six-file UI/API cohort, the relationship stage:

1. Validates forward catalog definitions and private relationship metadata.
2. Reads the exact source-fingerprinted, round-trip-UTF8-verified down/up files,
   applies them durably in order, and checks original then candidate definitions.
   It never edits the Drizzle journal.
3. Tests set-logs-only and session-movements-only deferral from original schema,
   each inside its own fully rolled-back transaction with both references present.
   Setup uses existing `supabase_admin`; tested DELETE uses SET LOCAL SESSION
   AUTHORIZATION `supabase_auth_admin`, not SET ROLE. Success forces ALL constraints.
   Each partial candidate must reject 23503 on the remaining RESTRICT reference;
   either success fails the two-FK candidate for coordinator narrowing.
4. Uses four generated IDs per fixture and a fresh connection after every attempt,
   including command failure, to verify candidate restoration and fixture absence.
   Target fingerprints normalize only fresh target OIDs and the three explicitly
   changed mode bits; all other constraint tuples remain complete. Table/column/
   index/ACL/RLS/user-trigger metadata is compared privately. Public evidence is
   closed statuses and booleans, not catalog data, UUIDs or raw errors.
5. After both necessity probes, separately tests UPDATE integrity against the
   current candidate using the existing `supabase_admin` bootstrap socket.
   This is SQL FK enforcement, not authenticated-user UPDATE permission. The
   shared synthetic fixture is created in one transaction ending ROLLBACK.
   Candidate definitions/metadata and fixture absence are checked before setup;
   the exact reference row and absence of a movement at the generated set UUID
   are checked before mutation. Setup constraints are forced before the narrow
   attempt. One exact session_movements UPDATE must affect one row, then forced
   ALL checking must reject 23503 on its movement-reference FK. Setup errors,
   zero rows, other errors or missing forced checking cannot qualify.
   A fresh connection verifies candidate semantics, unchanged other metadata and
   absence of every fixture ID even after error/disconnect. The strict
   `updateIntegrity` record starts not-attempted; overall matched requires this
   restored rejection, down/up and both unchanged necessity proofs.

Unverified restoration fails closed, without compensating row deletion or silent
repair. Existing exact owned-stack cleanup remains the last safety net.

C3 retains the native control, Auth404, linked preservation, actual linked Auth
deletion, and native/custom absence assertions. Added requests use the existing
linked authenticated client: reject referenced movement deletion, orphan INSERT
into both tables, and set_logs reference UPDATE with 23503 at request end. Fresh
reads compare the original four custom records and check exact orphan keys after
each rejection. C2 and the other ten cases are not weakened.

### Resolved verification mismatch: authenticated session-movement UPDATE

`0059_session_movements.sql` defines only SELECT, INSERT and DELETE policies.
`0063_session_movements_grant_update.sql` grants UPDATE but explicitly documents
that RLS blocks real updates; no later migration adds an UPDATE/ALL policy.
Consequently the required existing-client UPDATE cannot reach this FK: a direct
filtered UPDATE affects zero rows, not 23503. Under the coordinator's approved
verification correction, C3 separately issues that owner request with all owned
composite-key filters and a returned representation, requiring no error and
exactly `[]`. Fresh unchanged four-record and missing-parent-reference checks
follow. It does not invent an authenticated FK rejection from zero affected rows.

No policy, grant, role or migration semantics changed. Both protections are
tested at their actual layers: authenticated RLS denial in C3, actual FK UPDATE
rejection in the owned SQL assertion above. This resolves the source-proven
validation blocker without another approval loop or an extra browser case.
Neither assertion has yet been measured live on this candidate.

Source unit/lint/type checks and collection are not SQL execution. Live up/down,
necessity, UPDATE integrity, normal149, all36HTTP and C2/C3 at this candidate remain unrun. Both real
positive flows and all integrity requirements must pass before acceptance; no
source or structural measurement supplies release/production approval.

Related contract: [DC-SW8](../knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr0079--2026-09-05);
[current handoff](../../HANDOFF.md), [swimming knowledge](../knowledge/pool-swimming.md).
