# ADR 0020 — Secondary focus as a first-class engine input (volume tilt)

- **Status:** Proposed (design only — no engine code in this ADR). Parameters
  resolved with the user 2026-06-01 (see "Resolved parameters").
- **Date:** 2026-06-01
- **Supersedes / extends:** ADR 0016 (effort/volume dial), generalises its
  aesthetic-volume modulation pattern. Related: ADR 0004 (dual-main-lift),
  ADR 0006 (balance / folding), ADR 0011 (hypertrophy effort anchor),
  ADR 0015 (hypertrophy early-set bump).

## Context

The block wizard asks the user for a **primary goal** ("Build strength",
"Build muscle", "Build endurance", …) and an optional **secondary focus**
("Also build muscle", "Also build strength", "Also build endurance",
"Skip"). The wizard preview renders a week that visibly reflects the
secondary choice (e.g. Strength primary + Build-muscle secondary previews
`MON Strength / WED Hypertrophy / FRI Strength`).

**The secondary focus is structurally inert at the engine.** It is read by
the preview layer (`wizard-mapping.ts` → `buildWeekShape`) but is **dropped
at submission** — `createBlockSchema` (`actions.ts`) accepts only
`archetype, startedOn, daysPerWeek, dayIndexOverrides, powerEmphasis,
cardioSource, cardioSourceName, focusMuscles`. There is no `goal` or
`secondary` field. The block that materialises is a pure function of the
archetype the wizard *resolved* (`resolveArchetype`) and the day count.

Consequences proven during recon (June 2026):

1. **Preview ≠ block.** For Strength + Build-muscle, 3 days, the wizard
   previews `2 strength + 1 hypertrophy, 0 cardio`; the materialised block
   is `2 strength + 1 cardio, 0 hypertrophy`. The hypertrophy day the user
   explicitly placed is silently replaced by a cardio day (the archetype's
   ranked optional). Across the 228 reachable wizard configs, **119 (52%)
   under-cover a day-kind** the preview promised.
