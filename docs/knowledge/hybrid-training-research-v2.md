# Adaptive Hybrid Programming Engine --- System Spec Expansion

> **Research file role (added 2026-05-19):** This document is the **engine math spec** — one of three research files in this folder that together describe the engine the new app should implement. Its job is to translate v1's concepts into computable formulas, archetype specs, and decision trees. It does NOT define vocabulary (v1 does) and does NOT carry literature citations (`hybrid-training-research-new.md` does).
>
> **The three files and what each owns:**
>
> 1. **`hybrid-training-research-v1.md`** — Conceptual framework. Owns: anchor-filler model, stress-budget concept, five structural rules, durability-as-loading framing, aesthetics-as-explicit-programming framing, conditioning-modality interference profile, default weekly architecture, six-layer app architecture, recommended default product stance. **Read v1 first** — this file uses v1's vocabulary throughout.
> 2. **`hybrid-training-research-v2.md`** (this file) — Engine math spec. Owns: ceiling equation, recovery multiplier, bucket pressure, interference modifier, region caps, mesocycle archetype specs with stress budgets, user-tier inference, stall-vs-suppression diagnosis decision tree, AI-readable data model, planning pseudocode.
> 3. **`hybrid-training-research-new.md`** — Literature grounding + translation rules. Owns: citations with HIGH/MODERATE/LOW confidence labels, MV/MEV/MAV/MRV framework under concurrent stress, polarized 80/20 distribution data, modality-by-modality interference cost table, "Translation to app logic" code blocks at the end of every section, monitoring-stack priority (RPE / HRV / wellness scales), the program skeleton (year → block → week → day → rep), pre-mortem failure modes.
>
> **How to extract design constraints across the three:** when a principle appears in 2 or 3 files and they agree, treat it as **high-confidence** (cite all sources). When it appears in only one, cite that one and flag it for review. When two files conflict, flag the conflict for the project owner to resolve in Phase D (see `hybrid-training-app-plan.md` §8). For numerical thresholds: v2 carries default coefficients but they are explicitly labeled "Implementation default" — cross-check against the "new" file for literature support and adjust if `new` cites tighter or looser values.

---

**Scope:** This document is a **system-design specification** extending
the previously established conceptual framework for an adaptive hybrid
strength-and-conditioning app targeting advanced trainees (5+ years of
consistent structured training, beyond linear progression). It addresses
four specific gaps identified in review: the ceiling calculation model,
mesocycle archetype specification, user-tier inference from behaviour,
and stall-vs-suppression diagnosis. All claims are kept at the level of
established exercise-physiology consensus, coaching practice, and
explicit engineering assumptions. Where something is an **implementation
default** rather than settled principle, it is labelled accordingly.

![](./media/image1.png)

### Core insights at a glance

- **Ceiling = tolerance × recovery × specificity × local caps** — The ceiling should be computed from recovered chronic tolerance, then compressed or expanded by current recovery state, bucket-specific pressure, interference, and region-level caps.
- **Archetypes need explicit budgets** — Each block should carry a default stress-budget allocation, weekly template, deload rule, entry condition, and exit rule.
- **Tier is behavioural, not declared** — The engine should infer operational tier from anchor compliance, execution quality, schedule regularity, and recovery consistency rather than trusting self-report.
- **Stalls require diagnosis before prescription** — The system should separate underdosing, fatigue suppression, cross-quality interference, local tissue limits, and true adaptation plateaus before changing load.

## 0) Evidence-Informed Principles vs Implementation Defaults

  -------------------------------------------------------------------------
  Type                Use in the System
  ------------------- -----------------------------------------------------
  Evidence-informed   Use multiple signals together. No single marker (HRV,
  principle           soreness, sleep, or session performance) is reliable
                      enough to drive ceilings by itself.

  Evidence-informed   Base ceilings on recent recovered tolerance, not
  principle           absolute best weeks and not one-week spikes.

  Evidence-informed   Treat easy aerobic work and hard conditioning as
  principle           different stressors. The latter should carry much
                      higher interference cost when strength and lower-body
                      hypertrophy are priorities.

  Evidence-informed   Use local region caps when tissue symptoms rise,
  principle           rather than collapsing the entire plan.

  Implementation      The exact weights, threshold bands, evaluation
  default             windows, and promotion/demotion rules below are
                      engineering defaults that should be tuned from
                      observed user outcomes.
  -------------------------------------------------------------------------

## 1) Core Design Decisions

The missing piece in the previous framework was that **"ceiling"
remained conceptual**. This version makes it explicit:

1.  The engine computes **stress pressure** in six buckets: neural,
    mechanical, metabolic, impact, axial, and tissue-specific.

2.  It computes a **systemic recovery multiplier** from
    recovery/readiness and behavioural stability.

3.  It computes **per-region caps** from local symptoms plus regional
    loading spikes.

4.  It computes **per-quality ceilings** by multiplying: recovered
    chronic tolerance × global recovery multiplier × quality-specific
    bucket modifier × interference modifier × region cap × confidence
    bias.

5.  The scheduler then allocates floors and targets **under those
    ceilings**, with archetype-specific rules.

## 2) Canonical Internal Units

Use **two layers of units** --- one for the engine, one for user-facing
prescription.

  -----------------------------------------------------------------------
  Quality / Object Internal Unit               User-Facing Unit
  ---------------- --------------------------- --------------------------
  Lower-body max   strength exposure points or heavy / moderate
  strength         "heavy exposure            exposures, sets, top sets
                   equivalents"               

  Upper-body max   same                        same
  strength                                     

  Hypertrophy      effective hard sets by      sets per muscle or pattern
                   muscle group / pattern      

  Aerobic base     easy-conditioning load      minutes by modality
                   points                      

  Hard             hard-conditioning load      hard minutes / interval
  conditioning     points                      count

  Durability       regional tissue-capacity    microdose minutes,
                   points                      isometric sets, low-level
                                               exposures

  Global stress    bucket points               not shown directly unless
  buckets                                      user enables advanced view

  Regions          region risk score + cap     readiness flag / cap
                                               percentage
  -----------------------------------------------------------------------

**Recommendation:** keep **native user-facing units** per quality, but
store a **common internal stress ledger** by bucket and by region.

## 3) Ceiling Calculation Model

### 3.1 Data Primitives

#### Session load

Use **session RPE load** as the base internal-load primitive:

  ----------------------------------------------------------------------
  1 session_load_s = duration_minutes_s × session_RPE_s
  ----------------------------------------------------------------------

  ----------------------------------------------------------------------

#### Bucket tagging

Each session receives coefficients across the six stress buckets:

  ----------------------------------------------------------------------
  1 bucket_points_s,b = session_load_s × bucket_coeff_s,b
  ----------------------------------------------------------------------

  ----------------------------------------------------------------------

**Constraint:** the six bucket coefficients for one session should
normally sum to **1.0**.

Examples:

- Heavy squat day → high neural + mechanical + axial + tissue

- Long easy bike → mostly metabolic, minimal impact/axial

- Threshold run → mostly metabolic + impact + tissue, little neural

- Upper hypertrophy machine day → mostly mechanical + tissue, low neural

#### Region ledger

Regional stress is separate from the six global buckets:

  ----------------------------------------------------------------------
  1 region_points_s,r = session_load_s × region_coeff_s,r
  ----------------------------------------------------------------------

  ----------------------------------------------------------------------

**Important:** region coefficients do **not** need to sum to 1.0 because
one session can affect multiple regions.

### 3.2 Rolling Load State

For each bucket b and region r:

+----------------------------------------------------------------------+
| 1 ATL_b = EWMA_7(bucket_points_d,b)                                  |
|                                                                      |
| 2 CTL_b = EWMA_28(bucket_points_d,b)                                 |
|                                                                      |
| 3 ATL_r = EWMA_7(region_points_d,r)                                  |
|                                                                      |
| 4 CTL_r = EWMA_28(region_points_d,r)                                 |
|                                                                      |
| 5                                                                    |
+======================================================================+

ATL_r = EWMA_7(region_points_d,r)CTL_r = EWMA_28(region_points_d,r)

Use exponentially weighted moving averages:

+----------------------------------------------------------------------+
| 1 EWMA_n(t) = α × current_value + (1 - α) × EWMA_n(t-1)              |
|                                                                      |
| 2 α = 2 / (n + 1)                                                    |
+======================================================================+

#### Derived load variables

For each bucket:

+----------------------------------------------------------------------+
| 1 acute_pct_b   = ATL_b / baseline_tolerance_b                       |
|                                                                      |
| 2 ratio_b       = ATL_b / max(CTL_b, ε)                              |
|                                                                      |
| 3 monotony_b    = mean(daily_bucket_load_last_7d) /                  |
| max(sd(daily_bucket_load_last_7d), ε)                                |
|                                                                      |
| 4 strain_ratio_b = (ATL_b × monotony_b) / baseline_strain_b          |
+======================================================================+

For each region:

+----------------------------------------------------------------------+
| 1 regional_ratio_r = ATL_r / max(CTL_r, ε)                           |
|                                                                      |
| 2 novelty_r        = abs(current_7d_exposure_mix_r -                 |
| typical_28d_mix_r)                                                   |
+======================================================================+

### 3.3 Normalisation

All recovery and stress metrics should be normalised to **0--1 penalty
space**, where:

- 0.0 = low concern

- 1.0 = high concern

Default piecewise-linear normalisation:

+----------------------------------------------------------------------+
| 1 norm_high(x; good, bad) = clamp((x - good) / (bad - good), 0, 1)   |
|                                                                      |
| 2 norm_low(x; good, bad)  = clamp((good - x) / (good - bad), 0, 1)   |
+======================================================================+

Examples: monotony → norm_high; acute/chronic ratio → norm_high; resting
HR delta → norm_high; sleep score → norm_low; HRV delta below baseline →
norm_low.

#### Default normalisation bands

These are **implementation defaults**, not immutable truths.

  ---------------------------------------------------------------------------
  Variable          Raw Value                  Transform   Good Band Bad Band
  ----------------- -------------------------- ----------- --------- --------
  acute_pct_b       ATL relative to baseline   norm_high   0.90      1.35
                    bucket tolerance                                 

  ratio_b           ATL / CTL                  norm_high   0.95      1.30

  monotony_b        mean / SD over 7 days      norm_high   1.30      2.50

  strain_ratio_b    current strain vs baseline norm_high   1.00      1.40
                    strain                                           

  Sleep score       user score or derived      norm_low    85        60
                    score                                            

  HRV delta         7-day vs personal baseline norm_low    -2%       -12%

  Resting HR delta  current vs personal        norm_high   +0 bpm    +6 bpm
                    baseline                                         

  Compliance        missed prescribed work     norm_high   5%        30%
  instability       proportion                                       

  Anchor miss rate  missed anchor sessions     norm_high   0%        25%
                    proportion                                       

  Global soreness   0--10                      norm_high   1         6

  Local symptom     0--10 by region            norm_high   0         6
  score                                                              

  Novelty           fractional change in       norm_high   0.10      0.50
                    regional exposure                                
  ---------------------------------------------------------------------------

