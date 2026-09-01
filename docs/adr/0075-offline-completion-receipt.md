# ADR 0075 - Persist the offline completion receipt

Status: Accepted (2026-09-01)

Related: migration 0144, offline logging durability

## Context

An offline completion is stored on the device before it is sent. Retrying that
stored request must not turn a completed session into a new completion event.

## Decision

`sessions.completion_outbox_entry_id` stores the nullable UUID of the offline
outbox entry that first completes a session. The authenticated completion RPC
accepts that UUID and writes it in the same transaction as `completed_at`.
Older queued entries may use a non-UUID identifier. They still complete, but
their identifier is passed as `NULL` and is not stored as a receipt.

The field is top-level because it is a durable receipt for a user action that
arrives from outside the completion engine. It is not derived state, and it
must remain available to distinguish a replay from a new request. It is null
for ordinary online completion. The value is removed with the session.

## Consequences

- A repeated offline completion returns a replay result without changing its
  completion timestamp or repeating once-only side effects.
- A per-user unique index rejects accidental reuse of one receipt for different
  sessions.
- The guarded rollback refuses to discard recorded receipts.