2. **Secondary is a no-op for every same-modality combo.** `secondary=muscle`
   and `secondary=skip` materialise **byte-identical** blocks for a strength
   primary. The "Build muscle" card copy ("Add visible size where you want
   it — shoulders, arms, calves") describes behaviour the engine never
   delivers. This is not specific to one combo; it is the general case
   wherever the secondary does **not** flip the resolved archetype.

The user's expectation is the self-evident one: **what the preview shows is
the block that gets built**, and a secondary focus should make the engine
build a balanced program toward that secondary — exactly as a primary focus
does — not merely relabel a sidebar.

### Why not "just make the preview honest" (drop the hypertrophy day)?

That achieves preview==block by deleting the feature the user asked for. The
user explicitly rejected this: the secondary focus must be a **real engine
input**, not cosmetic. So the fix runs the other direction — teach the
engine to honour the secondary — and then reconcile the preview to the new,
honest output.

### Why not a per-session "hypertrophy day kind" (Design B)?

There is no hypertrophy day **kind**. `DayTemplate = StrengthDay | CardioDay
| TendonDay`. Programming *style* (heavy vs hypertrophy) is **archetype-wide**
via `weekProfiles` (set intensities / reps / effort anchor), not a per-day
field. `StrengthDay` carries no per-day intensity or style knob. A genuine
per-session style would require a new day-level style field threaded through
folding, placement, assembly, the wizard, and every golden-master — a deep,
high-regression-risk change. Deferred (see Out of scope).

## Decision

**Express secondary focus as a bounded volume/intensity *tilt* applied within
the primary archetype's identity, threaded into the prescription assembler
exactly the way ADR 0016's effort dial already is.** The secondary does not
swap a session, does not change the resolved archetype, and does not invent a
new day kind. It modulates how much accessory/secondary work the existing
days carry, biased toward the secondary goal.

This is deliberately the **same mechanism ADR 0016 already ships**:
`assemble-prescription.ts` already rebuilds `archetype.accessoryProfile.
aesthetic.setsPerItem` from a threaded user signal (`effortPreference`) for
the hypertrophy archetype, via `hypertrophyAccessorySetsPerItem(pref, base)`
(±1 set/item, clamped, CP-1 tagged, cited). Design A generalises that exact
pattern to a **second threaded signal — the secondary focus — applied to the
*primary* archetype**.

### The (primary, secondary) tilt matrix

`resolveArchetype` already handles secondaries that *change modality* by
switching the archetype outright; those are honest today and need no tilt
(only preview reconciliation). The tilt targets the combos where the
secondary currently evaporates:

| Primary  | Secondary | Resolved archetype   | Today | Tilt (this ADR)                                                   | Direction |
|----------|-----------|----------------------|-------|------------------------------------------------------------------|-----------|
| Strength | Muscle    | `strength_anchor`    | inert | **+ hypertrophy accessory volume** (aesthetic sets/items ↑)       | volume ✅ |
| Strength | Skip/—    | `strength_anchor`    | base  | **no-op (must stay byte-identical to today)**                    | —        |
| Muscle   | Strength  | `hypertrophy_anchor` | inert | bounded main-lift intensity emphasis (heavier top set / lower RIR)| intensity ⚠️ |
| Muscle   | Skip/—    | `hypertrophy_anchor` | base  | no-op                                                            | —        |
| Cardio   | Muscle    | `endurance_anchor`   | inert | + accessory volume on the maintenance lift days                  | volume ✅ |
| Cardio   | Strength  | `endurance_anchor`   | inert | heavier maintenance-lift dose (intensity)                        | intensity ⚠️ |
| Strength | Cardio    | `concurrent_hybrid`  | honest (archetype flips) | preview reconcile only            | —        |
| Muscle   | Cardio    | `concurrent_hybrid`  | honest (archetype flips) | preview reconcile only            | —        |
| any      | Maintenance | `maintenance`      | honest (archetype flips) | preview reconcile only            | —        |
| Resilience | (any)   | `rebuild`            | secondary ignored by design | preview reconcile only        | —        |

**Honest split.** Design A (volume tilt) is a *clean* fit for
**volume-direction** secondaries (Muscle on a strength/cardio primary): more
hypertrophy is straightforwardly "more sets in the 8–15 band," which is
precisely the `aesthetic.setsPerItem` / `itemsPerSession` knob. It is **not**
a clean fit for **intensity-direction** secondaries (Strength on a
hypertrophy/cardio primary): "more strength" is heavier load / lower reps /
a true top set, which cannot be expressed as accessory volume. Those rows are
marked ⚠️ and get a *different* (intensity) knob — or, pragmatically, are
deferred (see phasing).

### Mechanism (volume-direction rows)

Mirror `hypertrophyAccessorySetsPerItem`. Introduce a sibling resolver
`secondaryVolumeTilt(primaryArchetypeId, secondaryFocus)` returning a
modifier over the primary archetype's `accessoryProfile.aesthetic`:

- **`setsPerItem += SECONDARY_HYPERTROPHY_SET_DELTA`** (proposed `+1`,
  clamped ≥1) — each chosen aesthetic accessory carries one extra working set.
- **`itemsPerSession += SECONDARY_HYPERTROPHY_ITEM_DELTA`** (proposed `+1`)
  on strength-primary days — one more aesthetic movement gets picked, lifting
  a heavy-strength day toward a strength+hypertrophy day without removing the
  main-lift work the user came for.
- Movement **selection** rules (durability → functional → muscle-gap →
  aesthetic priority, dedup, focus-muscle bias, equipment filter) are
  **untouched** — only the aesthetic budget moves, exactly as ADR 0016 does.

**Hypertrophy back-off sets** on the main lift (via the existing
`kind: "back_off"` concept, `assemble-prescription.ts:63`) are a second volume
channel — **deferred to v2** (resolved with user). v1 is accessory-budget tilt
only, which is sufficient to make Strength+Muscle visibly hypertrophy-biased.

### Session-duration budget (governing constraint)

The tilt is **not** an unconditional fixed bump. The user's gym-session time
budget governs it:

- **Target ≈ 60 min**, **hard ceiling 75 min**, **varying by primary+secondary**.
  A user who opts into a volume secondary has signalled willingness to do more
  work, so volume-secondary combos may target the upper part of the band; a
  plain primary stays nearer 60.
- **The tilt is applied, then trimmed to fit.** Algorithm: start from the
  fuller bump (`+1 set/item` and `+1 aesthetic item`), estimate the session
  duration, and if it exceeds the combo's target, walk the bump back (drop the
  extra item first, then the extra set) until the estimate is ≤ target, never
  exceeding the 75-min hard ceiling. This makes the tilt **self-limiting**
  across every frequency and two-a-day configuration instead of trusting a
  fixed delta to happen to fit.

**This requires a set-aware duration estimator the engine does not yet have.**
The current `estimateDurationMin` (in the plan/preview page, not a lib) is
`strengthCount × 5 min` flat per item — **set-count-blind**, so it would price
the "+1 set/item" tilt at zero added minutes and cannot police a budget. v1
introduces a shared `lib/sessions/estimate-duration.ts` (or `lib/planner/`)
that sums, per prescription item, `sets × (workSecPerSet + restSecForKind)`
plus cardio `durationMinutes`, reusing the canonical `restSecondsForKind`
table (`main 180s`, `back_off 120s`, `accessory 90s`, `warmup 60s`,
`tendon 120s`, `cardio 0`). The crude preview heuristic is replaced by this
shared function so **the duration the planner budgets against and the duration
the preview displays are the same number**. `workSecPerSet` is a small CP-1
heuristic (see constants).

