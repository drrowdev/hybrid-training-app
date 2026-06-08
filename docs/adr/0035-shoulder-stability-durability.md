# ADR 0035 — Shoulder-stability (rotator-cuff) durability for pressers

Status: Accepted (2026-06-08)
Supersedes: none
Related: ADR 0034 (modality- & pattern-aware durability floor; this is its
deferred "Phase 3"), the DC-O4 durability floor + functional requirements
(`accessory-roles.ts`).

## Context

The catalogue already ships 8 `pattern:"cuff"` rotator-cuff / scapular-care
movements (`movements-part3.ts` CUFF: external/internal rotations, prone Y/T/W
raises, scapular pull-up). But `derive-roles.ts` assigned them **no** functional
or bulletproof role, so they surfaced only as incidental rear-delt *aesthetic*
isolation — never a guaranteed prehab item. The pre-launch plan review (Finding
#4c) caught the consequence: a block with **OHP / bench as a main lift** carries
**no guaranteed shoulder durability work**.

`FUNCTIONAL_ROLES` had `hip_stabilizer` and `ankle_foot` (exact prehab analogues
for the hip and ankle) but nothing for the shoulder. Since the picker selects by
role, the untagged cuff movements could never be a requirement.

## Decision

Add a **`shoulder_stability` functional role** and a **conditional weekly
requirement of 1**, fired only when the block has a pressing main lift —
mirroring ADR 0034's signal-gated, default-off pattern.

1. **Role**: `shoulder_stability` added to `FUNCTIONAL_ROLES`, alongside
   `hip_stabilizer` / `ankle_foot`.
2. **Derivation** (`derive-roles.ts`): `pattern === "cuff"` → `shoulder_stability`.
   Pure; used by both the seed and the reconcile migration.
3. **Migration 0092**: idempotently tags the 8 cuff movements'
   `functional_roles += shoulder_stability` on prod seed rows (mirrors 0088).
4. **Conditional requirement**: a new `pressingMainLift` signal threaded
   `actions.ts → assemble-prescription → pickAccessoriesForSession`. When true,
   the picker adds `shoulder_stability: 1` to the week's effective functional
   requirements. Default `false` → byte-identical (golden harness, custom blocks,
   legacy callers omit it).
5. **Reserve**: when `pressingMainLift`, the assembler grants **+1 to the total
   `maxItems` cap only** (NOT `aestheticMaxItems`), so the cuff item seats in its
   own headroom and never displaces an aesthetic slot. Gated on the signal.
6. `pressingMainLift` is computed once per block in `actions.ts`: true iff any
   strength day's `role` or `secondaryRole` ∈ {`vertical_press`,
   `horizontal_press`}.

## Dose

`shoulder_stability: 1` per week — a minimum prehab dose (lighter than
`hip_stabilizer` 2 / `ankle_foot` 2 since cuff work is supplementary).
**CP-1 / Stage-A heuristic**, no in-app calibration data.

## Consequences

- **Default-off & byte-identical** when `pressingMainLift` omitted — the
  `assemble-prescription` goldens pass unchanged; custom blocks (no picker) are
  unaffected.
- **Real createBlock with a press changes** — most strength / concurrent /
  hybrid / endurance (dual-main-lift) blocks gain one weekly cuff item. A
  deliberate global injury-prevention improvement.
- **Tendon floor untouched** — `shoulder_stability` is FUNCTIONAL, not a DC-O4
  bulletproof role; the `tendon-floor.ts` durability invariant is unaffected.
- **No aesthetic theft** — the +1 cap is the total ceiling only, so the cuff item
  occupies new headroom; aesthetic volume is unchanged.
- **Satisfiable without machines** — band / DB / bar cuff variants exist (≥1
  machine-free), pinned by `catalog-integrity`.

## Science

Rotator-cuff / scapular-stability prehab for overhead and bench pressing is
standard injury-prevention practice (subacromial / cuff load management). The
DIRECTION (a presser should carry cuff work) is well-supported; the 1/week dose
is a CP-1 heuristic. MODERATE confidence overall.

## Files
- `apps/web/src/lib/planner/accessory-roles.ts` — `shoulder_stability` role.
- `packages/db/seeds/derive-roles.ts` — derive from `pattern:"cuff"`.
- `packages/db/drizzle/0092_tag_shoulder_stability_roles.sql` + journal entry.
- `apps/web/src/lib/planner/accessory-picker.ts` — `pressingMainLift` param +
  conditional requirement.
- `apps/web/src/lib/planner/assemble-prescription.ts` — thread signal + +1 cap.
- `apps/web/src/lib/planner/actions.ts` — compute `pressingMainLift`.
- `apps/web/src/lib/planner/accessory-rationale.ts` — copy for the new role.
- Tests: `shoulder-stability-cuff.test.ts`, `catalog-integrity.test.ts`.
