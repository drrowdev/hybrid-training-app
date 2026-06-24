# ADR 0064 — Per-session HYROX station swap (equipment substitution)

Status: Accepted
Date: 2026-06-24

## Context

HYROX conditioning sessions (station-intervals / SE-circuit) carry their stations in
the `cardioPlan` blob, not as editable movement rows. The plan-drawer edit mode builds
its movement list by walking `prescription.items` and **skipping cardio**
(`PlanRedesign.tsx`), so these sessions had **no edit affordance at all** — a user who
lacks the kit for a station (no SkiErg, no sled) or wants to change it for any reason
could not. Strength sessions get per-movement Swap/Remove; station sessions got nothing.

## Decision

Add a **per-session station swap**: in the drawer's edit mode, each prescribed station
gets a **Swap** to a small curated equipment alternative, applied to **this planned
session only** (never future weeks — mirrors `planned-movement-actions.ts`).

### Curated alternatives (`STATION_ALTERNATIVES`, hyrox pkg)
Each station maps to a few gym-feasible substitutes, each `{ key, name, loaded,
approximate? }`:
- **Ergs are interchangeable** (SkiErg ↔ Row ↔ Bike/Echo) — unloaded, materialization-neutral.
- **Loaded stations** → same-pattern loaded subs (wall ball → DB thruster / goblet squat;
  sandbag lunge → DB/BB lunge; farmers → DB/trap-bar carry).
- **Sleds have no clean commercial-gym equivalent** — their alternatives (heavy march,
  leg press, heavy row, ring row) are flagged `approximate` and surfaced as such.

### Relabel model
A swap is a **relabel**, not a re-prescription. The station keeps its per-round
**target** and its **original engine key**; only the displayed name and the loaded flag
change. Loaded substitutes keep the original station's load/slug (lunge→lunge attribution
is fine); unloaded substitutes drop the load and produce no station set-log.

### Persistence + flow
- The override map `meta.stationOverrides: Record<originalKey, substituteKey>` is stored
  on the conditioning item of `planned_sessions.prescription` (this session only).
- The swap action rewrites the stored `cardioPlan` `segments` + `stations` (via the
  shared `stationBlockPlanParts(blocks, division, gender, overrides)`), so every display
  surface (drawer / Today / preview / completion form, all of which render the stored
  `cardioPlan`) reflects the swap immediately. Station rows now carry a stable `key` so
  overrides target reliably.
- **Completion** reads the override map: confirm-weights relabels loaded subs and drops
  unloaded ones; set-log materialization drops unloaded-substitute keys (their load is
  captured by the session sRPE × duration, like ergs/burpees already are).

## Calibration

`[DEF]`, no calibration data. **Confidence: high** that ergs are interchangeable and the
loaded-station substitutes are sensible same-pattern swaps. **The sleds are honestly
weak** — there is no good commercial-gym sled substitute, hence the `approximate` flag.
The substitution lists are trivially extendable.

## Consequences

- Station sessions are now editable for equipment/preference reasons, per session.
- Muscle attribution for a substituted station is approximate (loaded subs log under the
  original station's slug; unloaded subs aren't attributed) — the **session load
  (sRPE × duration) stays exact**. A documented limitation; richer per-substitute
  attribution can be layered later without changing this contract.
- Future weeks are unaffected (per-session override). A durable "equipment profile" that
  substitutes everywhere remains a possible future enhancement.
- Requires a block materialized with the `key`-bearing station rows (ADR 0061–0063 era);
  older blocks should be regenerated, consistent with the prior changes' guidance.