### Wiring

Follow the `effortPreference` precedent end-to-end:

1. **Schema/threading.** Add `secondaryFocus` (and `goal`, for provenance) to
   `createBlockSchema` with Zod `.strict()`. `BlockWizard.tsx` submit already
   computes both; send them instead of discarding. Resolve to a typed enum
   with an unknown→"none" collapse (the byte-identical default), exactly like
   `resolveEffortPreference`.
2. **Assembler.** Add a `secondaryFocus` parameter to
   `assemblePrescriptionItems` (default `"none"` → no-op, preserving every
   existing call site). In the dynamic-picker branch, fold the
   `secondaryVolumeTilt` modifier into the `pickerProfile` it already
   constructs — the same code path ADR 0016 uses for the effort dial. Both
   materialisation sites (`createBlock` ~`actions.ts:956`, `createCustomBlock`
   ~`actions.ts:1417`) pass the resolved value.
3. **Composition with the effort dial.** When both apply (hypertrophy archetype,
   non-standard effort, *and* a volume secondary) the two set-deltas compose
   additively, then clamp. The composed bump is bounded by `itemsPerSession`
   and the picker's `maxItems`, so it cannot run away.

### Persistence

The full prescription is baked into `planned_sessions` rows at creation, so
the tilt does **not** need to persist to re-render correctly. **Decision:
persist `goal` and `secondary_focus` on `training_blocks` anyway** (migration
`packages/db/drizzle/0080`) — for provenance/observability, for an honest
"why does this block look like this" trace, and to allow a future
re-materialisation path to reproduce it. This mirrors how `power_emphasis` is
persisted on the block. Columns nullable; null = legacy/skip = no tilt.

### Preview reconciliation

Once the engine honours the secondary, reconcile the preview so **preview ==
block**:

- `buildWeekShape` must stop emitting a phantom standalone "Hypertrophy day"
  for Strength+Muscle. The honest render is the *real* week (e.g. `2 strength
  (hypertrophy-tilted) + 1 cardio` for `strength_anchor`@3), with the
  hypertrophy contribution shown as a **tilt badge / sub-label on the strength
  days**, not a separate session.
- The verbatim "Hypertrophy" sidebar token that promises a session is
  removed; the tile copy explains the secondary as added volume on the
  existing days. This closes the 52%-under-cover gap by construction: the
  preview is derived from (or asserted against) the same resolved archetype +
  tilt the engine will use.

## Constants (CP-2 additions, all CP-1 [DEF→cal] Stage-A heuristics)

To be added to `docs/knowledge/hybrid-training-design-constraints.md` **and**
the Clawpilot workspace mirror when code lands:

| Const | Proposed | Meaning | Citation / tag |
|-------|----------|---------|----------------|
| `SECONDARY_HYPERTROPHY_SET_DELTA`  | `+1` | extra working sets per chosen aesthetic accessory when a hypertrophy secondary is active (the *fuller bump*, resolved with user) | `// heuristic, no calibration data` — direction per Schoenfeld 2021 (dose-response: more weekly sets → more hypertrophy, HIGH) |
| `SECONDARY_HYPERTROPHY_ITEM_DELTA` | `+1` | extra aesthetic movement slots/session on a strength-primary day (the *fuller bump*) | `// heuristic, no calibration data` — toward the 10–20 sets/muscle/week landmark, Baz-Valle 2022 (MED) |
| `WORK_SEC_PER_SET` | `~40` (strength/accessory) | per-set working-time estimate fed to the duration model; combined with `restSecondsForKind` | `// heuristic, no calibration data` — practitioner estimate; refine against logged set timestamps once available |
| `SESSION_TARGET_MIN` (per combo) | `60` base, up to `75` for volume-secondary combos | duration target the tilt is trimmed to fit; **75 is the hard ceiling for all combos** | user-set budget 2026-06-01; `// heuristic` magnitudes, ceiling is a product rule |

Indicative per-combo targets (heuristic, tune against real session logs):

| Combo | Target (min) | Notes |
|-------|--------------|-------|
| Strength + Skip | ~55–60 | baseline, no tilt |
| Strength + Muscle | ~70 (≤75) | fuller bump trimmed to fit |
| Cardio + Muscle | ~60 (≤75) | strength/maintenance days carry the accessory tilt; cardio minutes count toward budget |