**If personal baselines are stable enough**, replace fixed bands with
rolling robust bands using median/MAD. For onboarding or sparse-data
users, fixed bands are safer.

### 3.4 Bucket Pressure

For each stress bucket:

+----------------------------------------------------------------------+
| 1 pressure_b =                                                       |
|                                                                      |
| 2 0.35 × N_acute_pct_b +                                             |
|                                                                      |
| 3 0.25 × N_ratio_b +                                                 |
|                                                                      |
| 4 0.20 × N_monotony_b +                                              |
|                                                                      |
| 5 0.20 × N_strain_b                                                  |
+======================================================================+

Interpretability rationale:

- **acute_pct** = absolute recent dose relative to baseline tolerance
  (highest weight because it represents the direct loading signal)

- **ratio** = short-vs-long load relationship (second because spikes
  relative to chronic load are the primary injury/overreaching risk)

- **monotony** = day-to-day variation problem (lower weight because it
  is meaningful but not dominant)

- **strain** = load × monotony interaction (same weight as monotony;
  captures the combined effect)

These values are good **starting coefficients** for an adaptive engine
because they are readable, sum to 1.0, and easy to recalibrate from real
outcomes.

### 3.5 Systemic Recovery Penalty

This is the **non-bucket** penalty layer.

+----------------------------------------------------------------------+
| 1 systemic_penalty =                                                 |
|                                                                      |
| 2 0.30 × N_sleep +                                                   |
|                                                                      |
| 3 0.22 × N_HRV +                                                     |
|                                                                      |
| 4 0.16 × N_RHR +                                                     |
|                                                                      |
| 5 0.16 × N_compliance_instability +                                  |
|                                                                      |
| 6 0.16 × N_global_soreness                                           |
+======================================================================+

**Notes:**

- If HRV is unavailable, redistribute its 0.22 weight across sleep
  (+0.08), RHR (+0.07), and soreness (+0.07).

- If recovery data is sparse overall, apply a **confidence penalty**
  (section 3.11) rather than pretending the user is fresh.

- Compliance instability belongs here because erratic behaviour reduces
  the reliability of aggressive ceilings.

### 3.6 Global Recovery Multiplier

Each mesocycle archetype defines default **block weights** across the
stress buckets. Let BW_b be those block weights.

+----------------------------------------------------------------------+
| 1 global_pressure = Σ(BW_b × pressure_b)                             |
|                                                                      |
| 2 GRM = clamp(                                                       |
|                                                                      |
| 3 1.07                                                               |
|                                                                      |
| 4 0.18 × global_pressure                                             |
|                                                                      |
| 5 0.12 × systemic_penalty,                                           |
|                                                                      |
| 6 0.70,                                                              |
|                                                                      |
| 7 1.08                                                               |
|                                                                      |
| 8 )                                                                  |
|                                                                      |
| 9                                                                    |
+======================================================================+

- 0.18 × global_pressure

- 0.12 × systemic_penalty,0.70,1.08)

Where:

- **GRM** = global recovery multiplier

- Values below 1.0 compress ceilings

- Values above 1.0 allow mild expansion

**Interpretation bands:**

  -----------------------------------------------------------------------
  GRM Range    Meaning
  ------------ ----------------------------------------------------------
  1.02--1.08   User is tolerating current work very well; small increases
               may be accepted

  0.95--1.02   Normal operating band

  0.88--0.94   Meaningful compression; volume or intensity reductions
               warranted

  0.70--0.87   Deload territory or major local-substitution territory
  -----------------------------------------------------------------------

### 3.7 Quality-Specific Bucket Modifier

Each quality is more sensitive to some buckets than others. Use a
**quality sensitivity matrix**.

#### Default sensitivity matrix

  ------------------------------------------------------------------------------------
  Quality                  Neural   Mechanical   Metabolic   Impact   Axial   Tissue
  ------------------------ -------- ------------ ----------- -------- ------- --------
  Lower-body max strength  0.30     0.18         0.08        0.10     0.16    0.18

  Upper-body max strength  0.32     0.20         0.06        0.00     0.12    0.30

  Lower-body hypertrophy   0.08     0.30         0.10        0.08     0.10    0.34

  Upper-body hypertrophy   0.10     0.32         0.08        0.00     0.08    0.42

  Aerobic base (bike/erg)  0.04     0.06         0.56        0.00     0.04    0.30

  Aerobic base (running)   0.04     0.06         0.42        0.18     0.02    0.28

  Hard conditioning (erg)  0.06     0.06         0.58        0.00     0.04    0.26

  Hard conditioning        0.06     0.06         0.46        0.20     0.02    0.20
  (running)                                                                   

  Durability / regional    0.04     0.18         0.04        0.12     0.10    0.52
  tissue work                                                                 
  ------------------------------------------------------------------------------------

Then:

+----------------------------------------------------------------------+
| 1 quality_pressure_q = Σ(sensitivity_q,b × pressure_b)               |
|                                                                      |
| 2                                                                    |
|                                                                      |
| 3 quality_modifier_q = clamp(                                        |
|                                                                      |
| 4 1.04 - 0.18 × quality_pressure_q,                                  |
|                                                                      |
| 5 0.78,                                                              |
|                                                                      |
| 6 1.04                                                               |
|                                                                      |
| 7 )                                                                  |
|                                                                      |
| 8                                                                    |
+======================================================================+

quality_modifier_q = clamp(1.04 - 0.18 × quality_pressure_q,0.78,1.04)

**Trade-off:** Higher sensitivity weights mean the quality is protected
more aggressively from that bucket\'s pressure --- but also mean the
ceiling drops faster when that bucket is stressed. The matrix above
reflects the principle that strength is most sensitive to neural and
axial stress, hypertrophy to mechanical and tissue stress, and
conditioning to metabolic and impact stress.

### 3.8 Interference Modifier

This layer separates raw stress from quality expression. Its purpose is
to prevent the engine from misdiagnosing fatigue-suppressed performance
as a genuine stall.

#### Core rule

Do **not** assume a quality is underdosed if its KPI is flat. First
calculate whether **conflicting work is suppressing expression**.

+----------------------------------------------------------------------+
| 1 overload_c = max(0, delivered_dose_c / target_dose_c - 1)          |
|                                                                      |
| 2 interference_q = Σ(conflict_q,c × overload_c)                      |
|                                                                      |
| 3 interference_modifier_q = clamp(                                   |
|                                                                      |
| 4 1.00 - 0.25 × interference_q,                                      |
|                                                                      |
| 5 0.80,                                                              |
|                                                                      |
| 6 1.00                                                               |
|                                                                      |
| 7 )                                                                  |
|                                                                      |
| 8                                                                    |
+======================================================================+

interference_modifier_q = clamp(1.00 - 0.25 × interference_q,0.80,1.00)

#### Example conflict defaults

  -----------------------------------------------------------------------
  Target Quality     Main Conflicts
  ------------------ ----------------------------------------------------
  Lower-body max     hard running, high-impact work, lower-body
  strength           glycolytic density

  Lower-body         hard running, sprinting/plyos, threshold work too
  hypertrophy        close to leg volume

  Upper-body         less global interference; usually affected by
  hypertrophy        systemic fatigue rather than direct conflict

  Aerobic base       very little direct conflict unless global fatigue is
                     extreme

  Hard conditioning  heavy lower-body strength blocks, high axial
                     fatigue, poor freshness
  -----------------------------------------------------------------------

### 3.9 Region Caps

For each tracked region r:

+----------------------------------------------------------------------+
| 1 region_risk_r =                                                    |
|                                                                      |
| 2 0.45 × N_local_symptom_r +                                         |
|                                                                      |
| 3 0.25 × N_regional_ratio_r +                                        |
|                                                                      |
| 4 0.15 × N_novelty_r +                                               |
|                                                                      |
| 5 0.15 × N_stiffness_r                                               |
|                                                                      |
| 6 region_cap_r = clamp(                                              |
|                                                                      |
| 7 1.00 - 0.25 × region_risk_r,                                       |
|                                                                      |
| 8 0.70,                                                              |
|                                                                      |
| 9 1.00                                                               |
|                                                                      |
| 10 )                                                                 |
|                                                                      |
| 11                                                                   |
+======================================================================+

region_cap_r = clamp(1.00 - 0.25 × region_risk_r,0.70,1.00)

**Why this matters:** The whole plan should not collapse because one
region is irritated. The engine should instead compress exposures that
load that region directly, swap modality if needed, and preserve
unaffected qualities.

**Example:** Irritated Achilles → reduce running impact ceiling,
preserve bike aerobic work. Irritated shoulder → reduce overhead and
pressing ceiling, preserve lower-body and pulling work.

### 3.10 Base Ceiling (Recovered Chronic Tolerance)

The engine should **not** build ceilings from the hardest recent week.
It should build them from **recovered weeks**.

#### Recovered week criteria

A week qualifies as "recovered" if all of the following are true:

- Anchor completion ≥ 85%

- No global soreness average \> 5/10

- No local symptom increase \> 2 points vs the prior week

- No persistent performance crash across two anchor exposures

- No severe sleep or readiness deterioration

Then:

+----------------------------------------------------------------------+
| 1 base_ceiling_q =                                                   |
|                                                                      |
| 2 max(                                                               |
|                                                                      |
| 3 floor_q,                                                           |
|                                                                      |
| 4 median(last_3_recovered_weeks_dose_q) × headroom_q                 |
|                                                                      |
| 5 )                                                                  |
+======================================================================+

Where:

+----------------------------------------------------------------------+
| 1 headroom_q = clamp(                                                |
|                                                                      |
| 2 1.00                                                               |
|                                                                      |
| 3 0.02 × positive_response_streak_q                                  |
|                                                                      |
| 4 0.03 × recent_local_flags_q,                                       |
|                                                                      |
| 5 0.95,                                                              |
|                                                                      |
| 6 1.06                                                               |
|                                                                      |
| 7 )                                                                  |
|                                                                      |
| 8                                                                    |
+======================================================================+

- 0.03 × recent_local_flags_q,0.95,1.06)

**Implementation default:** positive_response_streak_q is capped at 2 to
prevent runaway optimism after two good weeks.

**Trade-off:** Using the median of only the last 3 recovered weeks makes
the base ceiling responsive to recent capacity but can be skewed if one
recovered week was unusually light. Using 4--6 recovered weeks is more
stable but slower to adapt. The 3-week default is recommended for early
deployment; expand the window as the data volume grows.

### 3.11 Final Ceiling Equation

+----------------------------------------------------------------------+
| 1 ceiling_q =                                                        |
|                                                                      |
| 2 base_ceiling_q                                                     |
|                                                                      |
| 3 × GRM                                                              |
|                                                                      |
| 4 × quality_modifier_q                                               |
|                                                                      |
| 5 × interference_modifier_q                                          |
|                                                                      |
| 6 × region_cap_factor_q                                              |
|                                                                      |
| 7 × confidence_bias                                                  |
+======================================================================+

