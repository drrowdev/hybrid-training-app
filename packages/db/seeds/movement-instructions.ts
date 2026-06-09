/**
 * Movement how-to content (migration 0098), keyed by stable slug.
 *
 * Style rules (enforced by review, not code): terse and concrete. One-line
 * summary (what it is / what it trains), one setup line, 3–6 imperative steps,
 * 1–3 cues, and a common mistake ONLY when it's specific and genuinely useful.
 * No filler, no hedging, no disclaimers.
 *
 * The seed runner (`seeds/run-movement-instructions.ts`) resolves each slug to
 * the global (user_id IS NULL) movement id and upserts. Built in batches for
 * accuracy; unmatched slugs are reported, never silently dropped.
 */

export type MovementInstructionSeed = {
  slug: string;
  summary: string;
  setup?: string;
  steps: string[];
  cues: string[];
  commonMistakes?: string[];
};

export const MOVEMENT_INSTRUCTIONS: MovementInstructionSeed[] = [
  // ── Calibration batch (tone + length reference) ──────────────────────────
  {
    slug: "spanish-squat",
    summary:
      "Banded squat that holds the knees back so the shins stay vertical, loading the quads and patellar tendon with little knee travel.",
    setup:
      "Loop a heavy band around a rack upright and behind both knees; step back until it's taut, feet shoulder-width.",
    steps: [
      "Let the band pull your knees back as you sit straight down.",
      "Keep shins vertical and torso tall.",
      "Lower to about 90° at the knee.",
      "Drive through midfoot to stand.",
    ],
    cues: ["Shins stay vertical the whole rep.", "Hips drop straight down, not back."],
    commonMistakes: ["Letting the knees drift forward over the toes."],
  },
  {
    slug: "heel-walk",
    summary: "Walking on your heels with the toes lifted to strengthen the tibialis anterior (shin).",
    setup: "Stand tall and lift the toes and forefoot off the floor so you're balanced on your heels.",
    steps: [
      "Pull the toes up hard toward your shins.",
      "Walk forward in small steps on your heels.",
      "Keep standing tall; don't let the forefoot touch down.",
    ],
    cues: ["Toes stay pulled up the whole time."],
  },
  {
    slug: "tibialis-raise",
    summary: "Lifting the toes against resistance to build the tibialis anterior and protect the shins/knees.",
    setup: "Sit or stand with heels down and the front of the feet free to move (band over the toes or back to a wall).",
    steps: [
      "Pull the toes and forefoot up toward your shins as far as possible.",
      "Pause at the top.",
      "Lower slowly under control.",
    ],
    cues: ["Keep heels planted.", "Control the way down — don't drop it."],
  },
  {
    slug: "single-leg-calf-raise",
    summary: "One-legged calf raise for full ankle range and balanced calf strength.",
    setup: "Stand on one foot with the ball of the foot on an edge, heel free to drop; hold something for balance.",
    steps: [
      "Let the heel sink below the step for a full stretch.",
      "Push through the ball of the foot to rise as high as possible.",
      "Pause at the top, then lower slowly.",
    ],
    cues: ["Full range — deep stretch, high squeeze.", "Don't bounce out of the bottom."],
  },
  {
    slug: "hsr-calf-raise",
    summary: "Heavy slow calf raise (3-second tempo) — a tendon-loading protocol for the Achilles.",
    setup: "Stand on a machine or step with the ball of the foot on the edge, heels free.",
    steps: [
      "Rise to full height over 3 seconds.",
      "Pause briefly at the top.",
      "Lower over 3 seconds to a full stretch.",
    ],
    cues: ["Slow and even — count the tempo.", "Heavy enough that the last reps are hard."],
  },
  {
    slug: "monster-walk-band",
    summary: "Banded sideways/forward walk to fire the glute medius and stabilise the hips and knees.",
    setup: "Loop a band around the ankles or just above the knees; sit into a quarter-squat.",
    steps: [
      "Stay low with tension on the band the whole time.",
      "Step out wide against the band, then bring the other foot in (don't let it click together).",
      "Walk forward/back or side to side keeping knees pushed out.",
    ],
    cues: ["Keep constant band tension.", "Drive the knees out, don't let them cave in."],
  },
  {
    slug: "copenhagen-plank",
    summary: "Side plank with the top leg on a bench to strongly load the adductors (groin).",
    setup: "Lie on your side; rest the inside of your top foot/shin on a bench, elbow under the shoulder.",
    steps: [
      "Lift your hips so the body is a straight line, supported by the top leg.",
      "Squeeze the bench with the top leg to hold position.",
      "Hold for time, keeping the body level.",
    ],
    cues: ["Body in one straight line — no sagging hips.", "Pull the top leg into the bench."],
    commonMistakes: ["Letting the hips drop or rotate back."],
  },
  {
    slug: "back-squat",
    summary: "Barbell squat with the bar on the upper back — the primary lower-body strength lift.",
    setup: "Set the bar on the upper traps, hands just outside the shoulders; unrack and step back, feet shoulder-width.",
    steps: [
      "Take a big breath and brace your core.",
      "Sit down and back, knees tracking over the toes.",
      "Descend until the hip crease is below the knee.",
      "Drive up through the whole foot.",
    ],
    cues: ["Brace before each rep.", "Knees track over toes; chest stays up."],
    commonMistakes: ["Knees caving in.", "Letting the chest fall forward out of the hole."],
  },
  {
    slug: "conventional-deadlift",
    summary: "Pulling a barbell from the floor to lockout — a full-body posterior-chain strength lift.",
    setup: "Bar over midfoot, shins ~an inch away; hinge and grip just outside the legs, shins to the bar.",
    steps: [
      "Take the slack out of the bar and brace.",
      "Push the floor away, keeping the bar against your legs.",
      "Stand tall, finishing with hips and knees locked.",
      "Return by hinging the hips back, then bending the knees.",
    ],
    cues: ["Bar stays against the body the whole pull.", "Brace hard before you break the floor."],
    commonMistakes: ["Hips shooting up first, turning it into a stiff-leg pull.", "Rounding the lower back."],
  },
  {
    slug: "bench-press-flat",
    summary: "Barbell press from the chest on a flat bench — the primary horizontal pressing lift.",
    setup: "Lie back, eyes under the bar, shoulder blades pinched down; grip a bit wider than shoulders.",
    steps: [
      "Unrack and hold the bar over your chest.",
      "Lower under control to the lower chest, elbows ~45°.",
      "Touch the chest, then press up and slightly back over the shoulders.",
    ],
    cues: ["Keep the shoulder blades pinned down and back.", "Drive the feet into the floor."],
    commonMistakes: ["Flaring the elbows straight out to the sides.", "Bouncing the bar off the chest."],
  },
  {
    slug: "pull-up-overhand",
    summary: "Pulling your chin over the bar with an overhand grip — the primary vertical pull for back and lats.",
    setup: "Hang from the bar with an overhand grip a bit wider than shoulders, arms straight.",
    steps: [
      "Pull the shoulder blades down and back to start.",
      "Drive the elbows down and pull your chest toward the bar.",
      "Get the chin over the bar, then lower under control to a full hang.",
    ],
    cues: ["Lead with the chest, not the chin.", "Control the descent — no dropping."],
    commonMistakes: ["Kipping/swinging to get up.", "Stopping short of a full hang at the bottom."],
  },
  {
    slug: "hip-thrust-bb",
    summary: "Barbell hip extension off a bench — the primary direct glute-strength movement.",
    setup: "Upper back on a bench, barbell over the hips (use a pad), feet flat, shins vertical at the top.",
    steps: [
      "Tuck the chin and brace.",
      "Drive through the heels to lift the hips to full extension.",
      "Squeeze the glutes hard at the top, shins vertical.",
      "Lower under control.",
    ],
    cues: ["Finish with a hard glute squeeze, ribs down.", "Push through the heels."],
    commonMistakes: ["Overarching the lower back instead of squeezing the glutes.", "Pushing through the toes."],
  },
];
