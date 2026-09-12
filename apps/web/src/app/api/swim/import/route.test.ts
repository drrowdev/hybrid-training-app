import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdmin } from "@/lib/supabase/server";
import { hashSwimImportKey } from "@/lib/swim/import-key";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createAdmin: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const key = `swim_${"a".repeat(43)}`;
const observation = {
  version: 1, activity: { activity_id: "123", date: "2026-09-12", type: "lap_swimming", distance_m: 900, duration_s: 1200 },
  detail: null,
};
let response: { data: unknown; error: { code: string; message: string } | null };
const rpc = vi.fn(() => ({ abortSignal: vi.fn(async () => response) }));
function request(body: unknown = observation, headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/swim/import", {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv("SWIM_IMPORT_ENABLED", "true");
  vi.clearAllMocks();
  response = { data: { id, revision: 1, replayed: false }, error: null };
  vi.mocked(createAdmin).mockReturnValue({ rpc } as never);
});
afterEach(() => vi.unstubAllEnvs());

describe("DC-SW8 scoped swimming receiver", () => {
  it("is off by default and never creates an admin client for a disabled request", async () => {
    vi.stubEnv("SWIM_IMPORT_ENABLED", "");
    expect((await POST(request())).status).toBe(503);
    expect(createAdmin).not.toHaveBeenCalled();
  });
  it.each(["", "Bearer invalid", `bearer ${key}`, `Bearer ${key} extra`])("rejects invalid authorization", async (authorization) => {
    expect((await POST(request(observation, { authorization }))).status).toBe(401);
    expect(createAdmin).not.toHaveBeenCalled();
  });
  it.each([
    [{ ...observation, userId: id }, 422],
    [{ ...observation, activity: { ...observation.activity, heartRate: 160 } }, 422],
    [{ ...observation, activity: { ...observation.activity, type: "running" } }, 422],
    ["not JSON", 400],
  ])("rejects bad or unapproved fields before privileged work", async (body, status) => {
    expect((await POST(request(body))).status).toBe(status);
    expect(createAdmin).not.toHaveBeenCalled();
  });
  it("checks both declared size and actual streamed size", async () => {
    expect((await POST(request(observation, { "content-length": "1048577" }))).status).toBe(413);
    expect((await POST(request(" ".repeat(1048577))))).toHaveProperty("status", 413);
    expect(createAdmin).not.toHaveBeenCalled();
  });
  it("rejects non-JSON content types", async () => {
    expect((await POST(request(observation, { "content-type": "text/plain" }))).status).toBe(415);
  });
  it("sends only a key hash and validated observations; receipt contains no account data", async () => {
    const result = await POST(request());
    expect(result.status).toBe(201);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({ id, revision: 1, replayed: false });
    expect(rpc).toHaveBeenCalledWith("swim_import_receive", {
      p_hash: hashSwimImportKey(key), p_evidence: expect.objectContaining({
        activityId: "123", durationKind: "unspecified", nativeCourse: null,
      }),
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(key);
  });
  it("returns a stable replay receipt instead of claiming another import", async () => {
    response.data = { id, revision: 2, replayed: true };
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(response.data);
  });
  it.each([["42501", 401], ["22023", 422], ["23514", 422], ["PGRST202", 503]])("maps %s without exposing raw storage errors", async (code, status) => {
    response = { data: null, error: { code, message: "SYNTHETIC_PRIVATE_STORAGE_ERROR" } };
    const result = await POST(request());
    expect(result.status).toBe(status);
    expect(await result.text()).not.toContain("SYNTHETIC_PRIVATE");
  });
  it("does not accept an incomplete storage receipt", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    response.data = { userId: id, raw: "SYNTHETIC_PRIVATE_RESPONSE" };
    expect((await POST(request())).status).toBe(503);
    expect(JSON.stringify(logged.mock.calls)).not.toContain("SYNTHETIC_PRIVATE");
    logged.mockRestore();
  });
  it("returns a sanitized retryable failure when client initialization throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createAdmin).mockImplementationOnce(() => { throw new Error("SYNTHETIC_PRIVATE_CONFIG"); });
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("SYNTHETIC_PRIVATE");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("SYNTHETIC_PRIVATE");
    logged.mockRestore();
  });
  it("rejects invalid UTF-8 before privileged work", async () => {
    const input = request();
    const malformed = new Request(input.url, {
      method: "POST", headers: input.headers, body: new Uint8Array([0xc3, 0x28]),
    });
    expect((await POST(malformed)).status).toBe(400);
    expect(createAdmin).not.toHaveBeenCalled();
  });
  it("bounds body reading by a deadline", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(AbortSignal.abort());
    expect((await POST(request())).status).toBe(408);
    expect(createAdmin).not.toHaveBeenCalled();
    timeout.mockRestore();
  });
});
