# ADR 0036 — Universal weekly pull floor

Status: Accepted (2026-06-08)
Supersedes: none
Related: ADR 0035 (shoulder-stability cuff floor — same functional-floor
mechanism), the DC-O4 durability floor + functional requirements
(`accessory-roles.ts`).

## Context

A plan-review validation pass found an endurance block that shipped **zero**
back/biceps volume — no rows, no pulls, no pulldowns anywhere across the whole
7-week block. Verified against the generated prod plan.

Root cause: the four main-lift patterns are **squat / horizontal_press /
deadlift / vertical_press** — **none is a pull**. Pulling can therefore only
come from accessories, and nothing guaranteed it. On a low-accessory-volume
archetype (endurance/rebuild) the aesthetic budget is 0, so the gap-fill never
runs and the back gets nothing. The user's directive: **pulling must be part of
every archetype, or the programming is not balanced.**

## Decision

Add a `pull` functional role and make **one weekly pull a universal floor on
every archetype** (unlike the cuff floor, which is signal-gated).

1. **Role**: `pull` added to `FUNCTIONAL_ROLES`.
2. **Derivation** (`derive-roles.ts`): `pattern === "pull"` → `pull`. Covers all
   25 catalogue pulls (rows, pulldowns, pull-ups, face pulls). Pure; used by the
   seed + the reconcile migration.
3. **Migration 0093**: idempotently tags every `pattern='pull'` seed row with
   `functional_roles += pull` on prod (mirrors 0088/0092).
4. **Universal requirement**: the picker adds `pull: BASELINE_PULL_REQUIREMENT`
   (= 1) to the effective weekly functional requirements for EVERY block — not
   gated on any signal. A deliberate global balance change.
5. **Reserve**: the assembler grants **+1 to the total `maxItems` cap** (always),
   so the pull seats in its own headroom and never displaces an aesthetic slot
   (added to the total ceiling only, NOT `aestheticMaxItems`).

## Consequences

- **NOT byte-identical** (intended) — every dynamic-picker block gains one weekly
  pull. This is the explicit goal. The golden-master fixtures happen to carry no
  pull-pattern movement, so they stay byte-identical there; production (real
  catalogue) gains the pull. A dedicated `pull-floor` test + `catalog-integrity`
  coverage verify seating against a pull-bearing catalogue.
- **Additive** — the +1 cap headroom means the pull never evicts the durability
  floor, the functional floor, or an aesthetic slot. The DC-O4 tendon-floor
  invariant is untouched (`pull` is functional, not a bulletproof role).
- **Custom blocks unaffected** — they pass `undefined` catalog (no picker).
- **Satisfiable without machines** — pull-ups / inverted rows / DB rows give ≥2
  machine-free pulls (pinned by `catalog-integrity`). A literally no-bar,
  no-dumbbell user soft-skips (no crash, no empty fill).
- **No double-counting on hypertrophy** — the functional pull seats first and
  credits the back muscles; the aesthetic gap-fill may still add more back work
  where the archetype's target is high (correct for a hypertrophy primary).

## Science / rationale

Balanced push:pull programming is a basic resistance-training principle —
unbalanced pressing volume without pulling is associated with shoulder-girdle
imbalance and is universally corrected by practitioners. The DIRECTION (every
program needs pulling) is uncontroversial; the **1/week** figure is a minimum
balance floor (CP-1 heuristic), not a hypertrophy target — archetypes whose goal
is back size add more via the aesthetic gap-fill.

## Files
- `apps/web/src/lib/planner/accessory-roles.ts` — `pull` in `FUNCTIONAL_ROLES`.
- `packages/db/seeds/derive-roles.ts` — derive from `pattern:"pull"`.
- `packages/db/drizzle/0093_tag_pull_roles.sql` + journal entry.
- `apps/web/src/lib/planner/accessory-picker.ts` — `BASELINE_PULL_REQUIREMENT`,
  universal `pull` in `effectiveFunctionalReqs`.
- `apps/web/src/lib/planner/assemble-prescription.ts` — +1 total-cap headroom.
- `apps/web/src/lib/planner/accessory-rationale.ts` — copy for the new role.
- Tests: `pull-floor.test.ts`, `catalog-integrity.test.ts`.
