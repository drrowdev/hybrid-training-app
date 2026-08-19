/**
 * Rest-timer settings toggle — static render.
 *
 * The project test env is Node with no DOM, so this covers what the markup
 * asserts rather than the click path (the flip is a two-line optimistic update
 * modelled on `SeasonPlanningToggle`). The value here is the default: a toggle
 * that reads as OFF when the preference is merely unknown would silently
 * disable the timer for everyone during the pre-migration deploy window.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/sessions/rest-timer-actions", () => ({
  setRestTimerEnabled: vi.fn(),
}));

import { RestTimerToggle } from "../RestTimerToggle";

describe("RestTimerToggle", () => {
  it("reads as on when the preference is on", () => {
    const html = renderToStaticMarkup(<RestTimerToggle initial={true} />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("rest-timer-switch");
  });

  it("reads as off when the lifter has opted out", () => {
    const html = renderToStaticMarkup(<RestTimerToggle initial={false} />);
    expect(html).toContain('aria-checked="false"');
  });

  it("says what turning it off does and does not change", () => {
    // "Off" must not read as "skip your rest" — the countdown stops, the rest
    // doesn't.
    const html = renderToStaticMarkup(<RestTimerToggle initial={true} />);
    expect(html).toContain("Rest timer");
    expect(html).toMatch(/rest untimed/i);
  });

  it("is labelled for screen readers", () => {
    const html = renderToStaticMarkup(<RestTimerToggle initial={true} />);
    expect(html).toContain('aria-label="Rest timer"');
  });

  it("shows no error until one happens", () => {
    const html = renderToStaticMarkup(<RestTimerToggle initial={true} />);
    expect(html).not.toContain('role="alert"');
  });
});
