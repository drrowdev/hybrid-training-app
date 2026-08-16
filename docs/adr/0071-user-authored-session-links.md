# ADR 0071 — User-authored session links replace antagonist auto-pairing

Status: Accepted (2026-08-16)
Supersedes: ADR 0026 (antagonist-superset accessories)
Related: ADR 0013 (autoreg volume end-slice), ADR 0020 (duration-governor volume tilt),
ADR 0048 (optional TB accessories)

## Context

ADR 0026 shipped a block-level `superset_accessories` toggle. When on, the app
inferred which accessories to pair from an anatomical antagonist table
(curl + pushdown, quad + hamstring) and applied the grouping at read time.

In use, the inference was the problem, not the feature:

- **You could not choose.** The pairing was derived, so a lifter who wanted a
  curl paired with a calf raise — non-antagonist, but a perfectly sensible
  time-saver — could not express it.
- **It never touched main lifts.** Pairing was restricted to `kind === "accessory"`
  with equal set counts, so the biggest available time saving (rotating two heavy
  lifts) was unreachable.
- **It was unstable.** Pairs appeared and disappeared as the ADR-0013 autoreg
  end-slice trimmed accessory volume, and a "widowed" member silently reverted to
  solo.
- **It could not express more than two.** Tri-sets and giant sets had no
  representation at all.