#### Confidence bias

If data completeness is weak:

  -----------------------------
  Data           Confidence
  Confidence     Bias
  -------------- --------------
  ≥ 0.80         1.00

  0.60--0.79     0.95

  \< 0.60        0.90
  -----------------------------

#### Region cap factor

Use:

- **Weighted mean** of relevant region caps for broad qualities (e.g.,
  aerobic base on bike draws from knee, hip, and lumbar caps, weighted
  by their relevance to cycling)

- **Minimum critical-region cap** for high-risk exposures like running,
  plyometrics, or deep knee-dominant lower-body work

### 3.12 Inputs → Transformations → Outputs

  -------------------------------------------------------------------------------
  Layer            Input              Transformation    Output
  ---------------- ------------------ ----------------- -------------------------
  Session          duration, sRPE,    session_load =    session load
  ingestion        exercise tags,     duration × sRPE   
                   modality                             

  Bucket tagging   exercise/session   multiply by       bucket points by session
                   bucket             session_load      
                   coefficients                         

  Region tagging   regional           multiply by       region points by session
                   coefficients       session_load      

  Rolling state    7d / 28d EWMAs     EWMA calculations ATL / CTL by bucket and
                                                        region

  Load compression acute %, ratio,    piecewise         pressure_b
  risk             monotony, strain   normalisation     

  Recovery         sleep, HRV, RHR,   normalisation +   systemic_penalty
  readiness        soreness,          weighted sum      
                   compliance                           

  Global           archetype bucket   weighted sum +    GRM
  recoverability   weights + systemic clamp             
                   penalty                              

  Quality          quality-specific   weighted sum +    quality_modifier_q
  sensitivity      sensitivity matrix clamp             

  Cross-quality    conflict matrix +  weighted sum +    interference_modifier_q
  conflict         current overloads  clamp             

  Local tissue     symptoms, regional weighted sum +    region_cap_r
  status           ratio, novelty,    clamp             
                   stiffness                            

  Data quality     missingness / weak confidence rules  confidence_bias
                   baselines                            

  Final allocation base recovered     multiply          ceiling_q
                   tolerance × all                      
                   modifiers                            
  -------------------------------------------------------------------------------

### 3.13 Worked Example

#### User state

Balanced hybrid block. Last three **recovered** weeks produced:

- Lower-body strength: **2.0 heavy exposure equivalents**

- Lower-body hypertrophy: **18 effective sets**

- Easy aerobic (bike): **165 minutes**

- Hard running: **24 hard minutes**

#### Current normalised bucket pressures

After ingesting 7d/28d load data:

  -----------------------
  Bucket       Pressure
  ------------ ----------
  Neural       0.42

  Mechanical   0.39

  Metabolic    0.63

  Impact       0.79

  Axial        0.31

  Tissue       0.58
  -----------------------

#### Balanced-block bucket weights

  ---------------------
  Bucket       Weight
  ------------ --------
  Neural       0.18

  Mechanical   0.24

  Metabolic    0.22

  Impact       0.08

  Axial        0.12

  Tissue       0.16
  ---------------------

Then:

+----------------------------------------------------------------------+
| 1 global_pressure                                                    |
|                                                                      |
| 2 = 0.18×0.42 + 0.24×0.39 + 0.22×0.63 + 0.08×0.79 + 0.12×0.31 +      |
| 0.16×0.58                                                            |
|                                                                      |
| 3 = 0.0756 + 0.0936 + 0.1386 + 0.0632 + 0.0372 + 0.0928              |
|                                                                      |
| 4 = 0.501                                                            |
+======================================================================+

#### Systemic penalty

Current normalised readiness values:

- Sleep = 0.44

- HRV = 0.50

- Resting HR = 0.67

- Compliance instability = 0.48

- Global soreness = 0.60

Then:

+----------------------------------------------------------------------+
| 1 systemic_penalty                                                   |
|                                                                      |
| 2 = 0.30×0.44 + 0.22×0.50 + 0.16×0.67 + 0.16×0.48 + 0.16×0.60        |
|                                                                      |
| 3 = 0.132 + 0.110 + 0.1072 + 0.0768 + 0.096                          |
|                                                                      |
| 4 = 0.522                                                            |
+======================================================================+

#### Global recovery multiplier

+----------------------------------------------------------------------+
| 1 GRM                                                                |
|                                                                      |
| 2 = clamp(1.07 - 0.18×0.501 - 0.12×0.522, 0.70, 1.08)                |
|                                                                      |
| 3 = clamp(1.07 - 0.0902 - 0.0626, 0.70, 1.08)                        |
|                                                                      |
| 4 = clamp(0.917, 0.70, 1.08)                                         |
|                                                                      |
| 5 = 0.917                                                            |
+======================================================================+

**Interpretation:** GRM of 0.917 falls in the meaningful-compression
band (0.88--0.94). The engine should reduce total loading modestly, with
targeted cuts where bucket pressure is highest.

#### Knee region cap

Assume the knee has: local symptom = 3/10, regional ratio = elevated,
novelty = moderate, stiffness = moderate. That yields region_cap_knee =
0.83.

#### Final ceilings (with intermediate arithmetic)

Assume: lower-body quality modifier = 0.95; lower-body interference
modifier = 0.95; bike aerobic modifier = 0.98; hard running quality
modifier = 0.90; hard running interference modifier = 0.91; confidence
bias = 1.00.

**Lower-body strength ceiling:**

+----------------------------------------------------------------------+
| 1 = 2.0 × 0.917 × 0.95 × 0.95 × 0.83 × 1.00                          |
|                                                                      |
| 2 = 2.0 × 0.917 = 1.834                                              |
|                                                                      |
| 3 × 0.95 = 1.742                                                     |
|                                                                      |
| 4 × 0.95 = 1.655                                                     |
|                                                                      |
| 5 × 0.83 = 1.374                                                     |
|                                                                      |
| 6 ≈ 1.37 heavy exposure equivalents                                  |
+======================================================================+

**Translation:** One heavy lower-body anchor stays. The second
lower-body session becomes a reduced-volume technique/moderate session.

**Lower-body hypertrophy ceiling:**

+----------------------------------------------------------------------+
| 1 = 18 × 0.917 × 0.95 × 0.93 × 0.83 × 1.00                           |
|                                                                      |
| 2 = 18 × 0.917 = 16.506                                              |
|                                                                      |
| 3 × 0.95 = 15.681                                                    |
|                                                                      |
| 4 × 0.93 = 14.583                                                    |
|                                                                      |
| 5 × 0.83 = 12.104                                                    |
|                                                                      |
| 6 ≈ 12.1 effective sets                                              |
+======================================================================+

**Translation:** Cut lower-body hypertrophy from \~18 sets to \~12 sets
for this week.

**Easy bike aerobic ceiling:**

+----------------------------------------------------------------------+
| 1 = 165 × 0.917 × 0.98 × 1.00 × 1.00 × 1.00                          |
|                                                                      |
| 2 = 165 × 0.917 = 151.3                                              |
|                                                                      |
| 3 × 0.98 = 148.3                                                     |
|                                                                      |
| 4 ≈ 148 minutes                                                      |
+======================================================================+

**Translation:** Easy bike minutes stay relatively high --- the system
correctly identifies that the current issue is not systemic aerobic
overload but rather lower-body and impact-specific pressure.

**Hard running ceiling:**

+----------------------------------------------------------------------+
| 1 = 24 × 0.917 × 0.90 × 0.91 × 0.83 × 1.00                           |
|                                                                      |
| 2 = 24 × 0.917 = 22.008                                              |
|                                                                      |
| 3 × 0.90 = 19.807                                                    |
|                                                                      |
| 4 × 0.91 = 18.025                                                    |
|                                                                      |
| 5 × 0.83 = 14.961                                                    |
|                                                                      |
| 6 ≈ 15.0 hard running minutes                                        |
+======================================================================+

**Translation:** Hard running minutes drop from 24 to \~15. The engine
compresses running specifically because impact pressure (0.79) is the
highest bucket, the knee region cap (0.83) directly penalises running,
and the interference modifier (0.91) reflects conflict with lower-body
priorities.

#### What the engine should do this week

- Preserve one heavy lower-body strength anchor.

- Downshift the second lower-body session to moderate load/volume.

- Keep easy bike volume close to normal (\~148 of 165 minutes).

- Reduce hard running from 24 to \~15 minutes.

- Maintain upper-body work more normally if shoulder/elbow region caps
  are clean.

- If knee symptoms persist beyond one more week, further compress impact
  and deep-knee-flexion ceilings.

The chart below shows the intended behaviour of this model over an
illustrative 14-day microcycle.

【5000†embed_image】

*Figure 1: Illustrative output of the ceiling model across a 14-day
microcycle, showing rolling 7-day stress, recovery capacity score, and
the resulting weekly ceiling as a percentage of recovered chronic
tolerance. Note how the ceiling dips to its lowest point when fatigue
and monotony peak simultaneously, then recovers as stress drops on rest
days.*

## 4) Mesocycle Archetype Specification

### 4.1 Default Stress-Budget Allocation by Archetype

These are the **normalised planning-unit shares** across the six stress
buckets for each archetype. All rows sum to 1.00.

  --------------------------------------------------------------------------------------
  Stress       Balanced       Strength-Biased   Aesthetic    Engine-Biased   Rebuild /
  Bucket       Hybrid Build                     Hybrid                       Return
  ------------ -------------- ----------------- ------------ --------------- -----------
  Neural       0.18           0.28              0.12         0.10            0.08

  Mechanical   0.24           0.20              0.30         0.14            0.20

  Metabolic    0.22           0.14              0.18         0.34            0.22

  Impact       0.08           0.06              0.06         0.14            0.06

  Axial        0.12           0.16              0.10         0.08            0.10

  Tissue       0.16           0.16              0.24         0.20            0.34
  --------------------------------------------------------------------------------------

**How these weights are used:** They feed the GRM calculation (section
3.6) and determine which buckets are weighted most heavily when
evaluating global pressure. A strength-biased block, for example, gives
neural bucket pressure nearly twice the influence of a balanced block,
meaning the engine protects freshness more aggressively.

### 4.2 Full Archetype Specifications

