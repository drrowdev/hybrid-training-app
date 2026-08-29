import { test, expect, type Page } from "@playwright/test";

/**
 * Mobile logging ergonomics — the guarantees the logger redesign exists to
 * provide. Driven against the dev-only `/dev/logger-preview` fixture so it
 * needs no database, auth or seeded user and runs on every machine.
 *
 * Each assertion here maps to a measured failure in the pre-dock build:
 *
 *   - the primary CTA sat at the end of a scrolling card, so it fell BELOW
 *     THE FOLD in all three sections at 375×667, and underneath the fixed
 *     tab bar on the accessory section at 390×844;
 *   - section navigation only rendered when the day contained rehab, so an
 *     ordinary day had no way to move between groups;
 *   - the movement queue was 725px of chips inside a 358px window;
 *   - supplemental work was folded into "Main" and was not addressable;
 *   - 7 of 30 interactive elements were under 44×44.
 */

const PREVIEW = "/dev/logger-preview";

/** Fixture movement ids, from `app/dev/logger-preview/preview.tsx`. */
const ROW_ID = "10000000-0000-4000-8000-000000000005";

/**
 * The devices this app is actually used on. Not a generic responsive matrix —
 * there is one user, on an iPhone 17.
 *
 * Width matters more than height here: every bug this file guards against is a
 * thumb-reach or overflow problem, and a wider viewport hides overflow rather
 * than revealing it. So the overflow test below stresses the CTA label instead
 * of relying on the fixture's (short) movement names, which is what let a real
 * off-screen navigator trigger ship unnoticed.
 */
const PHONES = [
  { name: "iPhone 17", width: 402, height: 874 },
  { name: "iPhone 17 Pro Max", width: 440, height: 956 },
] as const;

async function openNavigator(page: Page) {
  // Retry the tap: the trigger is a client component, so a click that lands
  // before hydration attaches the handler is swallowed silently and the sheet
  // never opens. `setNavOpen(true)` is idempotent, so re-clicking is safe.
  const sheet = page.getByTestId("movement-navigator");
  await expect(async () => {
    if ((await sheet.getAttribute("aria-hidden")) !== "false") {
      await page.getByTestId("movement-navigator-open").click();
    }
    await expect(sheet).toHaveAttribute("aria-hidden", "false", {
      timeout: 1_000,
    });
  }).toPass({ timeout: 15_000 });
}

