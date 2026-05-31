# ADR 0016 — User effort/volume dial for the hypertrophy archetype

**Status:** Accepted
**Date:** 2026-05-31
**Phase:** Production (engine conservativeness review — Part-1 findings A + B)
**Relates to:** ADR 0011 (final-set RIR anchor), ADR 0015 (early-set effort bump — this dial scales both), ADR 0012 (accessory rotation — the picker the volume axis tunes)
**Touches:** `apps/web/src/lib/planner/effort-preference.ts` (new — the dial config), `apps/web/src/lib/planner/archetypes.ts` (`applyHypertrophyEffortAnchor` + `buildPrescription` signature), `apps/web/src/lib/planner/assemble-prescription.ts` (volume axis + threading), `apps/web/src/lib/planner/actions.ts` (profile read + thread), `packages/db/src/schema/profiles.ts` + migration `0080_profiles_effort_preference.sql` (storage), `apps/web/src/lib/settings/actions.ts` + settings UI (write surface)

## Context

The engine conservativeness review (see `plan` / engine-live §10) located two real
findings, both in the `HYPERTROPHY_ANCHOR` archetype:

- **Finding A — compound effort.** Early compound sets sat at ~RIR 6–10 (sub-stimulus).
  ADR 0015 shipped a *modest, honest* default bump and explicitly deferred the
  aggressive "true RIR 1–3 / more volume" path **to this dial**.
- **Finding B — accessory volume.** The per-session accessory budget
  (itemsPerSession 4 × setsPerItem 3 = 12 sets/session ≈ 3–4 sets/muscle) lands below
  the 10–12 effective-sets/muscle/week productive zone (Baz-Valle 2022).

The review's strategic framing — **HIGH inter-individual variability on both effort
tolerance and volume response, and ~0 rows of real training data** — concluded that
the right move is to **expose a user lever, not re-hardcode a single "better" default**
(which would just swap one Stage-A guess for another). This ADR is that lever.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | One control, two axes | A single `profiles.effort_preference` enum (`low \| standard \| high`) scales BOTH the compound **effort** axis and the accessory **volume** axis together. | A user thinking "how hard/high-volume should my muscle work be?" wants one knob, not two. Effort + volume co-vary in practice. |
| 2 | `standard` is the identity | `standard` reproduces the post-ADR-0015/0011 prescription **byte-for-byte**. | Zero-migration safety: every existing row defaults to `standard`; the golden master and all prior pins stay green. |
| 3 | Hypertrophy-only scope | The dial is a **no-op for every non-hypertrophy archetype** (both axes). | Findings A + B are hypertrophy-specific. A "high" lifter on a concurrent/endurance archetype must keep that archetype's concurrent-safe identity untouched. |
| 4 | Effort axis magnitudes | `low`: skip the early bump (revert to fixed reps) + final-set RIR **+1** (looser). `high`: early bump **+4 reps, cap 15** + a tighter cue + final-set RIR **−1**. | `high` is the deferred ADR-0015 aggressive path; `low` is for fatigue/endurance-heavy phases. |
| 5 | Never RIR 0 | The final-set RIR shift is **floored at 1** — `high` never prescribes training to failure on a compound. | Failure on a compound inside a concurrent block carries the highest fatigue / running-interference cost (Wilson 2012; ADR 0008 lineage). The dial buys effort, not failure. |
| 6 | Volume axis = sets-per-movement | `high`/`low` shift the hypertrophy aesthetic **`setsPerItem` by ±1** (floored at 1). Movement **selection is unchanged**. | Tuning sets-per-movement leaves the accessory picker's role / focus-muscle / dedup invariants entirely intact — the lowest-risk volume lever. `high` (4 sets/movement) pushes effective weekly volume toward the 10–12 zone. |
| 7 | Generation-time, bake-at-creation | The dial is read at `createBlock` / `createCustomBlock` and baked into the materialised prescription. A change takes effect on the **next** created block, never retro-editing an existing one. | Consistent with every other profile-driven generation input (`training_experience`, `equipment`, `warmup_scheme`, focus muscles). Steady-state preference, not a per-session/state overlay. |

## Effect table (hypertrophy archetype, non-deload)

