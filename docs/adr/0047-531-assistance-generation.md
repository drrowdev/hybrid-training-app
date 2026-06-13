# ADR 0047 — 5/3/1 assistance generation (Push / Pull / Single-leg-or-Core)

Status: Proposed (2026-06-13)
Supersedes: none
Related: the platform pivot (5/3/1 + TB as foreign engines), the prescription
adapter (`apps/web/src/lib/platform/adapter.ts`, `movement-keys.ts` —
`assistance → accessory`), the wendler assistance model
(`packages/wendler/src/assistance.ts`), the Hybrid accessory picker
(`apps/web/src/lib/planner/accessory-picker.ts`) and its catalog/equipment/
limitation filter primitives, ADR 0027 (synergist credit) and ADR 0024
(accessory volume) — the analogous machinery on the *native* path.

## Context

The app ships two **separate** accessory architectures, chosen at deploy time
(`lib/platform/actions.ts`: `isNativeProgram` → native vs foreign):

- **Native (Hybrid / legacy archetypes)** run the rich, science-grounded
  `pickAccessoriesForSession` (durability → functional → power → aesthetic
  gap-fill → focus-muscle floor), with per-archetype `accessoryProfile`, volume
  levels, focus muscles, synergist credit, and equipment/limitation filtering.
- **Foreign (5/3/1, Tactical Barbell, Green Protocol)** pass the engine's
  `prescribe()` output straight through `adaptSessionPrescription` — the platform
  **injects nothing**.

For Tactical Barbell and Green Protocol that passthrough is **correct**: the TB
books treat accessories as discretionary, so Operator/Fighter/Zulu prescribe only
main lifts (+ warm-ups), Zulu/HT adds its prescribed pull-up assistance, and GP
delegates verbatim. No gap.

For **5/3/1 it is a real gap**. 5/3/1 Forever (Wendler, 2017) prescribes
assistance **every session** — roughly **25–50 reps each of Push, Pull, and
Single-leg-or-Core** (50–100 on higher-volume phases) — and every template gives
assistance guidance. But:

- `packages/wendler/src/program.ts` `prescribe()` only ever emits `warmup`,
  `main`/`amrap`, and `supplemental` (lines 370/375/388). It **never emits
  `kind: "assistance"`**, even though `PrescribedItemKind` allows it.
- A full assistance model exists (`assistance.ts`: Push/Pull/Single-leg/Core
  categories, `AssistancePlan`, `categoryFromMovement`) but **nothing in the repo
  populates it** — `resolveAssistance` always returns `[]`. A `blocks.ts` comment
  states the assistance-prescription model was "intentionally NOT ported …
  reintroduced at integration time"; that integration never happened.
- The templates carry prose cautions ("Volume is high — keep assistance light",
  "pair with assistance") that *assume* assistance exists.

Net effect: a deployed 5/3/1 program is **main + supplemental + warm-ups only** —
a structurally incomplete 5/3/1. The supplemental work (BBB 5×10, FSL, Spinal
Tap, Widowmaker, …) is implemented correctly; only the assistance is missing.

### Why this can't just live in the engine

`packages/wendler` is a **pure methodology package** — no DB, no movement
catalog, no equipment/limitation context. It knows engine movement *keys*
(`squat`, `bench`) that the platform later resolves to the user's anchored lifts
via an injected `resolveMovement`. It cannot pick "Triceps Pushdown vs Dips" — it
has no catalog and no idea what equipment the user owns or which regions are
injured. So assistance **selection** must happen in the app layer, while
assistance **intent** (how many reps of which category, per template) is
methodology and belongs in the package.

## Decision

Generate 5/3/1 assistance with a clean **intent → resolution** split, mirroring
how main lifts already flow (engine emits keys; platform resolves to movements).

### 1. Engine emits assistance *intent* (methodology, in `packages/wendler`)

`prescribe()` gains a per-strength-session assistance block: one slot per
**category** the template calls for, each carrying `{ category, targetReps,
sets, repRange }` but **no concrete movement** (a category placeholder, not a
movement key). The categories follow the book:

- **Push** (horizontal/vertical pressing isolation/compound assistance)
- **Pull** (rows, chins, face-pulls, rear-delt, curls)
- **Single-leg-or-Core** (lunges/split-squats/back-ext, or ab work)

Per-template assistance volume is a new field on each `WendlerTemplate` in
`wendler-templates.ts` — `assistanceVolume: "none" | "light" | "standard"` —
read from the book's own template guidance:

