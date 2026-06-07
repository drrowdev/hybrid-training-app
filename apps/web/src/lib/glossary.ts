/**
 * Central glossary — one source of truth for every derived metric the
 * app surfaces to users. The `<MetricHelp term="..." />` component
 * looks entries up here. Keep each `body` < 280 characters and end
 * with what the user does with the number; cite primary research only
 * (no external program / methodology names).
 */

export type GlossaryEntry = {
  /** Display title shown in the popover header (e.g. "Acute training load (ATL)"). */
  title: string;
  /** Plain-language explanation, 2–3 sentences, ends with how the user uses it. */
  body: string;
  /** Optional research citation, e.g. "Banister 1976". */
  citation?: string;
};

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ─── Load model ──────────────────────────────────────────────────
  ctl: {
    title: "Chronic training load (CTL)",
    body:
      "Your fitness baseline: an exponentially-weighted 42-day average of daily training stress. Slow to move — think of it as the platform you've built. We use it as the denominator against acute load to read whether you're under-, at-, or over-trained.",
    citation: "Banister 1976",
  },
  atl: {
    title: "Acute training load (ATL)",
    body:
      "Recent fatigue: an exponentially-weighted 7-day average of daily training stress. Fast to move. When ATL spikes above CTL you're overreaching; when it dips well below you're rested. Used to compute training-stress balance.",
    citation: "Banister 1976",
  },
  tsb: {
    title: "Training stress balance (TSB)",
    body:
      "CTL minus ATL. Positive means fresh and ready to perform; negative means fatigued and accumulating stress. We use TSB to flag peaking windows and to soften prescriptions when you're deep in the red.",
    citation: "Banister 1976",
  },
  acwr: {
    title: "Acute-to-chronic workload ratio (ACWR)",
    body:
      "Last 7 days of load divided by the rolling 28-day average. The sweet spot sits at 0.8–1.3; above 1.5 the injury-risk curve steepens sharply. We warn before scheduling a session that would push you over the line.",
    citation: "Gabbett 2016",
  },

  // ─── Ceiling + recovery ──────────────────────────────────────────
  ceiling: {
    title: "Weekly ceiling",
    body:
      "The maximum weekly tonnage we estimate you can absorb without losing recovery. Computed from your last 3 recovered weeks (median × confidence). Used to flag overreach when a plan exceeds it.",
  },
  recovered_week: {
    title: "Recovered week",
    body:
      "A week where every planned session was logged, no session sRPE exceeded 9, and pre-session fatigue + soreness both averaged below 4 (1–5 scale). Used as the foundation for your ceiling estimate.",
  },
  grm: {
    title: "Global recovery multiplier (GRM)",
    body:
      "A 0.85–1.10 scalar that nudges the day's prescribed intensity up or down based on your check-in — fatigue, soreness, and (when logged) sleep. We apply it before you start, so today's load matches today's body.",
  },
  confidence_bias: {
    title: "Confidence bias",
    body:
      "A multiplier on the ceiling that shrinks when we have little data. With 3+ recovered weeks it's 1.00; with sparse history it collapses toward 0.80 so the engine projects conservatively until you've built a track record.",
  },
  cold_start: {
    title: "Cold start",
    body:
      "The state of the engine before it has enough data to estimate ceilings confidently — fewer than 3 recovered weeks logged. We walk down a conservative ladder of defaults until the personal signal takes over.",
  },

  // ─── Buckets + regions ───────────────────────────────────────────
  bucket_pressure: {
    title: "Bucket pressure",
    body:
      "How much of a stress bucket's weekly cap each muscle region or stress type is consuming. 100% means at the cap; over 100% means we're betting on recovery. Used to spot which bucket is closest to the limit.",
  },
  stress_bucket: {
    title: "Stress bucket",
    body:
      "Training stress isn't one number — we split it into six buckets (e.g. lower-body strength, push, pull, conditioning) so the engine can balance hard days. Each bucket has its own acute load, chronic load, and ceiling.",
  },
  region_freshness: {
    title: "Region freshness",
    body:
      "Per-region recovery score (0–100%) derived from days-since-load and recent load magnitude. Used to choose movements that target rested regions and to back off ones that are still rebuilding.",
  },
  muscle_freshness: {
    title: "Muscle freshness (16-muscle grid)",
    body:
      "Same idea as region freshness but at higher resolution — 16 muscles. Green ≥ 4 days fresh, yellow 2–3 days, red < 2 days, grey not yet trained. Used to fine-tune accessory selection.",
  },
  days_since_load: {
    title: "Days since load",
    body:
      "How long since this region or muscle last took a meaningful set. Combined with set magnitude it drives the freshness curve. Used as the simple, transparent input behind the colored heatmap.",
  },

  // ─── Volume science ──────────────────────────────────────────────
  mv: {
    title: "Maintenance volume (MV)",
    body:
      "The minimum weekly sets per muscle that hold what you already have. Below MV the region detrains. Used as the floor when designing a deload or a maintenance week.",
    citation: "Schoenfeld 2017",
  },
  mev: {
    title: "Minimum effective volume (MEV)",
    body:
      "The smallest weekly set count that drives a meaningful adaptation. Programs that sit below MEV stop growing strength or size. Used as the lower bound of the productive band.",
    citation: "Schoenfeld 2017",
  },
  mav: {
    title: "Maximum adaptive volume (MAV)",
    body:
      "The weekly volume range where most of the gains happen — productive without overshooting recovery. We aim plans here for accumulation weeks. Used as the working band on the freshness chart.",
    citation: "Schoenfeld 2017",
  },
  mrv: {
    title: "Maximum recoverable volume (MRV)",
    body:
      "The most weekly volume you can recover from before performance regresses. Going past MRV burns the candle at both ends. Used as the ceiling on a region's set count.",
    citation: "Schoenfeld 2017",
  },
  weekly_tonnage: {
    title: "Weekly tonnage",
    body:
      "Sum of weight × reps for all working sets in a week, in kg or lb. A blunt but useful proxy for mechanical stress. Used to track progressive overload week-over-week and to feed the ceiling estimate.",
  },

  // ─── Strength outputs ───────────────────────────────────────────
  e1rm: {
    title: "Estimated 1RM (e1RM)",
    body:
      "Predicted one-rep max from a top set. We take the smaller of the Epley and Brzycki formulas (and use the RPE chart when RPE is logged) to stay conservative. Used as your strength signal between true tests.",
  },
  rpe: {
    title: "Rate of perceived exertion (RPE)",
    body:
      "Subjective effort on a 1–10 scale, where 10 = no reps left in the tank and 8 = ~2 reps in reserve. Logged per set or post-session. Used to gauge intensity without a barbell test and to flag creep across weeks.",
  },
  srpe: {
    title: "Session RPE (sRPE)",
    body:
      "Whole-session perceived effort on a 1–10 scale, logged after you finish. Multiplied by session duration to give a single training-load number per session. Used as the unit feeding ATL, CTL, and TSB.",
  },
  rpe_creep: {
    title: "RPE creep",
    body:
      "When the same prescribed weight feels harder week-over-week (rising average RPE on a tracked lift). A leading indicator of accumulated fatigue. Used to trigger a deload before missed reps show up.",
  },
  amrap: {
    title: "AMRAP set",
    body:
      "\"As many reps as possible\" — the final set is taken to a hard stop, leaving 0–1 reps in reserve. Used to update e1RM from a real top-end effort and to detect strength gains between formal tests.",
  },

  // ─── Adherence + outcomes ────────────────────────────────────────
  adherence: {
    title: "Adherence",
    body:
      "Logged sessions divided by planned sessions in the window. Skipped sessions count as missed. Used as a baseline reality check — the engine is only as good as the inputs you actually log.",
  },
  run_plan_adherence: {
    title: "Run-plan adherence",
    body:
      "Actual run minutes divided by planned run minutes per week. Outline = planned, fill = actual. Used to tell whether your cardio block is being executed as designed before chasing outcome metrics.",
  },
  streak: {
    title: "Streak",
    body:
      "Consecutive days where you either logged a session or took a planned rest day. Skips break it; rest days don't. Used as a low-pressure consistency cue — the longest streak is your personal high-water mark.",
  },
  completion_pct: {
    title: "Completion %",
    body:
      "Sessions logged divided by sessions scheduled to date in a block. Counts only sessions whose date has passed. Used to track how on-rail a block is mid-flight.",
  },

  // ─── Cardio / HR ─────────────────────────────────────────────────
  hr_zones: {
    title: "HR zones (Z1–Z5)",
    body:
      "Heart-rate bands from recovery (Z1) to VO2max (Z5), set per athlete from max HR or LTHR. Time-in-zone tells you what kind of stress your cardio is actually delivering. Used to keep easy days easy and hard days hard.",
  },
  polarised_distribution: {
    title: "Polarised distribution",
    body:
      "Spend ~80% of cardio time easy (Z1–Z2) and ~20% hard (Z4–Z5), minimising medium tempo (Z3). Used to read your easy/threshold/hard split against an evidence-based target.",
    citation: "Seiler 2010",
  },
  pace_pr: {
    title: "Pace PR",
    body:
      "Fastest pace you've held over a standard distance (1K, 5K, 10K, half, full). We surface improvements over your prior best. Used to spot real-world running progress that strength PRs alone won't capture.",
  },

  // ─── Wellness ────────────────────────────────────────────────────
  fatigue_score: {
    title: "Fatigue score",
    body:
      "Self-reported 1–5 reading of how worn-down you feel pre-session. Averaged across the week it drives the GRM and the recovered-week qualification rule. Used as one of the simplest, most predictive wellness signals.",
  },
  soreness_score: {
    title: "Soreness score",
    body:
      "Self-reported 1–5 reading of muscular soreness pre-session. Feeds the GRM alongside fatigue. Used to back off compound work on the regions that haven't finished repairing yet.",
  },
  motivation_score: {
    title: "Motivation score",
    body:
      "Self-reported 1–5 reading of training drive. Doesn't directly change today's plan, but a sustained dip is a leading indicator of overreach or life-stress overflow. Used to spot patterns over weeks.",
  },
  bodyweight_trend: {
    title: "Bodyweight trend",
    body:
      "Your bodyweight smoothed over 30 days against the latest reading. Used to read whether you're in a surplus, maintenance, or deficit — context the engine needs before reading strength changes correctly.",
  },
  prediction_accuracy: {
    title: "Prediction accuracy",
    body:
      "Difference between the sRPE you predicted in your pre-session check-in and what you logged afterward. The smaller the gap, the more your read on your body is calibrated. Used as a meta-skill score.",
  },

  // ─── Engine internals ───────────────────────────────────────────
  user_tier: {
    title: "User tier",
    body:
      "A behavioural skill class (novice → advanced) inferred from per-lift e1RM relative to bodyweight, schedule regularity, and check-in fill rate. Used to gate planning defaults — set-rep schemes, deload frequency, archetype options.",
  },
  bts_tier: {
    title: "Inferred tier",
    body:
      "Same idea as user tier — a behavioural class read off your declared experience plus four observed signals (e1RM-per-kg, 12-week anchor adherence, schedule regularity, check-in fill rate). The confidence % reflects how much data the read is built on.",
  },
  rolling_mean: {
    title: "Rolling mean",
    body:
      "An average taken over a moving window (the most recent N days) rather than across the whole history. Smooths daily fluctuations to surface the trend underneath. We use a 7-day window for bodyweight so a single big-meal day doesn't move the line.",
  },
  ai_notes: {
    title: "Training notes",
    body:
      "A free-text field where you can record what works for you and the engine can later annotate patterns it notices. Right now you own this entirely — write whatever helps you read your own training.",
  },
  decision_trace: {
    title: "Decision trace",
    body:
      "The short, ordered list of reasons the engine chose today's session shape (movements, sets, RPE caps). Surfaces the rules instead of hiding them. Used to debug the prescription when it doesn't feel right.",
  },
  override_event: {
    title: "Override event",
    body:
      "A row written every time you skip a planned session, swap a movement, or end a block early. Used to keep an honest audit log so you can see when the engine's calls and your judgment have diverged.",
  },
  injury_aware_ceiling: {
    title: "Injury-aware ceiling",
    body:
      "When an active limitation overlaps a movement or muscle, the engine caps the load — and may swap or skip. Cap scales with severity (mild ~80%, moderate ~60%, severe = skip). Lets you keep training around an issue.",
  },
  tendons_joints_integrated: {
    title: "Tendons & joints — integrated",
    body:
      "Tendon work lives inside every block, not as a separate day. Heavy-slow-resistance tempo work surfaces on selected sessions, and short isometric holds (30–45 s) are prescribed for vulnerable areas. Tendons adapt to load + time-under-tension, not extra sessions.",
  },
  two_a_day: {
    title: "Two-a-day",
    body:
      "This day has two sessions — an AM and a PM. Research recommends ≥6 h between sessions when one is heavy lifting and the other is cardio, to protect the strength signal.",
    citation: "Robineau 2016",
  },

  // ─── "Why the engine programmed this" (engine-reasoning sparks) ──────
  deload: {
    title: "Why this week backs off (deload)",
    body:
      "A planned lighter week — reduced volume, easier loads — that lets accumulated fatigue dissipate so the next hard block lands on a recovered body. It's the secondary valve; submaximal loading is the primary one. Train through it feeling fresh and the app may offer to skip it.",
    citation: "Bell 2022",
  },
  training_max: {
    title: "Why a training max (not your true max)",
    body:
      "Your percentages come off a training max set deliberately BELOW your true 1RM (~85–90%). Working submaximally keeps every rep clean and fatigue low, and fits alongside your cardio — which is what drives steady long-term strength, not maxing out each session.",
    citation: "Helms 2018",
  },
  submaximal_loading: {
    title: "Why the percentages stay submaximal",
    body:
      "Loads wave up across the weeks but stay short of a true max, with reps left in reserve. It is the accumulation of quality work over time — not grinding to failure — that builds strength while keeping you fresh enough to recover and to train your other qualities.",
    citation: "Helms 2018",
  },
  accessory_work: {
    title: "Why these accessories were chosen",
    body:
      "These movements cover what your main lift leaves out — grip and tendon work (carries, isometrics), single-leg balance, and muscles the big lifts barely hit. The picks also fit your equipment, how recently each area was trained, and any focus muscles you've set.",
    citation: "Schoenfeld 2017",
  },
  hsr: {
    title: "HSR — Heavy Slow Resistance",
    body:
      "A tendon-loading protocol: heavy weight moved deliberately slowly (a slow ~3s lower and ~3s lift). The slow tempo under load builds tendon stiffness and resilience — similar results to eccentric-only work, better adherence. That's why these reps are paced, not rushed.",
    citation: "Kongsgaard 2009",
  },
};

/**
 * Safe lookup. Returns `null` for unknown terms instead of throwing —
 * keeps the caller's render path resilient if a term name drifts.
 */
export function getGlossaryEntry(term: string): GlossaryEntry | null {
  return Object.prototype.hasOwnProperty.call(GLOSSARY, term)
    ? GLOSSARY[term]
    : null;
}