#### A. Balanced Hybrid Build

  -----------------------------------------------------------------------
  Attribute     Specification
  ------------- ---------------------------------------------------------
  Block length  5--6 weeks (4 loading + 1 deload; or 5 loading + 1 deload
                for high-resilience users)

  Primary       Strength + aerobic base
  qualities     

  Secondary     Hypertrophy + durability
  qualities     

  Maintenance   Anaerobic capacity
  qualities     

  Default       2 strength anchors (1 lower, 1 upper); 2--3 hypertrophy
  weekly        sessions; 3 easy aerobic sessions; 0--1 hard conditioning
  structure     touch; daily resilience microdoses

  Progression   Strength: add load or reps on anchor lifts across weeks.
  strategy      Aerobic: add 5--10% easy volume per week. Hypertrophy:
                add 1--2 sets per muscle per week across the block. Hard
                conditioning: hold or reduce frequency; increase
                quality/density only if aerobic base supports it.

  Deload        Week 5 (or 6): reduce total volume by 40--50%; keep
  protocol      intensity on anchors at 85--90% of peak-week loads; keep
                2 easy aerobic sessions; drop hard conditioning; maintain
                movement access across all patterns.

  Entry         Default block. Use when no specific goal or event
  conditions    dominates; returning from a specialty block; general
                year-round development phase.

  Exit /        If strength anchors plateau for 2+ mesocycles despite
  transition    adequate ceiling → transition to strength-biased. If
  logic         aerobic metrics stall and the user has capacity goals →
                transition to engine-biased. If user enters a fat-loss or
                physique-focused phase → transition to aesthetic. If new
                injury or returning from break → transition to rebuild.
                If all qualities progressing → repeat balanced block with
                updated targets.

  Risks and     \(1\) Everything stays moderate; no quality breaks
  failure modes through plateaus. Mitigate by monitoring anchor trends
                and transitioning if stagnation persists. (2) User adds
                too much hard conditioning, collapsing the
                strength/hypertrophy signal. Mitigate by defaulting hard
                conditioning to 0--1 session/week and escalating only
                when aerobic base is demonstrably strong.
  -----------------------------------------------------------------------

#### B. Strength-Biased Hybrid

  -----------------------------------------------------------------------
  Attribute     Specification
  ------------- ---------------------------------------------------------
  Block length  4--6 weeks (3--4 loading + 1 deload; shorter blocks for
                very high neural cost)

  Primary       Maximal strength
  qualities     

  Secondary     Upper-body hypertrophy + aerobic base
  qualities     

  Maintenance   Lower-body hypertrophy + anaerobic capacity
  qualities     

  Default       3 strength anchors (2 lower, 1 upper --- or 1 lower, 2
  weekly        upper depending on goal); 1--2 hypertrophy sessions
  structure     (upper focus); 2 easy aerobic sessions (bike/erg
                preferred); 0 hard conditioning by default; daily
                resilience microdoses

  Progression   Strength: wave load across 3--4 weeks --- e.g., week 1 at
  strategy      RPE 7.5, week 2 at RPE 8, week 3 at RPE 8.5--9, week 4
                deload. Aerobic: hold volume stable; do not attempt
                aerobic progression during a strength block. Hypertrophy:
                hold or very slightly increase upper-body sets only.

  Deload        Drop strength volume by 40--50%, keep 1--2 top singles at
  protocol      80--85% of peak to preserve neural patterning. Maintain
                all easy aerobic. Reduce accessories to floor.

  Entry         Strength has stalled for 2+ balanced blocks despite
  conditions    adequate recovery. User has an event requiring force
                output. User self-selects strength as the current
                priority and ceiling space permits.

  Exit /        If strength anchors hit new performance levels →
  transition    transition back to balanced to consolidate. If lower-body
  logic         hypertrophy or aerobic markers degrade more than 1 tier →
                transition to balanced or engine-biased. Block should not
                repeat more than 2 times consecutively without a
                balanced-block interlude.

  Risks and     \(1\) Aerobic fitness erodes if block runs too long or is
  failure modes repeated. Mitigate with strict 2-block cap and aerobic
                floor compliance monitoring. (2) Lower-body hypertrophy
                drops significantly. Mitigate by preserving floor-dose
                lower-body sets (even at reduced volume) and using
                low-fatigue quad/glute accessories.
  -----------------------------------------------------------------------

#### C. Aesthetic Hybrid

  -----------------------------------------------------------------------
  Attribute     Specification
  ------------- ---------------------------------------------------------
  Block length  6--8 weeks (5--6 loading + 1--2 deload; longer blocks
                because hypertrophy adapts slowly)

  Primary       Hypertrophy + body composition
  qualities     

  Secondary     Aerobic base + durability
  qualities     

  Maintenance   Max strength + anaerobic capacity
  qualities     

  Default       4--5 hypertrophy sessions (per-muscle priority split); 1
  weekly        strength anchor (maintenance load); 2--3 easy aerobic
  structure     sessions (low-impact); 0 hard conditioning; daily
                resilience microdoses

  Progression   Hypertrophy: add 1--2 hard sets per priority muscle per
  strategy      week across the block (e.g., start at 10 sets/week for
                priority muscles, end at 16--18). Strength: hold load
                stable on 1 key compound per pattern; do not chase PRs.
                Aerobic: hold time stable; use easy modalities only. Body
                composition: align nutrition phase (mild surplus for
                growth, mild deficit for lean-out).

  Deload        Reduce hypertrophy volume by 50% but maintain proximity
  protocol      to failure on 1 top set per exercise (stimulus
                preservation). Maintain 1 strength anchor at reduced
                volume. Keep easy aerobic. This block benefits from a
                slightly longer deload (7--10 days) due to accumulated
                mechanical/tissue stress.

  Entry         User selects physique/body-composition as the current
  conditions    priority. User enters a nutritional phase (surplus or
                deficit) that should be paired with appropriate volume.
                User has been in a balanced or engine-biased block and
                wants to direct gains toward specific muscle groups.

  Exit /        If per-muscle volume targets are met and progress has
  transition    plateaued (measured by circumference, photo, or
  logic         set-performance trend) → transition to balanced or
                strength-biased. If energy availability drops too low
                (bodyweight falling faster than target + strength
                slipping) → reduce volume toward balanced levels and
                address nutrition. If durability markers worsen (regional
                tissue symptoms rising) → shift to rebuild.

  Risks and     \(1\) Total mechanical stress becomes too high, causing
  failure modes tendon/joint irritation, especially in shoulders and
                elbows during high pressing/pulling volume. Mitigate with
                tissue-cap logic and embedded resilience work. (2) User
                in a deficit adds too much volume, creating an
                unsustainable combined stressor. Mitigate by tying volume
                ceiling to body-composition phase --- deficit phases
                should carry a 15--20% lower hypertrophy ceiling than
                surplus phases.
  -----------------------------------------------------------------------

#### D. Engine-Biased Hybrid

  -----------------------------------------------------------------------
  Attribute     Specification
  ------------- ---------------------------------------------------------
  Block length  4--6 weeks (3--5 loading + 1 deload)

  Primary       Aerobic base + threshold/VO₂max
  qualities     

  Secondary     Durability + upper-body hypertrophy
  qualities     

  Maintenance   Max strength
  qualities     

  Default       3--4 easy aerobic sessions (may include 1 long session);
  weekly        1--2 hard conditioning sessions (threshold or VO₂max
  structure     intervals); 1 strength anchor (maintenance); 1 upper-body
                hypertrophy session; daily resilience microdoses with
                emphasis on impact-loaded regions

  Progression   Aerobic: add easy volume first (frequency or duration,
  strategy      \~5--10% per week), then add quality to hard sessions.
                Threshold/VO₂max: progress interval count or density ---
                not both simultaneously. Strength: hold. Hypertrophy:
                hold upper-body only.

  Deload        Cut hard conditioning volume by 50%. Keep easy aerobic at
  protocol      60--70% of peak volume. Maintain 1 strength anchor. Keep
                movement across all patterns.

  Entry         Aerobic metrics (pace at easy HR, recovery kinetics,
  conditions    resting HR trends) have stagnated for 2+ balanced blocks.
                User has an endurance-adjacent event or goal. User
                subjectively reports poor work capacity or recovery
                between efforts.

  Exit /        If aerobic markers improve to target → transition to
  transition    balanced. If strength declines more than 1 tier →
  logic         transition to balanced or strength-biased. Do not repeat
                more than 2 consecutive engine blocks if lower-body
                hypertrophy is declining.

  Risks and     \(1\) Adding hard conditioning too aggressively collapses
  failure modes strength and lower-body size. Mitigate by enforcing the
                rule that easy aerobic volume increases first; hard
                sessions increase only after the easy base is
                established. (2) Running-dominant conditioning causes
                impact injuries if tissue tolerance was not built.
                Mitigate by defaulting to low-impact modalities (bike,
                erg) unless running is explicitly a goal and the regional
                tissue history supports it.
  -----------------------------------------------------------------------

#### E. Rebuild / Return

  -----------------------------------------------------------------------
  Attribute     Specification
  ------------- ---------------------------------------------------------
  Block length  3--5 weeks (all loading; no formal deload needed because
                intensity is deliberately low)

  Primary       Durability + aerobic base
  qualities     

  Secondary     Hypertrophy (general reintroduction)
  qualities     

  Maintenance   Heavy strength + anaerobic capacity (held at very
  qualities     conservative floor)

  Default       3 easy aerobic sessions; 2--3 general hypertrophy
  weekly        sessions at conservative loads; daily resilience/mobility
  structure     work (longer microdoses: 10--15 minutes); 1 light
                strength exposure per week focusing on full ROM and
                technique

  Progression   Durability: increase ROM depth and load variety each
  strategy      week; add unilateral and eccentric work progressively.
                Aerobic: add 10--15% volume per week if tolerated.
                Hypertrophy: increase sets per week toward normal floor
                doses by end of block. Strength: reintroduce moderate
                loads in week 2--3; do not chase intensity.

  Deload        Not typically required within a rebuild block because the
  protocol      entire block operates below the user\'s ceiling. If
                fatigue accumulates nonetheless, reduce to 2 movement
                sessions for 3--4 days before resuming.

  Entry         Returning from injury. Returning from \>2 weeks of no
  conditions    training. High-stress life period where compliance
                dropped below 50% for 3+ weeks. User reports persistent
                low motivation, elevated pain, or erratic recovery
                metrics.

  Exit /        When anchor compliance stabilises ≥ 80%, pain scores
  transition    return to baseline, and aerobic metrics are within 90% of
  logic         prior baseline → transition to balanced. Do not skip
                directly from rebuild to a specialty block
                (strength-biased, aesthetic, or engine-biased).

  Risks and     \(1\) User feels "too easy" and pushes intensity
  failure modes prematurely. Mitigate by communicating the block\'s
                purpose as restoration and constraining intensity
                ceilings to 80% of pre-rebuild values. (2) User stays in
                rebuild too long and detunes. Mitigate by setting a
                maximum rebuild duration of 5 weeks with automatic
                transition logic.
  -----------------------------------------------------------------------

### 4.3 Block Transition State Machine