- `jack-shit` / minimalist templates → **none**
- `bbb-*` (heavy 5×10 supplemental) → **light** (~25 reps/category)
- Triumvirate / FSL / 5's-PRO templates → **standard** (~50 reps/category, the
  default)

A volume level maps to `(sets × reps)` per category (e.g. standard ≈ `3×15` or
`5×10` per category ≈ 45–50 reps; light ≈ `2×12`). Deload / 7th-week / TM-test
weeks emit **no** assistance (consistent with how supplemental is already
skipped). This keeps the entire "how much, which categories, per template"
decision as book-grounded methodology inside the package, fully unit-testable
with no DB.

### 2. Platform resolves each intent to a concrete movement (app layer)

The foreign-deploy path (`createForeignProgramInstance` → `materializeProgram` /
`adaptSessionPrescription`) gains a **5/3/1 assistance resolver** injected the
same way `resolveMovement` is. For each assistance slot it selects a real catalog
movement of the slot's category, reusing the **existing filter primitives** that
the Hybrid picker already uses — NOT the archetype `accessoryProfile` machinery:

- **Category → catalog** via the movement `pattern` (the inverse of
  `categoryFromMovement`): Push = pressing patterns, Pull = pulling patterns,
  Single-leg-or-Core = single-leg keyword / hinge accessory / core.
- **Equipment availability** (`isEquipmentAvailable` / `resolveRequiredEquipment`)
  — only movements the user can actually load.
- **Limitations** (blocked regions/muscles/movements, tendinopathy) — same
  `PickFilters` the Hybrid picker honours.
- **Within-block rotation** — vary the chosen movement across the cycle so a user
  isn't handed the identical three lifts every session (reuse the recency seed).

Resolved slots are emitted as engine `assistance` items, which the existing
adapter already maps to the app's `accessory` kind (`movement-keys.ts:71`) and
the logger already renders. **No new render path, no schema change.**

### 3. Scope boundary stays explicit

This is a **5/3/1-specific** post-process, not a blanket "inject accessories into
all foreign programs." Tactical Barbell and Green Protocol keep their faithful
passthrough (zero injected accessories); only programs in the `531` family get
the assistance resolver. The native Hybrid path is untouched.

### 4. User customisation is deferred (but unblocked)

The auto-generated block is the default. The dormant `AssistancePlan`
(perDay/perWeekDay overrides) is the intended persistence seam for a later "edit
my assistance" UI — out of scope here, but this ADR populates the same shape so
that feature is additive.

## Consequences

- A deployed 5/3/1 program becomes **book-complete**: main + supplemental + warm-
  ups + Push/Pull/Single-leg-or-Core assistance, scaled per template, on every
  training session (none on deload/7th-week).
- **Engine-regression guard:** assistance is purely *additive* — the existing
  main / supplemental / warm-up items and their ordering are byte-identical, so
  the wendler golden tests and the platform adapter tests stay green except for
  the new assistance assertions. Users not on 5/3/1 see no change.
- **TB / GP unchanged** — the resolver is gated to the 5/3/1 family.
- The split keeps methodology testable without a DB (package units cover "BBB →
  light, Triumvirate → standard, deload → none") and selection testable with a
  fake catalog (app units cover equipment/limitation filtering + rotation).
- Interference awareness: because 5/3/1 here is a strength-only program (no
  concurrent cardio modelling on the foreign path), the assistance does not need
  the durability/HSR floor the Hybrid picker imposes — keeping the block simple
  and book-faithful rather than over-engineered.

## Calibration

Per the CP-1…CP-5 policy:

- **Assistance category model (Push / Pull / Single-leg-or-Core) and the
  25–50 reps/category target** are taken **directly from 5/3/1 Forever** — HIGH
  confidence, book-sourced, not a fitted constant.
- **Per-template `assistanceVolume` mapping** (e.g. BBB → light, Triumvirate →
  standard, Jack Shit → none) is read from each template's own book guidance —
  HIGH confidence as *direction*, with the template descriptions in
  `wendler-templates.ts` as the citation.
- **The exact `(sets × reps)` per level** (e.g. standard = `3×15`/`5×10`,
  light = `2×12`) and the **movement-selection / rotation heuristics** are
  CP-1 [DEF→cal] Stage-A heuristics — directionally grounded in the book's
  rep-total band but not tuned against logged 5/3/1 assistance/outcome data. They
  are bounded by the same session-duration governor the rest of the app uses, so
  the upward direction is safety-capped.
