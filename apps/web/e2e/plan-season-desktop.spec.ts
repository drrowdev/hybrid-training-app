import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

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
});
