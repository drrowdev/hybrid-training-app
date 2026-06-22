# ADR 0056 — HYROX strength dosing: a second, split strength day at higher budgets

**Status:** Accepted (evidence-led; user sign-off 2026-06-22).
**Date:** 2026-06-22
**Relates to:** ADR 0050 (HYROX program), ADR 0053 (quota week-builder),
ADR 0055 (taper / modality / progression). CP-1…CP-5 in
`docs/knowledge/hybrid-training-design-constraints.md`.

## Context

A user built a 5-day intermediate HYROX plan and got **one** strength day — a
single `strength-full` session cramming squat + deadlift + overhead press into
one workout. They asked whether it should be two split days instead.

A research pass on established HYROX programs + the inaugural **HYROX Sports
Science Advisory Council (SSAC) Report 2025** (Loughborough / AUT / ETH Zurich /
Manchester Met) settled it. There is no HYROX-specific RCT, so this is
practitioner-consensus + sport-science-advisory tier, but it is consistent and
high-confidence:

- **Frequency (HIGH).** RoxLyfe (Gillingham + WR-holder Weersma): strength
  *"once or twice a week."* For a **5-day athlete**, the standard prescription is
  **2 strength days** (5 days fits 2 runs + 1 station/compromised + 2 strength).
- **Full-body vs split (MOD-HIGH, with a HYROX deviation).** RoxLyfe infers
  **1 day → full-body**, **2 days → lower/upper split**. We KEEP full-body for both
  days (see Decision): the split's rationale is generic interference avoidance,
  which doesn't apply to a fatigue-based sport, and the athlete wants every lift
  2×/week. Cramming three compounds into one session is *"not a performance crime,
  just high fatigue"* — at submaximal HYROX loads it's fine, twice.
- **Phase shift (HIGH).** Heavier max-strength bias in **base/build (≈2×/wk)**,
  dropping to **1× maintenance in race-prep** as compromised running takes over.
- **Type / priority (HIGH).** HYROX is a *power-endurance* sport: *"strength
  supports performance rather than dominating it; running is the biggest
  performance driver"* (SSAC 2025). Max strength is foundational, NOT the goal;
  hypertrophy is undesirable (added mass hurts).

The current engine only adds a 2nd strength slot at **7** sessions (Build), and
the split was `strength-full → strength-lower`. So a 3–6-day plan got one
monolithic full-body day — the user's complaint.

## Decision

Strength-day **count is budget- and phase-driven** (not level-gated). When a week
carries two strength days they are **both full-body** (squat + deadlift + press),
so every main lift is trained **2×/week** — the frequency the athlete wants
(Schoenfeld 2016: 2× ≥ 1× at matched volume). HYROX strength is submaximal
(1–2 RIR) so the doubled full-body dose stays manageable, and every compound
transfers to a station.

**No lower/upper split.** An earlier draft split the two days lower/upper on
generic concurrent-interference grounds. That reasoning is **rejected for HYROX**:
the interference effect is mostly a hypertrophy / acute same-day (<6 h) concern,
and HYROX is *built on training under accumulated fatigue* (compromised running is
the signature skill) — so scheduling to avoid training legs while fatigued fights
the sport itself. Sport methodology (train the compounds often, submaximally) wins
over the generic physiology here.

Financed per the user's "endurance-protected" choice — the 2nd strength day never
displaces a HYROX endurance essential (station, quality run, compromised run, long
run) in Build/Race-prep:

- **Base:** 2nd strength slot at the **5th** position (after strength · station ·
  long · quality) — so a **5-day base week = 2 full-body strength days**, financed
  by dropping an easy-aerobic slot. Base has no compromised work yet.
- **Build:** the 2nd strength slot sits **after** all four endurance essentials
  (station · quality · compromised · long), at the **6th** position — so it
  appears at **6+ days**, never at the cost of compromised/long. A 5-day build
  week keeps **one** strength day.
- **Race-prep (Specific):** **always one** strength day (maintenance) regardless
  of budget — compromised running + stations dominate; strength volume drops per
  the SSAC phase model. No change.
- **Low budgets (3–4 days) & any 1-strength week:** the single day is
  `strength-full` (full-body).

Net effect for the user's case: a 5-day plan now gets **two full-body strength
days in Base weeks** (every lift 2×); Build weeks stay at one (endurance-protected)
until 6 days; race-prep stays at one. A 6-day plan gets two in Base **and** Build.

## Worked examples

Placement now spaces the two strength days evenly (see "Weekday placement"):

- **Intermediate, 5 days, Base:** Mon station · **Tue strength** · Wed long ·
  **Fri strength** · Sat threshold (2 full-body, on the 2nd & 4th training days —
  every lift 2×). *(was: 1 strength-full bookending the week)*
- **Intermediate, 5 days, Build:** strength on the mid-week day (1,
  endurance-protected).
- **Advanced, 6 days, Build:** Mon circuit · **Tue strength** · Wed quality ·
  Thu compromised · **Fri strength** · Sat long (2 full-body, Tue/Fri).
- **Any level, 4 days, Base:** strength on the 3rd training day (1 full-body, mid-week).
- **Race-prep, any budget:** one strength day (maintenance), mid-week.

## Weekday placement

The two strength days are seated on **evenly-spaced positions** within the
training week rather than in slot-priority order. Priority order put strength on
the user's 1st and last training days (e.g. Mon/Sat in a 5-day week) — too far
apart, with two consecutive run/station days bunched mid-week.

`strengthPositions(n, k)` returns `k` distinct session indices that split the
`n`-session week into `k+1` even gaps (`round((i+1)·(n+1)/(k+1)) − 1`, clamped +
de-collided). For `n=5,k=2` → positions 1 & 3 (the 2nd and 4th training days,
Tue/Fri in a default Mon-start week); `n=6,k=2` → 1 & 4 (Tue/Fri); `n≥4,k=1` →
the middle. The remaining sessions fill the other days in priority order, so
endurance protection (Build phase orders all four run/station essentials before
the 2nd strength day) is preserved. The race simulation seats on the last
**non-strength** day so it never displaces a lift.

Rationale: UX and programming quality drive this — two strength days ~3 days
apart give cleaner recovery and stimulus distribution than bookended days, and
HYROX is explicitly about training under fatigue, so next-day strength↔endurance
adjacency is acceptable (interference is mostly hypertrophic + acute <6 h, not a
24-h problem). Technical slot ordering is NOT a determining factor.



## CP pressure-test

- **CP-1:** the budget/phase thresholds for the 2nd strength day are `[DEF]`
  practitioner-consensus dosing (RoxLyfe + SSAC 2025), tagged in source;
  validation = the plan-composition QA guard + (once usage exists) adherence on
  2-strength weeks. No HYROX RCT exists — flagged.
- **CP-2:** no shared engine constant moves; HYROX-package-local. The strength
  prescription math (% of 1RM, rep scheme) is unchanged — this is session
  SELECTION only.
- **CP-3/CP-5:** no new >1-sig-fig coefficient; the dosing claims cite RoxLyfe /
  SSAC 2025 at the stated confidence.

## Scope / risk

HYROX-only, package-local; other programs byte-identical. Output changes for
Base (5+ days) and Build (6+ days) strength composition. Covered by updated quota
invariants + the full-matrix QA guard (every work week still has ≥1 strength + a
station + a run; the lone-erg-primary guard is untouched).
