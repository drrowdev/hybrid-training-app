import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");
type WorkerRequest = Pick<Request, "url" | "method" | "mode" | "headers">;

function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const entries = new Map<string, Map<string, Response>>();
  const fetch = vi.fn<(request: WorkerRequest) => Promise<Response>>();
  const key = (request: WorkerRequest | string) => typeof request === "string" ? request : request.url;
  const cache = (name: string) => {
    if (!entries.has(name)) entries.set(name, new Map());
    return {
      match: async (request: WorkerRequest | string) => entries.get(name)!.get(key(request))?.clone(),
      put: async (request: WorkerRequest | string, response: Response) => { entries.get(name)!.set(key(request), response.clone()); },
      addAll: vi.fn(),
    };
  };
  const claim = vi.fn();
  runInNewContext(source, {
    self: { location: { origin: "https://local.invalid" }, clients: { claim }, skipWaiting: vi.fn(),
      addEventListener: (event: string, callback: (event: unknown) => void) => handlers.set(event, callback) },
    caches: {
      open: async (name: string) => cache(name),
      keys: async () => [...entries.keys()],
      delete: async (name: string) => entries.delete(name),
      match: async (path: string) => {
        for (const rows of entries.values()) if (rows.has(path)) return rows.get(path)!.clone();
      },
    },
    fetch, URL, Response, setTimeout,
  });
  return {
    entries, fetch, cache, claim,
    navigate(path = "/app/plan?block=owned", headers: HeadersInit = {}, mode: RequestMode = "navigate") {
      const request: WorkerRequest = { url: new URL(path, "https://local.invalid").href,
        method: "GET", mode, headers: new Headers(headers) };
      let response: Promise<Response> | undefined;
      handlers.get("fetch")!({ request, respondWith: (value: Promise<Response>) => { response = value; } });
      return { request, response };
    },
    async activate() {
      let pending: Promise<void> | undefined;
      handlers.get("activate")!({ waitUntil: (value: Promise<void>) => { pending = value; } });
      await pending;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("service worker navigation and offline recovery", () => {
  it("keeps a reachable navigation pending beyond the former 3s deadline, then returns fresh content", async () => {
    vi.useFakeTimers();
    const sw = worker();
    await sw.cache("hta-v3-runtime").put("https://local.invalid/app/plan?block=owned", new Response("stale"));
    await sw.cache("hta-v3-shell").put("/offline.html", new Response("offline"));
    let finish!: (response: Response) => void;
    sw.fetch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const navigation = sw.navigate();
    let settled = false;
    void navigation.response!.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(4500);
    expect(settled).toBe(false);
    finish(new Response("fresh"));
    expect(await (await navigation.response!).text()).toBe("fresh");
    expect(await (await sw.cache("hta-v3-runtime").match(navigation.request))!.text()).toBe("fresh");
  });

  it.each([true, false])("retains genuine offline fallback (cached document=%s)", async (cached) => {
    const sw = worker();
    await sw.cache("hta-v3-shell").put("/offline.html", new Response("offline"));
    if (cached) await sw.cache("hta-v3-runtime").put("https://local.invalid/app/plan?block=owned", new Response("cached"));
    sw.fetch.mockRejectedValue(new TypeError("unreachable"));
    expect(await (await sw.navigate().response!).text()).toBe(cached ? "cached" : "offline");
  });

  it("preserves a server error rather than disguising it as offline or cached success", async () => {
    const sw = worker();
    await sw.cache("hta-v3-shell").put("/offline.html", new Response("offline"));
    sw.fetch.mockResolvedValue(new Response("server error", { status: 503 }));
    expect((await sw.navigate().response!).status).toBe(503);
  });

  it.each([
    ["/app/plan/history", { RSC: "1" }],
    ["/app/plan/history", { "Next-Router-State-Tree": "[]" }],
    ["/app/plan/history", { Accept: "text/x-component" }],
    ["/app/plan/history?_rsc=opaque", {}],
  ] satisfies [string, HeadersInit][])("never intercepts Flight requests: %s %j", async (path, headers) => {
    const sw = worker();
    await sw.cache("hta-v2-runtime").put(new URL(path, "https://local.invalid").href, new Response("old flight"));
    expect(sw.navigate(path, headers, "cors").response).toBeUndefined();
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  it("removes old document/Flight caches and claims existing clients on upgrade", async () => {
    const sw = worker();
    sw.cache("hta-v2-runtime"); sw.cache("hta-v2-shell");
    sw.cache("hta-v3-runtime"); sw.cache("hta-v3-shell");
    await sw.activate();
    expect([...sw.entries.keys()]).toEqual(["hta-v3-runtime", "hta-v3-shell"]);
    expect(sw.claim).toHaveBeenCalledOnce();
  });

  it.each(["/_next/static/chunks/app.js", "/api/movements/search?q=bench"])(
    "preserves offline asset/catalog cache and background refresh for %s", async (path) => {
      const sw = worker();
      const url = new URL(path, "https://local.invalid").href;
      await sw.cache("hta-v3-runtime").put(url, new Response("cached"));
      sw.fetch.mockResolvedValue(new Response("fresh"));
      expect(await (await sw.navigate(path, {}, "cors").response!).text()).toBe("cached");
      expect(await (await sw.cache("hta-v3-runtime").match(url))!.text()).toBe("fresh");
      sw.fetch.mockRejectedValue(new TypeError("offline"));
      expect(await (await sw.navigate(path, {}, "cors").response!).text()).toBe("fresh");
    },
  );
});
