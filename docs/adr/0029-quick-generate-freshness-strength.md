# ADR 0029 — Quick-generate: freshness-aware deterministic strength session

Status: Accepted (2026-06-04)
Supersedes: none
Related: ADR 0020 (secondary-focus tilt + duration governor), ADR 0024
(accessory volume level), ADR 0027 (aesthetic anti-redundancy), ADR 0028
(goal-weighted aesthetic profile); muscle-freshness layer (DC-A6 / DC-C14)

## Context

The Today-page "Quick workout" card let a user start an off-plan session, but
the only strength option created an **empty** session — the user picked every
movement, set, and rep by hand. That is the "blank start" problem: maximum
friction at exactly the moment the user wanted to just train.

The ask: a one-tap **Generate** button that builds a ready-to-log strength
session, accounting for (a) which muscles are fresh vs recently trained, and
(b) the user's archetype priorities (primary goal + secondary focus). With a
length choice — Short (~30 min) or Normal (~60 min).

**Build vs AI.** The core generation is done **deterministically**, not with an
LLM, and AI is explicitly NOT a dependency:
- Generating safe training loads (%TM × TM), movement selection, and volume is
  exactly what the science-grounded engine already encodes. An LLM inventing a
  1RM or an unsafe load is a real risk we refuse to take.
- The deterministic path is available to 100% of users (no BYOAI/MCP config),
  instant, free, offline-capable, and RLS-safe.
- A future opt-in "Adjust with AI" layer (natural-language tweaks like "only
  dumbbells, 30 min") can sit ON TOP of the deterministic seed via the existing
  `getEngineState` surface, with the engine still validating final loads. That
  is deferred; this ADR ships the deterministic core.

## Decision

A new deterministic generator that REUSES the existing prescription engine
read-only, plus one default-identity hook on the assembler. Two freshness
levers, both grounded in the muscle-recovery window (myofibrillar protein
synthesis is elevated ~24–48h and returns toward baseline by ~36–72h — Damas
2016 PMID 26666744; MacDougall 1995; Schoenfeld dose-response). For a one-off
bonus session we train what is RECOVERED, not re-hammer what was just trained.

### Lever 1 — pattern routing (freshest main lift)

`pickFreshestStrengthRole` scores each of the archetype's strength roles by the
mean recovery of its PRIME movers (`STRENGTH_ROLE_PRIME_MUSCLES`), reading the
16-muscle freshness layer (`getMuscleFreshness`). The main lift lands on the
freshest pattern: smashed legs yesterday → today's quick session is an upper
press/pull. Ties break on archetype day order (anchors first) for determinism.

### Lever 2 — aesthetic freshness mask (accessory gap-fill)

`buildAestheticFreshnessMask` maps each aesthetic-target muscle (fine
`movements` enum) → its 16-group via `MUSCLE_FROM_DB_ENUM` → a per-band
multiplier (`FRESHNESS_TARGET_MULTIPLIER`: loaded 0.34, ready 0.67, fresh /
untouched 1.0). The mask is applied to the picker's `perMuscleTargets` so the
gap-fill flows to recovered muscles. Floored at 1 — a recently-trained muscle is
de-prioritised, never zeroed.

### The assembler hook (default identity)

`assemblePrescriptionItems` gains ONE optional trailing param
`aestheticTargetMask?: ReadonlyMap<string, number>`, applied to the target map
AFTER the onboarding ramp: `value * (mask.get(key) ?? 1)`, floored at 1. Absent
for every planned-block caller → **byte-identical** (the golden master passes
unchanged). This mirrors how ADR 0020/0024/0028 each added a default-no-op param
to this same function — the codebase's established, regression-safe extension
pattern.

### Working intensity + duration governor

A quick session borrows the archetype's first NON-deload week
(`quickWorkingWeekIndex`) — never a deload, predictable working load. After
assembly, `trimToDurationCap` drops trailing accessory items (aesthetic-first,
since the picker appends durability → functional → power → aesthetic) until the
estimated session fits the length cap (SHORT 30 min / NORMAL 60 min). Main lifts
and warmups are never trimmed.

### Server action + materialisation

`generateQuickStrengthSession({ length })` (Zod `.strict()`, user-scoped client,
explicit `user_id` filters — RLS posture per the project's new-write-path rule):
- `resolveQuickStrengthPlan` gathers the same engine context as `createBlock`
  (archetype from the active or most-recent block; movements; TMs; picker
  catalog; limitations; equipment; experience), routes the pattern, and returns
  built items + the value_kg TM map.
- The action creates an off-plan session row (no `planned_sessions` linkage) and
  materialises items into `set_logs` exactly like `fillSessionFromPlan`
  (%TM × TM → weight, `roundToPlate`; accessories carry a null weight the user
  fills, aided by the existing "last time" hint).

Archetype priorities are honoured off-plan: the resolver reads the user's block
`focus_muscles`, `secondary_focus`, and `accessory_volume`, so an active Strength
+ Muscle athlete's quick session carries the same accessory posture (incl. ADR
0027/0028) as their planned work.

## Engine-regression posture

- **Assembler byte-identical when the mask is absent** — golden master + full
  suite (3305) green. `buildPrescription` and the shared muscle-targets logic
  are NOT modified.
- **No archetype config change** — cross-archetype invariants unaffected.
- **Read-only reuse** — the resolver performs no writes; only the action writes
  (a new session + its set_logs), off-plan, never touching the planned ledger.

## Constants (calibration policy)

- `FRESHNESS_TARGET_MULTIPLIER` (loaded 0.34 / ready 0.67 / fresh 1.0) — CP-1
  Stage-A heuristic, no calibration data. Recovery-window mapping.
- `STRENGTH_ROLE_PRIME_MUSCLES` — CP-1, prime-mover anatomy.
- `SHORT_CAP_MIN = 30`, `NORMAL_CAP_MIN = 60` — practitioner time budgets, CP-1.

Documented in the CP-2 constants table (both doc mirrors), row #50.

## Science grounding (honest confidence)

The DIRECTION — bias a bonus session toward recovered muscles/patterns — is
well-supported by recovery and MPS kinetics (MODERATE). The specific magnitudes
(0.34/0.67 multipliers, the 30/60-min caps, the prime-mover sets) are
**unvalidated CP-1 heuristics** (LOW as hard-science claims). The duration cap is
an adherence-ergonomics bound, not a science claim. First recalibration targets:
the multipliers and caps, once real generated-session adherence + per-muscle
response data exists.

## Consequences

- The "blank start" becomes one tap: a ready-to-log strength session tuned to
  what's recovered and aligned to the user's goal.
- No AI dependency; an opt-in AI refinement layer can stack on the deterministic
  seed later without re-architecture.
- The freshness mask hook is reusable by any future "build me a session" surface.

## Phasing

1. Pure core `quick-generate.ts` (role scoring, freshness mask, working week,
   duration trim) + default-identity assembler hook. Unit + integration tests.
2. Server resolver `quick-generate-resolve.ts` + action
   `generateQuickStrengthSession` (RLS, Zod strict, set_logs materialisation).
3. UI — Generate (Short / Normal) tiles in `QuickWorkoutSheet`; keep Start-empty
   + Recent repeat. Component tests.
4. Docs — ADR + CP-2 row #50 in both mirrors.