| Axis | low | standard | high |
|---|---|---|---|
| Early compound reps | wave reps (no bump, no cue) | min(12, wave + 2) + cue | min(15, wave + 4) + tighter cue |
| Final-set RIR (W0/W1/W2) | 3 / 3 / 2 | 2 / 2 / 1 | 1 / 1 / 1 (floored) |
| Accessory `setsPerItem` | 2 | 3 | 4 |

Deload (W3) is a no-op on every axis for every setting.

## Rationale

The honest read is that we don't know the *right* effort/volume for an individual,
and the literature says the optimum varies widely between people. Rather than pick a
new universal default we can't justify, we ship a reversible, clearly-labelled
preference that defaults to today's concurrent-safe behaviour and lets the user move in
either direction. The magnitudes are deliberately small (±1 RIR, ±1 set/movement, +2
extra early reps at `high`) — directionally grounded, bounded, and easy to recalibrate
once real `effort_preference` × outcome data exists.

## Evidence base

- **Baz-Valle 2022** (weekly-set dose-response) — **MODERATE**: 10–20 sets/muscle/week is
  the productive zone; >20 shows diminishing/negative returns. Basis for the `high`
  volume bump being **+1 set/movement**, not unbounded.
- **Schoenfeld 2021 / Refalo 2023** (proximity-to-failure) — **HIGH / MODERATE**: stimulus
  scales with proximity to failure, but the marginal per-set return is small — supports a
  bounded effort bump and a hard floor at RIR 1.
- **Helms/Zourdos RPE chart (`one-rm.ts`)** — **practical**: why the early bump is a rep
  count + cue (not a precise RIR label) at these loads (see ADR 0015).
- **Wilson 2012 / ADR 0008 concurrent-interference lineage** — **MODERATE**: the reason
  `high` is opt-in and floored at RIR 1, and the dial is hypertrophy-scoped.

All magnitudes are **CP-1 `[DEF→cal]` Stage-A heuristics** — to be revalidated against
real user data (parked alongside the wellness-scale and archetype-tuning follow-ups).

## Implementation contract (as built — 2026-05-31)

**Commit:** _(filled on merge)_.

1. **Storage.** Migration `0080` adds `profiles.effort_preference text NOT NULL DEFAULT
   'standard'` + CHECK `('low','standard','high')`. Schema column mirrors
   `preferredCardioSource`. No backfill (default = identity).
2. **Config module.** New `effort-preference.ts` owns the type, `resolveEffortPreference`
   (defaults unknown → `standard`), `hypertrophyEffortConfig` (effort axis), and
   `hypertrophyAccessorySetsPerItem` (volume axis). All magnitudes live here, tagged CP-1.
3. **Engine threading.** `buildPrescription` and `assemblePrescriptionItems` each gain a
   trailing `effortPreference: EffortPreference = "standard"` param. `buildPrescription`
   forwards it to `applyHypertrophyEffortAnchor` (effort axis); `assemblePrescriptionItems`
   clones the hypertrophy `accessoryProfile.aesthetic` with the scaled `setsPerItem` before
   calling the picker (volume axis). Both default `"standard"` → existing callers untouched.
4. **Read + write.** `actions.ts` reads `effort_preference` in both block-creation profile
   SELECTs and threads it to the assembler. `updateProfile` gains the enum field + write.
   New `EffortPreferenceAutoSave` radio on the profile settings page ("Easier / Balanced /
   Harder").
5. **Regression guard (CRITICAL).** Pinned in `adr-0016-effort-volume-dial.test.ts`:
   `standard` is byte-identical to the no-param default; a non-hypertrophy archetype is
   identical across all three dials on BOTH axes; `high` never yields RIR 0; the golden
   master is unchanged. ADR-0011 and ADR-0015 tests stay green (no param → `standard`).

## Out of scope

- Scaling accessory volume on non-hypertrophy archetypes (their concurrent identity is by
  design — deferred until data shows demand).
- A continuous slider / per-block override (this is a coarse 3-way user default; per-block
  control can layer later).
- Read-time application to already-materialised blocks (bake-at-creation only, Decision 7).
- Re-tuning the underlying constants (the dial exposes them; tuning waits for data).
