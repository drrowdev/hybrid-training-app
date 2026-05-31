# ADR 0018 — Retire the daily wellness check-in; ceiling chain goes two-factor

**Status:** Accepted
**Date:** 2026-05-31
**Phase:** Production (engine + UX simplification)
**Relates to:** CP-4 (ceiling-chain factor count, `docs/knowledge/hybrid-training-design-constraints.md`), DC-C5 (daily Global Recovery Multiplier spec), PR #166 (wired the daily wellness sliders into `recoveryMultiplier`), PR #176 (retired the Today-page wellness card)
**Touches:** `apps/web/src/lib/engine/wellness-recovery.ts` (deleted), `apps/web/src/lib/stats/engine.ts` (`getCeilingExplain`), `apps/web/src/lib/wellness/check-in.ts` + `actions.ts` (reduced to bodyweight), `apps/web/src/lib/ai/*` (knowledge / system prompt / `getEngineState`), `apps/web/src/lib/stats/wellness.ts` + `components/stats/WellnessRangeView.tsx` + `app/app/stats/wellness/*` (deleted), glossary / cmd-k / privacy copy. **No DB migration** — `wellness` columns retained.

## Context

The app had a per-day **wellness check-in** (fatigue / soreness / motivation /
notes on a 1–9 scale, stored on the `wellness` table). PR #166 wired the
fatigue/soreness sliders into a daily `recoveryMultiplier` that became the
**third factor** in the global ceiling chain:

```
finalCeiling = baseCeiling × recoveryMultiplier × confidenceBias
```

PR #176 then retired the Today-page input card because the friction-to-signal
ratio was poor and there were **zero production rows** to validate its
threshold cascade. That left the engine path live but starved: with no UI
writing fresh `wellness.fatigue` / `wellness.soreness`, `computeRecoveryMultiplier`
always returned `null`, so the multiplier was a constant `1.0` for every user.

The user asked to finish the job — remove the dead code path entirely to cut
in-app noise and stop documenting a factor that does nothing.

Two facts shaped the decision:

- **The daily multiplier was already inert.** Because no surface writes fresh
  daily fatigue/soreness, the third factor was identically `1.0`. Removing it
  from the chain is a **no-op on every real prescription** — near-zero
  engine-regression risk.
- **The `wellness` table is multi-purpose.** `wellness.bodyweight_kg` is a live,
  core feature (bodyweight nudge + trend, mirrored to `profiles.bodyweight_kg`).
  Only `fatigue` / `soreness` / `motivation` / `notes` belonged to the dead
  check-in. Dropping columns would be a destructive prod migration that also
  erases historical rows still useful for data export.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Engine path | **Delete** `wellness-recovery.ts` and its wiring in `getCeilingExplain`. | The factor was a constant `1.0`; deleting it removes dead code, not behaviour. |
| 2 | Ceiling chain | Goes **two-factor**: `finalCeiling = baseCeiling × confidenceBias`. CP-4 updated from "stays at 3 factors" to "stays at 2 factors". | Mirrors what the code now computes; reviewers must not reintroduce a third factor without a measurable signal. |
| 3 | DB columns | **Keep** all `wellness` columns; no migration. | Non-destructive: preserves history + the existing `select("*")` export, and keeps `bodyweight_kg` (a separate live feature) untouched. |
| 4 | Daily check-in module | Reduce `check-in.ts` / `actions.ts` to **bodyweight only** (date + `bodyweight_kg`). | `BodyweightNudge` is the sole remaining live writer; the merge-on-conflict upsert leaves retained legacy columns intact. |
| 5 | Per-session GRM | **Untouched.** `apps/web/src/lib/engine/grm.ts` (1–5 scale, reads `sessions.fatigue/soreness`, drives deload + recovery advice) is a *separate* mechanism and stays live. | Different signal, different write path, different consumer — out of scope. The glossary `grm` term and its help test describe this one. |
| 6 | Stats sub-page | Delete the `/app/stats/wellness` range view and its index link. | No data source remains for it. |
| 7 | AI surface | Two-factor everywhere: `getEngineState` drops `recovery_multiplier`; knowledge CP-4 / CP-2 table and the v1+v2 system prompts describe `base × confidenceBias`; the phantom `last_90d.wellness_check_ins` snapshot reference removed. | The AI must not explain a factor that no longer exists or cite a dataset that was never produced. |
| 8 | Not a load constant | No CP-2 calibration constant is added; one obsolete row (the wellness-recovery ladder/bounds) is struck through with a removal note. | Selection/cleanup work, no golden-master risk. |

## Rationale

The conservative move is to delete a factor that has provably been `1.0` for
everyone since PR #176, rather than keep documenting and shipping inert math.
The two-factor chain is exactly what the engine already produced; this change
makes the code, the docs, and the AI's explanation agree. Re-introduce a daily
readiness signal only behind a **less intrusive input surface** (e.g., a passive
HRV trend from a wearable), at which point a new ADR re-opens CP-4.

## Consequences

- **Ceiling is now `baseCeiling × confidenceBias`.** Any future PR adding a third
  factor must justify it with a user-outcome signal and implement the per-week
  compression cap (CP-4).
- **History + export preserved.** Old `wellness` rows still export via
  `/api/me/export`; the portability format is unchanged.
- **Confidence:** HIGH that this is behaviour-neutral on prescriptions (the factor
  was a constant). The removal is verified by the full build + test suite.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