Meanwhile the engine already had a richer primitive: `PrescribedItem.circuit`,
built for Tactical Barbell's AB Triad, carrying `{ id, name, position, size,
rounds }` and driving round-major navigation in the logger.

## Decision

**Delete the toggle and the inference. Let the lifter link lifts explicitly, and
express a link as the existing `circuit` primitive.**

In the program wizard, each strength slot offers "Link lifts": pick two or more
lifts, in the order you will perform them. The engine realises the link as
circuit metadata; the logger, the preview and the duration estimate all already
understand circuits, so the feature reuses one representation end to end.

Owner decisions (2026-08-16):

1. Linking is authored in the **program wizard**, per strength slot.
2. The auto-pairing toggle is **removed entirely**. Engine-picked accessories
   (ADR 0048 muscle chips) are not known at authoring time and simply run solo.
3. A link may hold **any number of members** (2 = superset, 3+ = tri-set / giant
   set), reusing the circuit primitive rather than a pair-only shape.
4. Linking is allowed across **all lifts in the slot including main lifts**, with
   a warning — never a hard block (DC-K4).
5. Links work on **every Tactical Barbell program**: canonical templates,
   customized ones, and Activation.

## Storage — outside the customization blob

Links live in their own independently-versioned envelope on the create/edit
payload, persisted to `program_instances.instance` (as
`TbInstance.customSessionLinks`) and `program_instances.setup_input` (as a
sibling of `customization`):

```
sessionLinks: { version: 1, bySeries: Record<seriesKey, SessionLink[]> }
```

Nesting them inside `tbCustomizationV1Schema` was rejected twice over:

- The wizard only builds a `customization` when "Customize this template" is
  ticked, but links must reach canonical Operator / Fighter / Zulu and
  Activation. Binding them would gate the feature behind an unrelated opt-in.
- `tbCustomizationSchema` is a `.strict()` union whose `version` literals
  (1 = weekly, 2/3 = Activation) form one shared sequence. Extending it means
  either a version bump plus a capability-predicate refactor of every
  `isTbCustomizationV1()` gate, or a strict-schema change an older build
  rejects — which, because `edit-context` `safeParse`s the customization as one
  unit, silently drops the WHOLE customization, not just the links.

As siblings parsed independently, a malformed one can never destroy the other.

**Series keys** are the engine's own `sessionSeriesKey()` output — `slot-N` for
weekly templates, `activation.<phase>.<id>` for Activation — so one flat map
covers every TB shape with no Activation-schema change, and links are
phase-scoped for free.

**Milestone sessions are not linkable.** `sessionSeriesKey()` falls back to
`activation.milestone.<id>`, but the wizard's Activation projection filters to
sessions with a phase and so never produces that key, and the unqualified id
collapses repeats of the same test session across weeks (`operator-test` runs in
two, deriving from different predecessor phases). The prefix is rejected at both
the Zod and engine layers rather than storing a link that applies to the wrong
week.

**Member identity is `sourceMovement ?? movement`** — the identity the engine
already uses for peak detection and the AB Triad — so a link survives a movement
substitution. This exposed a latent bug: the Activation Armor supplemental swaps
(back-extension/reverse-hyper, pullup/inverted-row) rebuilt the entry WITHOUT
`sourceMovement`, unlike the customization-override path, losing the canonical
slot identity. Fixed as part of this work.

## Resolution — against emitted items, not the lift list

`prescribe()` realises links AFTER the session's items are emitted. A member can
be absent for reasons the raw `lifts` list does not show (a template week
excludes a movement; a lift changes shape when its 1RM is missing). When any
member is absent the link is dropped whole and its present members render solo —
never a half-bracket, the same rule ADR 0026 used for widowed members.

Circuit metadata is now emitted from the anchored %TM branch as well. Previously
only the unanchored branch emitted one (it existed solely for the AB Triad), so
linking two percentage-loaded main lifts produced nothing.

Members are reordered adjacent so the preview brackets them and the logger
rotates through them. The emit loop therefore collects items per lift, because
moving a lift must carry its own warm-up ramp with it. The circuit attaches to
the working item only; warm-ups never carry it.

## Rounds and per-set participation

`rounds = min(required sets)` across members — the most rounds every member can
complete without inventing volume. A member prescribing more keeps those sets;
they fall OUT of the rotation and log solo at full rest.

That distinction is per-SET, so the platform adapter stamps `circuit.round` on
each granular set as it expands a `sets > 1` engine item, and only on the first
`rounds` required sets. Without the stamp every expanded set carries an identical
copy of the circuit and a rotation set is indistinguishable from a tail set —
which had already broken the logger in three ways (see below).

## Consumer rework

`linked-circuit.ts` read `group.items[0].circuit` and treated the whole movement
as "in the circuit". That held only for the AB Triad — three accessories, three
items each, no warm-ups, equal sets. Against arbitrary links it failed:

- an anchored main lift's `items[0]` is a WARM-UP carrying no circuit metadata,
  so main-lift links were invisible;
- warm-ups counted as circuit progress, so round numbers were wrong;
- sets beyond the round count were never offered by navigation but still demanded
  by completion, so the "Finish session" bar could never arm.

Membership and navigation now work in participating item indices, and rest
suppression is decided per slot.

## The volume invariant, now encoded

ADR 0026 called it absolute that pairing never feeds volume selection: if grouped
rest fed the ADR-0020 duration governor, linking two lifts would free up time and
the governor would keep MORE accessories — a presentation choice silently
changing the prescription.

That guarantee previously held only because no code path happened to produce
grouping metadata before the governor ran. `estimateSessionSeconds` now takes an
explicit `RestPricingMode`, and the governor asks for `"solo"`. The invariant is
enforced by the call, not by the current call graph.

## Consequences

- The lifter says exactly what they want to superset, and it stays put.
- One representation (`circuit`) serves the AB Triad and user links alike.
- Blocks that had the old toggle on lose the auto-paired brackets. **No
  prescription or set_log is migrated** — pairing was always read-time and
  derived, so the same items, sets and reps are produced; only the grouping and
  the shown duration change.
- `profiles.superset_accessories` and `training_blocks.superset_accessories` are
  dropped (migration 0129, with a down migration). Sole-user app; owner approved
  the destructive drop. **Ship the code release first** — running the migration
  against an older build breaks the plan queries, the logger and the wizard,
  which all select the columns by name.
- The AB Triad keeps precedence: when the complete triad is present, a user link
  touching those slots is refused by the wizard and ignored by the engine, so the
  collision is unrepresentable rather than ordering-dependent.

## Constants

No new CP-2 constants. `SUPERSET_TRANSITION_SEC = 15` survives unchanged from
ADR 0026 and now prices each station change in a round of any size:

```
round = Σ work + (size − 1) × SUPERSET_TRANSITION_SEC + max(rest of members)
```

It still affects only the DISPLAYED duration, never the prescription, so a
mis-estimate stays cosmetic. The Stage-B calibration plan from ADR 0026 carries
over: refine against realised inter-station transition time from logged set
timestamps.
