# Feature design: Pre-session check-in + readiness signal

**Status:** Planned. Build is next major feature after two-a-day. No code yet.
**Last updated:** 2026-05-21

---

## 1. Why

Right now the planner serves a static prescription. If the user is cooked from yesterday's heavy squat, they still see the same 90% TM today, and they either grind it or skip it. Neither is the right answer — the science says **scale the dose to today's recovery state**.

DC-P1 + the GRM (Global Recovery Multiplier) from research v2 §3.4 encode exactly this: a tiny self-report turns into a per-quality intensity nudge. Plumbed correctly, the planner becomes adaptive without needing a wearable.

## 2. Scope contract

**In v1 (this build):**
- A 2-slider pre-session widget (Fatigue 1–5, Soreness 1–5) per DC-P1
- GRM computed from those two inputs
- Per-session recommendation card: *"You're at GRM 0.92 today — consider 87% instead of 90% on the top set."* User decides; we never auto-apply.
- Fatigue + soreness persisted on the `sessions` row (columns exist)

**Out of v1:**
- HRV, sleep, RPE, life-stress inputs (Phase D backlog)
- Bar-speed-driven GRM (wearable backlog)
- Auto-application of the multiplier (only suggest)
- Trend graphs over time (stats page Phase 2)

## 3. Constraints already encoded

| Constraint | What it dictates |
|---|---|
| DC-P1 | Exactly two sliders. No sleep / life-stress / extra fields. |
| DC-C5 / DC-C8 | GRM is part of the ceiling equation — a multiplicative scalar in 0.80–1.00 range. |
| DC-K4 | Any nudge must cite the source ("research-v2 §3.4 GRM"). |
| DC-S3 | Recommendation is soft — never blocks the session. |

## 4. Data model (no new tables/columns)

Already present on `sessions`:
- `fatigue smallint` (1–5 per DC-P1)
- `soreness smallint` (1–5 per DC-P1)

No migration needed. The widget writes these two columns at session start.

## 5. GRM math (v1)

Simplest defensible mapping (calibratable later):
```
fatigueDelta  = (3 - fatigue)  / 2      // -1.0 to +1.0
sorenessDelta = (3 - soreness) / 2      // -1.0 to +1.0
grmRaw        = 1.0 + 0.06 * fatigueDelta + 0.04 * sorenessDelta
grm           = clamp(grmRaw, 0.80, 1.00)
```

A "3/3" check-in (neutral) → GRM = 1.00 (no nudge). A "5/5" (cooked) → GRM ≈ 0.90 (suggest -10%). A "1/1" (fresh) → still capped at 1.00 (we never let users go above the prescribed dose — that path is for the PR/TM progression feature).

## 6. UX flow

1. User clicks "Start session" on Today or Plan
2. A modal/inline form appears between click and the actual session page:
   - "How are you feeling today?"
   - Fatigue slider (1=fresh, 5=cooked)
   - Soreness slider (1=none, 5=severe)
   - Optional notes input (one short line)
   - "Skip" link bottom-right (skips the widget; GRM defaults to 1.00)
3. On submit, persist `fatigue`, `soreness` on the session row, compute GRM
4. Session page renders with a recommendation card at the top *if* GRM < 0.96:
   - *"Feeling cooked? GRM 0.91. Consider dropping top-set intensity by ~10%."*
   - Cited tooltip: "research-v2 §3.4 — Global Recovery Multiplier"
5. The planned prescription remains the same — the card is advisory only

## 7. Build sequence

1. Add a `pre-session/` route or modal under `/app/sessions/new`
2. Client component with two sliders + notes input
3. Server action `startCheckInSession(plannedSessionId, fatigue, soreness, notes)`:
   - Creates the session row with `fatigue` + `soreness` + slot/planned_at links
   - Returns the new session id
4. Replace the existing `startSessionFromPlan` callsites with the new flow when a planned session exists
5. Add `lib/engine/grm.ts` with the math
6. Render the recommendation card on the session page when GRM < 0.96
7. Tests: GRM math at boundary cases (1/1, 3/3, 5/5)
8. Stats integration deferred — just add a small "recent fatigue trend" footer line if trivial

## 8. Open questions for kickoff

- **Slider vs chip set:** 5 chips ("Fresh / Good / Neutral / Tired / Cooked") might be friendlier than a range slider on mobile. Recommend chips.
- **Skip behaviour:** when user clicks Skip, do we record `fatigue = null` (we have no data) or `fatigue = 3` (assume neutral)? Recommend null so analytics knows.
- **Where to show the recommendation:** only above the top set (DC-D2 ordering: heaviest first), or on every set card? Recommend top set only.
