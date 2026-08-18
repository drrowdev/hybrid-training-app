# ADR 0072 — A configured warm-up ladder wins over a program's published ramp

Status: Accepted (2026-08-18)
Supersedes: the program-owned-ramp decision recorded in the #724 work log
Related: ADR 0016 (generation-time, bake-at-creation), DC-K4 (override-and-warn)

## Context

`profiles.warmup_scheme` (migration 0039) presents itself as *the* warm-up
setting: a preset picker plus a custom ladder editor, with copy reading "A
warmup ladder ramps you into the working weight before each main lift." The
column's own schema comment promises that `setCount = 0` "disables auto-warmups
entirely."

None of that was true outside natively assembled blocks. Every program engine
hardcoded a ramp and never read the setting:

| program | ramp it emitted | publishes its own? |
| --- | --- | --- |
| 5/3/1 (`wendler-531`) | `TRAINING_MAX_WARMUP` — 40/50/60% of TM × 5/5/3 | **yes** |
| Tactical Barbell | `buildGlobalWarmupItems` — the app's shared ramp | no |
| Zulu/HT | same | no |
| HYROX | same | no |
| Green Protocol | inherited, delegates to TB / Zulu-HT | no |

So a lifter who chose "Skip warmups" still got three warm-up sets in all five,
and one who built a custom ladder never saw it in a program block.

The 5/3/1 case had a defensible rationale — Wendler prescribes that ramp, and
#724 fixed a real bug where it was being mis-anchored to the top set. The other
four had none: `program-core` states outright that they "have no published
warm-up of their own", and they were hardcoding **the app's own default ramp**,
i.e. the very ladder this setting exists to configure.

A second defect followed from the same gap. `PROGRAM_WARMUP_SCHEMES` contained
only the 5/3/1 entry, so `warmupSchemeForProgram` fell through to the user's
ladder for the other four. An unstarted TB/HYROX/Green session generated with
the hardcoded ramp would therefore be rebuilt by a movement swap using a
*different* ladder, leaving one movement on a rung count its neighbours did not
share.

## Decision

**Programs supply a warm-up DEFAULT. They do not overrule a lifter's choice.**

The stored value is read as a tri-state rather than a scheme:

| `profiles.warmup_scheme` | meaning | ramp used |
| --- | --- | --- |
| `NULL` | never chose | the program's own ramp (5/3/1 → %TM ladder; everything else → shared ramp) |
| set | explicit choice | **the lifter's ladder, everywhere**, including 5/3/1 and including `setCount: 0` |

The absent/present distinction is the load-bearing part. Migration 0039 added
the column with no backfill and the settings editor is its only writer, so
`NULL` provably means "never touched" rather than "picked the default". Without
that distinction, honouring explicit choices would silently strip 5/3/1's
published ramp from every lifter who had never opened the screen — the opposite
of "programs supply a default".

`resolveWarmupPreference` reads the raw column. `resolveWarmupScheme` collapses
`NULL` into the default and is now documented as unusable wherever the
difference decides whether a program ramp applies; both swap loaders were
resolving too early and had to move onto the preference.

### Mechanism

- `@hta/program-core` owns the canonical `WarmupRamp` (fractions, optional
  anchor) and gains `GLOBAL_WARMUP_RAMP`, derived from the existing constants.
- `PlatformContext.warmupRamp?: WarmupRamp` is the seam — optional, matching the
  existing `recentLogs?` / `activeLimitations?` / `gender?` pattern, so no
  engine or stored instance changes shape. Absent means "no preference".
- `@hta/wendler` re-exports `WarmupConfig` / `WarmupAnchor` as aliases of the
  program-core types, so a ladder crosses the seam untranslated and no package's
  public API breaks.
- All four remaining engines pass `ctx.warmupRamp` into `buildGlobalWarmupItems`,
  which takes an optional ramp. An empty ramp emits no items — that is how
  `setCount: 0` reaches an engine.
- TB / Zulu-HT / HYROX / Green are registered in `PROGRAM_WARMUP_SCHEMES` with
  the shared ramp their engines already default to, derived from
  `GLOBAL_WARMUP_RAMP` rather than restated, so the generation path and the swap
  path cannot drift.

### DC-K4

Choosing a ladder overrides a principle-derived default, so it is surfaced and
recorded rather than applied silently:

- **Warned** — the settings editor names the program whose published warm-up the
  choice replaces, and points at "Follow the program" to hand it back. The list
  is *derived* (a program qualifies when its registered default differs from the
  shared ramp), so registering a program that merely inherits the shared routine
  does not produce a spurious warning.
- **Recorded** — the canonical record is the `profiles.warmup_scheme` row
  itself, supplemented by an `engine_override_events` row of the existing
  `custom` type. No migration: `EngineOverrideContext` is deliberately loose
  JSONB (plan §6.8) and `custom` already exists in the type union.
- **Reversible** — a "Follow the program" preset writes SQL `NULL`. Without it
  an explicit choice could never be withdrawn, which is why it is part of this
  decision rather than deferred polish.

## Consequences

- 5/3/1's methodology fidelity becomes lifter-defeatable. Accepted deliberately:
  the owner's position is that a program is a default, not a mandate, and the
  warning plus the audit row keep the trade-off visible.
- Behaviour changes only for **newly generated sessions**. Existing
  `planned_sessions.prescription` snapshots are never rewritten, consistent with
  0039's forward-only note and ADR 0016's bake-at-creation stance. No migration.
- The pre-existing generation/swap split for TB / Zulu-HT / HYROX / Green closes
  as a side effect.
- `buildGlobalWarmupItems` only knows the working weight, so it cannot honour a
  `training_max` ramp. It falls back to the shared ramp rather than throwing
  inside prescription assembly (which would break a lifter's whole plan) or
  mis-anchoring — the exact failure mode #724 fixed. User ladders are top-set
  anchored by construction: the settings editor cannot write an anchor.

## Alternatives considered

- **Honour the setting everywhere, with no tri-state.** Simplest, and the
  literal reading of "your setting always wins". Rejected: every lifter who had
  never opened the settings screen would silently lose 5/3/1's published ramp,
  which contradicts "programs supply a default" and is a behaviour change nobody
  asked for.
- **Leave the engines alone and only fix the copy.** Cheap and honest, but it
  concedes that a prominent setting does nothing for most training, and leaves
  the schema comment's `setCount = 0` promise false.
- **Add a `warmup_scheme_source` column** to distinguish chosen from default.
  Rejected under schema discipline (plan §6.8): `NULL` already carries the
  signal, nothing observable removes the column, and an ADR-worthy top-level
  column is not justified when the existing nullability suffices.
