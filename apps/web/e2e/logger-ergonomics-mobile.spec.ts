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

const PHONES = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 14", width: 390, height: 844 },
  { name: "iPhone 15 Pro Max", width: 430, height: 932 },
] as const;

async function openNavigator(page: Page) {
  await page.getByTestId("movement-navigator-open").click();
  await expect(page.getByTestId("movement-navigator")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
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
    await page.setViewportSize({ width: 390, height: 844 });

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
    await page.setViewportSize({ width: 390, height: 844 });
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
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PREVIEW);
    await openNavigator(page);
    const linked = page.getByTestId("movement-navigator-superset-A");
    await expect(linked).toBeVisible();
    await expect(linked).toContainText("Leg Press");
    await expect(linked).toContainText("Seated Cable Row");
    await expect(linked).toContainText("A1");
    await expect(linked).toContainText("A2");
  });

  test("every interactive control meets the 44px touch floor", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
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
    await page.setViewportSize({ width: 390, height: 844 });
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

  test("editing a logged set is an explicit, cancellable mode", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
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
    await page.setViewportSize({ width: 390, height: 844 });
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
});
