/**
 * Unit tests for the cardio geolocation provider.
 *
 * Covers provider selection (native / browser / none), sample
 * normalization from both sources, and the browser + native + none watch
 * paths with stubbed globals and a mocked background-geolocation plugin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const addWatcher = vi.fn(
  async (
    _opts: unknown,
    cb: (loc: unknown, err: unknown) => void,
  ): Promise<string> => {
    cb(
      { latitude: 60.17, longitude: 24.94, accuracy: 6, speed: 3, time: 123 },
      undefined,
    );
    return "watch-1";
  },
);
const removeWatcher = vi.fn(async () => undefined);

// The native plugin is bound through Capacitor's `registerPlugin`, so we mock
// `@capacitor/core` (the only runtime import) rather than the entry-less
// native package.
const registerPlugin = vi.fn(() => ({ addWatcher, removeWatcher }));

vi.mock("@capacitor/core", () => ({ registerPlugin }));

import {
  detectGeoProvider,
  isCapacitorNative,
  normalizeBrowserPosition,
  normalizeNativeLocation,
  startGeoWatch,
  type GeoStatus,
} from "../geo-provider";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("detectGeoProvider", () => {
  it("returns 'native' inside a Capacitor shell", () => {
    vi.stubGlobal("window", {
      Capacitor: { isNativePlatform: () => true },
    });
    expect(isCapacitorNative()).toBe(true);
    expect(detectGeoProvider()).toBe("native");
  });

  it("returns 'browser' when only navigator.geolocation exists", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { geolocation: { watchPosition: vi.fn() } });
    expect(detectGeoProvider()).toBe("browser");
  });

  it("returns 'none' when nothing is available", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {});
    expect(detectGeoProvider()).toBe("none");
  });
});

describe("normalizers", () => {
  it("normalizeBrowserPosition maps coords and timestamp", () => {
    const sample = normalizeBrowserPosition({
      coords: {
        latitude: 60.17,
        longitude: 24.94,
        accuracy: 8,
        speed: 2.5,
      },
      timestamp: 999,
    } as GeolocationPosition);
    expect(sample).toEqual({
      lat: 60.17,
      lon: 24.94,
      accuracyM: 8,
      speedMps: 2.5,
      t: 999,
    });
  });

  it("normalizeBrowserPosition coerces missing accuracy/speed", () => {
    const sample = normalizeBrowserPosition({
      coords: { latitude: 1, longitude: 2, accuracy: NaN, speed: null },
      timestamp: 5,
    } as unknown as GeolocationPosition);
    expect(sample.accuracyM).toBe(9999);
    expect(sample.speedMps).toBeNull();
  });

  it("normalizeNativeLocation maps plugin fields and defaults time", () => {
    const s = normalizeNativeLocation({
      latitude: 60.17,
      longitude: 24.94,
      accuracy: 6,
      speed: 3,
      time: 123,
    });
    expect(s).toEqual({
      lat: 60.17,
      lon: 24.94,
      accuracyM: 6,
      speedMps: 3,
      t: 123,
    });
    const noTime = normalizeNativeLocation({
      latitude: 1,
      longitude: 2,
      accuracy: null,
      speed: null,
      time: null,
    });
    expect(noTime.accuracyM).toBe(9999);
    expect(noTime.speedMps).toBeNull();
    expect(noTime.t).toBeGreaterThan(0);
  });
});

describe("startGeoWatch — browser", () => {
  it("acquires, emits a normalized sample, and stops the watch", async () => {
    const clearWatch = vi.fn();
    const watchPosition = vi.fn(
      (success: (p: GeolocationPosition) => void) => {
        success({
          coords: {
            latitude: 60.17,
            longitude: 24.94,
            accuracy: 7,
            speed: 1.2,
          },
          timestamp: 42,
        } as GeolocationPosition);
        return 77;
      },
    );
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });

    const statuses: GeoStatus[] = [];
    const samples: unknown[] = [];
    const handle = await startGeoWatch({
      onStatus: (s) => statuses.push(s),
      onSample: (s) => samples.push(s),
    });

    expect(statuses).toEqual(["acquiring", "ok"]);
    expect(samples).toEqual([
      { lat: 60.17, lon: 24.94, accuracyM: 7, speedMps: 1.2, t: 42 },
    ]);

    handle.stop();
    expect(clearWatch).toHaveBeenCalledWith(77);
  });

  it("reports 'denied' on a permission error", async () => {
    const watchPosition = vi.fn(
      (
        _success: unknown,
        error: (e: { code: number; PERMISSION_DENIED: number }) => void,
      ) => {
        error({ code: 1, PERMISSION_DENIED: 1 });
        return 1;
      },
    );
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {
      geolocation: { watchPosition, clearWatch: vi.fn() },
    });

    const statuses: GeoStatus[] = [];
    await startGeoWatch({
      onStatus: (s) => statuses.push(s),
      onSample: () => undefined,
    });
    expect(statuses).toContain("denied");
  });
});

describe("startGeoWatch — none", () => {
  it("reports unavailable and returns a no-op handle", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {});
    const statuses: GeoStatus[] = [];
    const handle = await startGeoWatch({
      onStatus: (s) => statuses.push(s),
      onSample: () => undefined,
    });
    expect(statuses).toEqual(["unavailable"]);
    expect(() => handle.stop()).not.toThrow();
  });
});

describe("startGeoWatch — native", () => {
  it("uses the background-geolocation plugin and normalizes its location", async () => {
    vi.stubGlobal("window", {
      Capacitor: { isNativePlatform: () => true },
    });

    const statuses: GeoStatus[] = [];
    const samples: Array<{ lat: number; speedMps: number | null }> = [];
    const handle = await startGeoWatch({
      onStatus: (s) => statuses.push(s),
      onSample: (s) => samples.push(s),
    });

    expect(registerPlugin).toHaveBeenCalledWith("BackgroundGeolocation");
    expect(addWatcher).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["acquiring", "ok"]);
    expect(samples[0]).toMatchObject({ lat: 60.17, speedMps: 3 });

    handle.stop();
    expect(removeWatcher).toHaveBeenCalledWith({ id: "watch-1" });
  });
});
