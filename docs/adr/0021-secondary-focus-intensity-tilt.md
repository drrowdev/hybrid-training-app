# ADR 0021 — Intensity-direction secondary focus (main-lift intensity tilt)

- **Status:** Proposed (design only — no engine code in this ADR).
  **Parameters resolved with the user 2026-06-01** (see "Resolved parameters").
- **Date:** 2026-06-01
- **Extends:** ADR 0020 (secondary focus as a first-class engine input). ADR
  0020 shipped the **volume-direction** half (a `muscle` secondary tilts
  accessory volume); this ADR designs the **intensity-direction** half (a
  `strength` secondary), which ADR 0020 explicitly deferred to a follow-up
  ADR. Related: ADR 0004 (dual-main-lift), ADR 0007 (AMRAP top set), ADR 0011
  (hypertrophy effort anchor), ADR 0016 (effort/volume dial).

## Context

ADR 0020 made the wizard's secondary focus a real engine input, but only for
the **volume-direction** combination — a `muscle` secondary on a
strength/cardio primary, expressed as `+1 set / +1 accessory item` on the
existing accessory budget, trimmed by a session-duration governor. Its scope
matrix marked four combinations ⚠️ **intensity-direction** and deferred them:

| Primary | Secondary | Archetype | v1 (ADR 0020) | This ADR |
|---------|-----------|-----------|---------------|----------|
| Muscle  | Strength  | `hypertrophy_anchor` | **inert** (engine no-op; preview still shows a phantom standalone heavy "Strength day") | **in scope** (engine load tilt) |
| Cardio  | Strength  | `endurance_anchor`   | **inert** (engine no-op; preview already inlines "Heavy maintenance lift" meta) | **honest by construction** — no load tilt (Resolved param 3) |
| Strength | Muscle   | `strength_anchor`    | shipped (volume tilt + preview reconciled, PR #236/#237) | — |
| Cardio  | Muscle    | `endurance_anchor`   | shipped (volume tilt) | — |

Everything else either flips the archetype and is honest as-is (`X + Cardio →
concurrent_hybrid`, the maintenance shortcut), or has no secondary (resilience).

**Why volume can't express "more strength."** Hypertrophy is "more sets in the
8–15 band," which maps cleanly onto the `aesthetic.setsPerItem` /
`itemsPerSession` accessory knob ADR 0020 uses. Strength is the opposite
channel: **heavier load, fewer reps, a true top set** on the *main lift* —
load-driven, not volume-driven (ACSM/Ratamess 2009; Schoenfeld–Grgic 2017 load
meta; Lopez 2021). There is no accessory-volume manipulation that produces a
maximal-strength stimulus, so the intensity-direction rows need a different
knob, on a different item (the main lift, not the accessory pool).

**Where intensity lives in the engine today.** Main-lift intensity is the
per-week `WeekProfile` on each archetype (`archetypes.ts`):
`setIntensities: number[]` (%TM per set) + `setReps: number | number[]` +
`intensityLabel`. The signature top sets per archetype:

- `strength_anchor` — wave to **0.95 ×TM**, reps `5 → 3 → [5,3,1]` (true peak).
- `concurrent_hybrid` — capped at **≤ 0.85 ×TM** (protects cardio).
- `hypertrophy_anchor` — peak **0.75 ×TM**, 6–10 reps, final set RIR 1–2.
- `endurance_anchor` — maintenance lift **0.75–0.90 ×TM**, reps `[5,3,3]`.

So the intensity tilt is a **bounded upward nudge to the main lift's
`setIntensities` top end (and a rep cap on the top set)**, applied *within* the
primary archetype's identity — the intensity analogue of ADR 0020's
accessory-volume tilt.

## Decision

**Express a `strength` secondary as a bounded main-lift intensity tilt: raise
the top-set %TM by a small fixed delta and cap the top-set reps toward a true
top set, threaded into prescription assembly exactly the way ADR 0020's volume
tilt and ADR 0016's effort dial already are — and clamped by an
archetype-identity ceiling so the block never crosses into the next-heavier
archetype.**

The secondary tilts the program *toward* strength; it does not convert it. A
`muscle` primary with a `strength` secondary is still a hypertrophy block — with
a heavier top set — not a strength block.

### Mechanism (intensity-direction rows)

Introduce a sibling resolver to ADR 0020's `secondaryVolumeTilt`:

```
secondaryIntensityTilt(primaryArchetypeId, secondary) -> {
  topSetPctDelta: number;   // added to the top set of each weekProfile, clamped
  topSetRepCap:   number | null; // final-set rep ceiling (toward a true top set)
}
```

Returns the identity (`{ 0, null }`) for everything except a `strength`
secondary on `hypertrophy_anchor` (the **only** load-tilted combo — see
Resolved param 3 for why `endurance_anchor` is excluded), so callers apply it
unconditionally (byte-identical no-op everywhere else).

Application, per non-deload `WeekProfile` of the main lift:

- **Top-set load:** `topPct' = min(topPct + topSetPctDelta, identityCeiling)`.
  Only the **heaviest set** of the wave moves; earlier ramp sets are untouched,
  preserving accumulated volume.
- **Top-set reps:** if `topSetRepCap` is set, clamp the final set's reps down to
  it (e.g. a hypertrophy `8` → `5`), making the heavier set a genuine strength
  set rather than a near-failure hypertrophy set.
- **Volume preserved:** the tilt modifies the **existing** top set in place
  (load up, reps down) — it adds **no set**, so it is duration-neutral and
  total hard-set count per muscle is unchanged. For a `muscle`-*primary* block
  hypertrophy volume is the whole point, so no set is ever removed (the heavier
  top set is still a high-tension hypertrophy-effective set; Schoenfeld 2017).
  Resolved param 2.
- **Deload weeks untouched** (`intensityLabel === "Deload"`), same carve-out the
  taper/effort systems already respect.

The **archetype-identity ceiling** is the governing constraint — the intensity
analogue of ADR 0020's duration governor:

| Archetype | Today's top set | Tilted ceiling (proposed) | Rationale |
|-----------|-----------------|---------------------------|-----------|
| `hypertrophy_anchor` | 0.75 | **≤ 0.825** | Strictly below `concurrent_hybrid`'s 0.85 and far below `strength_anchor`'s 0.95 — recognisably still a hypertrophy block. Heavy enough (~0.80–0.825 ≈ 82–84% of true 1RM at TM 0.90) to bias strength (ACSM 2009: ≥80% 1RM region for strength) while volume holds hypertrophy (Schoenfeld 2017: hypertrophy preserved across loads at equal effort). |
| `endurance_anchor` | 0.75–0.90 | **no load tilt** | The maintenance lift already tops out at `0.90 ×TM` triples by default, and those lift days only exist when the secondary is `strength`/`muscle` (Cardio+Skip is pure cardio). The strength quality is therefore already expressed — as the *presence* of heavy lift days — at the ceiling the concurrent-compatibility window allows. Pushing past 0.90 toward strength territory breaches the archetype's aerobic-protection mandate (interference effect, Wilson 2012) for negligible headroom. Resolved param 3. |

This keeps CP-4 intact: the tilt adjusts the *base* weekProfile **before** the
existing concurrent/taper scalar chain runs, so it adds no new multiplier to
that chain.

### Composition with the volume tilt and effort dial

- **Volume tilt (ADR 0020) and intensity tilt are mutually exclusive within a
  block.** The secondary is a single choice — a block is *either* `+muscle`
  (volume) *or* `+strength` (intensity), never both — so the two never compose.
- **Effort dial (ADR 0016)** is hypertrophy-archetype-only and acts on the
  **accessory** set count (volume channel). The intensity tilt acts on the
  **main-lift** top set (intensity channel). Different items, different fields —
  they compose without interaction. A `hypertrophy_anchor` block can carry a
  non-standard effort dial *and* a strength secondary; the effort dial sets
  accessory volume, the intensity tilt sets the main-lift top set, independently.

### Wiring (the threading already exists)

ADR 0020 / PR #236 already did the hard threading: `secondaryFocus` is on
`createBlockSchema`, sent from `BlockWizard.tsx`, resolved via
`resolveSecondaryFocus`, persisted on `training_blocks` (migration 0082), and
passed to `assemblePrescriptionItems`. This ADR adds **only**:

1. The `secondaryIntensityTilt` resolver (new, in `secondary-focus.ts`).
2. Apply it where the main-lift `WeekProfile` is expanded into prescription
   items (`archetypes.ts` `buildPrescription` main-lift path — the
   `setIntensities`/`setReps` → `percentTm`/reps expansion), gated on the
   resolved secondary. Default `"none"` → no-op, preserving every call site.
3. Both materialisation sites (`createBlock`, `createCustomBlock`) already pass
   `secondaryFocus`; no new plumbing.

**No new migration** — the `secondary_focus` column already exists (0082).

### Preview reconciliation (closes the remaining phantom)

- **Muscle + Strength (`hypertrophy_anchor`):** `buildWeekShape` must **stop
  emitting the standalone heavy "Strength day"** (`schedule.ts` hypertrophy_anchor
  branch). The honest render is all hypertrophy days with a **"heavier top set"
  tilt badge / sub-label** — mirroring how PR #237 rendered Strength+Muscle.
  Add an `intensityEmphasis: "strength" | null` flag to `ResolvedArchetype`
  (sibling of PR #237's `accessoryEmphasis`) and have `resolveArchetype` set
  `sessions = { hypertrophy: effective }` (no phantom strength day) + the flag;
  `WizardSidebar.formatSessions` and `Step4Review` read it.
- **Cardio + Strength (`endurance_anchor`):** the preview already inlines a
  "Heavy maintenance lift" meta (no phantom standalone day), so only the copy
  needs to match the tilted output; no structural change.

## Constants (CP-2 additions, all CP-1 [DEF→cal] Stage-A heuristics)

To be added to `docs/knowledge/hybrid-training-design-constraints.md` **and**
the Clawpilot workspace mirror when code lands:

| Const | Proposed | Meaning | Citation / tag |
|-------|----------|---------|----------------|
| `SECONDARY_STRENGTH_TOPSET_PCT_DELTA` | `+0.05` | added to the top-set %TM of each non-deload main-lift week when a `strength` secondary is active | `// heuristic, no calibration data` — direction per ACSM/Ratamess 2009 (≥80% 1RM for maximal strength, HIGH); Lopez 2021 load–strength dose response (HIGH) |
| `SECONDARY_STRENGTH_TOPSET_REP_CAP` | `5` | final-set rep ceiling under a `strength` secondary (true top set vs near-failure hypertrophy set) | `// heuristic, no calibration data` — heavy-low-rep strength region, Schoenfeld–Grgic 2017 (HIGH) |
| `STRENGTH_TILT_CEILING_HYPERTROPHY` | `0.825` | identity ceiling: tilted top set on `hypertrophy_anchor` stays strictly below concurrent's 0.85 | `// product rule` — archetype-identity invariant (see below) |

Magnitudes are intentionally small (one notch of load, a rep cap) — the
conservative first step, tunable once we have logged top-set load data.
Hypertrophy preservation rests on **volume being held constant** (Schoenfeld
2017): the tilt adds load, it does not remove sets (default; see Open
parameter 2).

### Calibration plan (CP-1)

- **Validation signal:** logged top-set load progression on the main lifts for
  tilted blocks (are users actually completing the heavier top set?), plus
  hypertrophy-volume retention (accessory + main working sets unchanged) and
  adherence delta vs. the same primary with `secondary=skip`.
- **Rollback threshold:** if heavier top sets are routinely missed (AMRAP/load
  shortfall) or adherence drops, walk `SECONDARY_STRENGTH_TOPSET_PCT_DELTA`
  toward `0`; if duration becomes the problem, switch to the volume-traded
  variant (volume-traded — explicitly rejected as the default per Resolved
  param 2, but available as a rollback lever if real duration data demands it).
- Until data exists, the delta stays `+0.05` clamped by the identity ceiling and
  is surfaced honestly as heuristic.

## Invariants / regression guards (non-negotiable)

1. **`secondary=skip`/`none` is a byte-identical no-op** for every archetype
   (same golden-master guarantee ADR 0016 `"standard"` and ADR 0020 `"none"`
   carry). The ADR 0020 no-op golden-master test extends to assert the intensity
   tilt is also inert for `"none"`.
2. **Archetype-identity invariant (new):** a tilted top set is **strictly below
   the next-heavier archetype's signature top set** — `hypertrophy_anchor`
   tilted < 0.85 (`concurrent_hybrid`) < 0.95 (`strength_anchor`). A cross-
   archetype test asserts the ceiling holds at every week and frequency.
3. **`buildPrescription` / muscle-targets parity** for users not opting in — no
   shared-path drift.
4. **Volume preserved (hypertrophy maintained):** the tilt changes load/reps on
   the top set only; total working-set count per muscle is unchanged (default
   variant). Guards the hypertrophy claim.
5. **No taper / readiness interaction:** the tilt is a generation-time base
   adjustment applied before the taper and concurrent scalars; deload weeks are
   exempt. It is never a stats/readiness feedback loop.
6. **Hybrid completion guard parity** — the tilt does not change which days
   count as strength; `sessionPrescribesStrength` stays the single source of
   truth.
7. RLS posture unchanged (fields already shipped in ADR 0020): Zod `.strict()`
   off on `createBlockSchema` as today, ownership check, user-scoped client.

## Resolved parameters (with user, 2026-06-01)

1. **Top-set load delta: `+0.05 ×TM`** (locked). Lands `hypertrophy_anchor`'s
   0.75 peak at ~0.80 — the ≥80%-1RM strength region (ACSM/Ratamess 2009;
   Lopez 2021), clamped by the 0.825 identity ceiling.
2. **Volume-preserved** (locked, high confidence). The tilt modifies the
   existing top set in place and adds **no set**, so it is duration-neutral and
   hard-set count per muscle is unchanged; hypertrophy volume — the primary goal
   of a `muscle`-primary block — is fully retained (Schoenfeld 2017: equal-effort
   sets are hypertrophy-effective across the load range, so a heavier top set
   loses no growth stimulus). Volume-*trading* (deleting a set) was rejected: it
   would sacrifice the primary goal for a duration problem that does not exist.
3. **No load tilt on `endurance_anchor`** (locked, high confidence). The engine
   intensity tilt is scoped to `hypertrophy_anchor` **only**. The maintenance
   lift already runs `0.90 ×TM` triples, and those lift days exist *only* when
   the secondary is `strength`/`muscle` (Cardio+Skip = pure cardio, zero
   lifting) — so Cardio+Strength is already meaningful and honest vs Skip
   without any added load. Pushing past 0.90 toward strength territory would
   breach the archetype's aerobic-protection mandate (interference effect,
   Wilson 2012 meta) for negligible headroom. `endurance_anchor` needs
   preview-copy honesty only (already inlined), no engine change.
4. **No duration governor** (locked). The in-place tilt is duration-neutral
   (heavier load, equal-or-fewer reps, no added set); the identity ceiling + rep
   cap are sufficient bounds. ADR 0020's session-duration governor is not reused.

## Out of scope

- **Back-off main-lift volume** as a *second* hypertrophy channel — still
  deferred (ADR 0020 v2 note), independent of this ADR.
- **Per-session style field (Design B)** — still deferred indefinitely
  (ADR 0020 Context).
- Any change to the volume-direction combos already shipped.

## Phasing

- **This ADR (0021):** intensity load tilt for `hypertrophy_anchor` +
  `strength` secondary **only** (the user's analogue of the case that started
  ADR 0020); no-op golden-master + identity-ceiling guards; preview
  reconciliation for the remaining phantom standalone "Strength day".
  `endurance_anchor` + `strength` is resolved as honest-by-construction (no
  engine change, copy only — Resolved param 3).
- **Later:** back-off main-lift volume channel; per-combo calibration of the
  delta and ceiling against logged load data.
