# ADR 0024 — Accessory volume level (Low / Medium / High)

- **Status:** Proposed (design — awaiting review; no code yet)
- **Date:** 2026-06-03
- **Phase:** Production (engine review #1 — minimalist-training literature)
- **Supersedes / extends:** Supersedes the **volume axis** of ADR 0016 (effort/volume
  dial) and generalises it from hypertrophy-only to **all archetypes**. ADR 0016's
  **effort axis** (early-set rep bump + final-set RIR anchor, Decisions 4/5) is unchanged.
  Reuses the volume-tilt mechanism of ADR 0020/0021 (secondary-focus tilt) and the
  per-muscle weekly-target model of ADR 0022. Does **not** touch `buildPrescription`'s
  main-lift path or the dual-main-lift folding ADRs (0004–0006).
- **Touches:** `apps/web/src/lib/planner/accessory-volume.ts` (new — the level → tilt
  config), `apps/web/src/lib/planner/assemble-prescription.ts` (compose the level tilt
  with the secondary-focus tilt at the existing site), `apps/web/src/lib/planner/actions.ts`
  (read + thread the per-block level), block-creation input schema + `training_blocks`
  storage, and the BlockWizard / ArchetypePicker UI (the Low/Medium/High control +
  tooltip). Retires `hypertrophyAccessorySetsPerItem` from `effort-preference.ts`.

## Context

Engine review #1 (minimalist resistance-training literature: Schoenfeld 2019 low-volume;
Currier 2023 BJSM network MA — HM2 top-3 for both strength and hypertrophy; Baz-Valle
2022 weekly-set landmarks) points at one well-evidenced practical lever for the busy
hybrid athlete: **keep heavy compounds, trim accessory volume.** Strength is well
preserved on low accessory volume; hypertrophy scales with hard sets.

The engine already differentiates accessory **character** by archetype:

| Archetype | aesthetic items/session | rep range | functional requirement | character |
|---|---|---|---|---|
| Strength Focus | 2 | 8–12 | single-leg ×1/wk | few; support carryover + weak points; AMRAP top set |
| Hypertrophy Focus | 4 | 8–15 | — | many; curated gap-fill pool — accessories *are* the driver |
| Endurance / Rebuild | 1 | 12–15 | tendon / mobility roles | minimal aesthetic; durability-led |
| Maintenance | 0 | — | — | no aesthetic accessories by design |