+-------------------------------------------------------------------------------+
| 1 Current Block           Condition                             → Next Block  |
|                                                                               |
| 2                                                                             |
| ───────────────────────────────────────────────────────────────────────────── |
|                                                                               |
| 3 balanced                strength stalled 2+ blocks            →             |
| strength_biased                                                               |
|                                                                               |
| 4 balanced                aerobic stalled 2+ blocks             →             |
| engine_biased                                                                 |
|                                                                               |
| 5 balanced                user enters body-comp phase           → aesthetic   |
|                                                                               |
| 6 balanced                injury / break / low compliance       → rebuild     |
|                                                                               |
| 7 balanced                all progressing                       → balanced    |
| (repeat)                                                                      |
|                                                                               |
| 8                                                                             |
|                                                                               |
| 9 strength_biased         new strength PRs achieved             → balanced    |
|                                                                               |
| 10 strength_biased         aerobic/hypertrophy degrade \> 1 tier  → balanced  |
|                                                                               |
| 11 strength_biased         2 consecutive strength blocks done    → balanced   |
| (forced)                                                                      |
|                                                                               |
| 12 aesthetic               volume targets met, progress plateau  → balanced   |
|                                                                               |
| 13 aesthetic               energy availability crisis            → balanced   |
| (reduce)                                                                      |
|                                                                               |
| 14 aesthetic               tissue symptoms rising                → rebuild    |
|                                                                               |
| 15 engine_biased           aerobic targets met                   → balanced   |
|                                                                               |
| 16 engine_biased           strength declines \> 1 tier            → balanced  |
|                                                                               |
| 17 engine_biased           2 consecutive engine blocks done      → balanced   |
| (forced)                                                                      |
|                                                                               |
| 18 rebuild                 compliance ≥ 80%, pain baseline,      → balanced   |
|                                                                               |
| 19 aerobic ≥ 90% of prior                                                     |
|                                                                               |
| 20 rebuild                 5 weeks elapsed (max duration)        → balanced   |
| (forced)                                                                      |
|                                                                               |
| 21                                                                            |
+===============================================================================+

rebuild                 compliance ≥ 80%, pain baseline,      →
balancedaerobic ≥ 90% of priorrebuild                 5 weeks elapsed
(max duration)        → balanced (forced)

**Design note:** The state machine always routes through balanced
between specialty blocks. This prevents cascading detraining in
neglected qualities and gives the engine a full-signal evaluation period
before committing to another specialty.

## 5) User-Tier Inference (Learning Engine)

### 5.1 Problem Statement

A user who self-reports as "advanced" but whose behaviour shows 3
sessions/week with frequent skipped anchors should be served simpler
defaults and lower ceilings regardless of stated experience. The engine
should infer **effective operational tier** from behaviour, not
self-report.

### 5.2 Observable Signals

  ---------------------------------------------------------------------------
  Signal          Source                  Measurement
  --------------- ----------------------- -----------------------------------
  Anchor          session completion data \% of prescribed anchor sessions
  compliance rate                         completed over rolling 28 days

  Overall session session completion data \% of all prescribed sessions
  compliance                              completed over rolling 28 days

  Session         in-session tracking     \% of prescribed exercises
  completion                              completed within each session;
  quality                                 average RPE alignment vs
                                          prescription

  Schedule        session timestamps      standard deviation of inter-session
  regularity                              gaps over 28 days

  Recovery input  readiness check-in data \% of days with readiness inputs
  consistency                             logged over rolling 28 days

  Anchor          strength/conditioning   direction and stability of anchor
  performance     KPIs                    metrics over 8+ weeks
  trend                                   

  Effective       session logs            actual sessions/week averaged over
  training                                28 days
  frequency                               

  Feature         app usage data          does user interact with advanced
  engagement                              features (bar speed, HRV, detailed
  depth                                   conditioning metrics)?
  ---------------------------------------------------------------------------

### 5.3 Scoring Model

Compute a **Behavioural Tier Score (BTS)** from 0 to 100:

+----------------------------------------------------------------------+
| 1 BTS =                                                              |
|                                                                      |
| 2 0.25 × anchor_compliance_pct +                                     |
|                                                                      |
| 3 0.15 × session_compliance_pct +                                    |
|                                                                      |
| 4 0.15 × completion_quality_pct +                                    |
|                                                                      |
| 5 0.15 × schedule_regularity_score +                                 |
|                                                                      |
| 6 0.10 × recovery_input_consistency_pct +                            |
|                                                                      |
| 7 0.10 × performance_trend_score +                                   |
|                                                                      |
| 8 0.05 × frequency_score +                                           |
|                                                                      |
| 9 0.05 × feature_engagement_score                                    |
+======================================================================+

Where each component is normalised to 0--100.

**Normalisation details:**

  --------------------------------------------------------------------
  Component               0 (worst)         100 (best)
  ----------------------- ----------------- --------------------------
  Anchor compliance       ≤ 50%             ≥ 95%

  Session compliance      ≤ 50%             ≥ 90%

  Completion quality      ≤ 60%             ≥ 95%

  Schedule regularity     SD of gaps \> 3   SD of gaps \< 0.5 days
                          days              

  Recovery input          ≤ 20%             ≥ 85%
  consistency                               

  Performance trend       declining         stable or improving

  Frequency               ≤ 2.5             ≥ 5 sessions/week
                          sessions/week     

  Feature engagement      uses none         uses advanced features
                                            regularly
  --------------------------------------------------------------------

### 5.4 Tier Thresholds and Transitions

  ---------------------------------------------------------------------------------
  Tier               BTS Range Characteristics        Promotion      Demotion
                                                      Condition      Condition
  ------------------ --------- ---------------------- -------------- --------------
  Consumer           0--49     Simpler defaults,      BTS ≥ 60 for 3 N/A (lowest
                               fewer daily            consecutive    tier)
                               adjustments,           28-day windows 
                               conservative ceilings,                
                               reduced session                       
                               complexity                            

  Intermediate       50--74    Moderate               BTS ≥ 80 for 3 BTS \< 50 for
                               autoregulation,        consecutive    2 consecutive
                               standard session       28-day windows 28-day windows
                               complexity, moderate                  
                               conditioning exposure                 

  High-performance   75--100   Full autoregulation    N/A (highest   BTS \< 70 for
                               depth, advanced        tier)          2 consecutive
                               monitoring, higher                    28-day windows
                               volume ceilings,                      
                               event-specific                        
                               conditioning                          
  ---------------------------------------------------------------------------------

**Hysteresis rule:** Promotion requires sustained high BTS over **3
windows** (84 days). Demotion requires sustained low BTS over **2
windows** (56 days). This prevents oscillation from a single bad month.

**Override:** A user who explicitly requests high-performance features
and whose anchor compliance is ≥ 85% may be granted high-performance
access regardless of other signals. Self-report is overridden *downward*
but never *upward* beyond what behaviour supports.

### 5.5 How Tier Affects Planning Logic

  ------------------------------------------------------------------------
  Planning         Consumer            Intermediate    High-Performance
  Parameter                                            
  ---------------- ------------------- --------------- -------------------
  Volume ceiling   ×0.85 of calculated ×0.95           ×1.00
  headroom         ceiling                             

  Hard             0--1                0--1            0--2
  conditioning                                         
  sessions/week                                        

  Autoregulation   Simple (RPE-only    Moderate (RPE + Full (multi-signal
  mode             session             soreness +      with HRV/bar speed)
                   modification)       sleep)          

  Session          ≤ 5                 ≤ 7             ≤ 9
  complexity       exercises/session                   

  Plan flexibility Fixed weekly        Modest daily    Full session-level
                   template, minimal   modification    adjustment
                   daily changes                       

  Deload trigger   Time-based (every 4 Time + signal   Signal-driven
                   weeks)              hybrid          (deload when GRM
                                                       drops below
                                                       threshold)

  Mesocycle        Balanced + rebuild  All except      All
  archetype access only                engine-biased   
  ------------------------------------------------------------------------

### 5.6 Pseudocode

+----------------------------------------------------------------------+
| 1 function infer_tier(user):                                         |
|                                                                      |
| 2 raw_score = compute_BTS(user.last_28d_data)                        |
|                                                                      |
| 3 smoothed = EWMA_28(raw_score)                                      |
|                                                                      |
| 4 current = user.current_tier                                        |
|                                                                      |
| 5                                                                    |
|                                                                      |
| 6 if current == "consumer":                                        |
|                                                                      |
| 7     if smoothed \&gt;= 60 for last 3 windows:                      |
|                                                                      |
| 8         promote to "intermediate"                                |
|                                                                      |
| 9 elif current == "intermediate":                                  |
|                                                                      |
| 10     if smoothed \&gt;= 80 for last 3 windows:                     |
|                                                                      |
| 11         promote to "high_performance"                           |
|                                                                      |
| 12     elif smoothed \&lt; 50 for last 2 windows:                    |
|                                                                      |
| 13         demote to "consumer"                                    |
|                                                                      |
| 14 elif current == "high_performance":                             |
|                                                                      |
| 15     if smoothed \&lt; 70 for last 2 windows:                      |
|                                                                      |
| 16         demote to "intermediate"                                |
|                                                                      |
| 17                                                                   |
|                                                                      |
| 18 \# Override: allow upward access only if anchor compliance        |
| supports it                                                          |
|                                                                      |
| 19 if user.requested_tier \&gt; user.current_tier:                   |
|                                                                      |
| 20     if user.anchor_compliance_28d \&gt;= 0.85:                    |
|                                                                      |
| 21         grant requested_tier access for features                  |
|                                                                      |
| 22         but keep ceiling modifier at current_tier level           |
|                                                                      |
| 23         until BTS naturally promotes                              |
|                                                                      |
| 24     else:                                                         |
|                                                                      |
| 25         keep current_tier                                         |
|                                                                      |
| 26         surface message: "Unlock higher-tier features by         |
|                                                                      |
| 27         completing anchor sessions consistently"                 |
|                                                                      |
| 28                                                                   |
|                                                                      |
| 29 apply tier_defaults(user.current_tier)                            |
|                                                                      |
| 30                                                                   |
+======================================================================+

**Trade-off:** Inferring tier from behaviour means the engine must
accumulate enough data to make a reliable classification. During the
first 28 days, the engine should default to intermediate tier (moderate
complexity, moderate ceilings) unless the onboarding questionnaire
indicates very low experience, in which case consumer is the safer
default.

## 6) Progressive Overload and Stall Diagnosis Across Multiple Qualities

### 6.1 The Core Problem

The wrong diagnosis leads to the wrong fix. Adding volume to a stalled
strength metric when the real cause is too much hard conditioning is one
of the most common mistakes a hybrid athlete makes. The system must
distinguish five categories:

  --------------------------------------------------------------------------
  Diagnosis       What Is Actually      Wrong Fix        Right Fix
                  Happening                              
  --------------- --------------------- ---------------- -------------------
  True            Quality is not        Reduce other     Add targeted volume
  underdosing     receiving enough      work (wastes     or load for that
                  stimulus to progress  capacity)        quality

  Fatigue         Quality has adequate  Add more work    Reduce total stress
  suppression     stimulus but systemic (deepens         or deload; allow
                  fatigue masks         fatigue)         expression
                  performance                            

  Cross-quality   A conflicting quality Add volume to    Reduce the
  interference    is overdosed,         the stalled      conflicting
                  directly impairing    quality          quality\'s dose;
                  the stalled one       (compounds       improve scheduling
                                        interference)    separation

  Local tissue    Regional pain or      Push through or  Modify load
  limitation      irritation is         add volume       profile, swap
                  limiting performance  (worsens tissue) exercises, add
                                                         graded
                                                         tissue-capacity
                                                         work

  True adaptation The quality has       Keep doing the   Change stimulus
  plateau         reached the current   same thing       type, enter a
                  ceiling of the        (stagnation)     specialty block, or
                  user\'s physiology at                  accept the current
                  this body mass and                     level and shift
                  training age                           priority elsewhere
  --------------------------------------------------------------------------