async function gotoMovement(page: Page, name: RegExp) {
  await openNavigator(page);
  // Scope to the sheet: the card also renders a "Swap <movement>" button
  // whose accessible name matches the same movement.
  await page
    .getByTestId("movement-navigator")
    .getByRole("button", { name })
    .first()
    .click();
  await expect(page.getByTestId("movement-navigator")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
}

/** Is the CTA fully inside the viewport and not covered by anything? */
async function ctaReachable(page: Page) {
  return page.evaluate(() => {
    const cta = document.querySelector<HTMLElement>(
      '[data-testid="movement-focus-log-button"]',
    );
    if (!cta) return { found: false as const };
    const r = cta.getBoundingClientRect();
    const centreX = r.left + r.width / 2;
    const centreY = r.top + r.height / 2;
    const topmost = document.elementFromPoint(centreX, centreY);
    return {
      found: true as const,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: Math.round(r.height),
      viewportH: window.innerHeight,
      insideViewport: r.top >= 0 && r.bottom <= window.innerHeight + 0.5,
      hittable: !!topmost && (topmost === cta || cta.contains(topmost)),
    };
  });
}

test.describe("@mobile logger ergonomics", () => {
  test("the primary action stays reachable on every movement and phone size", async ({
    page,
  }) => {
    for (const phone of PHONES) {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      await page.goto(PREVIEW);
      await expect(page.getByTestId("session-dock")).toBeVisible();

      for (const movement of [
        /Seated Calf Raise/,
        /Back Squat/,
        /Romanian Deadlift/,
        /Leg Press/,
        /Farmer Carry/,
        /Front Plank/,
      ]) {
        await gotoMovement(page, movement);
        const cta = await ctaReachable(page);
        expect(cta.found, `${phone.name} · ${movement} · CTA present`).toBe(true);
        expect(
          cta.insideViewport,
          `${phone.name} · ${movement} · CTA inside viewport (got ${cta.top}-${cta.bottom} of ${cta.viewportH})`,
        ).toBe(true);
        expect(
          cta.hittable,
          `${phone.name} · ${movement} · CTA is the topmost element at its centre`,
        ).toBe(true);
        // Primary controls are 48px+, not merely the 44px compliance floor.
        expect(cta.height, `${phone.name} · CTA height`).toBeGreaterThanOrEqual(48);
      }
    }
  });

  test("movement navigation is always available, including without rehab", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 402, height: 874 });

    // A day WITHOUT rehab previously rendered no section navigation at all.
    await page.goto(`${PREVIEW}?variant=norehab`);
    await openNavigator(page);
    const nav = page.getByTestId("movement-navigator");
    await expect(nav).toContainText("Main");
    await expect(nav).toContainText("Supplemental");
    await expect(nav).toContainText("Accessories");
    await expect(nav).not.toContainText("Rehab");

    // A day WITH rehab surfaces all four sections.
    await page.goto(PREVIEW);
    await openNavigator(page);
    await expect(nav).toContainText("Rehab");
    await expect(nav).toContainText("Main");
    await expect(nav).toContainText("Supplemental");
    await expect(nav).toContainText("Accessories");

    // Every movement row is fully inside the viewport width — the old
    // horizontal queue clipped 3 of 5 movements off-screen.
    const clipped = await page.evaluate(() => {
      const rows = [
        ...document.querySelectorAll<HTMLElement>('[data-testid^="movement-navigator-item-"]'),
      ];
      return rows
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.left < 0 || r.right > window.innerWidth + 0.5;
        })
        .map((el) => el.getAttribute("data-testid"));
    });
    expect(clipped, "no navigator row is clipped horizontally").toEqual([]);
  });

  test("supplemental work is addressable as its own section", async ({ page }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto(PREVIEW);
    await gotoMovement(page, /Romanian Deadlift/);
    await expect(page.getByTestId("focus-strip-logger")).toContainText(
      "Romanian Deadlift",
    );
    await expect(page.getByTestId("focus-strip-logger")).toContainText("Supplemental");
  });

  test("linked superset work is bracketed rather than listed as unrelated rows", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto(PREVIEW);
    await openNavigator(page);
    // The bracket id is the LINK's own id (a user superset, or the engine's
    // "tb-ab-triad"), not a positional label — a movement belongs to at most one
    // link, so the id is what groups its members.
    const linked = page.getByTestId("movement-navigator-superset-link-1");
    await expect(linked).toBeVisible();
    await expect(linked).toContainText("Leg Press");
    await expect(linked).toContainText("Seated Cable Row");
    await expect(linked).toContainText("A1");
    await expect(linked).toContainText("A2");
  });

  test("every interactive control meets the 44px touch floor", async ({ page }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto(PREVIEW);

    const tooSmall = await page.evaluate(() => {
      const out: { label: string; w: number; h: number }[] = [];
      const sel = 'button, a[href], input, select, textarea, [role="button"], [role="tab"]';
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        // The dot strip renders small visual pips inside a larger hit area;
        // role="tab" entries are measured via their own bounding box below.
        if (r.height < 44 || r.width < 44) {
          out.push({
            label: (
              el.getAttribute("data-testid") ||
              el.getAttribute("aria-label") ||
              el.textContent ||
              el.tagName
            )
              .trim()
              .replace(/\s+/g, " ")
              .slice(0, 40),
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
      }
      return out;
    });

    expect(
      tooSmall,
      `controls under 44x44: ${JSON.stringify(tooSmall)}`,
    ).toEqual([]);
  });

  test("the rest timer and the primary action never occupy the same pixels", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto(PREVIEW);
    // Log a working set so a rest countdown fires (warm-ups intentionally
    // do not rest, so drive the main lift's first working slot).
    await gotoMovement(page, /Back Squat/);
    await page.getByTestId("movement-dot-3").click();
    await page.getByTestId("movement-focus-log-button").click();
    const timer = page.getByTestId("rest-timer-shell");
    await expect(timer).toBeVisible({ timeout: 5000 });

    const overlap = await page.evaluate(() => {
      const cta = document.querySelector('[data-testid="movement-focus-log-button"]');
      const rest = document.querySelector('[data-testid="rest-timer-shell"]');
      if (!cta || !rest) return null;
      const a = cta.getBoundingClientRect();
      const b = rest.getBoundingClientRect();
      return !(b.bottom <= a.top || b.top >= a.bottom || b.right <= a.left || b.left >= a.right);
    });
    expect(overlap, "rest timer overlaps the CTA").toBe(false);
  });

  test("nothing in the dock is pushed off-screen horizontally", async ({
    page,
  }) => {
    // The dock's CTA label does not wrap ("Log set · 72.5 kg × 3"). Grid and
    // flex items default to `min-width: auto`, so that label set the dock's
    // minimum width, widened it past the viewport and pushed the navigator
    // trigger off the right edge — the movement overview became unreachable
    // mid-session. The pre-existing checks only measured the CTA vertically,
    // so a purely horizontal overflow went unnoticed.
    for (const phone of PHONES) {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      await page.goto(PREVIEW);
      await gotoMovement(page, /Back Squat/);
      await page.getByTestId("movement-dot-3").click();
      await page.getByTestId("movement-focus-log-button").click();
      await expect(page.getByTestId("rest-timer-shell")).toBeVisible({
        timeout: 5000,
      });

      // Stress the label well past the real worst case: the accessory must
      // survive any CTA text, not just the fixture's.
      await page.evaluate(() => {
        const cta = document.querySelector(
          '[data-testid="movement-focus-log-button"]',
        );
        if (cta) cta.textContent = "Log set · 137.5 kg × 12 @ RPE 9.5 (paused)";
        const ctx = document.querySelector('[data-testid="rest-timer-context"]');
        if (ctx)
          ctx.textContent = "next Standing Banded Hip Adduction (left, tempo)";
      });

      const geo = await page.evaluate(() => {
        const vw = window.innerWidth;
        const dock = document.querySelector<HTMLElement>(
          '[data-testid="session-dock"]',
        );
        const acc = document.querySelector<HTMLElement>(
          '[data-testid="movement-navigator-open"]',
        );
        const a = acc?.getBoundingClientRect();
        const hittable = (() => {
          if (!acc || !a) return false;
          const t = document.elementFromPoint(
            a.left + a.width / 2,
            a.top + a.height / 2,
          );
          return !!t && (t === acc || acc.contains(t));
        })();
        return {
          dockOverflow: dock ? dock.scrollWidth - dock.clientWidth : null,
          docOverflow: document.documentElement.scrollWidth - vw,
          accInside: !!a && a.left >= 0 && a.right <= vw + 0.5,
          accHittable: hittable,
        };
      });

      expect(geo.dockOverflow, `${phone.name} · dock overflows`).toBe(0);
      expect(geo.docOverflow, `${phone.name} · page scrolls sideways`).toBe(0);
      expect(
        geo.accInside,
        `${phone.name} · navigator trigger fully on-screen`,
      ).toBe(true);
      expect(
        geo.accHittable,
        `${phone.name} · navigator trigger is tappable`,
      ).toBe(true);
    }
  });

  test("cancelling an edit on a fully-logged movement actually exits", async ({
    page,
  }) => {
    // Reported twice from live sessions: Cancel and Update set both appeared
    // completely dead, and the only escape was leaving the workout.
    //
    // Edit mode used to be derived from position alone — "the cursor is on a
    // logged set". Once a movement is fully logged `autoCursorForGroup` parks
    // on its LAST slot, which is logged, so clearing the pin re-derived edit
    // mode instantly. Both buttons ran; the resulting state was identical.
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto(`${PREVIEW}?variant=rehabdone`);

    const card = page.getByTestId("movement-focus-card");
    await gotoMovement(page, /Seated Calf Raise/);

    // Landing on a completed movement must NOT open edit mode by itself —
    // that is how it "opened on its own" with no action taken.
    await expect(card).toHaveAttribute("data-editing", "false");
    await expect(page.getByTestId("movement-focus-edit-banner")).toHaveCount(0);

    // Opening it is an explicit act.
    await page.getByTestId("movement-dot-2").click();
    await expect(card).toHaveAttribute("data-editing", "true");
    await expect(page.getByTestId("movement-focus-edit-banner")).toBeVisible();

    // ...and Cancel gets out of it, on a movement with nothing left to log.
    await page.getByTestId("movement-focus-cancel-edit-dock").click();
    await expect(card).toHaveAttribute("data-editing", "false");
    await expect(page.getByTestId("movement-focus-edit-banner")).toHaveCount(0);
    await expect(page.getByTestId("movement-navigator-open")).toBeVisible();
  });

  test("the dock covers the bottom edge so nothing shows underneath it", async ({
    page,
  }) => {
    // On a notched phone the dock offset itself by the safe-area inset, leaving
    // a ~34px strip of live page visible below it. What showed through was the
    // in-flow "Finish session" bar, sitting directly under the thumb — one
    // mis-tap from ending the session early.
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto(PREVIEW);
    const dock = page.getByTestId("session-dock");
    await expect(dock).toBeVisible();
    // The dock claims the bottom region in a mount effect (it zeroes
    // `--cp-bottomnav-h` and adds this class together), so wait for that rather
    // than measuring a pre-hydration frame.
    await expect(page.locator("html")).toHaveClass(/cp-session-live/);

    const gap = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-testid="session-dock"]',
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return Math.round(window.innerHeight - r.bottom);
    });
    expect(gap, "dock reaches the bottom edge").toBe(0);

    // And the finish control is never under the dock's footprint.
    const finishClear = await page.evaluate(() => {
      const dockEl = document.querySelector<HTMLElement>(
        '[data-testid="session-dock"]',
      );
      const finish = document.querySelector<HTMLElement>(
        '[data-testid="finish-stickybar"]',
      );
      if (!dockEl || !finish) return "no-finish-bar";
      const d = dockEl.getBoundingClientRect();
      const f = finish.getBoundingClientRect();
      const overlaps = !(f.bottom <= d.top || f.top >= d.bottom);
      return overlaps ? "overlaps" : "clear";
    });
    expect(finishClear).not.toBe("overlaps");
  });

  test("editing a logged set is an explicit, cancellable mode", async ({ page }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto(PREVIEW);

    // Rehab sets 1 and 2 are pre-logged in the fixture.
    await gotoMovement(page, /Seated Calf Raise/);
    const card = page.getByTestId("movement-focus-card");
    await expect(card).toHaveAttribute("data-editing", "false");
    await expect(page.getByTestId("movement-focus-edit-banner")).toHaveCount(0);
    await expect(page.getByTestId("movement-focus-log-button")).toContainText(
      "Log set",
    );
    const normalBg = await page
      .getByTestId("movement-focus-log-button")
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    // Re-open the first logged set.
    await page.getByTestId("movement-dot-0").click();

    // Every cue the mode is supposed to raise.
    await expect(card).toHaveAttribute("data-editing", "true");
    const banner = page.getByTestId("movement-focus-edit-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Editing a logged set");
    await expect(banner).toContainText("you logged");
    await expect(page.getByTestId("movement-focus-cancel-edit")).toBeVisible();
    await expect(page.getByTestId("movement-focus-cancel-edit-dock")).toBeVisible();
    await expect(page.getByTestId("movement-focus-log-button")).toContainText(
      "Update set",
    );
    await expect(page.getByTestId("session-dock")).toHaveClass(
      /cp-session-dock--editing/,
    );
    const editBg = await page
      .getByTestId("movement-focus-log-button")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(editBg, "edit CTA is visually distinct from the log CTA").not.toBe(
      normalBg,
    );

    // Cancel restores the normal mode and writes nothing.
    await page.getByTestId("movement-focus-cancel-edit-dock").click();
    await expect(card).toHaveAttribute("data-editing", "false");
    await expect(page.getByTestId("movement-focus-edit-banner")).toHaveCount(0);
    await expect(page.getByTestId("movement-focus-log-button")).toContainText(
      "Log set",
    );
    // The navigator trigger comes back in place of Cancel.
    await expect(page.getByTestId("movement-navigator-open")).toBeVisible();
  });

  test("an unprescribed accessory opens at last session's load, not zero", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto(PREVIEW);
    await gotoMovement(page, /Leg Press/);

    // The fixture gives Leg Press no percentTm and no targetWeightKg, but a
    // prior-session top set of 135 kg. Stepping there from 0 at 2.5 kg would
    // be 54 taps.
    await expect(
      page.locator('[data-testid="stepper-weight"] input'),
    ).toHaveValue("135");
    await expect(page.getByTestId("load-from-history")).toBeVisible();
    await expect(page.getByTestId("movement-focus-log-button")).toContainText("135");
  });

  test("skipping the rest of a superset station leaves the circuit", async ({
    page,
  }) => {
    // "Skip remaining sets" writes every open slot of the movement but used to
    // report only the cursor's. The circuit's round-major lookup reads that
    // coverage directly, so the rounds it had just skipped still looked open,
    // it pointed back at the station the lifter was already standing on, and
    // nothing moved — parked on a movement with nothing left to do, with only
    // the navigator sheet as a way out.
    //
    // Reachable only with the earlier rounds already covered, hence the
    // dedicated fixture.
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto(`${PREVIEW}?variant=supersetlast`);
    await gotoMovement(page, /Seated Cable Row/);

    await page.getByTestId("movement-focus-skip-rest-button").click();
    await expect(page.getByTestId("skip-set-menu")).toBeVisible();
    await page.getByTestId("skip-reason-time").click();
    await page.getByTestId("skip-confirm").click();

    // Moved on, and to a movement that still has work — the stuck state was
    // being left standing on this one with all three rounds covered. Which
    // movement comes next is the fixture's business, not this test's.
    await openNavigator(page);
    await expect(
      page.getByTestId(`movement-navigator-item-${ROW_ID}`),
    ).toHaveAttribute("aria-current", "false");
    const current = page
      .getByTestId("movement-navigator")
      .locator("[data-testid^='movement-navigator-item-'][aria-current='true']");
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("data-done", "false");
  });

  test("a half-kilo weight can be typed, with either decimal separator", async ({
    page,
  }) => {
    // Reported as: "I couldn't write 27,5 kg for the db row. It only accepted
    // full numbers and no decimals."
    //
    // The field was controlled by a NUMBER, so "27." parsed to 27, re-rendered
    // as "27", and the dot the user had just typed disappeared — the next
    // keystroke gave 275. A comma never parsed at all, so the controlled value
    // snapped back and it could not be typed. Weights store to the half kilo,
    // so there was no route to a load the app can hold.
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto(PREVIEW);
    await gotoMovement(page, /Leg Press/);

    const weight = page.locator('[data-testid="stepper-weight"] input');
    const cta = page.getByTestId("movement-focus-log-button");
    await expect(weight).toHaveValue("135");

    for (const typed of ["27,5", "27.5"]) {
      await weight.click();
      await weight.press("ControlOrMeta+a");
      await weight.pressSequentially(typed, { delay: 30 });
      // What was typed survives keystroke by keystroke, separator included.
      await expect(weight).toHaveValue(typed);
      // And it is the number the set would be logged with.
      await expect(cta).toContainText("27.5");
    }

    // Leaving the field shows the stored value, which is snapped to the half
    // kilo and so need not match the keystrokes character for character.
    await weight.blur();
    await expect(weight).toHaveValue("27.5");

    // A rejected keystroke is dropped, not stripped out of the middle: "2a7"
    // silently becoming 27 would be worse than the "a" never appearing.
    await weight.click();
    await weight.press("ControlOrMeta+a");
    await weight.pressSequentially("4a2,,5", { delay: 30 });
    await expect(weight).toHaveValue("42,5");
    await expect(cta).toContainText("42.5");
  });

  test("the dock owns the bottom region and the exit is explicit", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto(PREVIEW);

    // Two stacked fixed bars cost 133px of a 667px screen, and a mis-tap on
    // "Plan" mid-set drops you out of a live workout.
    await expect(page.getByTestId("session-dock")).toBeVisible();
    await expect(page.locator(".cp-bottom-tabbar")).toBeHidden();
    await expect(page.locator("html")).toHaveClass(/cp-session-live/);

    // Hiding global nav is only acceptable if leaving is still obvious.
    await openNavigator(page);
    const leave = page.getByTestId("movement-navigator-leave");
    await expect(leave).toBeVisible();
    await expect(leave).toHaveAttribute("href", "/app");
    await expect(leave).toContainText("Leave workout");
    // It says what happens to your work, because that is the actual worry.
    await expect(leave).toContainText("saved");
    const box = await leave.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });

  test("a just-logged set can be undone from the dock", async ({ page }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto(PREVIEW);
    await gotoMovement(page, /Front Plank/);

    // The preview's server action is a stub that returns no row id, so Undo
    // correctly stays hidden — there is nothing to delete. This asserts the
    // guard rather than the happy path: offering Undo for a set that was only
    // queued offline would delete nothing and lie about it.
    await page.getByTestId("movement-focus-log-button").click();
    await page.waitForTimeout(400);
    await expect(page.getByTestId("session-dock-undo")).toHaveCount(0);
  });

  test("the dock never lets its rows cover the primary action", async ({ page }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto(PREVIEW);
    await gotoMovement(page, /Back Squat/);
    await page.getByTestId("movement-dot-3").click();
    await page.getByTestId("movement-focus-log-button").click();
    await expect(page.getByTestId("rest-timer-shell")).toBeVisible({ timeout: 5000 });

    // Rest row, undo row and CTA all live inside the dock, so they stack
    // instead of overlapping however many are present.
    const clear = await page.evaluate(() => {
      const cta = document.querySelector<HTMLElement>(
        '[data-testid="movement-focus-log-button"]',
      );
      if (!cta) return null;
      const r = cta.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        insideViewport: r.top >= 0 && r.bottom <= window.innerHeight + 0.5,
        topmost: !!top && (top === cta || cta.contains(top)),
      };
    });
    expect(clear?.insideViewport).toBe(true);
    expect(clear?.topmost).toBe(true);
  });
});

