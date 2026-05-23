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
