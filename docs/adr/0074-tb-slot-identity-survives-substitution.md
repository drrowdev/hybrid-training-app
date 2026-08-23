# ADR 0074 — A customized Tactical Barbell slot keeps its identity through a substitution

Status: Accepted (2026-08-23)
Supersedes: none
Related: ADR 0048 (TB optional accessory work — the *other* kind of extra work),
ADR 0071 (user-authored session links), DC-K4 (override-and-warn)

## Context

TB3's Zulu is a prescriptive template, not a cluster the user fills in. Each of
its four sessions carries main lifts **and** supplemental lifts:

| | main | supplemental |
| --- | --- | --- |
| A days | bench, squat | overhead press (3–5×8–10 @ 65/70/75/65/70%), AB Triad |
| B days | deadlift, weighted pull-up | barbell row, back extension (3–5×8–10) |

The engine has emitted these since Zulu was rebuilt to TB3
(`zuluSupplementalRules` in `packages/tacticalbarbell/src/templates.ts`), and
`program.test.ts` pins them. Two problems sat on top of that.

**1. The wizard never said so.** The Zulu card described the older TB1 Zulu
("splits 4 main lifts into two pairs… lets you carry more lifts than Operator's
3-lift cap"), which is a different program. Step 2 showed frequency, block length
and loading basis, and nothing about session content. A reader could only
conclude that Zulu was four main lifts and that anything else had to come from
the ADR 0048 "Add accessory work" toggle — a separate, opt-in, aesthetic feature
whose own copy asserted that "Tactical Barbell doesn't add accessories".

**2. Editing a supplemental silently promoted it to main work.** The engine
matches `prescriptionRules` on a lift's movement key. The customized path
(`sessionLifts` → `usesCustomizedSelection`) replaced the template's list with
the user's, and the user's entries carried only a movement key. Swap the overhead
press for anything else and no rule matched it, so a lift meant to run at
3–5×8–10 @ 65% was prescribed at the session's main percentage instead. Three
further consequences of the same root cause:

- `cloneEntry` dropped `sourceMovement`, so even an explicitly tagged entry lost
  its slot on the way through.
- `translateTestSelection` filled each week-6 peak slot with `exact ?? added ??
  fallback`. Empty the squat slot and an unrelated supplemental — or a movement
  the user added themselves — could become the 1RM attempt.
- `sameMovementSelection` compared a sorted multiset of movement keys, so
  reassigning two movements between slots compared equal to the canonical
  template and the edit was discarded.

Activation already had the answer. Its Armor supplemental picker rebuilds a
swapped entry as `{ ...replacement, sourceMovement }` precisely so "the canonical
slot identity survives the substitution", and everything that reasons about a
lift's ROLE reads `sourceMovement ?? movement`. That mechanism simply was not
wired into the weekly customization path.

## Decision

**A slot is a first-class thing with a permanent identity; the exercise filling
it is replaceable.**

1. **`sourceMovement` becomes the customization vocabulary.** `entriesFromValue`
   parses it, `cloneEntry` preserves it, and the wizard stamps it on every row
   that stands in for a template slot. A row the user adds themselves carries no
   slot and is prescribed as main work.
2. **Slot-aware resolution.** `sameMovementSelection` compares slot→movement
   assignments rather than a bag of names. `translateTestSelection` resolves each
   peak lift by slot when the payload is slot-aware, and refuses to substitute
   into an emptied slot; the positional heuristic is kept only for payloads
   written before slots were recorded.
3. **One projection.** `tbTemplateSeries(template)` is the single home for "what
   this template prescribes per session, and which of it is supplemental". The
   step-2 preview, the customization editor and the deploy-time validator all
   read it instead of each re-deriving from `weeklySessions` (plan §6.9).
4. **The wizard shows the session, not prose about it.** Step 2 lists each day's
   main and supplemental lifts, derived from the template. The AB Triad reads as
   one entry because it is one circuit. The Zulu card copy is corrected.
5. **Supplemental slots are editable like main ones** — Change swaps the
   exercise while keeping the slot (so links keyed by that slot survive), Remove
   drops it. Removal is allowed and stated back to the user, never blocked
   (DC-K4).
6. **Slot claims are validated**, both structurally (at most one row per slot; a
   `catalog:` movement can never BE a slot) and against the selected template at
   deploy. A claim decides which prescription an entry inherits, so an
   unvalidated one is a way to pull arbitrary loading onto arbitrary work.

## Options considered

- **A — Re-key prescription rules by position.** Rejected: positions shift when
  a user adds or removes a movement, which is exactly when the rule matters.
- **B — Forbid editing supplemental slots.** Rejected: it contradicts the user's
  actual request and DC-K4, and would have left the misleading step-2 copy as the
  only fix.
- **C — Carry the resolved prescription in the customization blob.** Rejected:
  it freezes loading at wizard time, so a template correction would never reach
  an existing block. The engine must stay the source of prescription.
- **D — Slot identity in the payload (chosen).** Reuses the mechanism Activation
  already proved, and is the smallest change that makes a swap safe.

## Consequences

- **Byte-identical defaults.** An untouched Zulu deploys exactly as before —
  pinned by a test that walks the whole timeline comparing a slot-stamped
  canonical customization against the plain instance.
- **Legacy customizations keep working.** Entries with no `sourceMovement` fall
  back to their own movement key, which for an unswapped row IS its slot — the
  same fallback the engine already applied. Slot-aware peak resolution only
  engages once a payload actually carries slots.
- **Links survive a swap.** Weekly link members are now slot identities, matching
  what the engine has always realised them against (ADR 0071); orphan validation
  compares in the same vocabulary.
- **The accessory toggle is now honestly scoped.** Its copy no longer claims TB
  adds nothing beyond main lifts, which was never true of Zulu. Its own overlap
  question — the injector's exclusion list does not know about back extensions or
  the AB Triad, so ab work can be stacked on ab work — is deliberately left to a
  separate change, since the fix is about muscle overlap rather than slot identity.
- **Not addressed here:** Zulu I/A, Gladiator, Mass and Grey Man are still
  encoded from the earlier edition. Their copy is accurate for what they
  currently are; bringing them to TB3 is a separate decision.
