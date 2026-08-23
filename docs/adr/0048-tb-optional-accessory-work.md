# ADR 0048 — Tactical Barbell optional accessory work

Status: Superseded for Tactical Barbell by [ADR 0075](0075-tb-user-chosen-accessories.md)
(2026-08-23) — accessories are now chosen by the user in the session editor. This
ADR still governs **Green Protocol**, which keeps the toggle and the injector, and
the accessory DOSE it derived (8–15 reps, near failure) is what a user-added
movement is prescribed at. Originally: Accepted (2026-06-13) — platform layer
implemented in #496
Supersedes: none
Related: ADR 0047 (5/3/1 assistance generation — the *contrasting* model), the
platform pivot (5/3/1 + TB as foreign engines), the prescription adapter
(`apps/web/src/lib/platform/adapter.ts`), the 5/3/1 assistance resolver
(`apps/web/src/lib/platform/assistance-resolver.ts`), the Hybrid accessory picker
(`apps/web/src/lib/planner/accessory-picker.ts`) and its catalog / equipment /
limitation primitives, the TB engine (`packages/tacticalbarbell/`).

## Context

ADR 0047 closed the 5/3/1 assistance gap: 5/3/1 *prescribes* assistance every
session, so the engine now emits category-tagged intent and the platform resolves
it to catalog movements. A natural follow-up question is whether Tactical Barbell
needs the same treatment. **It does not** — and applying the 5/3/1 model to TB
would actively violate TB's methodology. This ADR records why, and the (different)
design for the *optional* accessory support TB users do ask for.

### What the TB book actually says

Source: *Tactical Barbell — Definitive Strength Training for the Operational
Athlete* (K. Black), the "Accessory / Assistance Work" section, the Zulu worked
example, the "What about bicep curls?" FAQ, and the Gladiator/Mass template notes.

1. **Default is deliberately empty.** "Bicep curls and other isolation exercises
   originally didn't have a place in this program… you'll grow biceps, triceps,
   calves etc. dramatically and *indirectly* through heavy compound work and your
   conditioning." Accessories are an **opt-in add-on**, never a gap to auto-fill.
