# ADR 0087: Independent program ownership

Date: 2026-09-23
Status: Owner-approved source and disposable-test design; implementation in progress.

## Decision

One Strength, one Running, one Swimming and one Hybrid program may be active
together. Two strength days, two running days and two swimming days belong to
three programs, not an implicit Hybrid program. Only Hybrid intentionally
combines ordinary modalities. An attached rehabilitation protocol is permitted
in every type. Programs retain their supported sport-specific controls; this
does not require identical pause/resume controls or concurrent season tracks.

This supersedes ADR 0085's single-primary cardinality, not its shared-calendar,
freshness, consent, identity, history or offline guarantees. Qualification of
the earlier architecture is regression evidence, not acceptance of this one.

## Identity and compatibility

Keep `training_blocks`, `program_instances`, `planned_sessions` and the separate
`swim_plans` / `swim_workouts` graph. There is no universal program table.
New nullable `training_blocks.program_kind` is the authoritative non-swim slot.
It is externally observable in navigation and lifecycle operations and is used
by the uniqueness constraint, so it merits a column rather than JSON metadata.
It disappears only with its block. Engine ID/family remain separate identities.
The kind cannot change through an ordinary edit.

New forward migration `0158_independent_program_ownership` replaces global
non-swim active uniqueness with per-kind block uniqueness and per-block instance
uniqueness. Owned parent constraints and consistency triggers cover direct writes,
not only the application. Existing RLS policies and routine security attributes
remain unchanged. The old archive-all entrypoint refuses mutation, including
when there is only one typed program.

Existing rows remain unclassified; no backfill or title/content inference occurs.
An older active non-swimming program must be explicitly ended before typed
activation. This never discards its sessions or queued logs. A malformed legacy
orphan is reported rather than adopted or silently archived.

All date writers retain the shared user schedule lock. A reviewed replacement
identifies an active block of the same kind. All other types remain in the
overlap preview. Exact replay returns the original result before freshness checks.
Ending, restoring, completing or changing one program does not change another.
Started workouts are not completed workouts.

Typed programs settle only after each completed, non-skipped workout has its
own instance/session progression receipt. No-op progression also records a
receipt; receipt-less unclassified history is not subject to this new gate.
Saving a workout precedes progression, but a failed progression attempt keeps
the existing completion outbox entry retryable rather than reporting the
workout unsaved. Explicit End still frees that type's slot while progression
is pending. Receipts validate the kind, block, instance and session together.

## Loads and recovery

Measured 1RM remains account-owned. Working percentages and engine working maxes
are program-owned. Issued prescription metadata carries the program's load basis;
one domain resolver serves the logger, prescribed snapshot and bulk fill.
An engine-owned absolute working max is not inferred from a newly changed account
percentage. A program using a percentage of measured 1RM retains its own chosen
percentage and rounding. Existing untyped prescriptions retain legacy behavior.

Actual workload, limitations and fatigue remain whole-person signals. Program
targets, progression and accepted recommendations belong to the addressed
program. The optional existing season roadmap does not acquire extra tracks or
advance merely because a different program starts.

Final recommendations remain visible for their completed source program.
Opening or abandoning setup does not resolve advice. A guided continuation
carries the exact recommendation, block, instance, kind and phase through preview
and commits its acceptance inside the same schedule transaction as the new
program. Changed, dismissed or foreign advice is refused; exact replay returns
the original result without accepting it again. Recovery acceptance names one
occurrence rather than consuming unrelated pending advice. Declining the
recommended recovery week warns and records that choice without accepting it.

## Shared rehabilitation

`rehab_protocols` remains the account library. Non-swim programs retain
`program_rehab_bindings`. The owner separately approved
`swim_plan_rehab_bindings`: owned composite references to a swim plan and an
existing protocol, protocol deletion RESTRICT, plan deletion CASCADE, and
own-user RLS on the new table. These references are observable attachments and
need foreign-key deletion guarantees; they are not copied per-sport libraries.

Starting an attached protocol from a swimming workout uses an ordinary
rehab-only session. Its issued prescription records protocol identity, revision,
dose, order, grouping and the owned origin. The immutable swimming course
definition, native swim session link and imported outcome are not repurposed.
Recording and rehab are separate results within the same Swimming program.
The common lock and durable start receipt prevent duplicate occurrence starts.
No additional occurrence-link table or column is approved by this decision.

## Rollout and rollback

Application readiness is explicit. Missing new storage disables typed setup;
history, existing logging and specifically supported legacy operations remain
accessible. Permission or data errors are not missing-feature fallbacks.

The migration changes no historical SQL or journal prefix. Its unused down
refuses typed records, attachment records, issued rehab snapshots, new-mode
receipts and any state incompatible with the old uniqueness. Removed attachments
do not make issued work unused. Existing routine bodies and attributes must
restore exactly. After use, repair forward rather than deleting or archiving
data to make a downgrade possible. An old application is not a compatible
rollback once multiple program types are active.

Source approval is not hosted DDL, updater widening, activation, merge or deploy
approval. The release coordinator owns real disposable/native qualification and
any separately approved production operation.

Related contracts: [DC-R5/DC-R6](../knowledge/hybrid-training-design-constraints.md#r-architectural-skeleton--program-structure-new-in-this-revision),
[DC-K4](../knowledge/hybrid-training-design-constraints.md#k-engineering--data-hygiene),
and [DC-SW7/DC-SW8](../knowledge/hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05).