### 6.2 Signal Hierarchy

The diagnostic engine should evaluate signals in this order:

1.  **Local tissue status** --- check first because tissue limitations
    override all other considerations.

2.  **Systemic fatigue markers** --- if fatigue is globally high,
    performance suppression is the most likely explanation.

3.  **Cross-quality interference** --- if fatigue is moderate but a
    conflicting quality is overdosed, interference is the likely cause.

4.  **Dose adequacy** --- if fatigue is low, tissues are fine, and no
    interference is present, the quality may genuinely be underdosed.

5.  **Plateau assessment** --- if the quality has been adequately dosed,
    recovery is fine, interference is controlled, and it still isn\'t
    progressing over 2+ mesocycles, consider a true plateau.

### 6.3 Evaluation Time Windows

  -----------------------------------------------------------------------
  Signal Type          Minimum           Rationale
                       Evaluation Window 
  -------------------- ----------------- --------------------------------
  Local tissue         Real-time + 7-day Pain responds quickly; trend
  symptoms             trend             matters for persistence

  Systemic fatigue     7--14 days        Captures weekly accumulation
  (GRM, readiness)                       patterns

  Interference         14--28 days       Interference effects accumulate
  (cross-quality                         over multiple weeks
  overload)                              

  Dose adequacy        21--42 days (1--2 Adaptation takes weeks to
                       mesocycles)       express

  True plateau         2+ mesocycles     Must rule out all other causes
                       (8--16 weeks)     before concluding adaptation has
                                         stalled
  -----------------------------------------------------------------------

### 6.4 Diagnostic Decision Tree

+----------------------------------------------------------------------+
| 1 function diagnose_stall(quality_q, user):                          |
|                                                                      |
| 2 perf_trend = get_performance_trend(quality_q, last_6_weeks)        |
|                                                                      |
| 3 if perf_trend == "progressing" or "stable_acceptable":         |
|                                                                      |
| 4     return NO_STALL                                                |
|                                                                      |
| 5                                                                    |
|                                                                      |
| 6 \# \-\-- Step 1: Local tissue check \-\--                          |
|                                                                      |
| 7 relevant_regions = get_regions_for_quality(quality_q)              |
|                                                                      |
| 8 for r in relevant_regions:                                         |
|                                                                      |
| 9     if region_risk_r \&gt; 0.60:                                   |
|                                                                      |
| 10         return LOCAL_TISSUE_LIMITATION(region=r)                  |
|                                                                      |
| 11                                                                   |
|                                                                      |
| 12 \# \-\-- Step 2: Systemic fatigue check \-\--                     |
|                                                                      |
| 13 if GRM \&lt; 0.90:                                                |
|                                                                      |
| 14     return FATIGUE_SUPPRESSION(                                   |
|                                                                      |
| 15         evidence="GRM below 0.90",                              |
|                                                                      |
| 16         contributing_factors=identify_top_penalties()             |
|                                                                      |
| 17     )                                                             |
|                                                                      |
| 18                                                                   |
|                                                                      |
| 19 \# \-\-- Step 3: Interference check \-\--                         |
|                                                                      |
| 20 if interference_modifier_q \&lt; 0.90:                            |
|                                                                      |
| 21     conflicting =                                                 |
| identify_overdosed_conflicting_qualities(quality_q)                  |
|                                                                      |
| 22     if conflicting:                                               |
|                                                                      |
| 23         return CROSS_QUALITY_INTERFERENCE(                        |
|                                                                      |
| 24             conflicts=conflicting,                                |
|                                                                      |
| 25             interference_modifier=interference_modifier_q         |
|                                                                      |
| 26         )                                                         |
|                                                                      |
| 27                                                                   |
|                                                                      |
| 28 \# \-\-- Step 4: Dose adequacy check \-\--                        |
|                                                                      |
| 29 delivered = get_delivered_dose(quality_q, last_28d)               |
|                                                                      |
| 30 target = get_target_dose(quality_q)                               |
|                                                                      |
| 31 if delivered \&lt; 0.85 × target:                                 |
|                                                                      |
| 32     return UNDERDOSING(                                           |
|                                                                      |
| 33         delivered=delivered,                                      |
|                                                                      |
| 34         target=target,                                            |
|                                                                      |
| 35         shortfall_pct=(target - delivered) / target               |
|                                                                      |
| 36     )                                                             |
|                                                                      |
| 37                                                                   |
|                                                                      |
| 38 \# \-\-- Step 5: True plateau \-\--                               |
|                                                                      |
| 39 if stall_duration \&gt; 2_mesocycles:                             |
|                                                                      |
| 40     return TRUE_PLATEAU(                                          |
|                                                                      |
| 41         duration=stall_duration,                                  |
|                                                                      |
| 42         doses_adequate=True,                                      |
|                                                                      |
| 43         recovery_adequate=True,                                   |
|                                                                      |
| 44         interference_controlled=True                              |
|                                                                      |
| 45     )                                                             |
|                                                                      |
| 46                                                                   |
|                                                                      |
| 47 \# \-\-- Inconclusive \-\--                                       |
|                                                                      |
| 48 return MONITOR(                                                   |
|                                                                      |
| 49     message="Performance flat but no clear single cause yet",   |
|                                                                      |
| 50     recommendation="Continue current plan for 1 more mesocycle;  |
|                                                                      |
| 51     monitor all signals"                                         |
|                                                                      |
| 52 )                                                                 |
|                                                                      |
| 53                                                                   |
+======================================================================+

### 6.5 Signal Pattern → Diagnosis → Intervention Table

  --------------------------------------------------------------------------
  Signal Pattern             Diagnosis       Intervention
  -------------------------- --------------- -------------------------------
  Performance flat +         Local tissue    Swap exercise variation for
  regional pain/stiffness    limitation      affected region; add graded
  elevated + GRM normal                      tissue-capacity work; reduce
                                             peak load on irritated
                                             structure; do not change the
                                             rest of the plan

  Performance flat + GRM \<  Fatigue         Reduce total volume (fillers
  0.90 + sleep/HRV           suppression     first, then secondary work);
  degraded + soreness                        drop hard conditioning;
  elevated                                   preserve anchor movements at
                                             reduced volume; maintain easy
                                             aerobic; reassess after 1
                                             deload or reduction week

  Performance flat + GRM     Cross-quality   Reduce the conflicting
  normal +                   interference    quality\'s dose toward its
  interference_modifier \<                   floor; improve temporal
  0.90 + conflicting quality                 separation between conflicting
  recently overdosed                         sessions; do not add volume to
                                             the stalled quality

  Performance flat + GRM     Underdosing     Increase targeted dose for the
  normal + interference                      stalled quality using
  normal + delivered dose \<                 low-fatigue tools; ensure
  85% of target                              ceiling has room; monitor for
                                             3--4 weeks

  Performance flat for 2+    True adaptation Change stimulus type (new
  mesocycles + all above     plateau         exercise variation, different
  causes ruled out                           rep range, different
                                             periodisation scheme); consider
                                             a specialty block targeting
                                             that quality; if the user\'s
                                             priorities allow, accept
                                             current level and redirect
                                             resources

  Performance flat +         Inconclusive /  Continue current plan; improve
  insufficient data to       monitor         data completeness (prompt for
  classify (new user, sparse                 readiness inputs, session RPE);
  logging)                                   re-evaluate in 2--4 weeks
  --------------------------------------------------------------------------

### 6.6 Per-Quality Stall Indicators

  -------------------------------------------------------------------------
  Quality       KPI Used               "Flat" Threshold  "Declining"
                                                           Threshold
  ------------- ---------------------- ------------------- ----------------
  Strength      e1RM trend on anchor                       \>3% decline
                lifts                                      over 4 weeks

  Hypertrophy   hard-set performance   no set-performance  set performance
                trend +                improvement over 4  declining or RPE
                circumference/photo    weeks at same       rising at same
                trend                  proximity to        load
                                       failure             

  Aerobic base  pace/power at easy HR;                     pace/power
                HR recovery rate                           worsening or
                                                           resting HR
                                                           rising

  Threshold /   interval pace/power;                       interval quality
  VO₂max        repeatability across                       declining or
                sets                                       incomplete sets
                                                           increasing

  Durability    symptom score trends;  no improvement in   symptoms
                range-of-motion        pain/stiffness over worsening
                tolerance              4 weeks of graded   despite graded
                                       work                approach
  -------------------------------------------------------------------------

### 6.7 Interaction with the Ceiling Model

The stall-diagnosis engine and the ceiling model form a **feedback
loop**:

1.  **Ceiling compresses a quality\'s dose** → delivered dose may fall
    below target → risk of underdosing diagnosis.

2.  **Safeguard:** The diagnostic engine should check whether the
    shortfall is **voluntary** (ceiling-driven compression to protect
    recovery or manage interference) vs **involuntary** (missed
    sessions, poor compliance). If the compression was ceiling-driven,
    the engine should **not** diagnose underdosing --- instead it should
    flag: "this quality is deliberately suppressed this week due to
    \[bucket pressure / region cap / interference\]; expect performance
    stagnation; will recover when ceiling expands."

3.  **If the quality remains ceiling-suppressed for 2+ consecutive
    mesocycles,** the engine should recommend a block-type transition
    that elevates that quality to primary status (which widens its
    ceiling by changing archetype bucket weights and reducing
    conflicting quality targets).

## 7) Integration Into Existing Architecture

### 7.1 System Architecture Overview

【5001†embed_image】

*Figure 2: System architecture for the adaptive hybrid programming
engine --- inputs feed the stress-tagging and readiness layers, which
determine ceilings, allocate floors and targets, and drive scheduling,
daily adaptation, and learning feedback.*

### 7.2 Updated End-to-End Planning Flow

