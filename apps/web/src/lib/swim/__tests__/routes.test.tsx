import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import SwimPage from "@/app/app/swim/page";
import SwimWorkoutPage from "@/app/app/swim/[workoutId]/page";
import { SwimHub } from "@/components/swim/SwimHub";
import { WorkoutClient } from "@/components/swim/WorkoutClient";
import { getSwimCapability } from "../capability";
import { listSwimPlans } from "../storage";
import { loadSwimHubView, loadSwimWorkoutView } from "../queries";
import { swimFixture, userId } from "./fixtures";

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
vi.mock("@/components/swim/WorkoutClient", () => ({ WorkoutClient: () => null }));

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
  });
  it("does not query additive tables on an old schema", async () => {
    vi.mocked(getSwimCapability).mockResolvedValue({ storageAvailable: false, setupEnabled: false });
    await SwimPage({ searchParams: Promise.resolve({}) });
    expect(listSwimPlans).not.toHaveBeenCalled();
    expect(loadSwimHubView).not.toHaveBeenCalled();
  });
  it("keeps the structured workout and edit link reachable after setup is disabled", async () => {
    const page = await SwimWorkoutPage({ params: Promise.resolve({ workoutId: "workout" }), searchParams: Promise.resolve({ edit: "1" }) });
    expect(elements(page).find((element) => element.type === WorkoutClient)?.props).toMatchObject({ userId, edit: true });
  });
  it("does not fall back to a generic editor for missing structured work", async () => {
    vi.mocked(loadSwimWorkoutView).mockResolvedValue(null);
    await expect(SwimWorkoutPage({ params: Promise.resolve({ workoutId: "missing" }), searchParams: Promise.resolve({}) })).rejects.toThrow("not-found");
  });
});
