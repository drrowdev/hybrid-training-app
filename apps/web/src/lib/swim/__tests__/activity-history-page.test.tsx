import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
import SessionsListPage from "@/app/app/sessions/page";
import { getAuthUser } from "@/lib/supabase/server";
import { loadSwimActivity } from "../activity-history";
import { SWIM_TRAINING_LABEL, type SwimActivity } from "../activity-presentation";

const { transport } = vi.hoisted(() => ({ transport: vi.fn<typeof fetch>() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient("https://synthetic.invalid", "synthetic-key", {
    global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }),
  getAuthUser: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
}));
vi.mock("@/components/ui/BackLink", () => ({
  BackLink: ({ href, label }: { href: string; label: string }) => <a href={href}>{label}</a>,
}));
vi.mock("@/components/trash/DeleteSessionButton", () => ({
  DeleteSessionButton: ({ sessionId }: { sessionId: string }) => <button data-session-delete={sessionId} />,
}));
vi.mock("../activity-history", () => ({ loadSwimActivity: vi.fn() }));

const user = "00000000-0000-4000-8000-000000000001";
const nativeId = "00000000-0000-4000-8000-000000000002";
const swim: SwimActivity = {
  kind: "swim", id: "00000000-0000-4000-8000-000000000003",
  importId: "00000000-0000-4000-8000-000000000004", title: "Synthetic swim",
  date: "2026-09-21", scheduledDate: "2026-09-22", status: "completed",
};
const native = {
  id: nativeId, title: "Synthetic strength", performed_at: "2026-09-22T01:00:00Z",
  completed_at: "2026-09-22T02:00:00Z", fatigue: null, soreness: null, session_rpe: 7, duration_min: 60,
};
const requests: URL[] = [];
let nativeRows: (typeof native & { swim_rehab?: unknown })[];
let failedTable: string | null;

beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  nativeRows = [native];
  failedTable = null;
  vi.mocked(getAuthUser).mockResolvedValue({
    data: { user: { id: user, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-21T00:00:00Z" } },
    error: null,
  });
  vi.mocked(loadSwimActivity).mockResolvedValue([swim]);
  transport.mockImplementation(async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (failedTable && url.pathname.endsWith(failedTable)) return Response.json({ code: "42501" }, { status: 403 });
    if (url.pathname.endsWith("/profiles")) return Response.json({
      timezone: "America/Los_Angeles", time_format: "24h", date_format: "iso",
    });
    if (url.pathname.endsWith("/sessions")) return Response.json(nativeRows);
    throw new Error("Unexpected request.");
  });
});

describe("DC-SW3/SW7/SW8 independent swimming in shared History", () => {
  it("shows native work and imported outcomes together without a synthetic native row or delete action", async () => {
    const html = renderToStaticMarkup(await SessionsListPage());
    expect(html).toContain(`/app/sessions/${nativeId}`);
    expect(html).toContain(`/app/swim/recordings/${swim.importId}?workout=${swim.id}&amp;from=sessions`);
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html.match(/data-session-delete=/g)).toHaveLength(1);
    expect(html).toContain(`data-session-delete="${nativeId}"`);
    expect(html).not.toContain(`/app/sessions/${swim.id}`);
    expect(html.match(/2026-09-21/g)).toHaveLength(2);
    expect(html).not.toContain(swim.scheduledDate);
    expect(loadSwimActivity).toHaveBeenCalledWith(expect.anything(), user, 100);
    const sessionRequest = requests.find((url) => url.pathname.endsWith("/sessions"))!;
    expect(sessionRequest.searchParams.get("user_id")).toBe(`eq.${user}`);
    expect(sessionRequest.searchParams.get("deleted_at")).toBe("is.null");
    expect(sessionRequest.searchParams.get("limit")).toBe("100");
  });
  it.each(["completed", "stopped_early", "needs_review"] as const)("shows %s swim-only history without native measurements", async (status) => {
    nativeRows = [];
    vi.mocked(loadSwimActivity).mockResolvedValue([{ ...swim, status }]);
    const html = renderToStaticMarkup(await SessionsListPage());
    expect(html).toContain(SWIM_TRAINING_LABEL[status]);
    expect(html.match(/<li /g)).toHaveLength(1);
    expect(html).not.toContain("data-session-delete");
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(/\b(?:Effort \d+|\d+ min)\b/);
  });
  it("retains native-only history when the additive capability is absent", async () => {
    vi.mocked(loadSwimActivity).mockResolvedValue([]);
    const html = renderToStaticMarkup(await SessionsListPage());
    expect(html.match(/<li /g)).toHaveLength(1);
    expect(html).toContain(`/app/sessions/${nativeId}`);
  });
  it("DC-R5 keeps attached rehab and the swim recording as separate results in the same program", async () => {
    nativeRows = [{ ...native, title: "Shoulder rehab", swim_rehab: {
      version: 1, planId: nativeId, workoutId: swim.id, scheduledDate: swim.scheduledDate,
      protocolId: user, protocolRevision: 2, protocolName: "Shoulder rehab",
    } }];
    const html = renderToStaticMarkup(await SessionsListPage());
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html.match(/data-session-delete=/g)).toHaveLength(1);
    expect(html).toContain(`/app/sessions/${nativeId}`);
    expect(html).toContain(`/app/swim/recordings/${swim.importId}?workout=${swim.id}`);
    expect(html).not.toContain(`/app/sessions/${swim.id}`);
    expect(html).toContain("Swimming · Rehab");
    expect(requests.find((url) => url.pathname.endsWith("/sessions"))?.searchParams.get("select"))
      .toContain("swim_rehab:prescription->meta->swimRehab");
  });
  it("retains the existing empty-state action when both sources are empty", async () => {
    nativeRows = [];
    vi.mocked(loadSwimActivity).mockResolvedValue([]);
    const html = renderToStaticMarkup(await SessionsListPage());
    expect(html).not.toContain("<li ");
    expect(html).toContain('href="/app/sessions/new"');
  });
  it.each(["/sessions", "/profiles"])("does not turn %s failures into empty history", async (table) => {
    failedTable = table;
    await expect(SessionsListPage()).rejects.toThrow("Your training history could not be loaded.");
  });
  it("does not conceal a failed imported-history read", async () => {
    vi.mocked(loadSwimActivity).mockRejectedValue(new Error("Recorded swims could not be loaded."));
    await expect(SessionsListPage()).rejects.toThrow("Recorded swims could not be loaded.");
  });
});
