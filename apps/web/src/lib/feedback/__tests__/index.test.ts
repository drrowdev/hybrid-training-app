import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hapticTick, timerBeep } from "../index";

describe("hapticTick — Phase 3 C1", () => {
  const orig = globalThis.navigator;
  afterEach(() => {
    // Restore the original navigator stub.
    Object.defineProperty(globalThis, "navigator", { value: orig, configurable: true });
  });

  it("no-ops silently when the user has opted out", () => {
    const spy = vi.fn();
    Object.defineProperty(globalThis, "navigator", {
      value: { vibrate: spy },
      configurable: true,
    });
    hapticTick(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("invokes navigator.vibrate(ms) when enabled and supported", () => {
    const spy = vi.fn().mockReturnValue(true);
    Object.defineProperty(globalThis, "navigator", {
      value: { vibrate: spy },
      configurable: true,
    });
    hapticTick(true, 12);
    expect(spy).toHaveBeenCalledWith(12);
  });

  it("no-ops when navigator.vibrate is unsupported", () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    expect(() => hapticTick(true)).not.toThrow();
  });
});

describe("hapticTick — native Capacitor bridge", () => {
  const origNav = globalThis.navigator;
  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", { value: origNav, configurable: true });
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  function installBridge(opts: {
    native: boolean;
    impact?: (o: { style: string }) => unknown;
  }) {
    (globalThis as unknown as { window: unknown }).window = {
      Capacitor: {
        isNativePlatform: () => opts.native,
        Plugins: { Haptics: opts.impact ? { impact: opts.impact } : {} },
      },
    };
  }

  it("dispatches a native impact and skips navigator.vibrate inside the shell", () => {
    const impact = vi.fn();
    const vibrate = vi.fn();
    Object.defineProperty(globalThis, "navigator", {
      value: { vibrate },
      configurable: true,
    });
    installBridge({ native: true, impact });
    hapticTick(true, 120);
    expect(impact).toHaveBeenCalledWith({ style: "HEAVY" });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("maps a short tick to a LIGHT impact", () => {
    const impact = vi.fn();
    installBridge({ native: true, impact });
    hapticTick(true, 10);
    expect(impact).toHaveBeenCalledWith({ style: "LIGHT" });
  });

  it("falls back to navigator.vibrate when not a native platform", () => {
    const impact = vi.fn();
    const vibrate = vi.fn();
    Object.defineProperty(globalThis, "navigator", {
      value: { vibrate },
      configurable: true,
    });
    installBridge({ native: false, impact });
    hapticTick(true, 30);
    expect(impact).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledWith(30);
  });

  it("does not throw if the native impact call rejects", () => {
    const impact = vi.fn().mockRejectedValue(new Error("bridge gone"));
    installBridge({ native: true, impact });
    expect(() => hapticTick(true, 120)).not.toThrow();
  });
});

describe("timerBeep — Phase 3 C2", () => {
  beforeEach(() => {
    // Strip any Audio constructor between tests.
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    delete (globalThis as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("returns false when the user has opted out", () => {
    expect(timerBeep(false)).toBe(false);
  });

  it("returns false when no AudioContext is available", () => {
    (globalThis as unknown as { window: object }).window = {};
    expect(timerBeep(true)).toBe(false);
  });

  it("schedules a tone when AudioContext is available", () => {
    const osc = {
      type: "",
      frequency: { value: 0 },
      connect: vi.fn().mockReturnThis(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const gain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn().mockReturnThis(),
    };
    const ctx = {
      state: "running",
      currentTime: 0,
      createOscillator: vi.fn().mockReturnValue(osc),
      createGain: vi.fn().mockReturnValue(gain),
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const Ctor = vi.fn().mockImplementation(() => ctx);
    (globalThis as unknown as { window: object }).window = { AudioContext: Ctor };
    expect(timerBeep(true)).toBe(true);
    expect(Ctor).toHaveBeenCalled();
    expect(osc.start).toHaveBeenCalled();
    expect(osc.stop).toHaveBeenCalled();
  });
});