+----------------------------------------------------------------------+
| 1 PHASE 1 --- INITIALISATION (onboarding or block start)             |
|                                                                      |
| 2 Ingest user profile: training age, goals, schedule,                |
|                                                                      |
| 3 equipment, injury history, body-comp phase.                        |
|                                                                      |
| 4 Set initial tier from onboarding questionnaire                     |
|                                                                      |
| 5 (default: intermediate if ambiguous).                              |
|                                                                      |
| 6 Select mesocycle archetype from entry conditions or                |
|                                                                      |
| 7 user preference.                                                   |
|                                                                      |
| 8 Load archetype defaults: bucket weights, weekly                    |
|                                                                      |
| 9 template, progression rules, deload timing.                        |
|                                                                      |
| 10 Set floor doses for all qualities.                                |
|                                                                      |
| 11 Initialise stress-bucket and region ledgers to zero               |
|                                                                      |
| 12 (or carry forward from prior block).                              |
|                                                                      |
| 13 PHASE 2 --- WEEKLY CEILING CALCULATION (runs at start of each     |
| week)                                                                |
|                                                                      |
| 14 7.  Compute ATL / CTL for all buckets and regions.                |
|                                                                      |
| 15 8.  Compute normalised bucket pressures.                          |
|                                                                      |
| 16 9.  Compute systemic recovery penalty.                            |
|                                                                      |
| 17 10. Compute GRM.                                                  |
|                                                                      |
| 18 11. Compute quality-specific modifiers.                           |
|                                                                      |
| 19 12. Compute interference modifiers.                               |
|                                                                      |
| 20 13. Compute region caps.                                          |
|                                                                      |
| 21 14. Compute per-quality ceilings.                                 |
|                                                                      |
| 22 15. Verify: for each quality, ceiling ≥ floor.                    |
|                                                                      |
| 23 If not, flag a recovery crisis and recommend                      |
|                                                                      |
| 24 deload or block transition.                                       |
|                                                                      |
| 25 PHASE 3 --- WEEKLY ALLOCATION (runs after ceiling calculation)    |
|                                                                      |
| 26 16. Allocate floor doses to all qualities.                        |
|                                                                      |
| 27 17. Allocate remaining budget toward target doses,                |
|                                                                      |
| 28 weighted by archetype priority.                                   |
|                                                                      |
| 29 18. If any quality target exceeds its ceiling,                    |
|                                                                      |
| 30 clamp to ceiling and redistribute surplus                         |
|                                                                      |
| 31 to next-priority quality.                                         |
|                                                                      |
| 32 19. Generate weekly session skeleton:                             |
|                                                                      |
| 33 anchors first, then fillers.                                      |
|                                                                      |
| 34 20. Apply conflict matrix to session placement:                   |
|                                                                      |
| 35 separate high-conflict pairings.                                  |
|                                                                      |
| 36 21. Apply equipment-aware substitutions.                          |
|                                                                      |
| 37 PHASE 4 --- DAILY ADAPTATION (runs pre-session)                   |
|                                                                      |
| 38 22. Ingest readiness data (sleep, soreness, pain,                 |
|                                                                      |
| 39 HRV if available).                                                |
|                                                                      |
| 40 23. Recompute GRM with today\'s data.                             |
|                                                                      |
| 41 24. If GRM drops below session\'s minimum threshold:              |
|                                                                      |
| 42 → reduce session scope (drop fillers,                             |
|                                                                      |
| 43 reduce accessory volume, keep anchor intent).                     |
|                                                                      |
| 44 25. If local region cap drops below session\'s                    |
|                                                                      |
| 45 requirement:                                                      |
|                                                                      |
| 46 → swap exercise or modality for that region.                      |
|                                                                      |
| 47 26. Execute session.                                              |
|                                                                      |
| 48 PHASE 5 --- POST-SESSION AND POST-WEEK LEARNING                   |
|                                                                      |
| 49 27. Log session load, bucket points, region points.               |
|                                                                      |
| 50 28. Update rolling ATL / CTL.                                     |
|                                                                      |
| 51 29. Run stall-diagnosis engine for each quality                   |
|                                                                      |
| 52 (if evaluation window is complete).                               |
|                                                                      |
| 53 30. Run user-tier inference (every 28 days).                      |
|                                                                      |
| 54 31. Check block-transition conditions.                            |
|                                                                      |
| 55 32. If transition triggered:                                      |
|                                                                      |
| 56 → select new archetype,                                           |
|                                                                      |
| 57 carry forward stress ledger,                                      |
|                                                                      |
| 58 reset block week counter,                                         |
|                                                                      |
| 59 apply new archetype defaults.                                     |
|                                                                      |
| 60 33. Update personal baselines (tolerance estimates,               |
|                                                                      |
| 61 normalisation bands) using learning engine.                       |
|                                                                      |
| 62                                                                   |
+======================================================================+

PHASE 5 --- POST-SESSION AND POST-WEEK LEARNING27. Log session load,
bucket points, region points.28. Update rolling ATL / CTL.29. Run
stall-diagnosis engine for each quality(if evaluation window is
complete).30. Run user-tier inference (every 28 days).31. Check
block-transition conditions.32. If transition triggered:→ select new
archetype,carry forward stress ledger,reset block week counter,apply new
archetype defaults.33. Update personal baselines (tolerance
estimates,normalisation bands) using learning engine.

### 7.3 How Each New Component Connects

  ----------------------------------------------------------------------------
  New Component     Connects To                  Nature of Connection
  ----------------- ---------------------------- -----------------------------
  Ceiling           Stress-budget model (layer   Ceiling output constrains the
  calculation       2), Floor/target/ceiling     allocator and scheduler;
                    allocator (layer 3),         stress-budget model feeds the
                    Scheduling engine (layer 4)  inputs

  Mesocycle         Floor/target/ceiling         Archetype defines default
  archetypes        allocator (layer 3),         bucket weights, weekly
                    Scheduling engine (layer 4), template, progression rules,
                    Block-transition logic       deload protocol, and exit
                                                 conditions

  User-tier         User model (layer 1), Daily  Tier modifies ceiling
  inference         adaptation engine (layer 5), headroom, session complexity,
                    Learning engine (layer 6)    autoregulation depth, and
                                                 conditioning exposure
                                                 defaults

  Stall-diagnosis   Floor/target/ceiling         Diagnosis determines whether
  engine            allocator (layer 3),         to add dose, reduce
                    Block-transition logic,      conflicting work, modify
                    Interference modifier        exercises, deload, or trigger
                                                 a block transition
  ----------------------------------------------------------------------------

### 7.4 Data Dependencies and Update Cadence

  ------------------------------------------------------------------------
  Computation          Update Cadence     Dependencies
  -------------------- ------------------ --------------------------------
  Session load and     After every        Session duration, sRPE, exercise
  bucket/region        session            metadata
  tagging                                 

  ATL / CTL            After every        Cumulative session data
                       session            

  Bucket pressures     Weekly (or more    ATL, CTL, baseline tolerances
                       often if needed)   

  Systemic penalty     Weekly + daily     Sleep, HRV, RHR, soreness,
                       pre-session        compliance

  GRM                  Weekly + daily     Bucket pressures, systemic
                       pre-session        penalty, archetype weights

  Per-quality ceilings Weekly             GRM, quality modifiers,
                                          interference modifiers, region
                                          caps, base ceiling

  User-tier BTS        Every 28 days      28-day behavioural data

  Stall diagnosis      Per quality at end Performance trends, GRM history,
                       of evaluation      interference history, dose
                       window             history, tissue signals

  Block-transition     End of each        Stall diagnosis results,
  check                mesocycle week     performance trends, compliance,
                                          tier
  ------------------------------------------------------------------------

## 8) Illustrative Stress vs Recovery vs Ceiling Chart

The chart generated below shows the ceiling model\'s intended behaviour
over an illustrative 14-day hybrid microcycle with realistic stress
variation, including two rest days (days 7 and 14), a monotony peak
around days 9--11, and the resulting ceiling compression and recovery.

【5000†embed_image】

*Figure 1 (repeated for cross-reference): Rolling 7-day stress, recovery
capacity score, and weekly ceiling (% of chronic tolerance) across a
14-day period. When stress peaks and monotony is high (days 9--11), the
ceiling drops to its lowest point (\~87% of chronic tolerance). As
stress falls on rest/easy days, recovery capacity rebounds and the
ceiling returns above 100%.*

