# ADR 0004 — Endurance Anchor dual-main-lift redesign (post-Huiberts 2024)

**Status:** Accepted
**Date:** 2026-05-28
**Phase:** D
**Supersedes (in part):** the pre-2024 lower-body-only design of the two `ENDURANCE_ANCHOR` strength days in `apps/web/src/lib/planner/archetypes.ts`. The Endurance Anchor *cardio* layer (long Z2, VO2 intervals, Z2 + alactic finisher, easy Z2, tendon HSR floor) is unchanged.

## Context

`ENDURANCE_ANCHOR` shipped with two strength "maintenance" sessions per week — Squat (Tue) and Deadlift (Thu) — sized as full main-lift sessions and intentionally lower-body-only. The justification on `main` was the pre-2024 reading of concurrent training: cardio interferes with strength globally, so the safe move is to keep strength sessions short, lower-body, and few in number, and let push patterns ride on push-up / dip accessories.

That reading no longer matches the evidence. The 2024 Huiberts meta-analysis decomposed the interference effect by region and showed it is *not* global — it is concentrated in lower-body strength in male athletes and is statistically absent in upper-body strength. Feuerbacher 2025 replicated the upper-body finding in a controlled RCT directly. Meanwhile the cost of running an Endurance block with no upper-body main lifts compounds: push-ups load the bench press pattern well below the loading threshold that the maintenance-dose literature identifies as required to hold 1RM, so a multi-week Endurance block ends in a measurable bench-1RM regression that the user then has to rebuild.

So an Endurance block today *under-uses* a recovery budget that does in fact have room for upper-body work, and *over-pays* on the rebuild cost when the user comes off it.

## Evidence

