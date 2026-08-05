import { expect, test } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

test("customized TB builder exposes standalone templates but not Activation", async ({
  page,
  context,
  freshUser,
  seedConfig,
  admin,
  baseURL,
}) => {
  const url = baseURL ?? "https://getsxc.app";
  await markOnboarded(admin, freshUser.userId);
  await seedStrengthTms(admin, freshUser.userId);
  await signInAs(context, freshUser, seedConfig, url);

  await page.goto("/app/program?program=tactical-barbell");
  await expect(page.getByText("Customize template")).toBeVisible();
  await page.getByText("Customize template").click();
  await expect(page.getByText("Program name")).toBeVisible();
  await expect(
    page.locator('input[value="Tactical Barbell - Customized"]'),
  ).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Strength movements")).toBeVisible();

  const tuesday = page.getByRole("button", { name: /Tue Rest/i });
  await tuesday.click();
  await page.getByRole("button", { name: /Tue Strength/i }).click();
  await page.getByRole("button", { name: /Tue Conditioning/i }).click();
  await expect(page.getByText("Rehab protocol")).toBeVisible();
  await page.getByRole("button", { name: "Add rehab movement" }).click();
  await expect(
    page.getByLabel("Rehab movement 1", { exact: true }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Strength movements")).toBeVisible();
  const overflow = await page.evaluate(() => ({
    amount: document.documentElement.scrollWidth - window.innerWidth,
    offenders: Array.from(document.querySelectorAll("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          className: element.className,
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      })
      .filter((element) => element.right > window.innerWidth + 1)
      .slice(0, 12),
  }));
  if (overflow.amount > 1) {
    throw new Error(
      `Mobile overflow ${overflow.amount}px: ${JSON.stringify(overflow.offenders)}`,
    );
  }

  await page.goto("/app/program?program=tactical-barbell");
  await page.getByTestId("loadout-opt-activation").click();
  await expect(page.getByText("Customize template")).toHaveCount(0);
});
