import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import SwimPage from "@/app/app/swim/page";
import SwimWorkoutPage from "@/app/app/swim/[workoutId]/page";
import { SwimHub } from "@/components/swim/SwimHub";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorkoutScreen } from "@/components/swim/WorkoutScreen";
import { getSwimCapability } from "../capability";
import { listSwimPlans } from "../storage";
import { loadSwimHubView, loadSwimWorkoutView } from "../queries";
import { swimFixture, userId, sessionId } from "./fixtures";
import { workoutPresentation } from "../presentation";
import type { SwimWorkoutView } from "../view-types";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not-found"); },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
  getAuthUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("../capability", () => ({ getSwimCapability: vi.fn() }));
vi.mock("../storage", () => ({ listSwimPlans: vi.fn() }));
vi.mock("../queries", () => ({ loadSwimHubView: vi.fn(), loadSwimWorkoutView: vi.fn() }));
vi.mock("@/components/swim/SwimHub", () => ({ SwimHub: () => null }));
vi.mock("@/components/swim/WorkoutScreen", () => ({ WorkoutScreen: () => null }));

function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children)];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSwimCapability).mockResolvedValue({ storageAvailable: true, setupEnabled: false });
  vi.mocked(listSwimPlans).mockResolvedValue([swimFixture().plan]);
  vi.mocked(loadSwimHubView).mockResolvedValue({ id: "view" } as Awaited<ReturnType<typeof loadSwimHubView>>);
  vi.mocked(loadSwimWorkoutView).mockResolvedValue({ id: "workout", title: "Pool swim" } as Awaited<ReturnType<typeof loadSwimWorkoutView>>);
});

describe("ADR0079 reachable standalone routes", () => {
  it("loads the hub without a primary block or enabled setup", async () => {
    const page = await SwimPage({ searchParams: Promise.resolve({}) });
    expect(loadSwimHubView).toHaveBeenCalledWith({}, userId, swimFixture().plan);
    expect(elements(page).some((element) => element.type === SwimHub)).toBe(true);
    expect(elements(page).filter((element) => element.type === PageHeader)).toHaveLength(0);
    expect(elements(page).find((element) => element.type === SwimHub)?.props).toEqual({
      plan: { id: "view" }, setupEnabled: false,
      plans: [{ id: swimFixture().plan.id, startedOn: "2026-09-07", status: "active" }],
    });
  });
  it("does not query additive tables on an old schema", async () => {
    vi.mocked(getSwimCapability).mockResolvedValue({ storageAvailable: false, setupEnabled: false });
    const page = await SwimPage({ searchParams: Promise.resolve({}) });
    expect(listSwimPlans).not.toHaveBeenCalled();
    expect(loadSwimHubView).not.toHaveBeenCalled();
    expect(elements(page).filter((element) => element.type === PageHeader)).toHaveLength(1);
    expect(elements(page).filter((element) => element.type === SwimHub)).toHaveLength(0);
  });
  it("retains one page header and setup action with no plan", async () => {
    vi.mocked(getSwimCapability).mockResolvedValue({ storageAvailable: true, setupEnabled: true });
    vi.mocked(listSwimPlans).mockResolvedValue([]);
    const page = await SwimPage({ searchParams: Promise.resolve({}) });
    const headers = elements(page).filter((element) => element.type === PageHeader);
    expect(headers).toHaveLength(1);
    expect(elements(headers[0]!.props.actions).map((element) => element.props.href)).toContain("/app/swim/setup");
    expect(elements(page).filter((element) => element.type === SwimHub)).toHaveLength(0);
  });
  it("passes only own thin choices and selects the requested plan", async () => {
    const { plan } = swimFixture();
    const other = { ...plan, id: "other", status: "paused" as const };
    vi.mocked(listSwimPlans).mockResolvedValue([plan, other, { ...plan, id: "foreign", user_id: "foreign" }]);
    const page = await SwimPage({ searchParams: Promise.resolve({ plan: other.id }) });
    expect(loadSwimHubView).toHaveBeenCalledWith({}, userId, other);
    expect(elements(page).find((element) => element.type === SwimHub)?.props.plans).toEqual([
      { id: plan.id, startedOn: plan.started_on, status: "active" },
      { id: other.id, startedOn: other.started_on, status: "paused" },
    ]);
  });
  it("keeps the structured workout and edit link reachable after setup is disabled", async () => {
    const page = await SwimWorkoutPage({ params: Promise.resolve({ workoutId: "workout" }), searchParams: Promise.resolve({ edit: "1" }) });
    const screen = elements(page).find((element) => element.type === WorkoutScreen)!;
    expect(screen.props).toEqual({ workout: { id: "workout", title: "Pool swim" }, userId, edit: true });
    expect(screen.key).toBe("workout");
    expect(elements(page).filter((element) => element.type === PageHeader)).toHaveLength(1);
  });
  it("passes query entry, clear and same-revision re-entry to the same owner key (route elements only)", async () => {
    const row = swimFixture().history[0]!.workout;
    const workout: SwimWorkoutView = {
      ...workoutPresentation(row.definition.issued),
      id: row.id, revision: 4, status: "completed", sessionId, planStatus: "active",
      date: row.scheduled_date, provisional: false, deleted: false,
      result: { lengths: 14, timeMs: 840456, rpe: 7, stroke: "backstroke", equipment: ["fins"], notes: "Edited swim" },
    };
    vi.mocked(loadSwimWorkoutView).mockResolvedValue(workout);
    for (const edit of ["1", undefined, "1"]) {
      const page = await SwimWorkoutPage({
        params: Promise.resolve({ workoutId: workout.id }), searchParams: Promise.resolve({ edit }),
      });
      const screen = elements(page).find((element) => element.type === WorkoutScreen)!;
      expect(screen.key).toBe(workout.id);
      expect(screen.props.workout).toBe(workout);
      expect(screen.props).toEqual({ workout, userId, edit: edit === "1" });
    }
    expect(loadSwimWorkoutView).toHaveBeenCalledTimes(3);
    expect(loadSwimWorkoutView).toHaveBeenCalledWith({}, userId, workout.id);
  });
  it("does not fall back to a generic editor for missing structured work", async () => {
    vi.mocked(loadSwimWorkoutView).mockResolvedValue(null);
    await expect(SwimWorkoutPage({ params: Promise.resolve({ workoutId: "missing" }), searchParams: Promise.resolve({}) })).rejects.toThrow("not-found");
  });
});
