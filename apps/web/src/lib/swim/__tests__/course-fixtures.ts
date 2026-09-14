import { SWIM_COURSE_VERSION, type SwimCourse } from "@hta/domain";

export function syntheticCourse(): SwimCourse {
  const workout: SwimCourse["weeks"][number]["workouts"][number] = {
    title: "Synthetic practice", reportedDistanceMetres: 350,
    sections: [
      { kind: "warmup", label: "Warm-up", rounds: 1, items: [
        { repeats: 1, distanceMetres: 50, stroke: "freestyle", effort: "easy", equipment: [] },
      ] },
      { kind: "main", label: "Main", rounds: 1, items: [
        { repeats: 5, distanceMetres: 50, stroke: "freestyle", effort: "steady", equipment: [], restSeconds: 20 },
      ] },
      { kind: "cooldown", label: "Cool-down", rounds: 1, items: [
        { repeats: 1, distanceMetres: 50, stroke: "freestyle", effort: "easy", equipment: [] },
      ] },
    ],
  };
  return {
    version: SWIM_COURSE_VERSION, title: "Synthetic private course",
    source: { reference: "Synthetic fixture, not a training recommendation", edition: "Test edition" },
    weeks: [{ workouts: [workout, structuredClone(workout)] }, { workouts: [structuredClone(workout)] }],
  };
}
