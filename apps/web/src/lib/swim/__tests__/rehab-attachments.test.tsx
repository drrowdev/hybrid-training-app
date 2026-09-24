import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { revalidatePath } from "next/cache";
import { loadSwimRehabAttachments, loadSwimRehabUsage } from "../rehab-attachments";
import { saveSwimRehabAttachments } from "../rehab-actions";
import { SwimRehabEditor } from "@/components/swim/SwimRehabEditor";
import { listRehabProtocols } from "@/lib/rehab-protocols/queries";
import { deleteRehabProtocol } from "@/lib/rehab-protocols/actions";
import { userId, planId, receiptId } from "./fixtures";

const server = vi.hoisted(() => ({ createClient: vi.fn(), getAuthUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => server);
vi.mock("../capability", () => ({ requireSwimStorage: vi.fn(), requireSwimSetup: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/lib/platform/actions", () => ({ createProgramInstance: vi.fn() }));
vi.mock("@/lib/platform/edit-context", () => ({ getBlockEditContext: vi.fn() }));

const protocolId = "00000000-0000-4000-8000-000000000020";
const secondProtocolId = "00000000-0000-4000-8000-000000000021";
const plan = { id: planId, user_id: userId, status: "active" as const };
const revision = "a".repeat(32);
const input = { planId, protocolIds: [protocolId], revision, requestId: receiptId };
type RecordedRequest = { url: URL; method: string; body: unknown };

function fixture(overrides: Record<string, { data: unknown; status?: number }> = {}) {
  const requests: RecordedRequest[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname.replace("/rest/v1/", "");
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url: parsed, method: init?.method ?? "GET", body });
    const defaults: Record<string, unknown> = {
      "rpc/independent_programs_ready": true,
      "rpc/training_schedule_snapshot": { revision, entries: [] },
      "rpc/set_swim_rehab_bindings": { planId, protocolIds: input.protocolIds },
      rehab_protocols: [{ id: protocolId, name: "Adductor rehab" }, { id: secondProtocolId, name: "Shoulder rehab" }],
      swim_plan_rehab_bindings: [{ rehab_protocol_id: protocolId, plan_id: planId }],
      swim_plans: [{ id: planId, status: "active", definition: { privateCourse: { title: "Pool course" } } }],
      program_rehab_bindings: [{ rehab_protocol_id: protocolId, program_instance_id: receiptId }],
      program_instances: [{ id: receiptId, display_name: "Strength A", status: "active", deleted_at: null }],
    };
    if (!(path in defaults)) throw new Error(`Unexpected fixture request: ${path}`);
    const response = overrides[path] ?? { data: defaults[path] };
    return new Response(JSON.stringify(response.data), {
      status: response.status ?? 200, headers: { "content-type": "application/json" },
    });
  });
  const client = createClient("http://127.0.0.1:54321", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
  });
  server.createClient.mockResolvedValue(client);
  return { client, requests };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(revalidatePath).mockReset();
  server.getAuthUser.mockResolvedValue({ data: { user: { id: userId } } });
});