| Source | Finding | Confidence |
|---|---|---|
| **Huiberts RO et al. 2024**, *Sports Med* 54(2):485–503, PMID 37847373 | Meta-analysis of 59 studies (n ≈ 1500). Concurrent endurance interferes with **lower-body** strength in male athletes (SMD = −0.43, 95% CI [−0.59, −0.27], p < 0.001) but does **not** impair upper-body strength (SMD ≈ 0, p = 0.67). Decomposed by sex and body region; the lower-body effect attenuates in trained females and disappears in upper-body across both sexes | HIGH |
| **Feuerbacher JF et al. 2025**, *Scand J Med Sci Sports*, PMID 39921365 | Controlled RCT. Bench-press 1RM unimpaired in the concurrent group running lower-body HIIT alongside upper-body strength training, vs. strength-only control. Direct replication of the Huiberts upper-body null | MODERATE |
| **Spiering BA et al. 2021**, *J Strength Cond Res*, PMID 33629972 | Narrative + dose-response review. Minimum effective intensity to maintain 1RM in trained lifters is ≥75% 1RM; loads below that drift the user toward regression even at high total volume | HIGH |
| **Androulakis-Korakakis P et al. 2020**, *Sports Med*, PMID 31797219 | Systematic review of minimum dose. **One** hard set per week at ≥75% 1RM is sufficient to maintain (and in some populations grow) upper-body 1RM in trained lifters. Two-to-three sets sits comfortably above the floor with minimal extra recovery cost | HIGH |
| Accessory insufficiency (push-up biomechanics estimate) | Push-ups load the bench press pattern at ~40–45% bench 1RM (literature ranges 38–50% depending on foot elevation), well below the ≥75% maintenance threshold above. Inferred bench 1RM cost of a 12+ week Endurance block with no upper main lift: ~8–15% regression | LOW-MODERATE (informed interpolation, no direct RCT for this exact block length) |

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Strength days become dual-main-lift | The two `ENDURANCE_ANCHOR` strength sessions are restructured as **Strength A: Squat → Overhead Press** (Tue) and **Strength B: Deadlift → Bench Press** (Thu). Both upper lifts are programmed as main lifts (top set %TM, the archetype's normal wave), not as accessories | Adds protected upper-body main-lift exposure inside the same recovery budget. Huiberts 2024 says this exposure is not paid for in lower-body strength loss; Feuerbacher 2025 confirms bench specifically is not impaired by concurrent lower-body HIIT |
| 2 | Lower lift always sequenced first | Squat precedes OHP; Deadlift precedes Bench Press. No archetype-level override exposes the reverse order to the UI | The residual interference budget the meta-analyses *did* identify lands on lower-body strength. Putting the lower lift first protects the at-risk capacity; second-slot fatigue costs the upper lift a small amount of top-set quality, which is the cheaper trade |
| 3 | Upper main lift capped at 2–3 work sets | New per-day-template field `secondaryMaxSets: 3`. The prescription assembler emits at most that many sets for the secondary lift, sliced from the front of the archetype's normal `setIntensities` ladder (so the user still hits a real top set) | Androulakis-Korakakis 2020 (HIGH) shows 1 hard set/week at ≥75% 1RM is the minimum effective dose for 1RM maintenance; 2–3 sets is a small, evidence-supported margin above that floor that preserves endurance recovery. A full main-lift block on the secondary slot would blow the session length budget and would not buy additional 1RM maintenance |
| 4 | Pairing chosen for **rack ergonomics** | Squat pairs with Overhead Press and Deadlift pairs with Bench Press because the two lifts in each pair use the **same J-cup height** on a power rack — the bar lives at upper-chest / shoulder height for both. The user can superset or alternate sets without re-racking the J-cups or moving the bar between movements. This is explicit and load-bearing: it is the reason this pairing is the right one, not Squat+Bench / Deadlift+OHP | Session length budget is the binding constraint at ≤75 min. The pairing that removes rerack overhead is the pairing that fits. Squat+Bench would require either two racks or a J-cup move mid-session; Deadlift+OHP would split the bar between the floor and the rack. Squat+OHP and Deadlift+Bench keep the bar at one height across the pair |
| 5 | New `StrengthDay.secondaryRole` + sibling fields | Optional fields: `secondaryRole: StrengthRole`, `secondaryTitle?: string`, `secondaryCandidateSlugs?: string[]`, `secondaryMaxSets?: number`. Only `ENDURANCE_ANCHOR` uses them in v1; every other archetype's day templates are unchanged. The planner's strength-movement resolver picks a secondary movement using the same TM-gated candidate logic as the primary, and the resolved secondary movement is threaded through to `buildPrescription` | Smallest reasonable type extension. Avoids special-casing `archetype.id === "endurance_anchor"` anywhere in the prescription path — the behaviour is data-driven via the day template, and any future archetype that wants dual-main-lift days can opt in by setting these fields |
| 6 | Archetype change, not a settings toggle | The dual-main-lift shape ships baked into `ENDURANCE_ANCHOR`. No new wizard switch, no per-block override, no opt-out | Other archetypes (Strength Focus, Hybrid Focus, Maintenance) serve users who want different strength/cardio balances. A user who specifically does not want upper-body main lifts during an endurance block already has Maintenance (and can build a Custom block). Adding a toggle to Endurance instead would weaken the archetype's identity and complicate the wizard |
| 7 | One-liner copy | New oneLiner emphasises the dual-main-lift shape and the rack-ergonomics rationale: *"Cardio-led concurrent training. Polarized aerobic exposures (long Z2 + VO2 intervals) anchor the week. Two dual-main-lift strength sessions (squat + overhead press, deadlift + bench press — paired for rack-height efficiency) keep all four movement patterns covered without breaking the cardio focus."* | The previous copy implied lower-body only. The new copy is accurate about what the archetype now produces and surfaces the ergonomic rationale on the archetype picker card |
| 8 | Migration posture | **No retroactive change.** Existing active `training_blocks` rows with `archetype = 'endurance_anchor'` keep the day templates they were generated with (planned sessions live in the DB, not regenerated from the archetype library at runtime). Only newly-generated blocks pick up the new shape | Standard live-engine convention: archetype-library changes are forward-only. Forcing a regen mid-block would invalidate logged sets and break the user's calendar |

## Rationale (point by point)

**Why upper now.** Huiberts 2024 inverts the prior framing this codebase encoded. The interference effect, when it exists, is lower-body-only in males. Continuing to skip upper main lifts in Endurance is paying a real bench-1RM cost (push-up loading sits well below the maintenance threshold) to avoid an interference cost that the meta-analytic evidence says does not exist for the upper body.

**Why squat+OHP and deadlift+bench specifically.** The session length budget is ≤75 min (currently ~45–55 for Endurance strength days). Two main lifts in 75 min only works if the user can superset or rapidly alternate sets. Same-rack-height pairs — Squat+OHP at the J-cups, Deadlift+Bench at the J-cups — remove the only equipment manipulation that would otherwise fragment the session. The pairing is not a stylistic choice; it is the only pairing that physically fits without a rack-height change mid-session.

**Why lower first.** The interference residual that the meta-analyses *do* identify is in lower-body strength. Sequencing the lower lift first puts the at-risk capacity on fresh nervous system; the upper lift takes the residual-fatigue cost, which is small at 2–3 sets and which the evidence says is recoverable.

**Why the 2–3 set cap.** Androulakis-Korakakis 2020 (HIGH; systematic review of minimum effective dose) shows 1 set/wk at ≥75% 1RM maintains 1RM in trained lifters; Spiering 2021 (HIGH) reaches the same conclusion via a different review. Three sets is a small, evidence-supported margin above the floor — enough for a real top set + a couple back-offs — and it preserves the endurance-recovery budget that justifies the archetype's existence. A full 3-set wave (with the squat-day's normal volume) on the secondary slot would push session length past 75 min and would compete with the endurance signal for systemic recovery.

