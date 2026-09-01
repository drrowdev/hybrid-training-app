# ADR 0074 — Store actual external load with each bodyweight set

Status: Accepted (2026-09-01)

Related: bodyweight progression plan, migration 0143

## Context

A bodyweight set can record an added load or band assistance. `weight_kg` does
not consistently represent this value: it remains the ordinary strength-load
field, while bodyweight logging has its own user-entered external load.

Progress history needs the actual external load to continue a loaded
bodyweight progression and to stay correct after a set is edited or deleted.
Keeping that value only in derived progress history made reconciliation
impossible and could lose the value during concurrent writes.

## Decision

`set_logs.external_load_kg` records the actual added or assisted load for one
bodyweight set.

The value is top-level because it is part of the user-recorded set, is shown
outside the progression engine, and must survive a set edit, deletion, export,
and history reconstruction. It is nullable because older rows never captured
this value and a value cannot be inferred honestly. A set deletion removes the
value with the set.

## Consequences

- New bodyweight logs retain their actual external load independently of
  `weight_kg`.
- Bodyweight progress can update its capped history by stable set-log id.
- Existing history is preserved instead of being rebuilt from insufficient
  legacy data.
