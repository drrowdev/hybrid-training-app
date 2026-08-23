# ADR 0075 — Tactical Barbell accessories are chosen by the user, in the session

Status: Accepted (2026-08-23)
Supersedes: ADR 0048 (both Tactical Barbell and Green Protocol)
Related: ADR 0074 (slot identity survives a substitution), ADR 0071 (session
links), DC-K4 (override-and-warn)

## Context

ADR 0048 shipped opt-in Tactical Barbell accessory work as a **checkbox plus a
muscle multiselect** on the wizard's loadout step. Ticking it sent
`accessories: { enabled, muscles }`; a platform injector then picked isolation
movements per session at deploy time, rotating, capped by template
(Zulu 3, Operator/Fighter 2, Gladiator/Mass/Grey Man disabled).

Owner feedback, verbatim: *"The whole checkbox is confusing as the user doesn't
really know what it does."*

That is a fair reading of what it does. You tick a box, choose some muscles, and
nothing appears. The movements are selected later, out of sight, and are first
visible once the plan exists. The wizard's own copy compounded it by asserting
"Tactical Barbell doesn't add accessories" — untrue of Zulu, which prescribes
supplemental lifts (ADR 0074).

Meanwhile the wizard already had a place where a user picks the movements in a
session: the "Strength movements" builder, three steps later, behind a
"Customize template" checkbox. Its "+ Add exercise" control was **broken for this
purpose**: an added movement carried no slot, matched no prescription rule, and
was therefore emitted as *main work at the session's sets and reps*. A bicep curl
was prescribed 3–5×5.

So the app had two surfaces for shaping a session — one invisible and automatic,
one hidden and mis-prescribing.

## Decision

**One surface. The user picks every accessory. Nothing is chosen for them.**

1. **The loadout step is the editor.** The per-day preview added in ADR 0074
   becomes editable in place: every row is Main, Supplemental or Accessory, with
   Change, Remove, and "Add accessory". The step-4 "Strength movements" and
   "Link lifts" sections are deleted; "Customize template" keeps its remaining
   jobs (weekday types, rehab days, block name).
2. **An added movement is prescribed as accessory work** — `assistance` in engine
   terms, which the adapter already maps to the app's `accessory` kind: 3 sets of
   8–15 near failure, no percentage, no warm-up ramp of its own. The dose is the
   one ADR 0048 derived from the book.
3. **Stated explicitly, never inferred.** The customization entry carries
   `role: "accessory"`. Absence of a slot cannot mean "accessory", because
   customizations written before slots existed have no slot on ANY entry —
   inferring would turn their main lifts into curls.
4. **The picker offers only movements that suit the dose** (`pattern:
   "isolation"`). A carry, a plyometric or an Olympic lift cannot share a
   3×8–15-near-failure prescription, so offering them would produce nonsense.
5. **Template gating becomes a warning.** Gladiator, Mass and Grey Man previously
   refused accessories outright. With the user choosing explicitly, the objection
   is stated where they add the work and only once they have added some — Mass
   already schedules its own arm and pull-up day. It never blocks (DC-K4).
6. **The checkbox is gone.** For Tactical Barbell *and* for Green Protocol —
   Green runs Tactical Barbell templates, so it inherits the same answer even
   though it does not yet have the editor. The auto-picking injector, the
   `accessories` deploy param and the muscle allowlist remain, unchanged, for one
   consumer: blocks already deployed with them.
7. **Editing the movements no longer renames the block.** `displayName` becomes
   optional on the V1 customization: movement edits write the same overlay
   "Customize template" does, and only the naming flow should set a name.

## Options considered

- **A — Reword the checkbox.** Rejected: the confusion is structural, not
  lexical. The control's effect is invisible until after deploy.
- **B — Keep auto-picking, but show the chosen rows for review.** A real option,
  and the one the rubber-duck review recommended as the smaller step. Rejected on
  owner instruction: fully manual for new blocks.
- **C — Delete the injector outright.** Rejected: blocks already deployed carry
  real `accessory` items whose selection rotates per session; there is no
  faithful conversion into one repeating row per series, so deleting it would
  silently strip work from a live plan on its next edit.
- **D — Manual, with the injector retained for legacy and Green (chosen).**

## Consequences

- **New Tactical Barbell blocks contain exactly what the user put in them.** No
  rotation, no muscle balancing, no cap — those existed to make an automatic
  choice defensible and have no job once the choice is explicit.
- **Protections that mattered are kept, in the right place.** Deploy-time
  active-limitation validation already covers every customized movement, so an
  added accessory is checked like any other. Dose compatibility is enforced by
  restricting the picker. Duplicates are excluded per session.
- **Protections that are lost are the ones the user replaces.** Equipment
  filtering and the experience floor applied to auto-picked movements; a user
  choosing from the library sees the whole library. Acceptable — they are picking
  a curl for themselves, not being handed one.
- **Green Protocol loses auto-picked accessories too.** Owner decision: it is a
  Tactical Barbell program, so it gets the same answer. It is periodised across
  several TB templates with a per-session cap and has no per-session editor to
  move the choice into, so for now a new Green block simply has no accessory
  work — which is what the book prescribes by default anyway. Giving it the same
  editor is open work, not a regression to fix before shipping this.
- **Existing blocks keep their accessory work.** On edit, the wizard offers one
  control to keep or clear it; keeping it re-runs the injector exactly as before.
- **`role` is a new discriminator in an existing JSONB blob** — no schema
  migration, no new column, and old payloads parse unchanged.

## Open questions

1. **Green Protocol's editor.** GP resolves a different TB template per phase, so
   its sessions are not a fixed weekly series. Whether it gets the same
   per-session editor, or stays accessory-free, is undecided.
2. **Equipment awareness in the picker.** The library is not filtered by the
   user's equipment. Showing what they can't load is a mild annoyance rather than
   a correctness problem, but it is worth revisiting.
