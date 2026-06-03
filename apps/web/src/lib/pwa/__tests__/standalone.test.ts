/**
 * Unit tests for `isStandalonePwa`. We don't need a real DOM — the helper
 * only reads `window.matchMedia` and `navigator.standalone`, so we stub
 * globalThis directly and run under the default node vitest environment.
 */
import { afterEach, describe, expect, it } from "vitest";
import { isStandalonePwa } from "../standalone";

type StubWin = {
  matchMedia?: (q: string) => { matches: boolean };
  navigator: { standalone?: boolean };
  Capacitor?: { isNativePlatform?: () => boolean };
};

const g = globalThis as unknown as { window?: StubWin; navigator?: StubWin["navigator"] };

function setWindow(win: StubWin | undefined) {
  if (win === undefined) {
    delete g.window;
    delete g.navigator;
  } else {
    g.window = win;
    g.navigator = win.navigator;
  }
}

afterEach(() => {
  setWindow(undefined);
});

describe("isStandalonePwa", () => {
  it("returns false when window is undefined (SSR)", () => {
    setWindow(undefined);
    expect(isStandalonePwa()).toBe(false);
  });

  it("returns false in a regular tabbed browser", () => {
    setWindow({
      matchMedia: () => ({ matches: false }),
      navigator: {},
    });
    expect(isStandalonePwa()).toBe(false);
  });

  it("returns true when matchMedia reports display-mode: standalone (Chromium PWA)", () => {
    setWindow({
      matchMedia: (q: string) => ({
        matches: q === "(display-mode: standalone)",
      }),
      navigator: {},
    });
    expect(isStandalonePwa()).toBe(true);
  });

  it("returns true when navigator.standalone is true (iOS Add-to-Home-Screen)", () => {
    setWindow({
      matchMedia: () => ({ matches: false }),
      navigator: { standalone: true },
    });
    expect(isStandalonePwa()).toBe(true);
  });

  it("returns true inside the Capacitor native shell", () => {
    setWindow({
      matchMedia: () => ({ matches: false }),
      navigator: {},
      Capacitor: { isNativePlatform: () => true },
    });
    expect(isStandalonePwa()).toBe(true);
  });

  it("returns false when matchMedia is missing and navigator.standalone is unset", () => {
    setWindow({ navigator: {} });
    expect(isStandalonePwa()).toBe(false);
  });
});