**Key design implication from this chart:** The ceiling is not static.
It responds to the accumulation pattern of the previous 7 days, the
systemic recovery state, and the monotony of the recent schedule. A
well-designed engine should surface this dynamic to the user in
simplified form (e.g., "your capacity this week is slightly compressed
--- we\'ve adjusted your plan to protect your anchor sessions while
reducing lower-priority work").

## 9) Summary of Engineering Assumptions Requiring Validation

The following elements are **implementation defaults** that should be
tuned through observed outcomes once the app has a sufficient user base:

  ------------------------------------------------------------------------
  Component              Default Value    What to Validate
  ---------------------- ---------------- --------------------------------
  Bucket pressure        0.35 / 0.25 /    Do these weights predict
  weights (3.4)          0.20 / 0.20      performance trends better than
                                          equal weighting?

  Systemic penalty       0.30 / 0.22 /    Does sleep deserve 0.30, or is
  weights (3.5)          0.16 / 0.16 /    soreness a better predictor for
                         0.16             this population?

  GRM formula            1.07 base, -0.18 Are these slopes appropriate, or
  coefficients (3.6)     global, -0.12    do advanced trainees tolerate
                         systemic         higher pressure before GRM
                                          should drop?

  Quality sensitivity    Per-cell values  Do these match observed
  matrix (3.7)                            quality-specific performance
                                          responses to bucket loading?

  Normalisation bands    Per-variable     Are the default bands
  (3.3)                  good/bad         appropriate for advanced
                         thresholds       trainees, or should they shift
                                          based on training age?

  BTS weights (5.3)      0.25 anchor      Is anchor compliance truly the
                         compliance, etc. strongest behavioural signal, or
                                          does schedule regularity matter
                                          more?

  Stall evaluation       7 days to 16     Are these windows long enough to
  windows (6.3)          weeks depending  avoid false positives while
                         on type          short enough to avoid delayed
                                          intervention?

  Block transition       "2+ blocks      Is 2 mesocycles the right
  thresholds (4.3)       stalled" etc.   threshold for recommending a
                                          specialty block, or should it be
                                          1 or 3?

  Tier                   3 windows up, 2  Does this hysteresis prevent
  promotion/demotion     windows down     oscillation in practice?
  periods (5.4)                           
  ------------------------------------------------------------------------

**Recommendation:** Build a logging and analytics layer from day one
that captures enough data to recalibrate these defaults within 6--12
months of deployment.

## 10) Updated AI-Readable Data Model

+----------------------------------------------------------------------+
| 1 user_profile:                                                      |
|                                                                      |
| 2 training_age_years:                                                |
|                                                                      |
| 3 goal_weights:                                                      |
|                                                                      |
| 4 strength:                                                          |
|                                                                      |
| 5 hypertrophy:                                                       |
|                                                                      |
| 6 aerobic_base:                                                      |
|                                                                      |
| 7 anaerobic:                                                         |
|                                                                      |
| 8 mobility:                                                          |
|                                                                      |
| 9 durability:                                                        |
|                                                                      |
| 10 aesthetics:                                                       |
|                                                                      |
| 11 body_composition_phase:         \# gain \| maintain \| lean_out   |
|                                                                      |
| 12 equipment_mode:                 \# full_gym \| limited \|         |
| adaptive                                                             |
|                                                                      |
| 13 schedule:                                                         |
|                                                                      |
| 14 sessions_per_week:                                                |
|                                                                      |
| 15 average_session_minutes:                                          |
|                                                                      |
| 16 double_sessions_possible:                                         |
|                                                                      |
| 17 tissue_history:                                                   |
|                                                                      |
| 18 foot_ankle:                                                       |
|                                                                      |
| 19 knee:                                                             |
|                                                                      |
| 20 hamstring:                                                        |
|                                                                      |
| 21 adductor:                                                         |
|                                                                      |
| 22 shoulder:                                                         |
|                                                                      |
| 23 back:                                                             |
|                                                                      |
| 24 elbow:                                                            |
|                                                                      |
| 25 modality_preferences:                                             |
|                                                                      |
| 26 current_block_type:             \# balanced \| strength_biased \| |
| aesthetic \|                                                         |
|                                                                      |
| 27 \# engine_biased \| rebuild                                       |
|                                                                      |
| 28 effective_tier:                 \# consumer \| intermediate \|    |
| high_performance                                                     |
|                                                                      |
| 29 tier_bts_history:               \# rolling 28-day BTS scores      |
|                                                                      |
| 30 state_model:                                                      |
|                                                                      |
| 31 readiness:                                                        |
|                                                                      |
| 32 sleep_score:                                                      |
|                                                                      |
| 33 soreness_by_region:                                               |
|                                                                      |
| 34 pain_by_region:                                                   |
|                                                                      |
| 35 HRV_optional:                                                     |
|                                                                      |
| 36 resting_hr_optional:                                              |
|                                                                      |
| 37 e1rm_trends:                                                      |
|                                                                      |
| 38 aerobic_trends:                                                   |
|                                                                      |
| 39 session_rpe_load:                                                 |
|                                                                      |
| 40 recent_compliance:                                                |
|                                                                      |
| 41 anchor_compliance_28d:                                            |
|                                                                      |
| 42 schedule_regularity_sd:                                           |
|                                                                      |
| 43 stress_buckets:                                                   |
|                                                                      |
| 44 neural:                                                           |
|                                                                      |
| 45 ATL:                                                              |
|                                                                      |
| 46 CTL:                                                              |
|                                                                      |
| 47 pressure:                                                         |
|                                                                      |
| 48 mechanical:                                                       |
|                                                                      |
| 49 ATL:                                                              |
|                                                                      |
| 50 CTL:                                                              |
|                                                                      |
| 51 pressure:                                                         |
|                                                                      |
| 52 metabolic:                                                        |
|                                                                      |
| 53 ATL:                                                              |
|                                                                      |
| 54 CTL:                                                              |
|                                                                      |
| 55 pressure:                                                         |
|                                                                      |
| 56 impact:                                                           |
|                                                                      |
| 57 ATL:                                                              |
|                                                                      |
| 58 CTL:                                                              |
|                                                                      |
| 59 pressure:                                                         |
|                                                                      |
| 60 axial:                                                            |
|                                                                      |
| 61 ATL:                                                              |
|                                                                      |
| 62 CTL:                                                              |
|                                                                      |
| 63 pressure:                                                         |
|                                                                      |
| 64 tissue:                                                           |
|                                                                      |
| 65 ATL:                                                              |
|                                                                      |
| 66 CTL:                                                              |
|                                                                      |
| 67 pressure:                                                         |
|                                                                      |
| 68 region_ledger:                                                    |
|                                                                      |
| 69 Per region:                                                       |
|                                                                      |
| 70 ATL:                                                              |
|                                                                      |
| 71 CTL:                                                              |
|                                                                      |
| 72 symptom_score:                                                    |
|                                                                      |
| 73 stiffness_score:                                                  |
|                                                                      |
| 74 novelty:                                                          |
|                                                                      |
| 75 region_risk:                                                      |
|                                                                      |
| 76 region_cap:                                                       |
|                                                                      |
| 77 ceiling_model:                                                    |
|                                                                      |
| 78 GRM:                                                              |
|                                                                      |
| 79 systemic_penalty:                                                 |
|                                                                      |
| 80 per_quality:                                                      |
|                                                                      |
| 81 \# Per quality:                                                   |
|                                                                      |
| 82 base_ceiling:                                                     |
|                                                                      |
| 83 quality_modifier:                                                 |
|                                                                      |
| 84 interference_modifier:                                            |
|                                                                      |
| 85 region_cap_factor:                                                |
|                                                                      |
| 86 confidence_bias:                                                  |
|                                                                      |
| 87 final_ceiling:                                                    |
|                                                                      |
| 88 quality_doses:                                                    |
|                                                                      |
| 89 Per quality:                                                      |
|                                                                      |
| 90 floor:                                                            |
|                                                                      |
| 91 target:                                                           |
|                                                                      |
| 92 ceiling:                                                          |
|                                                                      |
| 93 delivered:                                                        |
|                                                                      |
| 94 stall_diagnosis:                                                  |
|                                                                      |
| 95 Per quality:                                                      |
|                                                                      |
| 96 status:                         \# progressing \| stable \|       |
| stalled                                                              |
|                                                                      |
| 97 diagnosis:                      \# none \| underdosing \|         |
| fatigue_suppression \|                                               |
|                                                                      |
| 98 \# interference \| local_tissue \| plateau \| monitor             |
|                                                                      |
| 99 contributing_factors:                                             |
|                                                                      |
| 100 recommended_intervention:                                        |
|                                                                      |
| 101 block_state:                                                     |
|                                                                      |
| 102 current_archetype:                                               |
|                                                                      |
| 103 block_week:                                                      |
|                                                                      |
| 104 block_length:                                                    |
|                                                                      |
| 105 deload_scheduled:                                                |
|                                                                      |
| 106 transition_candidates:                                           |
|                                                                      |
| 107                                                                  |
+======================================================================+

block_state:current_archetype:block_week:block_length:deload_scheduled:transition_candidates:

## 11) Updated Planning Logic (Complete Pseudocode)

+----------------------------------------------------------------------+
| 1 \# \-\-- BLOCK START \-\--                                         |
|                                                                      |
| 2 archetype = select_archetype(user, transition_candidates)          |
|                                                                      |
| 3 load archetype_defaults(archetype)                                 |
|                                                                      |
| 4 set floor_doses(all_qualities)                                     |
|                                                                      |
| 5 set block_week = 1                                                 |
|                                                                      |
| 6 \-\-- WEEKLY LOOP \-\--                                            |
|                                                                      |
| 7 for each week in block:                                            |
|                                                                      |
| 8 \# Ceiling calculation                                             |
|                                                                      |
| 9 for each bucket b:                                                 |
|                                                                      |
| 10     compute ATL_b, CTL_b                                          |
|                                                                      |
| 11     compute acute_pct_b, ratio_b, monotony_b, strain_ratio_b      |
|                                                                      |
| 12     normalise → N_acute_pct_b, N_ratio_b, N_monotony_b,           |
| N_strain_b                                                           |
|                                                                      |
| 13     pressure_b = weighted_sum(\...)                               |
|                                                                      |
| 14                                                                   |
|                                                                      |
| 15 compute systemic_penalty from sleep, HRV, RHR, compliance,        |
| soreness                                                             |
|                                                                      |
| 16 GRM = clamp(1.07 - 0.18×global_pressure - 0.12×systemic_penalty,  |
| 0.70, 1.08)                                                          |
|                                                                      |
| 17                                                                   |
|                                                                      |
| 18 for each quality q:                                               |
|                                                                      |
| 19     quality_modifier_q = f(sensitivity_matrix, pressures)         |
|                                                                      |
| 20     interference_modifier_q = f(conflict_matrix, delivered_doses) |
|                                                                      |
| 21     region_cap_factor_q = f(relevant_region_caps)                 |
|                                                                      |
| 22     base_ceiling_q = median(last_3_recovered_weeks) × headroom    |
|                                                                      |
| 23     ceiling_q = base × GRM × quality_mod × interference_mod       |
|                                                                      |
| 24                 × region_cap × confidence_bias                    |
|                                                                      |
| 25     assert ceiling_q \&gt;= floor_q else flag_recovery_crisis     |
|                                                                      |
| 26                                                                   |
|                                                                      |
| 27 \# Allocation                                                     |
|                                                                      |
| 28 allocate floors first                                             |
|                                                                      |
| 29 allocate remaining budget toward targets (priority-weighted)      |
|                                                                      |
| 30 clamp each quality at its ceiling                                 |
|                                                                      |
| 31 generate weekly session skeleton (anchors first, fillers second)  |
|                                                                      |
| 32 apply conflict matrix to session placement                        |
|                                                                      |
| 33 apply equipment-aware substitutions                               |
|                                                                      |
| 34                                                                   |
|                                                                      |
| 35 \# Daily loop                                                     |
|                                                                      |
| 36 for each day:                                                     |
|                                                                      |
| 37     ingest readiness                                              |
|                                                                      |
| 38     recompute daily GRM                                           |
|                                                                      |
| 39     if GRM \&lt; session_threshold: reduce scope                  |
|                                                                      |
| 40     if region_cap \&lt; session_requirement: swap                 |
| exercise/modality                                                    |
|                                                                      |
| 41     execute session                                               |
|                                                                      |
| 42     log session_load, bucket_points, region_points                |
|                                                                      |
| 43     update ATL, CTL                                               |
|                                                                      |
| 44                                                                   |
|                                                                      |
| 45 \# End-of-week checks                                             |
|                                                                      |
| 46 run stall_diagnosis for qualities at evaluation window            |
|                                                                      |
| 47 if block_week == deload_week: apply deload protocol               |
|                                                                      |
| 48 block_week += 1                                                   |
|                                                                      |
| 49 \-\-- BLOCK END \-\--                                             |
|                                                                      |
| 50 check transition conditions                                       |
|                                                                      |
| 51 if transition triggered:                                          |
|                                                                      |
| 52 select new archetype                                              |
|                                                                      |
| 53 carry forward stress ledger                                       |
|                                                                      |
| 54 reset block_week                                                  |
|                                                                      |
| 55 else:                                                             |
|                                                                      |
| 56 repeat current archetype with updated targets                     |
|                                                                      |
| 57 \-\-- EVERY 28 DAYS (independent of block) \-\--                  |
|                                                                      |
| 58 compute BTS                                                       |
|                                                                      |
| 59 update effective_tier                                             |
|                                                                      |
| 60 apply tier_defaults                                               |
|                                                                      |
| 61                                                                   |
+======================================================================+

compute BTSupdate effective_tierapply tier_defaults

This completes the system-spec expansion. The four previously identified
gaps --- ceiling calculation, archetype specification, user-tier
inference, and stall diagnosis --- are now formalised with formulas,
pseudocode, decision logic, default parameters, and integration points.
The next implementation step is translating this specification into the
app\'s session-generation algorithm with real exercise metadata and a
logging infrastructure to validate the engineering defaults.
