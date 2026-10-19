import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrescriptionItem } from "@hta/db";
import { WorkoutExercises } from "./WorkoutExercises";

const render = (items: unknown[]) =>
  renderToStaticMarkup(<WorkoutExercises items={items as PrescriptionItem[]} detailed />);

describe("WorkoutExercises detailed view", () => {
  it("shows a note once, as the cue", () => {
    const html = render([{
      kind: "tendon", movementId: "c", movementName: "Copenhagen Plank", sets: 1,
      holdSec: { min: 20, max: 20 }, notes: "Isometric. Side plank for lower leg",
      meta: { rehab: true },
    }]);
    expect(html.match(/Side plank for lower leg/g)).toHaveLength(1);
    expect(html).toContain("1 × 20s hold");
  });

  it("lists accessories after the main lifts", () => {
    const html = render([
      { kind: "main", movementId: "b", movementName: "Bench", sets: 1, reps: 5, percentTm: 75 },
      { kind: "accessory", movementId: "a", movementName: "Curl", sets: 1, reps: 10 },
      { kind: "accessory", movementId: "a", movementName: "Curl", sets: 1, reps: 10 },
    ]);
    expect(html).toContain("Accessories");
    expect(html).toContain("2 × 10");
  });

  it("does not repeat the conditioning name or effort", () => {
    const html = render([{
      kind: "cardio_easy", movementId: "r", movementName: "Easy Run — Z2",
      cardioPlan: {
        summary: "Easy Run — Z2", meta: "",
        segments: [{ label: "Easy Run — Z2", detail: "40–60 min Zone 2" }], effort: "Zone 2",
      },
    }]);
    expect(html.match(/Easy Run — Z2/g)).toHaveLength(1);
    expect(html.match(/Zone 2/g)).toHaveLength(1);
  });
});
