# ADR 0063 — HYROX paired two-block conditioning + session duration estimate

Status: Accepted
Date: 2026-06-24

## Context

ADR 0062 made station-intervals / SE-circuit **focused** (a single 2-station couplet
per session, rotating by week). Two follow-on problems surfaced:

1. **A single focused couplet is short.** 4 rounds × a 2-station couplet at the ADR
   0061 per-round volumes is only ~10–15 min of work (~20 min door-to-door). For a
   dedicated gym trip that can feel too brief, and it needs many separate days to
   cover all stations.
2. **The app showed no duration for these sessions.** The conditioning item carried
   no `durationSec`; the platform adapter turns it into `cardio_external` with no
   `durationMin`, so `estimateSessionSeconds` priced it at **0** → the card showed
   "—" and time-budgeting ignored it. Runs/ergs (which set `durationSec`) showed a
   time; station sessions didn't.

## Decision

### 1. Pair two complementary focused blocks per conditioning session

A conditioning DAY is now **two focused couplets done SEQUENTIALLY** — finish block 1
(all rounds), reset, then block 2 — not a simultaneous all-stations rotation. The
week selects the first block; the second is the **next group in the rotation**:

- **station-intervals** (3 groups): wk1 = sled power + erg/wall-ball, wk2 = erg/wall-
  ball + ski/lunges, wk3 = ski/lunges + sled power, … Each week covers **4 of 6**
  stations; the rotation still covers all 6 across the block.
- **se-circuit** (2 groups): both groups every week (bodyweight engine + loaded
  carries) — all 4 stations, but as two coherent blocks.

This keeps each block **gym-feasible** (only 1–2 implements at any moment — you're not
juggling the whole floor), while a 2-block session is a substantial ~40 min of
quality conditioning. Capped at **two** blocks deliberately: three would just rebuild
the impractical all-stations session.

Structurally it stays **one** `conditioning` item whose `cardioPlan` expresses the two
blocks via `segments` ("Block 1 — sled power: Sled Push → Sled Pull", "Block 2 — …")
and a **union** `stations` list (per-round volumes + race loads for all 4). The
completion form, confirm-weights and set-log materialization all consume the **union**
of the two blocks' movements (`stationBlocksForWeek(...).flatMap(movements)`), so they
cover exactly what was performed — no over- or under-attribution.

### 2. Estimate station-session duration

`buildIntervals` / `buildCircuit` now set `durationSec` from a rounds-based model:
per station bout ~75 s (work + brief transition), ~75 s rest between rounds, ~8 min
warm-up once, ~2 min reset between the two blocks. The adapter maps this to
`durationMin`, so the card shows a real "~N min" (e.g. intermediate paired session
≈ 40 min) and `estimateSessionSeconds` counts it for budgeting.

## Load / recovery interaction

A paired session is a genuinely **hard ~40 min day**. No separate scheduling change is
needed: the athlete logs **one** session time (now longer) + one sRPE, and the
existing 2-factor load model (sRPE × duration — Foster 2001) plus the union set-logs
attribute the bigger stimulus automatically. The materialized load scales with the
real entered time, so interference vs adjacent hard days is already accounted for.

## Calibration

`[DEF]`, no calibration data. **Confidence: high** on the structure (sequential paired
couplets = standard HYROX conditioning-day practice, resolves the "too short" + "set-up
burden" concerns). The duration constants (`STATION_BOUT_SEC` etc.) are Stage-A
heuristics — refine against logged session times; over/under-estimate only shifts the
displayed minutes and the budget, not the prescription. The exact block pairings and
cycle length are sensible defaults, trivially tunable.

## Consequences

- Conditioning sessions are now substantial (~40 min) yet still focused and
  gym-feasible — two sequential couplets, not an all-stations scramble.
- The card finally shows a duration for station sessions, and time-budgeting works.
- Coverage invariant preserved: every station-interval station is trained across the
  block (now two per session). se-circuit covers all 4 each session.
- Volumes (0061) and loads unchanged; load scales via the longer logged time.
- **Materialize-time change:** existing HYROX blocks keep their single-block sessions
  — **regenerate / redeploy** to get the paired blocks + duration.
