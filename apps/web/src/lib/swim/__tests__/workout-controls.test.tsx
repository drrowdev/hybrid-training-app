import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkoutClient } from "@/components/swim/WorkoutClient";
import { workoutPresentation } from "../presentation";
import type { SwimWorkoutView } from "../view-types";
import { swimFixture, userId, sessionId } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
vi.mock("../actions", () => ({}));
vi.mock("@/components/trash/DeleteSessionButton", () => ({ DeleteSessionButton: () => null }));
vi.mock("@/lib/offline/flusher", () => ({}));

function workoutView(): SwimWorkoutView {
  const row = swimFixture().workouts[0]!;
  return {
    ...workoutPresentation(row.definition.issued),
    id: row.id, revision: 2, sessionId, status: "started",
    planStatus: "active", date: row.scheduled_date,
    provisional: false, deleted: false, result: null,
  };
}

describe("DC-SW3 poolside workout controls", () => {
  it("reaches actual logging without scrolling through every repeat", () => {
    const html = renderToStaticMarkup(<WorkoutClient workout={workoutView()} userId={userId} />);
    expect(html).toContain('href="#swim-result"');
    expect(html).toContain('id="swim-result"');
  });

  it("does not offer the logging shortcut before starting", () => {
    const workout = { ...workoutView(), status: "scheduled" as const, sessionId: null };
    const html = renderToStaticMarkup(<WorkoutClient workout={workout} userId={userId} />);
    expect(html).not.toContain('href="#swim-result"');
    expect(html).not.toContain('id="swim-result"');
  });
});