Both satisfy CP-3 (>1 sig fig → tagged) trivially (they are `1`), CP-1
(labelled validation plan + rollback below), and CP-4 (the ceiling chain
stays two factors — the tilt is applied *before* the existing scalar chain,
not as a third multiplier). Magnitudes are intentionally small (one set, one
item) — the conservative first step, tunable up once data exists.

### Calibration plan (CP-1)

- **Validation signal:** the **session-duration budget is now the primary
  signal** — compare estimated vs. *actually logged* session duration (we have
  logged set timestamps via `actual-session-load.ts`) for tilted blocks, plus
  adherence delta vs. Strength+Skip blocks.
- **Rollback threshold:** if logged duration on tilted blocks routinely
  exceeds 75 min (estimator under-counts), tighten `WORK_SEC_PER_SET` or the
  per-combo target; if adherence drops materially, walk the deltas toward `0`.
- Until data exists, deltas stay at `+1/+1` trimmed by the duration governor,
  and are surfaced honestly as heuristic.

## Invariants / regression guards (non-negotiable)

1. **`secondary=skip`/`none` is a byte-identical no-op.** Golden-master: for
   every archetype, a block built with `secondaryFocus="none"` equals today's
   output bit-for-bit (same guarantee ADR 0016's `"standard"` carries).
2. **`buildPrescription` / muscle-targets parity** for users not opting in —
   no shared-path drift.
3. **Cross-archetype "no lower-only week at any frequency ≥2"** still holds
   after the tilt (the tilt adds accessories; it must not strip a main lift).
4. **Hybrid completion guard parity** — the tilt does not change which days
   count as strength; `sessionPrescribesStrength` stays the single source of
   truth.
5. **Stats / prescription separation** — unchanged; this is a generation-time
   input, never a stats feedback loop.
6. RLS posture on the new `createBlock` fields: Zod `.strict()`, ownership
   check, user-scoped Supabase client.

## Out of scope (this ADR / first increment)

- **Intensity-direction secondaries** (Muscle+Strength, Cardio+Strength, the
  ⚠️ rows). They need a heavier-load / top-set knob, not accessory volume.
  Documented in the matrix; **deferred to a follow-up ADR** so the first PR
  stays low-risk and ships the case the user actually hit.
- **Per-session style field (Design B).** Deferred indefinitely; see Context.
- **Back-off main-lift sets** as a second volume channel — deferred to a v2
  increment after the accessory tilt is validated.

## Phasing

- **v1 (next PR, after this ADR is approved):** volume-direction tilt for
  **Strength + Muscle AND Cardio + Muscle** (resolved), governed by the
  session-duration budget. Deliverables: `secondaryVolumeTilt` resolver +
  threading; `+1/+1` fuller-bump constants; **set-aware shared duration
  estimator** (replacing the crude preview heuristic) + the trim-to-fit
  governor; persist `goal`/`secondary_focus` on `training_blocks`
  (migration 0080); golden-master no-op guard for `secondary=skip`; **preview
  reconciliation** for both combos.
- **v2:** intensity-direction secondaries (own ADR), back-off main-lift
  volume (deferred), remaining preview combos.

## Resolved parameters (with user, 2026-06-01)

1. **Tilt dose:** fuller bump — `+1 set/item` **and** `+1 extra aesthetic item`.
2. **Back-off main-lift sets:** deferred to v2.
3. **Persistence:** persist `goal` + `secondary_focus` on `training_blocks`
   (migration 0080).
4. **v1 scope:** both Strength+Muscle and Cardio+Muscle.
5. **Session-duration budget:** target ~60 min, hard ceiling 75 min, varying
   by combo; governs (trims) the tilt.

## Open question (one, before v1 code)

**Velocity vs. correctness on the duration governor.** Two ways to ship v1:

- **(A) Duration-governed tilt now (recommended).** Build the set-aware
  duration estimator + trim-to-fit governor in v1 so the 75-min ceiling is
  actually enforced from day one. More work, but it's the honest reading of
  "respect the time budget" and avoids shipping a tilt that could blow 75 min
  at high frequency / two-a-day.
- **(B) Fixed `+1/+1` now, governor as a fast-follow.** Ship the bump
  immediately and add the duration governor in a quick second PR. Faster to a
  visible fix, but the interim build can exceed 75 min for some combos —
  medium confidence it fits, which conflicts with the "no medium-confidence
  changes" rule.

Recommendation: **A** — the estimator is a contained addition (rest table +
set counts already exist) and the time budget is the whole point of getting
the dose right.
