# Hybrid Training Framework — Bodyweight-Only Addendum

A companion to `hybrid-training-research.md`. This document captures how the structural principles change (and don't) when strength training is constrained to bodyweight and weighted bodyweight movements — no barbells, dumbbells, or machines. Assumes the same audience: advanced trainees, 5+ years of consistent structured training.

---

## What Stays the Same

- **The interference effect.** AMPK ⊣ mTORC1 doesn't care whether the strength stimulus is a back squat or a one-arm chin-up. Modality separation (6h+ between conflicting sessions, 24h ideal) still applies unchanged.
- **Aerobic base building.** Z2 polarized distribution, Z2-as-recovery-enhancer, capillary/mitochondrial logic — identical.
- **Autoregulation resolutions.** RPE/RIR daily, HRV as 7-day trend, subjective wellness as the highest-ROI signal. Unchanged.
- **Recovery as a load variable.** Sleep, nutrition, lifestyle stress — identical.
- **Tendon timeline asymmetry.** Connective tissue still adapts 2–10× slower than muscle. If anything, this gets *more* important (see below).

---

## What Changes Materially

### 1. Strength expression becomes relative, not absolute

This is the single biggest shift. Bodyweight strength is fundamentally a **strength-to-mass ratio**. That breaks two things from the original framework:

- **Hypertrophy can directly hurt strength on the same movement.** A heavier you needs more force to do a one-arm pull-up. The "hypertrophy survives concurrent training" finding still holds physiologically, but now hypertrophy is in tension with your strength goal even *without* conditioning in the picture.
- **Volume landmarks (MEV/MAV/MRV) get fuzzy.** A "set" of one-arm chins ≠ a set of pull-ups ≠ a set of archer pull-ups. The app needs an **effective-volume** model: leverage difficulty + load + reps + proximity to failure, normalized into a comparable unit. Counting raw sets per muscle group will mislead.

### 2. Progression mechanics change shape

Linear loading is replaced by a **discrete progression tree**:

- Leverage progressions (tuck → advanced tuck → straddle → full, for lever/planche family)
- Unilateral progressions (two-arm → assisted one-arm → archer → one-arm)
- Added external load (vest, dip belt, ankle weights) — this is where you regain barbell-like titration
- Tempo/iso holds and ROM expansion (deficit pushups, ring work)

The granularity is coarser than barbell. **An app needs to model jumps between progressions explicitly** — and probably require *over-completion* of the easier variant (e.g., 3×8 clean reps for 2 weeks) before unlocking the next, because the jumps are larger than +2.5 kg.

### 3. Lower body and hinge become a structural gap

This is the calisthenics weakness the framework needs to surface explicitly:

- **Knee-dominant** work is fine — pistols, shrimp squats, Bulgarian split squats with vest scale a long way.
- **Hinge-dominant** work is the real gap. Nordics, glute-ham raises, single-leg RDLs, reverse hypers cover some of it, but you cannot load the posterior chain the way a deadlift does.
- **Loaded carry** is essentially gone without equipment.

**App implication:** the system should treat posterior chain as a programmable risk and compensate via modality choice in conditioning — hill sprints, weighted ruck, sled drag, sprint mechanics work — rather than pretending the gap doesn't exist.

### 4. Tendon and joint demand rises, and shifts upstream

Advanced bodyweight skills (front lever, planche, ring work, one-arm pull-up) are **disproportionately demanding on elbows, wrists, shoulders, and biceps tendon** — far more than equivalent barbell strength. Two consequences:

- The **2–10× tendon timeline gap** becomes the binding constraint, not muscle adaptation. The classic gymnastic rule — "if you can do a skill 10 times, you can train it; if you can do it once, you cannot" — exists precisely because muscle outruns tendon and athletes get injured.
- **Isometric and heavy slow resistance work** (Baar's protocols) is even higher leverage here. The good news: calisthenics is *already* heavily isometric (holds, levers, planche leans, tuck holds). Programmed correctly, the strength work *is* the tendon work — they don't compete for time.

**App implication:** progressions should be **gated on accumulated time-under-tension at the previous level**, not just rep-able performance. Build a "tissue-readiness" gate into the unlock logic.

### 5. Interference mix changes character

Bodyweight strength sessions are typically **lower in absolute mechanical load and lower in neural cost** than heavy barbell work. Two downstream effects:

- Residual fatigue is often lower → you can tolerate *higher* conditioning frequency than a barbell-based hybrid athlete.
- But skill-based sessions (planche, lever progressions) are neurologically demanding in a different way — fresh CNS matters as much as fresh muscle. **Skill work belongs early in the day and early in the week, like heavy strength work**, even if it doesn't feel "heavy."

### 6. Conditioning toolkit overlaps with strength work

CrossFit-style metcons, burpee EMOMs, calisthenic circuits sit awkwardly in the original framework because they're hybrid stimuli — partly strength-endurance, partly aerobic. **They're more useful in a no-equipment context** because they double-purpose your time. But they have to be classified honestly: a 20-min AMRAP of pull-ups and pushups is *not* a Z2 session and *not* a strength session — it's a third thing that interferes with both. Budget it accordingly.

### 7. Aesthetics: easier upper, harder lower

The calisthenics physique signature — strong lats, full shoulders, developed arms, lean midsection, comparatively under-developed legs — is a real outcome bias. If aesthetics is a deliberate goal:

- Upper body hypertrophy on bodyweight is well-established (high frequency, weighted vest, proximity to failure, ring work for novel tension profiles).
- Legs will lag without cycling/sprint/sled/heavy-vest work as a deliberate compensator. Volume of lower-body conditioning becomes an aesthetics input, not just a fitness input.

---

## App Design Implications, Specifically

1. **Replace "weight loaded" with a normalized effective-difficulty score** that combines progression level, external load, reps, tempo, and RIR.
2. **Skill trees as first-class objects** — front lever, planche, one-arm pull-up, muscle-up, pistol — with prerequisite gates and time-at-level requirements (not just rep targets).
3. **Bodyweight is itself a variable.** The system should track it weekly and model relative-strength drift — flag when hypertrophy is starting to erode a skill goal.
4. **Explicit posterior-chain coverage check.** A weekly view that highlights hinge volume and prompts compensation via conditioning modality when low.
5. **Tendon-load budgeting.** Track time-under-tension on the hardest progressions (rings, levers, planche) and rate-limit weekly increases independently of how strong the muscle feels.
6. **Conditioning classifier.** Each session tagged as Z2 / threshold / VO2 / mixed-modal — the last category gets budgeted against both strength and aerobic, not just one.
7. **Lower body conditioning bias.** When the user opts for no-equipment strength, default conditioning suggestions should lean toward hill sprints, ruck, sled, weighted carries — modalities that fill the posterior-chain gap.
