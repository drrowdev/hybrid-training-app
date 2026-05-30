import { describe, it, expect, vi } from "vitest";
import { fetchActivityStreams } from "../client";

function jsonResponse(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe("fetchActivityStreams", () => {
  it("parses heartrate + time data from a key_by_type response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(true, {
        heartrate: { data: [120, 130, 140] },
        time: { data: [0, 1, 2] },
      }),
    ) as unknown as typeof fetch;

    const res = await fetchActivityStreams("tok", 999, { fetchImpl });
    expect(res).toEqual({ heartrate: [120, 130, 140], time: [0, 1, 2] });

    // Requests only heartrate+time, keyed by type, with the bearer token.
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = call[0] as URL;
    expect(url.pathname).toContain("/activities/999/streams");
    expect(url.searchParams.get("keys")).toBe("heartrate,time");
    expect(url.searchParams.get("key_by_type")).toBe("true");
  });

  it("returns null on a non-ok response (e.g. 404 no streams, 429 rate-limited)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(false, {})) as unknown as typeof fetch;
    expect(await fetchActivityStreams("tok", 1, { fetchImpl })).toBeNull();
  });

  it("returns null when the heartrate stream is absent", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(true, { time: { data: [0, 1, 2] } }),
    ) as unknown as typeof fetch;
    expect(await fetchActivityStreams("tok", 1, { fetchImpl })).toBeNull();
  });

  it("never throws — a network error resolves to null", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await fetchActivityStreams("tok", 1, { fetchImpl })).toBeNull();
  });
});
