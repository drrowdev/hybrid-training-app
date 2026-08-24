# ADR 0078 — Weekly Tactical Barbell rehab placement is a sibling envelope, addressed by session

Status: Accepted (2026-08-24)
Related: ADR 0071 (user-authored session links), ADR 0073 (rehab protocol library),
migration 0127 (embed same-day rehab)

## Context

A weekly Tactical Barbell block (Operator, Fighter, Zulu, Gladiator) could only
run rehab on a day it gave up entirely. `tbCustomizationV1Schema` encodes rehab
as a DAY TYPE — a weekday is `strength` OR `conditioning` OR `rehab` OR `rest` —
so "rehab as the warm-up section of a strength day" had no representation.

The engine has supported that placement since migration 0127:
`materializeProgram` builds the rehab prescription, finds a strength session on
the same `(week, day)`, and calls `embedRehabPrescription`. Activation (V3) uses
it through `rehabAssignments: [{day, protocolId}]`, and its wizard says so —
"Included as the warm-up rehab section in this strength workout". Only the
weekly shape could not ask for it.

The owner asked for it as a `+ Add rehab` button on each session card, beside
the existing `+ Add accessory` and `+ Superset more lifts`.

## Decision

**1. Placement and content live in a sibling envelope, `setup_input.rehabSchedule`.**

```
rehabSchedule: { version: 1, localProtocolId, name, items[], series[], days[] }
```

`tbCustomizationV1Schema` is untouched. Extending it was rejected for the reason
ADR 0071 gives for the links: it is a `.strict()` union that `edit-context`
`safeParse`s as ONE unit, so an older build meeting an unknown key — or a
relaxed refinement — silently drops the WHOLE customization and the wizard opens
with the user's block missing. `setup_input` is read key-by-key, so a build that
predates this envelope ignores it and the customization still parses. The worst
case is rehab missing, never a lost block.

Note that both of the V1 refinements (`rehab` days require `rehab.items`;
no `rehab` day forbids `rehab`) are satisfied trivially by what the wizard now
writes: a rehab-only day is written as `rest` and `customization.rehab` is not
written at all. The blob simply says nothing about rehab.

**2. A session is addressed by SERIES KEY; a standalone day by weekday.**

The user attaches rehab on the loadout step, which runs BEFORE the schedule
step, so the session's weekday is not settled yet. Resolving it in the wizard
would mean replaying the engine's seating rule (`weekdays[positionInWeek]`), and
that rule counts every non-rest timeline spec while the wizard's series list
filters out conditioning, test and out-of-week sessions — the two indices
diverge the moment a template has either. `PlannedSessionSpec` already carries
`seriesKey`, so materialisation resolves it exactly, and the rehab follows its
session when the schedule moves.

Placement resolves against the session with that series key WHATEVER its role.
A peak/test week reuses the same key, so a `role === "strength"` filter would
make rehab vanish in exactly the week a lifter is most loaded.

`days` stays weekday-indexed because a standalone rehab day has no session to
hang off. A day named by both is prescribed once.

**3. `weeklyRehabPlan()` is the only reader.** Envelope first; without one, a
block resolves to precisely what it did before — its own `rehab.items` on the
weekdays its `dayTypes` marks. A deployed block is unaffected until the wizard
next writes it (AGENTS.md §6.9).

**4. Provenance follows the Activation rule.** `localProtocolId` is the library
row's uuid for a new attachment and `protocol-1` for a block converted from the
legacy shape. The synthetic legacy id carries NO provenance, so a converted
block keeps emitting `rehab-w<week>-d<day>` and the tombstones for rehab the
user already deleted keep matching. A uuid carries its own id and name.

**5. Rehab no longer requires the "Customize template" opt-in.** The envelope is
independent of the customization, so a canonical Zulu block can carry rehab —
the same freedom ADR 0071 gave the links, for the same reason.

## Consequences

- A weekly block can run its protocol on any mix of its sessions and its rest
  days. Attaching it to a session embeds it as that workout's warm-up section;
  a conditioning day gets its own `pm` session; a rest day a `single` one.
- The weekly shape still runs ONE protocol. Multiple named protocols per weekly
  block is a separate decision.
- `resolveRehabLibrary` and friends take a `RehabSource` (`{customization?,
  rehabSchedule?}`) so a Settings edit reaches a block through either home.
  Sync no longer requires a customization to exist.
- Two pre-existing bugs are fixed here because they sit in the same path:
  - `syncOneProgram` called `createProgramInstance` without `rehabBindings`, and
    the edit path REPLACES a program's bindings with what it is sent — so the
    first Settings sync deleted every binding and no later sync ever ran.
  - A newly deployed weekly block bound its protocol under the library uuid but
    materialised its links under `protocol-1`, so rehab supersets were silently
    dropped and Settings edits never resolved. Both now use the envelope's
    `localProtocolId`.
- Rolling the application back leaves the envelope unread: the block keeps its
  customization and loses only its rehab, and saving from the old build would
  drop the envelope — the same exposure ADR 0071 accepted for the links.
