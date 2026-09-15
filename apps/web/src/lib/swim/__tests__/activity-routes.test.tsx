import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SessionsListPage from "@/app/app/sessions/page";
import { RecentActivity } from "@/components/today/RecentActivity";
import { loadSwimActivity } from "../activity-history";
import { mergeTrainingActivity, type SwimActivity } from "../activity-presentation";
import { userId, sessionId } from "./fixtures";

const mock = vi.hoisted(() => ({
  user: { id: "00000000-0000-4000-8000-000000000001" } as { id: string } | null,
  client: { from: vi.fn() },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mock.client,
  getAuthUser: async () => ({ data: { user: mock.user } }),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/components/trash/DeleteSessionButton", () => ({
  DeleteSessionButton: ({ sessionId: id, label }: { sessionId: string; label: string }) =>
    <button data-delete-session={id}>Delete {label}</button>,
}));
vi.mock("../activity-history", async (original) => ({
  ...await original<typeof import("../activity-history")>(), loadSwimActivity: vi.fn(),
}));
const native = {
  id: sessionId, title: "Strength", performed_at: "2026-09-08T01:00:00Z",
  completed_at: "2026-09-08T02:00:00Z", session_rpe: 7, duration_min: 60,
};
const swims: SwimActivity[] = [
  { kind: "swim", id: "complete", title: "Week 1 A", date: "2026-09-08", status: "completed" },
  { kind: "swim", id: "partial", title: "Week 1 B", date: "2026-09-07", status: "stopped_early" },
  { kind: "swim", id: "stale", title: "Week 1 C", date: "2026-09-06", status: "needs_review" },
];
beforeEach(() => {
  vi.resetAllMocks();
  mock.user = { id: userId };
  vi.mocked(loadSwimActivity).mockResolvedValue(swims);
  mock.client.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: async () => ({ data: { timezone: "America/Los_Angeles", date_format: "iso" }, error: null }),
      limit: async () => {
        expect(table).toBe("sessions");
        return { data: [native], error: null };
      },
    };
    return query;
  });
});
describe("DC-SW7 ordinary history routes", () => {
  it("renders swims alongside native history with distinct outcomes and native-only delete and metrics", async () => {
    const html = renderToStaticMarkup(await SessionsListPage());
    expect(loadSwimActivity).toHaveBeenCalledWith(mock.client, userId, 100);
    expect(html).toContain('href="/app/sessions/' + sessionId + '"');
    for (const id of ["complete", "partial", "stale"]) expect(html).toContain(`href="/app/swim/${id}?from=sessions"`);
    expect(html).toContain("Stopped early");
    expect(html).toContain("Review recording");
    expect(html.match(/data-delete-session=/g)).toHaveLength(1);
    expect(html).toContain(`data-delete-session="${sessionId}"`);
    expect(html.match(/Effort 7/g)).toHaveLength(1);
    expect(html.match(/60 min/g)).toHaveLength(1);
    expect(html.indexOf("Week 1 A")).toBeLessThan(html.indexOf("Strength"));
    expect(html).toContain("2026-09-08");
    expect(html).toContain("2026-09-07");
  });
  it("renders the existing empty state without phantom swim entries", async () => {
    vi.mocked(loadSwimActivity).mockResolvedValue([]);
    mock.client.from.mockReturnValue({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), maybeSingle: async () => ({ data: null, error: null }),
      limit: async () => ({ data: [], error: null }),
    });
    const html = renderToStaticMarkup(await SessionsListPage());
    expect(html).toContain("No sessions yet");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("data-delete-session");
  });
  it("does not turn failed imported history into an empty successful page", async () => {
    vi.mocked(loadSwimActivity).mockRejectedValue(new Error("Recorded swims could not be loaded."));
    await expect(SessionsListPage()).rejects.toThrow("could not be loaded");
  });
  it("redirects an unauthenticated user before any history read", async () => {
    mock.user = null;
    await expect(SessionsListPage()).rejects.toThrow("redirect:/login");
    expect(loadSwimActivity).not.toHaveBeenCalled();
    expect(mock.client.from).not.toHaveBeenCalled();
  });
  it("renders Today groups using actual local dates and preserves return navigation", () => {
    const html = renderToStaticMarkup(<RecentActivity
      sessions={mergeTrainingActivity([native], swims, "America/Los_Angeles", 8)} todayIso="2026-09-08" />);
    expect(html.indexOf("Today")).toBeLessThan(html.indexOf("Week 1 A"));
    expect(html.indexOf("Yesterday")).toBeLessThan(html.indexOf("Strength"));
    expect(html.indexOf("Earlier")).toBeLessThan(html.indexOf("Week 1 C"));
    expect(html).toContain('href="/app/swim/partial?from=today"');
    expect(html.match(/Effort 7/g)).toHaveLength(1);
    expect(html.match(/60 min/g)).toHaveLength(1);
    expect(html).toContain("Stopped early");
    expect(html).toContain("Review recording");
    expect(html).toContain('class="sr-only">Completed');
  });
});
