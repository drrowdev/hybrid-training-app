# ADR 0073 — Rehab protocols are a user-owned library, bound to programs by reference

Status: Accepted (2026-08-19)
Related: ADR 0071 (user-authored session links), migration 0127 (embed same-day rehab)

## Context

A rehab protocol used to exist only inside the program it was written for. Its
definition lived in `program_instances.setup_input.customization` — as
`rehabProtocols[]` for the current Activation shape (V3), or a single unnamed
`rehab.items` list for the two legacy shapes (V1, V2).

Three consequences followed:

- **A protocol could not outlive its program.** Deploying a new block meant
  retyping a clinician-supplied protocol from memory.
- **Editing one meant re-running the wizard.** A physio progressing you from
  3×12 to 3×15 required walking the whole program-creation flow.
- **Authoring lived in the wrong place.** The Activation editor was ~270 lines
  inside an already 5,400-line wizard component, and its movement picker was a
  single `<select>` over the entire non-cardio catalog — unusable on a phone.

The owner asked for the protocol to be authored once in Settings, selected in
the wizard, and — explicitly — for an edit in Settings to reach the live program
automatically.

## Decision

**1. A library table, `rehab_protocols`.** One row per protocol per user, with
`name` top-level (listed and sorted in the UI) and `{items, links}` in a
`definition` JSONB blob, per the schema discipline in AGENTS.md §6.8. Supersets
move onto the protocol because how its movements pair up is intrinsic to the
protocol, not to the program running it.

**2. A binding table, `program_rehab_bindings`, rather than a field in the
customization blob.** The obvious alternative — stamping `libraryId` into
`setup_input.customization` — was rejected for three reasons:

- That blob is `.strict()`-validated, and this repo deploys **app-first,
  database-second**. The previous build serves traffic while the migration runs,
  and it rejects an unknown key. `edit-context.ts` `safeParse`s the blob and
  drops it on failure, so the symptom is silent: the wizard opens with the
  user's rehab configuration missing.
- `ON DELETE RESTRICT` on a real foreign key makes "you cannot delete a protocol
  a program uses" a database guarantee instead of a check-then-delete race.
- V1 and V2 have no named-protocol array to stamp. A binding row addresses their
  synthetic `protocol-1` exactly as it addresses a V3 id.

The blob is therefore never rewritten by the migration, and every deployed
program keeps parsing as before.

**3. The library is authoritative for CONTENT; the program stays authoritative
for PLACEMENT.** Which weekday and phase a protocol runs on is a property of the
program — the same protocol legitimately sits on different days in different
programs — so `rehabAssignments` and `dayTypes` remain in the customization.

**4. Local protocol ids are preserved for existing attachments, and are the
library uuid for new ones.** A customization addresses its protocols by a local
id, and three other things key off it: `sessionLinks.bySeries["rehab.<id>"]`,
`rehabAssignments[].protocolId`, and the `rehabSourceRef` written into every
materialised prescription — which `removedEmbeddedRehabSourceRefs` tombstones
reference. Those ids were ordinals handed out by position, and `actions.ts`
already warned that "ids are reused as ordinals". With a library the hazard
reaches tombstones: reusing `protocol-1` for a different protocol makes a day
the user had cleared stay cleared for the newcomer. A uuid cannot collide; an
existing attachment keeps its id so a live program does not shift underneath its
own links and tombstones.

**5. A Settings edit re-runs the wizard's existing program-edit path.** Sync does
not get bespoke plan-rewriting code. It calls `createProgramInstance` with
`editBlockId`, passing the program's own stored setup with only the rehab
resolved from the library. That path is already hardened for exactly these
hazards: forward-only rewrite so past slots are frozen, started and skipped rows
preserved, tombstones respected, and the whole rewrite behind
`rewrite_planned_sessions_atomically`. It updates `program_instances` in place,
so bindings keep pointing at the right instance and `setup_input` is left
holding the current library content — which is what stops a later wizard deploy
resurrecting a stale copy.

## Consequences

- Editing a protocol in Settings updates every live program bound to it, on
  future and unstarted sessions only. Logged and in-progress sessions keep the
  prescription they were trained against.
- Deleting a protocol a program uses is refused by the database.
- A program with no binding resolves to its own embedded items — identical to
  pre-library behaviour — which is what lets the application ship before its
  migration.
- Scope is Tactical Barbell, the only program with a rehab concept. Extending
  rehab to other programs is a separate decision.
- Change detection for sync deliberately includes the protocol NAME:
  `rehabItemsForComparison` strips `rehabProtocolName` before comparing
  prescriptions, so a rename with identical movements is invisible to it and
  would otherwise never reach the plan.