**Why archetype change, not settings toggle.** Endurance Anchor's identity is "cardio is the priority, strength is the floor that protects against regression". The dual-main-lift shape is the correct expression of that identity given the post-2024 evidence. Users who want a different strength/cardio balance have the other five archetypes; surfacing a per-block strength-day toggle would smear archetype semantics and grow the wizard surface for no real gain.

## Implementation contract

The behaviour is data-driven through the existing day-template machinery, not via per-archetype branches in the prescription pipeline.

* **Type extension.** `StrengthDay` gains four optional fields:
  ```ts
  secondaryRole?: StrengthRole;
  secondaryTitle?: string;
  secondaryCandidateSlugs?: string[];
  secondaryMaxSets?: number;
  ```
  Only `ENDURANCE_ANCHOR` populates them in v1. Every other archetype's day templates are byte-identical to before, so the existing prescription / picker / warmup / ceiling pipelines are unchanged for them.
* **Movement resolution.** `allCandidateLiftSlugs(archetype)` is extended to also walk `secondaryCandidateSlugs`, so the movements query in `actions.ts` continues to fetch every slug the planner can touch. The strength-day resolver runs the same `pickStrengthMovementForBand` logic for the secondary slot as for the primary, gated by TM presence. If the primary resolves but the secondary does not (no TM for any push pattern, say), the planner emits the primary lift only — the day still runs, the user just sees a one-lift session and the standard "no TM for X" hint surfaces in Settings.
* **Prescription assembly.** `buildPrescription` accepts an optional `secondaryMovement` argument. When present and the day template carries `secondaryMaxSets`, the assembler emits up to `secondaryMaxSets` items from the front of the wave (so the user still hits a top set), tagged `kind: "main"` against the secondary movement. The existing auto-warmup ladder (`prependWarmupsForMainLifts`) already iterates by movement and so produces a separate warmup ramp per main lift with no further change.
* **Stress / freshness accounting.** Secondary items flow through the same `set-load.ts` / `bucket-load.ts` / `region-ledger.ts` pipeline as primary items, so the upper-body load *is* counted in the user's freshness and ceiling state. No special-casing.