describe("DC-R5 owned Swimming rehab attachments", () => {
  it("captures freshness before reading the owned shared library and target plan attachments", async () => {
    const { client, requests } = fixture();
    expect(await loadSwimRehabAttachments(client, userId, plan)).toEqual({
      planId, revision, editable: true, attachedIds: [protocolId],
      protocols: [{ id: protocolId, name: "Adductor rehab" }, { id: secondProtocolId, name: "Shoulder rehab" }],
    });
    expect(requests[1]!.url.pathname).toContain("training_schedule_snapshot");
    for (const request of requests.slice(2)) expect(request.url.searchParams.get("user_id")).toBe(`eq.${userId}`);
    expect(requests.find((request) => request.url.pathname.endsWith("swim_plan_rehab_bindings"))!.url.searchParams.get("plan_id"))
      .toBe(`eq.${planId}`);
    expect(requests.every((request) => request.method === "GET" || request.url.pathname.includes("/rpc/"))).toBe(true);
  });
  it("refuses a foreign plan before making any request", async () => {
    const { client, requests } = fixture();
    await expect(loadSwimRehabAttachments(client, userId, { ...plan, user_id: receiptId })).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
  it("omits the feature only for the known pre-migration capability gap", async () => {
    const { client, requests } = fixture({
      "rpc/independent_programs_ready": { data: { code: "PGRST202", message: "Missing independent_programs_ready" }, status: 404 },
    });
    expect(await loadSwimRehabAttachments(client, userId, plan)).toBeNull();
    expect(requests).toHaveLength(1);
  });
  it.each(["rehab_protocols", "swim_plan_rehab_bindings"])("does not hide an installed %s read failure", async (table) => {
    const { client } = fixture({ [table]: { data: { code: "42501" }, status: 403 } });
    await expect(loadSwimRehabAttachments(client, userId, plan)).rejects.toThrow();
  });
  it("refuses a dangling attachment instead of showing an empty selection", async () => {
    const { client } = fixture({ rehab_protocols: { data: [] } });
    await expect(loadSwimRehabAttachments(client, userId, plan)).rejects.toThrow();
  });
  it("resolves Swimming library usage from owned plan IDs without copying the protocol", async () => {
    const { client, requests } = fixture();
    expect(await loadSwimRehabUsage(client, userId, protocolId)).toEqual([
      { protocolId, planId, name: "Pool course", active: true },
    ]);
    for (const request of requests.slice(1)) expect(request.url.searchParams.get("user_id")).toBe(`eq.${userId}`);
    expect(requests[1]!.url.searchParams.get("rehab_protocol_id")).toBe(`eq.${protocolId}`);
    expect(requests[2]!.url.searchParams.get("id")).toBe(`in.(${planId})`);
  });
  it("keeps historical attachment usage available for delete refusal, but not as an active program", async () => {
    const { client } = fixture({ swim_plans: { data: [{ id: planId, status: "archived", definition: {} }] } });
    expect(await loadSwimRehabUsage(client, userId)).toEqual([{ protocolId, planId, name: "Swimming", active: false }]);
  });
  it("does not hide a missing owned plan behind an empty usage label", async () => {
    const { client } = fixture({ swim_plans: { data: [] } });
    await expect(loadSwimRehabUsage(client, userId)).rejects.toThrow();
  });
  it("shows simultaneous Strength and Swimming usage in the same shared library entry", async () => {
    fixture();
    const library = await listRehabProtocols();
    expect(library.find((protocol) => protocol.id === protocolId)?.usedBy).toEqual(["Strength A", "Pool course"]);
    expect(library.find((protocol) => protocol.id === secondProtocolId)?.usedBy).toEqual([]);
  });
  it("names the attached swimming program when its owned FK prevents deleting the protocol", async () => {
    fixture({ rehab_protocols: { data: { code: "23503" }, status: 409 } });
    const result = await deleteRehabProtocol(protocolId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Pool course");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it.each(["active", "paused", "finished", "archived"] as const)("allows only supported attachment edits for %s plans", async (status) => {
    const { client } = fixture();
    const context = await loadSwimRehabAttachments(client, userId, { ...plan, status });
    expect(context?.editable).toBe(status === "active" || status === "paused");
    const html = renderToStaticMarkup(<SwimRehabEditor context={context!} />);
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(context?.editable ? 2 : 0);
    expect(html.includes("Shoulder rehab")).toBe(context?.editable);
    expect(html).toContain("Adductor rehab");
  });
  it("does not add an empty rehab panel to historical plans", async () => {
    const { client } = fixture({ swim_plan_rehab_bindings: { data: [] } });
    const context = await loadSwimRehabAttachments(client, userId, { ...plan, status: "archived" });
    expect(renderToStaticMarkup(<SwimRehabEditor context={context!} />)).toBe("");
  });
  it("writes only the explicit plan and library IDs through the locked, replayable RPC", async () => {
    const { requests } = fixture();
    expect(await saveSwimRehabAttachments(input)).toEqual({ ok: true, protocolIds: [protocolId] });
    expect(requests.map((request) => request.url.pathname)).toEqual([
      "/rest/v1/rpc/independent_programs_ready", "/rest/v1/rpc/set_swim_rehab_bindings",
    ]);
    expect(requests[1]!.body).toEqual({
      p_plan_id: planId, p_protocol_ids: [protocolId], p_expected_revision: revision, p_request_id: receiptId,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/app/settings/rehab-protocols");
  });
  it("preserves exact replay input rather than generating a new request on retry", async () => {
    const { requests } = fixture();
    await saveSwimRehabAttachments(input);
    await saveSwimRehabAttachments(input);
    expect(requests[1]!.body).toEqual(requests[3]!.body);
  });
  it("surfaces stale review failure without retrying or refreshing away the draft", async () => {
    const { requests } = fixture({
      "rpc/set_swim_rehab_bindings": { data: { code: "40001", message: "Review the changed attachments." }, status: 409 },
    });
    expect(await saveSwimRehabAttachments(input)).toMatchObject({ errorCode: "validation" });
    expect(requests).toHaveLength(2);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("reports an unavailable protocol without exposing foreign-key or table details", async () => {
    fixture({
      "rpc/set_swim_rehab_bindings": { data: { code: "23503", message: "private constraint details" }, status: 409 },
    });
    const result = await saveSwimRehabAttachments(input);
    expect(result).toMatchObject({ errorCode: "validation" });
    expect(result.error).not.toContain("private constraint");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("does not report success for another target or an incomplete result", async () => {
    for (const data of [null, { planId: receiptId, protocolIds: [protocolId] }, { planId, protocolIds: [] }]) {
      fixture({ "rpc/set_swim_rehab_bindings": { data } });
      expect(await saveSwimRehabAttachments(input)).toHaveProperty("error");
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("keeps a confirmed save distinct from a failed view refresh", async () => {
    fixture();
    vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Synthetic refresh failure"); });
    expect(await saveSwimRehabAttachments(input)).toMatchObject({ ok: true, protocolIds: [protocolId], warning: expect.any(String) });
  });
  it("rejects invalid or duplicate selections before writing", async () => {
    const { requests } = fixture();
    for (const invalid of [
      { ...input, protocolIds: [protocolId, protocolId] }, { ...input, planId: "invalid" },
      { ...input, userId: receiptId }, { ...input, revision: "" },
    ]) expect(await saveSwimRehabAttachments(invalid)).toHaveProperty("error");
    expect(requests).toHaveLength(0);
  });
});
