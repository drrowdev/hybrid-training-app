import { describe, it, expect, vi, afterEach } from "vitest";
import { createWakeLockController, isWakeLockSupported } from "../wake-lock";

const origNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: origNavigator,
    configurable: true,
  });
});

/** Build a fake WakeLockSentinel whose release() flips `released`. */
function makeSentinel() {
  const listeners: Array<() => void> = [];
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true;
      for (const l of listeners) l();
    }),
    addEventListener: (_type: "release", listener: () => void) => {
      listeners.push(listener);
    },
    // test helper: simulate the OS auto-releasing the lock
    _osRelease: () => {
      sentinel.released = true;
      for (const l of listeners) l();
    },
  };
  return sentinel;
}

function installWakeLock(request: ReturnType<typeof vi.fn>) {
  Object.defineProperty(globalThis, "navigator", {
    value: { wakeLock: { request } },
    configurable: true,
  });
}

describe("isWakeLockSupported", () => {
  it("is false when navigator has no wakeLock", () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    expect(isWakeLockSupported()).toBe(false);
  });

  it("is true when navigator.wakeLock.request exists", () => {
    installWakeLock(vi.fn());
    expect(isWakeLockSupported()).toBe(true);
  });
});

describe("createWakeLockController", () => {
  it("acquires a screen lock when supported", async () => {
    const sentinel = makeSentinel();
    const request = vi.fn().mockResolvedValue(sentinel);
    installWakeLock(request);

    const ctrl = createWakeLockController();
    await ctrl.acquire();

    expect(request).toHaveBeenCalledWith("screen");
    expect(ctrl.isHeld()).toBe(true);
  });

  it("does not double-request when a lock is already held", async () => {
    const sentinel = makeSentinel();
    const request = vi.fn().mockResolvedValue(sentinel);
    installWakeLock(request);

    const ctrl = createWakeLockController();
    await ctrl.acquire();
    await ctrl.acquire();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases the held lock and reports not-held", async () => {
    const sentinel = makeSentinel();
    const request = vi.fn().mockResolvedValue(sentinel);
    installWakeLock(request);

    const ctrl = createWakeLockController();
    await ctrl.acquire();
    await ctrl.release();

    expect(sentinel.release).toHaveBeenCalledTimes(1);
    expect(ctrl.isHeld()).toBe(false);
  });

  it("re-acquires after the OS auto-releases the lock (page hidden)", async () => {
    const first = makeSentinel();
    const second = makeSentinel();
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    installWakeLock(request);

    const ctrl = createWakeLockController();
    await ctrl.acquire();
    expect(ctrl.isHeld()).toBe(true);

    // Simulate the OS dropping the lock when the page was hidden.
    first._osRelease();
    expect(ctrl.isHeld()).toBe(false);

    await ctrl.acquire();
    expect(request).toHaveBeenCalledTimes(2);
    expect(ctrl.isHeld()).toBe(true);
  });

  it("no-ops silently when wakeLock is unsupported", async () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    const ctrl = createWakeLockController();
    await expect(ctrl.acquire()).resolves.toBeUndefined();
    expect(ctrl.isHeld()).toBe(false);
    await expect(ctrl.release()).resolves.toBeUndefined();
  });

  it("swallows a rejected request (e.g. permission denied)", async () => {
    const request = vi.fn().mockRejectedValue(new Error("denied"));
    installWakeLock(request);

    const ctrl = createWakeLockController();
    await expect(ctrl.acquire()).resolves.toBeUndefined();
    expect(ctrl.isHeld()).toBe(false);
  });

  it("release() is safe to call when nothing is held", async () => {
    installWakeLock(vi.fn());
    const ctrl = createWakeLockController();
    await expect(ctrl.release()).resolves.toBeUndefined();
  });
});
