# ADR 0039 — Specificity-aware cardio modality diversification

Status: Accepted (2026-06-08)
Supersedes: none
Related: ADR 0017 (ranked cardio-modality preference — this layers on top), ADR
0034 (running-impact durability), ADR 0025/`concurrent-scalar.ts`
(`MODALITY_INTERFERENCE`, Wilson 2012), the events system (`events.modality`).
Phase A of the modality-specificity design (`files/modality-specificity-design.md`);
Phase B (interference→prescription feedback) is ADR 0040, separate.

## Context

Today a cardio modality swap (run → bike) is treated as a **load-neutral vehicle
change**: ADR 0017 holds `cardioKind` + duration and swaps the modality; the load
model (`cardioEslFromKind`) is modality-blind. That's fine for *intensity* (HR-
anchored, modality-agnostic) but the engine has **no model of specificity** — it
can't tell which sessions must stay in the athlete's goal sport (a runner's
intervals + long run) from the transferable aerobic base that can move to a
lower-interference modality. So it can neither diversify safely nor preserve
goal-specific adaptation.

The pieces already exist: the **goal signal** (`events.modality`: run/bike/swim/
row/ski, A/B/C priority) and the **interference model** (`MODALITY_INTERFERENCE`:
run 1.0, bike 0.4 … Wilson 2012). They were just never connected to modality
selection.

## Decision

A pure per-day **modality plan** (`cardio-modality-plan.ts`) decides which
modality each cardio session is prescribed in, then reuses the ADR 0017 resolver
for equipment/tier/kind feasibility. It only decides the *ranking*.

1. **Goal modality** = upcoming A-priority event (`events.modality`) → user's top
   preference → running. Source tracked (`event | preference | default`).
2. **Specificity** (per cardio day):
   - **quality** (`vo2 | threshold | alactic`) and the **anchor long Z2** (the
     longest Z2, preferring a "long" role) are specificity-critical → kept in the
     goal modality (central adaptation transfers across modalities; peripheral /
     biomechanical is specific — SAID).
   - the remaining shorter **easy Z2 base** is **diversifiable**.
3. **Diversification gate** — only on strength-constrained blocks (endurance +
   strength/muscle secondary, concurrent_hybrid, strength-led). NEVER on a
   pure-cardio block (specificity wins).
4. **Diversify target** — the lowest-interference modality the athlete owns, and
   ONLY when it is **lower-interference than the goal** (so a cyclist's base stays
   cycling; only a runner's filler drops to e.g. the bike). The goal modality is
   appended as the consistency fallback.
5. **Ordering vs preference** — specificity-critical sessions force the goal
   modality (override a generic vehicle preference); the diversifiable base
   respects an explicit preference, else auto-diversifies.

### Safety: new behaviour is event-gated

The plan only changes anything when the goal is **event-derived**
(`source === "event"`). With no A-priority cardio event, every day returns the
user's existing preference list → the ADR 0017 call is unchanged → the
prescription is **byte-identical to today**. Preference/default users keep current
behaviour (their preference already governs the vehicle). So the entire feature
activates for "training for a race" and is inert otherwise.

## Consequences

- **Byte-identical for every non-event block** (verified: full suite green, no
  golden movement). Only a user with an A-priority cardio event sees changes.
- **Event-driven changes**: a runner with a running race on a strength-emphasis
  block keeps intervals + the long run as runs and moves the shorter easy runs to
  the bike (lower interference, near-zero aerobic cost — Wilson 2012); a cyclist
  with a bike race gets quality + long + base in cycling.
- **No schema change** — reuses `events`, `preferred_cardio_modalities`, the
  cardio catalog. The catalog is now also loaded when an event goal is present
  (previously only when a preference was set).
- **Equipment-gated** — diversification only picks modalities the athlete owns and
  can perform at the prescribed kind; a treadmill-only runner stays running.
- **Custom blocks unaffected** — the custom path has no event lookup → today's
  behaviour.
- **Known v1 edge** (documented, low harm): `blockUsesRunningCardio` (ADR 0034
  Achilles/calf-HSR steering) still keys off the preference list, so a bike-event
  athlete may still get one calf-HSR slot. Harmless; revisit if it matters.

## Science / rationale

- **Wilson 2012** (HIGH, 21-study MA): running-based concurrent impairs lower-body
  strength/hypertrophy; cycling-based does not → move *non-specific* base off
  running on strength blocks.
- **SAID / specificity + cross-training transfer** (Tanaka 1994; Millet 2009):
  central (cardiac/VO₂max) adaptations transfer; peripheral + economy adaptations
  are modality-specific → protect quality + the long session in the goal modality.
- The interference *ranking* reuses the existing `MODALITY_INTERFERENCE`
  coefficients (no new magnitudes). The specificity taxonomy + the
  diversification gate are **CP-1 heuristics**. Confidence: **HIGH** for "protect
  specific work, diversify the base on strength blocks"; **MODERATE/CP-1** for the
  exact gate + classification thresholds.

## Files
- `apps/web/src/lib/planner/cardio-modality-plan.ts` (NEW, pure):
  `goalModalityFromEvent`, `resolveGoalModality`, `diversificationEnabled`,
  `classifyCardioSpecificity`, `modalityPreferenceForDay`.
- `apps/web/src/lib/planner/actions.ts` — fetch upcoming A-event, resolve goal,
  broaden catalog load, feed the per-day preference to the ADR 0017 resolver.
- Tests: `adr-0039-cardio-modality-plan.test.ts`.
- `docs/knowledge/hybrid-training-design-constraints.md` (+ workspace mirror).
