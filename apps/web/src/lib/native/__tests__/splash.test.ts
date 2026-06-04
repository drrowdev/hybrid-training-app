import { describe, it, expect, vi, afterEach } from "vitest";
import { hideNativeSplash } from "../splash";

describe("hideNativeSplash — Capacitor splash bridge", () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  function installBridge(opts: {
    native: boolean;
    hide?: (o?: { fadeOutDuration?: number }) => unknown;
    withPlugin?: boolean;
  }) {
    const plugins =
      opts.withPlugin === false
        ? {}
        : { SplashScreen: opts.hide ? { hide: opts.hide } : {} };
    (globalThis as unknown as { window: unknown }).window = {
      Capacitor: {
        isNativePlatform: () => opts.native,
        Plugins: plugins,
      },
    };
  }

  it("returns false on plain web (no Capacitor bridge)", () => {
    (globalThis as unknown as { window: unknown }).window = {};
    expect(hideNativeSplash()).toBe(false);
  });

  it("returns false when not a native platform", () => {
    const hide = vi.fn();
    installBridge({ native: false, hide });
    expect(hideNativeSplash()).toBe(false);
    expect(hide).not.toHaveBeenCalled();
  });

  it("returns false when the SplashScreen plugin is absent", () => {
    installBridge({ native: true, withPlugin: false });
    expect(hideNativeSplash()).toBe(false);
  });

  it("dispatches a native hide with the default 250ms fade", () => {
    const hide = vi.fn();
    installBridge({ native: true, hide });
    expect(hideNativeSplash()).toBe(true);
    expect(hide).toHaveBeenCalledWith({ fadeOutDuration: 250 });
  });

  it("passes a custom fade duration through", () => {
    const hide = vi.fn();
    installBridge({ native: true, hide });
    hideNativeSplash(0);
    expect(hide).toHaveBeenCalledWith({ fadeOutDuration: 0 });
  });

  it("does not throw if the native hide call rejects", () => {
    const hide = vi.fn().mockRejectedValue(new Error("bridge gone"));
    installBridge({ native: true, hide });
    expect(() => hideNativeSplash()).not.toThrow();
    expect(hideNativeSplash()).toBe(true);
  });

  it("does not throw if the native hide call throws synchronously", () => {
    const hide = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    installBridge({ native: true, hide });
    expect(hideNativeSplash()).toBe(false);
  });
});
