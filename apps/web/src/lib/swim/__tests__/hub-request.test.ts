import { describe, expect, it, vi } from "vitest";
import { createRequestGate } from "../hub-request";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("DC-SW7 per-Hub request ownership", () => {
  it.each(["resolve", "reject"] as const)("excludes same-tick and later duplicates until %s, then permits reuse", async (settlement) => {
    const gate = createRequestGate();
    const owned = deferred();
    const busy = vi.fn();
    const duplicate = vi.fn(async () => {});
    const request = vi.fn(() => owned.promise);
    const running = gate(request, busy);
    const outcome = running.catch((error) => error);
    expect(request).toHaveBeenCalledOnce();
    expect(busy.mock.calls).toEqual([[true]]);
    await gate(duplicate, busy);
    await Promise.resolve();
    await gate(duplicate, busy);
    expect(duplicate).not.toHaveBeenCalled();
    expect(busy.mock.calls).toEqual([[true]]);
    const failure = new Error("Request rejected");
    if (settlement === "resolve") owned.resolve();
    else owned.reject(failure);
    expect(await outcome).toBe(settlement === "resolve" ? undefined : failure);
    expect(busy.mock.calls).toEqual([[true], [false]]);
    await gate(duplicate, busy);
    expect(duplicate).toHaveBeenCalledOnce();
    expect(busy.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it("releases after a synchronous throw without swallowing it", async () => {
    const gate = createRequestGate();
    const busy = vi.fn();
    const failure = new Error("Request threw");
    await expect(gate(() => { throw failure; }, busy)).rejects.toBe(failure);
    expect(busy.mock.calls).toEqual([[true], [false]]);
    const next = vi.fn(async () => {});
    await gate(next, busy);
    expect(next).toHaveBeenCalledOnce();
  });

  it("holds through the entire callback and keeps mounted instances independent", async () => {
    const first = createRequestGate();
    const second = createRequestGate();
    const action = deferred();
    const callback = deferred();
    const busy = vi.fn();
    const running = first(async () => { await action.promise; await callback.promise; }, busy);
    action.resolve();
    await action.promise;
    const other = vi.fn(async () => {});
    await second(other, vi.fn());
    await first(other, busy);
    expect(other).toHaveBeenCalledOnce();
    expect(busy.mock.calls).toEqual([[true]]);
    callback.resolve();
    await running;
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });
});
