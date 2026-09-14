# ADR 0081 - Account-owned swimming imports

**Date:** 2026-09-12
**Status:** Development approved; isolated synthetic Postgres contract passed.
No existing review or production migration is authorized.

## Decision and scope

The owner approved swimming-only local-dashboard feedback and, separately,
additive account-owned storage with synthetic isolation tests and a
history-preserving down plan. This increment captures observations. It does
not mark workouts completed, add shared workload, recalibrate pace, link a
planned workout by guesswork or activate a new training model.

A signed-in user creates one active, revocable import connection. The server
generates a 256-bit random key and returns it once; only its SHA-256 hash is
stored. The key is never a Garmin credential or a general account session.
Lost responses require disconnecting the displayed connection and creating a
new key, not reading back a stored secret. There is no silent replacement of
an existing connection.

The local sender posts only the approved, bounded observation projection.
The server validates it, then invokes a service-role-only import RPC. That
function derives ownership solely from the matching non-revoked key hash;
there is no caller-supplied account ID. Its receipt contains an import ID,
revision and replay flag, not account data. The key cannot read history,
change a prescription, disconnect another connection or invoke general APIs.

The [local sender](../design/swimming-programme-rebuild.md#bounded-local-sender)
reuses the cache reader's complete privacy projection. It requires explicit
sending and an exact approved HTTPS endpoint, keeps keys off command arguments,
and follows no redirects. A bounded child process prevents stalled networking
from running indefinitely. A failed or unconfirmed request stops the batch;
server receipts, not local inference, distinguish imports and replays.
There is no automatic synchronization or live-account acceptance yet.

The service RPC is SECURITY INVOKER, not a new privileged definer or role.
The server's existing service-role client is confined to this narrow request
boundary. Anonymous and authenticated clients cannot call the receiver or
write import rows. Signed-in create/disconnect RPCs use the existing non-login,
non-bypass `swim_writer` role, owner RLS and the established identity helper.

## Relational fields (plan section 6.8)

| Table / field | Why relational / observable | Removal |
| --- | --- | --- |
| Connections: id, user_id | Pairing identity, ownership and account deletion. | Account deletion. |
| Connections: token_hash | Indexed bearer-key authentication; excluded from UI/export grants. | Account deletion; revocation disables use. |
| Connections: created_at, revoked_at | Visible connection state and serialized revocation. | Account deletion. |
| Imports: id, user_id, connection_id | Immutable receipt, ownership and source-connection linkage. | Account deletion. |
| Imports: activity_id, revision, content_hash | Account-scoped duplicate/correction identity and stable replay receipts. | Account deletion. |
| Imports: received_at | Visible arrival history, separate from activity date. | Account deletion. |
| Imports: evidence JSONB | Versioned observation fields and provenance, not new engine-owned columns. | Account deletion. |

Both tables have `USING (auth.uid() = user_id)` and matching checks.
The connection FK includes the same owner. It is deferred NO ACTION so
ordinary connection deletion cannot erase history, while deleting the Auth
account can cascade both owned tables in one transaction. Disconnect revokes
the connection and preserves all observations.

The receiver locks its connection and serializes by owner before assigning a
revision. A replay returns the original receipt, including when a newer
correction exists; it cannot make an old revision current again. A changed
observation appends a revision and retains the prior evidence. Reconnecting
does not reset account-scoped duplicate identity. Revocation and receipt
creation share the connection lock, providing a definite ordering.

The database also validates a closed JSON shape and bounded measurements;
unexpected keys cannot be persisted by bypassing the HTTP parser. Native
course remains unknown for this source, session-duration kind unspecified,
and fallback active timing unverified.

## Rollout, export and down

`SWIM_IMPORT_ENABLED` defaults false. A separate capability RPC allows the
application to remain usable before migration. Disabling new imports does
not hide existing export data or prevent a signed-in user from disconnecting.
Exports include public connection metadata and every import revision, never
key plaintext or hashes. Auth-account deletion cascades the new owned data.

Migration 0150 is additive after the unchanged 150-file baseline. Existing
one-shot review profiles keep their 150-only guards and must reject this
new source; their receipts, runtime limits and historical definitions are not
updated to accept it.

The down script locks both new tables and refuses to proceed if either has
rows, including revoked connections. It never deletes history to make a
rollback possible. With recorded data, disable ingestion and retain the
schema/evidence. A successful empty down removes only the new tables,
functions and their grants. No ledger reset or alteration of old migrations.

## Acceptance

Use only a fresh, disposable CI database with synthetic accounts. Cover real
Postgres owner RLS, denied direct writes/hash reads, cross-account RPC denial,
replay/correction/reconnection, concurrent receives, revocation, malformed
payloads, account deletion and empty/nonempty down behavior. This database
contract test is not live Supabase Auth, browser, owner-data or device proof.
Those remain separate rollout gates before any review migration or live pilot.

Source `0961b7ac0d0eb2f8ec1691e996b061526c0076b2` passed
[run34693878236](https://github.com/drrowdev/hybrid-training-app/actions/runs/34693878236),
including container cleanup. This evidence does not authorize migration of
an existing review/account database. Full application CI is a separate gate.

Related: [DC-SW1/SW4/SW5/SW8](../knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05),
[rebuild plan](../design/swimming-programme-rebuild.md).
