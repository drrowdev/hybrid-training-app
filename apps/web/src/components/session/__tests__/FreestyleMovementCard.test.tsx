/**
 * FreestyleMovementCard render + chip-collapse tests.
 *
 * The web test env is Node (no JSDOM), so dynamic interactions go
 * through the exported `freestyleChipsOpen` pure helper. Initial
 * render markup is asserted with `renderToStaticMarkup`. The live
 * click-to-remove round-trip is covered in the Playwright e2e spec.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FreestyleMovementCard,
  freestyleChipsOpen,
} from "../FreestyleMovementCard";

const movement = {
  id: "mov-1",
  slug: "front-squat",
  display_name: "Front Squat",
  primary_region: "lower",
};

const noopAction = vi.fn(async () => ({ ok: true as const }));

const baseProps = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  movement,
  loggedSets: [],
  tmKg: undefined,
  oneRmKg: undefined,
  priorBest: undefined,
  addStrengthSet: noopAction as unknown as Parameters<
    typeof FreestyleMovementCard
  >[0]["addStrengthSet"],
  hapticsEnabled: false,
  timerSoundEnabled: false,
  restTimerEnabled: true,
};

describe("freestyleChipsOpen", () => {
  it("is closed by default when nothing is open and set kind is main", () => {
    expect(freestyleChipsOpen("main", false)).toBe(false);
  });

  it("opens when the user manually expands the disclosure", () => {
    expect(freestyleChipsOpen("main", true)).toBe(true);
  });

  it("opens when the user picks a non-Main kind even without an explicit open", () => {
    expect(freestyleChipsOpen("warmup", false)).toBe(true);
    expect(freestyleChipsOpen("back_off", false)).toBe(true);
    expect(freestyleChipsOpen("accessory", false)).toBe(true);
    expect(freestyleChipsOpen("tendon", false)).toBe(true);
  });
});

describe("FreestyleMovementCard render", () => {
  it("hides the kebab once at least one set is logged", () => {
    const html = renderToStaticMarkup(
      <FreestyleMovementCard
        {...baseProps}
        loggedSetCount={2}
        removeSessionMovement={
          noopAction as unknown as Parameters<
            typeof FreestyleMovementCard
          >[0]["removeSessionMovement"]
        }
        onRemove={() => {}}
      />,
    );
    expect(html).not.toContain('data-testid="freestyle-kebab-mov-1"');
    expect(html).toContain('data-testid="freestyle-kebab-disabled-mov-1"');
  });

  it("shows the kebab when no set has been logged AND a remove action is provided", () => {
    const html = renderToStaticMarkup(
      <FreestyleMovementCard
        {...baseProps}
        loggedSetCount={0}
        removeSessionMovement={
          noopAction as unknown as Parameters<
            typeof FreestyleMovementCard
          >[0]["removeSessionMovement"]
        }
        onRemove={() => {}}
      />,
    );
    expect(html).toContain('data-testid="freestyle-kebab-mov-1"');
  });

  it("hides the kebab entirely when no remove action is wired (legacy callers)", () => {
    const html = renderToStaticMarkup(
      <FreestyleMovementCard {...baseProps} loggedSetCount={0} />,
    );
    expect(html).not.toContain('data-testid="freestyle-kebab-mov-1"');
    expect(html).toContain('data-testid="freestyle-kebab-disabled-mov-1"');
  });

  it("renders the chip rail collapsed by default with 'Set type: Main' disclosure", () => {
    const html = renderToStaticMarkup(
      <FreestyleMovementCard {...baseProps} loggedSetCount={0} />,
    );
    expect(html).toContain('data-testid="freestyle-chips-toggle-mov-1"');
    expect(html).toContain("Set type: Main");
    // Full rail is not rendered yet.
    expect(html).not.toContain('data-testid="freestyle-chips-rail-mov-1"');
  });
});
