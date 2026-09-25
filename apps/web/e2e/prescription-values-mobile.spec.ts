/**
 * Regression: a prescription value must never break across visual lines.
 *
 * Reported from a phone — the rehab card on Today showed a long movement name
 * next to "3 × 15" and wrapped the value into "3 ×" / "15" on separate lines.
 * Short doses stay together; long instructions must wrap without shrinking
 * movement names or widening the document and displacing fixed navigation.
 */
import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import { seedActiveBlock } from "./fixtures/session-log";

test.describe("@mobile Today prescription values", () => {
  test("never breaks a sets × reps value across two lines", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";
    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    const seed = await seedActiveBlock(admin, freshUser.userId);

    // Long rehab movement names are what squeezed the value cell. Prepend a
    // rehab block to today's prescription so the Today hero renders the same
    // "Includes rehab" card the report came from.
    const { data: planned, error: plannedError } = await admin
      .from("planned_sessions")
      .select("prescription")
      .eq("id", seed.todayPlannedId)
      .single();
    expect(plannedError).toBeNull();

    const prescription = planned!.prescription as {
      items: Array<Record<string, unknown>>;
    };
    const rehabNames = [
      "Supported Reverse Wrist Curl (DB)",
      "Supported Wrist Radial Deviation (DB)",
      "Supported Pronation / Supination (DB)",
    ];
    prescription.items = [
      ...rehabNames.map((movementName, i) => ({
        movementId: `rehab-${i}`,
        movementSlug: `rehab-${i}`,
        movementName,
        kind: "tendon",
        sets: 3,
        reps: 15,
        meta: { rehab: true, rehabProtocolName: "Golfer's Elbow Rehab" },
      })),
      ...prescription.items,
    ];
    const { error: updateError } = await admin
      .from("planned_sessions")
      .update({ prescription })
      .eq("id", seed.todayPlannedId);
    expect(updateError).toBeNull();

    await signInAs(context, freshUser, seedConfig, url);
    await page.goto("/app");
    await expect(page.getByTestId("session-preview-section-rehab")).toBeVisible();

    // Every value chunk must occupy exactly one line box. `getClientRects()`
    // on a Range returns one rect per line the content is laid out on.
    const broken = await page.evaluate(() => {
      const out: { value: string; chunk: string; lines: number }[] = [];
      for (const cell of document.querySelectorAll(
        '[data-testid="prescription-value"]',
      )) {
        for (const chunk of cell.querySelectorAll("span")) {
          const range = document.createRange();
          range.selectNodeContents(chunk);
          const lines = range.getClientRects().length;
          if (lines > 1) {
            out.push({
              value: cell.textContent?.trim() ?? "",
              chunk: chunk.textContent?.trim() ?? "",
              lines,
            });
          }
        }
      }
      return out;
    });

    expect(broken, `values split across lines: ${JSON.stringify(broken)}`).toEqual(
      [],
    );

    // Sanity: the assertion above is only meaningful if values actually rendered.
    await expect(
      page.getByTestId("prescription-value").first(),
    ).toContainText("3 × 15");
  });

  test("keeps Copenhagen instructions readable and navigation pinned while scrolling", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    const seed = await seedActiveBlock(admin, freshUser.userId);
    const { data: planned, error: plannedError } = await admin
      .from("planned_sessions")
      .select("prescription")
      .eq("id", seed.todayPlannedId)
      .single();
    expect(plannedError).toBeNull();
    const prescription = planned!.prescription as { items: Array<Record<string, unknown>> };
    const rehab = { kind: "tendon", sets: 3, meta: { rehab: true, rehabProtocolName: "Adductor rehab" } };
    prescription.items = [
      { ...rehab, movementId: "copenhagen", movementName: "Copenhagen Plank", reps: 8,
        repRange: { min: 8, max: 10 }, notes: "Dynamic. Raise the hips with control." },
      { ...rehab, movementId: "copenhagen", movementName: "Copenhagen Plank",
        holdSec: { min: 20, max: 20 },
        notes: "Isometric. Side plank lower leg. Keep the pelvis level and breathe throughout the hold." },
      { ...rehab, movementId: "hip-flexor", movementName: "Hip Flexor Raise (kettlebell)", reps: 10 },
      ...prescription.items,
    ];
    const { error } = await admin.from("planned_sessions")
      .update({ prescription }).eq("id", seed.todayPlannedId);
    expect(error).toBeNull();
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app");
    await expect(page.getByTestId("embedded-rehab-badge")).toHaveCount(0);
    const rehabCard = page.getByTestId("session-preview-section-rehab");
    await expect(rehabCard).toBeVisible();
    await expect(rehabCard).toContainText("Keep the pelvis level and breathe throughout the hold.");

    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 812 });
      const name = rehabCard.getByTestId("prescription-name").filter({ hasText: "Copenhagen Plank" });
      const box = await name.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(120);
      expect(box!.height).toBeLessThanOrEqual(48);
      expect(await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )).toBeLessThanOrEqual(1);
      const brokenDoses = await rehabCard.locator("[data-prescription-chunk]").evaluateAll(chunks =>
        chunks.filter(chunk => /^\d+\s*×/.test(chunk.textContent ?? "")).filter(chunk => {
          const range = document.createRange();
          range.selectNodeContents(chunk);
          return range.getClientRects().length > 1;
        }).map(chunk => chunk.textContent),
      );
      expect(brokenDoses).toEqual([]);

      for (const y of [0, 400, 1000, 3000, 200]) {
        await page.evaluate(y => window.scrollTo(0, y), y);
        await expect.poll(() => page.getByTestId("bottom-tabbar").evaluate(nav => {
          const bottom = nav.getBoundingClientRect().bottom;
          const viewportBottom = window.visualViewport
            ? window.visualViewport.height + window.visualViewport.offsetTop
            : window.innerHeight;
          return Math.abs(bottom - viewportBottom);
        })).toBeLessThanOrEqual(2);
      }
    }
  });
});