2. **Template-gated.** Zulu is the template *designed* to host accessories
   ("sessions take 20-25 min… plenty of time for more work after… if accessory
   work is important, stick to Zulu and avoid the specialist templates"). Mass
   already ships its own accessory day ("pull-ups/dips/arm work"). Gladiator
   explicitly warns *against* extra barbell work ("avoid any extra heavy barbell
   lifting… supplementary push-ups, pull-ups, ab work is fine"). Operator/Fighter
   tolerate a little "around the edges… keep it to a minimum."
3. **Placement: after the main lifts** (same session) or a dedicated accessory day
   — never before, never interleaved with the strength clusters.
4. **Style is explicitly "bodybuilder fashion"** and explicitly *not* how TB main
   work runs: "short rest intervals, higher repetitions, relatively lighter weights
   (**50%-70% RM**) and seeking muscle failure." The main lifts, by contrast, are
   submaximal and must leave you fresh.
5. **Selection is aesthetic / individual / gap-filling**, complementing the day.
   The Amir example: bench day → dips + incline DB press; squat/pull day →
   hamstring curls + barbell curls; bench day → DB shoulder press + hanging leg
   raise + ab roller; squat/pull day → calf raises + **forearm work + face-pulls**.
6. **Hard interference guard:** "If your accessory work is interfering with your
   recovery to the point it's affecting your main lifts… cut back or eliminate it.
   Leave the main lifts unaffected."

### Why this is NOT the 5/3/1 model

| | 5/3/1 (ADR 0047) | Tactical Barbell |
| --- | --- | --- |
| Prescribed by default? | Yes — every session | **No** — opt-in only; default stays empty |
| Categories | Structured 3 (Push/Pull/Single-leg-or-Core), mandatory | None — "do what you want," aesthetic |
| Movement scope | Strict — we deliberately **excluded** face-pulls, shrugs, grip work | **Permissive** — face-pulls, forearm, calf, arm work are explicitly welcomed |
| Load / intent | hypertrophy range reps | 50-70% RM, **to failure**, bodybuilder style |

The 5/3/1 resolver's defining behaviour — emitting three mandatory categories and
*excluding* aesthetic/prehab items — is the exact opposite of what TB wants. TB's
"aesthetic gap-fill complementing the day, individual choice" philosophy instead
maps almost exactly onto the existing **Hybrid accessory picker**
(`pickAccessoriesForSession`: aesthetic muscle-gap fill + focus muscles +
equipment/limitation filtering).

## Decision

Add **optional, opt-in TB accessory work, built on the Hybrid accessory picker —
not the 5/3/1 assistance resolver.** Specifically:

1. **Opt-in, never automatic.** The deployed TB default stays accessory-free (it
   already is — the foreign passthrough injects nothing). Accessories are enabled
   only by an explicit user toggle, framed as aesthetic/individual, with copy
   echoing the book ("you don't need this to grow — it's for aesthetic / weak-point
   work").
2. **Template-gated:**
   - **Zulu / Zulu-IA** → full accessory support (the book's intended home).
   - **Operator / Fighter** → allowed but capped low ("keep it to a minimum").
   - **Mass** → surface its existing built-in accessory day rather than layering a
     second system.
   - **Gladiator / Grey-Man** → **disabled** (the book discourages extra work).
3. **Programming parameters (book-grounded):**
   - **Placement:** after the main lifts, same session (or a dedicated accessory
     slot on a Fighter/Mass off-cluster day).
   - **Volume cap:** small — 1–3 movements/session, 2–4 sets × 8–15 reps
     (CP-1 calibration; Zulu cap > Operator/Fighter cap).
   - **Load / intent:** 50–70% RM, RPE-high, near-failure permitted — carried as a
     display note, not a %TM prescription (TB accessories are RPE/feel-driven).
   - **Selection bias:** (a) complement the day's main pattern (push accessory on a
     press day, etc.) and (b) the indirect muscles compounds miss — arms, calves,
     abs, rear delts, forearms (Amir's pattern). The **permissive** scope means we
     do **not** apply the 5/3/1 `classifyAssistanceCandidate` prehab exclusions.
   - **Filtering:** reuse equipment (`isEquipmentAvailable`) + limitation
     (`loadsBlockedRegion` / `loadsBlockedMuscle`) primitives already shared by both
     pickers.
4. **User-selectable muscles** (like Hybrid's focus picker) rather than imposed
   categories — TB accessory selection is the user's choice, not a methodology
   prescription. Default suggestion: "complement today + fill arms/calves/abs."
5. **Self-regulation built in:** every accessory item is trivially skippable, with
   the interference note surfaced ("if it's affecting your main lifts, cut it").

## Options considered

- **A — Reuse the 5/3/1 resolver for TB.** Rejected: its mandatory 3-category
  scheme and prehab exclusions are the opposite of TB's permissive, opt-in,
  aesthetic philosophy. It would mis-prescribe (forcing a pull/push/legs slot every
  session) and exclude the very face-pull/forearm/calf work TB invites.
- **B — Reuse the Hybrid accessory picker (chosen).** Its aesthetic gap-fill +
  focus-muscle + equipment/limitation machinery is the closest existing fit for
  TB's "fill what the compounds miss, your choice" model. Lowest new surface area;
  one accessory engine, two callers.
- **C — Manual "pick your accessories" builder.** Closest to the book literally
  (Amir hand-picks). Highest friction, most UI. Kept as a possible layer *on top*
  of B (let the user pin/swap), not the base mechanism.
- **D — Do nothing (status quo).** Faithful to pure TB, but ignores a real,
  repeated user request and leaves the "I want some arm work" path dead.

## Consequences

- **TB stays minimalist by default.** No behavioural change unless a user opts in;
  the foreign passthrough is untouched for the default path. Operator/Fighter/Zulu
  prescriptions remain byte-identical when accessories are off.
- **One accessory engine, two consumers.** The Hybrid picker gains a second caller
  with TB-flavoured parameters (template cap, permissive scope, RPE note). Risk:
  parameter creep in `pickAccessoriesForSession`; mitigate by passing a small TB
  config object rather than branching inside the picker.
- **Engine vs platform boundary preserved.** Like ADR 0047, the methodology
  (opt-in, template gating, volume caps, 50-70%/feel) lives in the platform layer;
  the pure TB engine keeps emitting only main work. The TB book's "accessories are
  discretionary, not programmed" stance is *itself* faithfully encoded by leaving
  the engine output empty.
- **Calibration.** The volume caps and rep ranges are CP-1 heuristics derived from
  the book's qualitative guidance ("keep it to a minimum", "50-70% RM, higher
  reps"); they carry citation comments and are revisited if user data shows
  interference with main-lift progression (the book's own stop condition).

## Open questions

1. **Auto-suggest vs manual.** Default to (a) auto-suggested accessories
   complementing each day (reuse picker, low cap) or (b) a manual builder the user
   fills once? Lean: **(a) with muscles user-selectable**, defaulting to "complement
   today + fill arms/calves/abs" — honours TB intent at low friction; (c) manual
   pinning can layer on later.
2. **Where accessories live in the data model.** A per-block TB accessory config
   (enabled + template cap + chosen muscles) vs per-session materialised items.
   Mirroring 5/3/1 (materialise into `planned_sessions.prescription` as `accessory`
   items) keeps the read side uniform.
3. **Mass template.** Reuse its existing accessory day vs unify under this system —
   needs a look at how Mass is currently materialised before deciding.

## Implementation note (addendum, 2026-06-13)

Refinement to Option B after reading the code: the full Hybrid
`pickAccessoriesForSession` requires an `AccessoryProfile` + DC-O4 durability floor
+ MEV per-muscle targets + synergist credit — Hybrid science TB explicitly rejects.
Forcing TB through it would fabricate floors TB does not prescribe. So the platform
layer instead **reuses the shared accessory PRIMITIVES** — `loadPickerCatalog`,
`resolveRequiredEquipment` / `isEquipmentAvailable`, `loadsBlockedRegion` /
`loadsBlockedMuscle`, the `CatalogMovement` shape, and a seeded rotation — in a
focused `apps/web/src/lib/platform/tb-accessories.ts` selector (the same shape as
the 5/3/1 `assistance-resolver.ts`). This honours Option B's intent (build on the
existing accessory machinery) without the ill-fitting profile engine.

Shipped (platform layer, #496): muscle-driven selection over an allowlist (default
biceps/triceps/side_delts/abs/calves), template gating + caps via
`tbAccessoryPlanForTemplate` (Zulu/Zulu-IA cap 3, Operator/Fighter cap 2, others
disabled), equipment + limitation filtering, per-session rotation, items emitted as
`accessory` (3×12, "8–15 reps · ~50–70%, near failure" note), injected at
`materializeProgram` on TRAINING sessions only, behind a deploy-time
`accessories: { enabled, muscles }` param (default off → byte-identical). The TB
engine is untouched and still emits only main work.

Still to do (wizard UI): surface the opt-in toggle + muscle multiselect in the TB
loadout step, template-gated, sending the `accessories` param. Until then the
feature is wired but not user-reachable.

Update (#497): the wizard UI shipped — the TB loadout step (`ProgramPicker`) now
shows an "Add accessory work (optional)" toggle (only for accessory-eligible
templates via `tbAccessoryPlanForTemplate`) + a muscle-emphasis multiselect, and
sends `accessories: { enabled, muscles }` to `createProgramInstance`. The pure
config (muscle allowlist, labels, template gating) lives in
`tb-accessories-config.ts` so the client bundle doesn't pull the server selector.
Live-verified: a TB Operator deploy with accessories on materialises 2 accessory
items (Operator cap) at 3×12.
