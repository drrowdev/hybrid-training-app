/**
 * Regression: a prescription value must never break across visual lines.
 *
 * Reported from a phone — the rehab card on Today showed a long movement name
 * next to "3 × 15" and wrapped the value into "3 ×" / "15" on separate lines.
 * The unit test guards the DOM contract (one nowrap span per " · " chunk);
 * this measures what the contract is FOR, by asking the browser how many line
 * boxes each chunk actually occupies at a phone width.
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
});
