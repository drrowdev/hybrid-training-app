import { swimPrimaryStroke, type SwimEffort, type SwimItem, type SwimStroke, type SwimWorkout } from "./swimming";

const STROKE_CUES: Record<SwimStroke, string> = {
  freestyle: "Look down, rotate with each stroke and breathe to the side without lifting your head.",
  backstroke: "Look up, keep your hips near the surface and rotate your shoulders smoothly.",
  breaststroke: "Pull, breathe, kick, then glide briefly in a long body position.",
  butterfly: "Use a small body wave and relaxed recovery; keep both arms moving together.",
  individual_medley: "Swim butterfly, backstroke, breaststroke, then freestyle in equal portions when the repeat allows.",
  choice: "Choose a familiar stroke and keep the movement relaxed and consistent.",
  kick: "Keep the kick small and controlled, with relaxed ankles.",
};
const EFFORT_CUES: Record<SwimEffort, string> = {
  easy: "Swim comfortably with relaxed breathing; finish each repeat ready to continue.",
  steady: "Hold an even, sustainable effort from the first repeat to the last.",
  brisk: "Swim strongly but under control; keep your technique as breathing quickens.",
  threshold: "Hold a hard, repeatable effort rather than sprinting the first repeat.",
  sprint: "Swim fast with controlled technique; recover at the wall for the prescribed rest.",
};
const SINGLE_ARM: Partial<Record<SwimStroke, string>> = {
  freestyle: "Keep one arm forward and swim with the other. Breathe to the working side; switch arms each length.",
  backstroke: "Keep one arm by your side and stroke with the other, rotating gently. Switch arms each length.",
  breaststroke: "Practise one arm's outward sweep and recovery at a time with a gentle breaststroke kick. Switch arms each length.",
  butterfly: "Keep one arm forward and stroke with the other using a gentle dolphin kick. Switch arms each length.",
};

/** Read-only guidance for current and historical issued snapshots; never alters targets. */
export function swimItemGuidance(workout: SwimWorkout, item: SwimItem) {
  const primary = item.stroke === "kick" ? swimPrimaryStroke(workout.snapshot.strokes) : item.stroke;
  let drillLabel: string | null = null;
  let instruction = STROKE_CUES[item.stroke];
  if (item.drill === "single_arm") {
    drillLabel = "Single-arm drill";
    instruction = SINGLE_ARM[item.stroke] ?? "Ask a swim coach to demonstrate this drill for your chosen stroke before trying it.";
  } else if (item.drill === "kick_with_board") {
    drillLabel = "Kick with board";
    const kick = primary === "breaststroke" ? "Use a gentle breaststroke kick, bringing the heels in before sweeping the feet out and together."
      : primary === "butterfly" ? "Use small dolphin kicks with both legs together."
      : primary === "freestyle" || primary === "backstroke" ? "Alternate small kicks from the hips with relaxed ankles."
      : "Use a comfortable kick you already know.";
    instruction = `Hold the board lightly with your shoulders relaxed. ${kick} Breathe normally.`;
  } else if (item.drill === "pull_count_strokes") {
    drillLabel = "Pull and count strokes";
    instruction = "Place the pull buoy between your thighs and let it support your legs. Count arm cycles each length; aim for a repeatable count without forcing a longer glide. " + STROKE_CUES[item.stroke];
  } else if (item.drill) {
    drillLabel = "Technique drill";
    instruction = "Check the drill with a swim coach before trying it.";
  }
  const focus = workout.focus === "endurance" ? "Keep the last repeat as smooth as the first."
    : workout.focus === "event_specific" ? "Practise consistent turns and a controlled finish."
    : "Prioritise smooth movement over speed.";
  return { drillLabel, instruction, effort: EFFORT_CUES[item.effort], focus };
}
