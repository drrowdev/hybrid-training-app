import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import { seedBlockAtWeekDay } from "./fixtures/program-run";

test.describe("@desktop /app/plan Season consistency", () => {
  test("uses the same Plan navigation and button system", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    const { error } = await admin
      .from("profiles")
      .update({ season_planning_enabled: true })
      .eq("id", freshUser.userId);
    expect(error).toBeNull();
    await signInAs(
      context,
      freshUser,
      seedConfig,
      baseURL ?? "http://localhost:3000",
    );

    await page.goto("/app/plan?view=season");
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("season-nav-timeline")).toHaveText("Program");
    await expect(page.getByTestId("season-nav-month")).toHaveText("Calendar");
    await expect(page.getByTestId("season-nav-season")).toHaveText("Season");
    await expect(page.getByTestId("season-nav-season")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("season-empty")).toBeVisible();
    await expect(page.getByTestId("season-add-row")).toHaveClass(/cp-btn/);
    await expect(page.getByTestId("season-create")).toHaveClass(/cp-btn/);
    await expect(page.getByTestId("season-create")).toHaveClass(/primary/);
    await expect(page.getByTestId("season-draft-suggest-0")).toHaveClass(
      /cp-btn/,
    );
  });

  test("switches Season inside the active-program shell", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    await seedBlockAtWeekDay(admin, freshUser.userId, { weekIndex: 0 });
    const { error } = await admin
      .from("profiles")
      .update({ season_planning_enabled: true })
      .eq("id", freshUser.userId);
    expect(error).toBeNull();
    await signInAs(
      context,
      freshUser,
      seedConfig,
      baseURL ?? "http://localhost:3000",
    );

    await page.goto("/app/plan?view=season");
    await page.waitForLoadState("networkidle");

    const shell = page.getByTestId("plan-redesign");
    await expect(shell).toBeVisible();
    await expect(shell.getByText(/active program/i)).toBeVisible();
    await expect(page.getByTestId("plan-view-tab-season")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("plan-season-view")).toBeVisible();
    await expect(page.getByTestId("season-empty")).toBeVisible();
    await expect(page.getByTestId("season-nav-timeline")).toHaveCount(0);

    await page.getByTestId("plan-view-tab-timeline").click();
    await expect(page.getByTestId("plan-timeline")).toBeVisible();
    await expect(shell.getByText(/active program/i)).toBeVisible();

    await page.getByTestId("plan-view-tab-season").click();
    await expect(page.getByTestId("plan-season-view")).toBeVisible();
    await expect(shell.getByText(/active program/i)).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("plan-season-view")).toBeVisible();
    await expect(shell.getByText(/active program/i)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