What is missing is a user lever for accessory **amount**. ADR 0016 added one — but it is
(a) **hypertrophy-only** (no-op on every other archetype) and (b) **fused with effort**
into a single "Easier/Balanced/Harder" knob. Minimalism is **low volume, not low
effort**: the few sets stay heavy. A fused knob mis-models it (its "Easier" setting also
softens RIR and drops the early-set bump). The strategic framing from the ADR 0016 review
still holds — HIGH inter-individual variability, ~0 rows of real data → **expose a lever,
don't re-hardcode a default.** This ADR splits the volume lever out, fixes the semantics,
and generalises it across archetypes so it also covers cardio-primary blocks whose
strength portion folds to ~2 strength days (where "minimalism applies only to strength").

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Split volume from effort | New, separate **accessory-volume level** (`low \| medium \| high`). `effort_preference` keeps **only** its effort axis; its volume axis (ADR 0016 D6) is superseded here. | Low volume ≠ low effort. Two distinct questions ("how much accessory work" vs "how hard") deserve two controls — but on different axes, so it does not compound choice fatigue. |
| 2 | `medium` is the identity | `medium` reproduces today's prescription **byte-for-byte** on every archetype (the `NO_TILT` of ADR 0020). Default for all rows/blocks. | Zero-migration safety: golden master + ADR 0011/0015/0016/0020/0022 pins stay green. |
| 3 | Cross-archetype | The level applies to **every** archetype's aesthetic accessory profile (not hypertrophy-only). | Findings generalise: a strength block, a hybrid block, and a cardio-primary block with a strength day all benefit from a volume lever. |
| 4 | Amount layer, not character | The level shifts **how much** accessory work; the **archetype keeps owning** rep range, movement bias, functional/durability requirements, and AMRAP. No priority-specific branching in the control. | The engine already programs accessories correctly per priority (see context table). The level rides on top. |
| 5 | Relative to each archetype's base | The level is a **delta on each archetype's own profile**, not an absolute set count. So "Low" on Strength (2→1 item) is leaner than "Low" on Hypertrophy (4→3 items) automatically. | A hypertrophy lifter dialling down still does more accessory work than a strength lifter dialling down — correct, and it falls out for free. |
| 6 | Mechanism = volume tilt (reuse 0020) | `accessoryVolumeTilt(level): { itemsPerSessionDelta, setsPerItemDelta }`, applied at the **same** `assemble-prescription` site as the secondary-focus tilt and **composed additively** with it. | A known-safe, test-pinned pattern. Minimal new surface; no new code path. |
| 7 | Low trims **breadth**, not depth; durability is protected | `low` removes the **lowest-value aesthetic movement** (the picker already value-ranks, ADR 0012) — `itemsPerSessionDelta = −1`, `setsPerItemDelta = 0`. Functional + durability fills (single-leg, tendon/mobility roles) are **not** trimmed. | "Cut junk volume, keep specificity" (report §3). Kept movements stay full-quality; the tendon/durability floor survives even at Low (report's explicit minimalist caveat). |
| 8 | Grain = per-block (+ optional profile default) | The level is chosen **per block** in the wizard (next to focus + days), baked at creation like every other generation input. A profile default may pre-fill it. | Minimalism is situational ("busy this month"), so a global-only setting is the wrong grain. Bake-at-creation matches ADR 0016 D7. |

## Effect table (proposed magnitudes — CP-1, to confirm)

`itemsPerSessionDelta` floored so an archetype never goes below 0 aesthetic items;
`setsPerItemDelta` floored at a minimum of 2 sets/movement.

| Archetype (base items × sets) | Low | Medium (identity) | High |
|---|---|---|---|
| Strength (2 × 3) | **1 × 3** | 2 × 3 | 3 × 4 |
| Hypertrophy (4 × 3) | **3 × 3** | 4 × 3 | 5 × 4 |
| Endurance / Rebuild (1 × 2) | 1 × 2 *(floor; no-op)* | 1 × 2 | 2 × 3 |
| Maintenance (0) | 0 *(no-op)* | 0 | 0 |

Tilt values: `low = { items −1, sets 0 }`, `medium = { 0, 0 }`, `high = { items +1, sets +1 }`.
Composes additively with the secondary-focus tilt (e.g. Strength + Muscle secondary +
High would stack, then trim-to-fit under the ADR 0020 duration governor).

## Tooltip copy (priority-agnostic — reads correctly on any focus)

- **Low** — "Just the essentials: your main lifts plus a couple of key accessories. Best
  when you're short on time or recovery. Keeps strength; muscle growth is slower."
- **Medium** — "Balanced accessory work to build muscle alongside your main lifts. The
  default."
- **High** — "Extra accessory volume to push muscle growth. Best when you have time and
  recovery to spare."

## Rationale

We do not know the right accessory volume for an individual, and the literature says the
optimum varies widely. Rather than pick a new default, we expose a reversible,
clearly-labelled per-block level that defaults to today's behaviour and lets the user move
either way — now correctly separated from effort, and available on every archetype.
"Minimalism" is simply the **Low** end of this control on a strength-leaning block; it is
not a new archetype, not a new card, and adds no choice at the goal-selection step.

## Evidence base

- **Schoenfeld 2019** (low-volume in trained men) — **HIGH**: 1 set/exercise matched 3/5
  sets for strength; hypertrophy favoured higher volume. Basis for "Low keeps strength,
  slows growth."
- **Currier 2023** (BJSM network MA) — **HIGH**: HM2 (heavy, multiset, 2×/wk) top-3 for
  both strength and hypertrophy. Supports a low-volume, heavy, multiset shape as the
  defensible minimalist anchor.
- **Baz-Valle 2022** (weekly-set dose-response) — **MODERATE**: 10–20 sets/muscle/wk
  productive; >20 diminishing. Bounds the **High** end at +1 item / +1 set.
- **Schoenfeld 2017** (Sports Med 47) — **MODERATE**: trained MEV ≈ 10 sets/muscle/wk;
  anchors `DEFAULT_MUSCLE_TARGET` and the Low floor.

All magnitudes are **CP-1 `[DEF→cal]` Stage-A heuristics** — to be revalidated against
real `accessory_volume` × outcome data, alongside the wellness-scale and ADR 0016
follow-ups.

## Implementation contract (to build on approval)

1. **Config module.** New `accessory-volume.ts`: `AccessoryVolumeLevel = "low" | "medium"
   | "high"`, `resolveAccessoryVolumeLevel` (unknown → `medium`), and
   `accessoryVolumeTilt(level): { itemsPerSessionDelta, setsPerItemDelta }`. All
   magnitudes here, tagged CP-1.
2. **Compose at the assembler.** In `assemble-prescription.ts`, add the level tilt to the
   existing secondary-focus tilt before the `itemsPerSession`/`setsPerItem` are resolved
   (lines ~375/464). Floor items ≥ archetype base-or-0 and sets ≥ 2. Functional +
   durability fills untouched.
3. **Retire the ADR 0016 volume axis.** Remove `hypertrophyAccessorySetsPerItem`; its
   effect is absorbed here. `effort_preference` now drives the effort axis only.
4. **Storage + threading.** Per-block `accessory_volume` (migration on `training_blocks`,
   `NOT NULL DEFAULT 'medium'`, CHECK `('low','medium','high')`); captured in the
   block-creation input (Zod `.strict()`), read + threaded by `actions.ts` like
   `effort_preference`, baked into the materialised prescription. Optional
   `profiles.accessory_volume_default` to pre-fill the wizard.
5. **UI.** A three-way "Accessory volume: Low / Medium / High" control in the BlockWizard
   (and ArchetypePicker), with the tooltip copy above. Effort knob unchanged.
6. **Regression guard (CRITICAL).** New `accessory-volume-level.test.ts`:
   `medium` is byte-identical to the no-tilt default across **all** archetypes (golden
   master); the level tilt composes additively with the secondary-focus tilt; `low` never
   drives items < 0 or sets < 2; functional + durability fills are identical across all
   three levels (durability floor preserved); main-lift and cardio prescriptions are
   byte-identical across all three levels. ADR 0011/0015/0016/0020/0022 tests stay green.

## Out of scope

- **2-day frequency unlock** (adding `2` to `FREQ_OPTIONS` + an archetype that folds to 2
  strength days) — a separate, optional follow-up for the pure 2-total-days user.
- **Antagonist-superset accessories** (engine review #4) — the time-efficiency lever; later.
- Re-tuning the underlying landmark numbers (`LANDMARKS` / `DEFAULT_MUSCLE_TARGET`).
- Retroactive edit of already-materialised blocks (bake-at-creation only).

## Addendum (2026-06-03) — live time estimates + engine recommendation, always-visible control

Three UX gaps surfaced after the initial ship. This addendum extends the same
lever — no new engine behaviour, no new constant — purely additive preview + UI.

### Decisions

1. **The control is shown on every priority combination.** The original ship
   hid the control on archetypes whose accessory base is at its floor (cardio-led
   / rebuild / maintenance) to avoid a dead knob. That made users ask "why is it
   missing here?". The control now renders everywhere. Its *meaningfulness* is
   derived from the archetype's own aesthetic accessory base
   (`accessoryVolumeApplicability` reads `ARCHETYPES[id].accessoryProfile`):
   base ≥ 2 → three distinct levels; base == 1 (endurance / rebuild) → Low ==
   Medium (floored), only High adds, shown with an honest note; base == 0
   (maintenance) → fully inert → control rendered **disabled** with an
   explanation. This reads applicability from the single source of truth that
   also drives the engine floor, so the UI can never drift from real behaviour.

2. **An engine-recommended level is pre-selected, with a one-line reason.**
   `recommendedAccessoryVolume({archetypeId, secondary})` returns `{level, reason}`:
   strength_anchor → Medium, hypertrophy_anchor → High, concurrent_hybrid →
   Medium, endurance_anchor → Low, rebuild → Low; a `muscle` secondary bumps up
   one level (on base-1 archetypes it skips the inert Medium straight to High —
   the level that actually adds volume). Maintenance → no recommendation (null).
   The pre-select is **advisory**: a new `accessoryVolumeTouched` flag in the
   wizard reducer prevents `recommend-accessory-volume` from ever stomping a level
   the user picked, and `set-goal` / `set-secondary` reset the flag so a changed
   priority re-recommends.

3. **Each level shows a live ballpark time estimate.** A new read-only server
   action `estimateAccessoryVolumeMinutes` (`lib/planner/estimate-actions.ts`)
   prices a representative strength workout at Low / Medium / High by reusing the
   exact engine path — `assemblePrescriptionItems` (including the ADR 0020
   duration-governor trim that already bounds High) + `estimateSessionMinutes`
   (the same set-aware estimator the governor uses). Timing is **load-independent**
   in this model (per-set work ≈ constant; rest is per-kind, not %TM-scaled), so
   the action skips TM resolution, bodyweight-node hydration, cardio substitution
   and day placement, and synthesizes a representative main (+ secondary) lift —
   the set *counts* that drive duration come from the archetype week profile. It
   runs on a full (max `strengthVolumeScale`) week, on the first folded strength
   day, and returns `{applicable:false}` for pure-cardio shapes with no strength
   day. Auth + Zod `.strict()`; never touches a write path.

### Why this is zero engine-regression risk

No edits to `createBlock`, `assemblePrescriptionItems`, or any engine module. The
estimate is a separate read-only path; the DB/schema default for `accessory_volume`
stays `medium`, so the byte-identical guarantee from the original ship is
preserved. The wizard pre-selecting (and sending) a recommended level for **new**
blocks is an intended product change, not a regression — golden-master tests call
the engine directly, not the wizard. Threaded as a prop
(`estimateAccessoryVolumeAction`) through `page.tsx → PlanNewSwitch → BlockWizard
→ Step4Review`, mirroring the existing `saveDayPrefAction` pattern.

### Tests

`adr-0024-accessory-volume-recommendation.test.ts` pins: applicability bases per
archetype; disabled only on maintenance; `lowEqualsMedium` only on base-1
archetypes; `muscle` secondary bumps to High and never recommends an inert
Medium; null recommendation for maintenance. Full suite green.

## Addendum (2026-06-03) — tendon-floor guarantee + cross-archetype invariant

The Low/Medium/High lever raised a safety question: can trimming accessory volume
ever drop a generated week below the DC-O4 weekly connective-tissue floor
(heavy isometric, HSR, plyometric, 2x carry)? This addendum makes that floor an
explicit, enforced, offline-checkable invariant. No new calibrated constant
beyond a single heuristic reserve (CP-3).

### What was already true

The dynamic accessory picker fills the **durability floor FIRST** (before
functional / power / aesthetic), bounded by `maxItems` and accumulated across
the week via `weekAccessoryHistory`. The Low/Med/High lever only ever trims the
**aesthetic** section, so it structurally cannot touch the floor. A full-matrix
gap map (every archetype x frequency x level x week x {experienced, beginner})
confirmed the floor is met EVERYWHERE for experienced users. The single measured
gap was **beginner/novice onboarding-ramp weeks 0-1 on maintenance freq=4**: the
ramp scaled the per-session budget down far enough that the 2nd weekly carry
could not be seated.

### The fix — protect the floor reserve from the onboarding ramp

`assemble-prescription.ts` now passes the picker **two caps** instead of one:

- `maxItems` (total ceiling) = `ramp x (aesthetic.itemsPerSession + itemBonus)`
  `+ FLOOR_FUNCTIONAL_RESERVE`. The reserve is held **outside** the ramp, so
  beginner ramp weeks keep the floor/functional headroom the ramp used to steal.
- `aestheticMaxItems` (aesthetic-only cap) = the **original** fully-ramped budget
  `ramp x (aesthetic.itemsPerSession + itemBonus + FLOOR_FUNCTIONAL_RESERVE)`.
  This bounds the hypertrophy gap-fill section alone, so the unramped reserve can
  **never leak into extra aesthetic volume** for a beginner.

At `ramp = 1.0` (every non-beginner call site) both caps equal the previous
`itemsPerSession + 4 + itemBonus`, so output is **byte-identical** — the
golden-master suite passes unchanged. Only beginner/novice block weeks 0–2 can
change, and only by gaining protected floor/functional fills (the aesthetic
budget stays at its original ramped value, verified byte-identical by the
existing beginner golden snapshot).

`FLOOR_FUNCTIONAL_RESERVE = 4` (`accessory-roles.ts`) is a tuned heuristic
(CP-3), not sized from first principles — resizing it would shift experienced
prescriptions and is out of scope.

### The invariant — `tendon-floor.ts` + `tendon-floor.test.ts`

A pure, DB-free module exposes:

- `contextualFloor({ tendinopathyActive, experience })` — the floor a context can
  honestly be held to. Plyometrics are suppressed for active tendinopathy AND for
  beginner/novice tiers (the picker's experience band drops high-skill plyo), so
  the floor's plyo line drops to zero in those contexts. Isometric / HSR / carry
  are universal.
- `countFloorRoles(items, roleBySlug)` — tallies bulletproof roles from a
  materialised week's accessory + tendon items (mirrors the runtime
  `getCurrentWeekTissueStackGaps` query, offline).
- `checkTendonFloor(count, floor)` — met/deficits, merging plyo low+high against
  `FLOOR_PLYOMETRIC_TOTAL`.

`tendon-floor.test.ts` drives the **production** week path (`foldDualMainLifts` →
`assemblePrescriptionItems` with a shared week history) for every archetype ×
frequency × Low/Med/High × week across three contexts — experienced, beginner
ramp, tendinopathy active — and asserts the contextual floor is met every week.
This locks the guarantee so the volume lever (or any future engine change) can
never silently regress below it.

### Honest residual — equipment-impossible floors

Enforcement cannot conjure a movement the catalog/equipment filter removed (e.g.
a bodyweight-only user with no loaded-carry option). Those cases are the
deliberate non-goal: they remain covered by the existing runtime disclosure
`getCurrentWeekTissueStackGaps` (the tissue-stack warning surface), not by the
generator. The invariant therefore runs against a full catalog — it protects the
engine's ordering/budget logic, which is the only thing the engine controls.