## Out of scope for this PR

* `STRENGTH_ANCHOR` and `CONCURRENT_HYBRID` stay on the four-separate-days shape (covered under Open follow-ups).
* No UI superset / back-to-back hint — the planner emits the items in pair order, but the rendering does not yet group them as a superset card.
* No change to the wave's intensity percentages or week profiles; the secondary slot reuses the archetype's existing maintenance-band `setIntensities`.
* No change to `accessoryProfile` for Endurance. Accessory volume stays where it is; this ADR adds main-lift exposure, it does not also add accessory exposure.

## Session shape — before / after

```
ENDURANCE_ANCHOR strength days, before this ADR:

  Tue  Strength — Squat (main, full wave)         + accessories            ~45–55 min
  Thu  Strength — Deadlift (main, full wave)      + accessories            ~45–55 min

ENDURANCE_ANCHOR strength days, after this ADR:

  Tue  Strength A — Squat (main, full wave)       → OHP   (≤3 sets)        target ≤75 min
                    [same J-cup height; superset or alternate sets]        + accessories
  Thu  Strength B — Deadlift (main, full wave)    → Bench (≤3 sets)        target ≤75 min
                    [same J-cup height; superset or alternate sets]        + accessories
```

The cardio layer (Mon easy Z2, Wed Z2+alactic finisher, Fri VO2 intervals, Sat long Z2, plus the Achilles HSR tendon floor) is unchanged.

## Implications

* **Session length.** Endurance strength days move from ~45–55 min (single lower lift + accessories) to a target ≤75 min (dual main lifts in a superset + accessories). Time-budget regression watch on real user sessions for the first 4 weeks after ship; if median session length exceeds 80 min, drop the secondary cap to 2.
* **Movement coverage.** The four main movement patterns (squat / hinge / horizontal press / vertical press) are all hit weekly in Endurance for the first time. The `requiredStrengthRoles(ENDURANCE_ANCHOR)` set grows from `{squat, deadlift}` to `{squat, deadlift, horizontal_press, vertical_press}`.
* **TM gating.** A user starting an Endurance block now needs TMs for all four main patterns to get the full prescription. The planner's "no TM set for X" error message already surfaces this for Strength Focus / Hybrid Focus users; the same path catches Endurance users in v2. Secondary slot gracefully skips if the secondary TM is missing — primary slot still prescribes.
* **Constraints doc.** New row in the CP-2 table in `hybrid-training-design-constraints.md` referencing this ADR.
* **Live engine spec.** §10 archetypes table in `hybrid-training-engine-live.md` updated to describe the new Endurance shape; §20 PR audit trail gets an ADR-0004 line.
* **No retroactive change** to in-flight Endurance blocks — only new blocks pick up the redesign (see Decision 8).

## Open follow-ups

* Whether `STRENGTH_ANCHOR` and `CONCURRENT_HYBRID` should also adopt the ergonomic squat+OHP / deadlift+bench pairing. Today both run the four main lifts on separate days. The rack-ergonomics rationale applies; the recovery-budget rationale does not (those archetypes do not run an endurance load that competes for recovery). Separate ADR if pursued.
* Whether to expose a superset / back-to-back UI hint in the planned-session card so users see the pairing intent without reading the ADR. Out of scope for this PR.
* Whether the 2–3 set cap should scale by week (e.g. 2 on heavy weeks, 3 on lighter weeks). Defer until 4 weeks of post-ship adherence data.
* Whether the secondary slot should accept the user's tempo / pause variant slugs (currently inherits `STRENGTH_ROLE_CANDIDATES.vertical_press` / `horizontal_press` wholesale). Open question for a follow-up if the data shows users abandoning the secondary because their TM is on a pause-bench variant the candidate list ranks low.
