import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

test("confirmed rehab creation appears once and survives reload", async ({
  page, context, freshUser, seedConfig, admin, baseURL,
}) => {
  await markOnboarded(admin, freshUser.userId);
  await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
  await page.goto("/app/settings/rehab-protocols");
  await page.getByTestId("rehab-protocols-empty").getByRole("button").click();
  await page.getByTestId("rehab-protocol-name").fill("List confirmation test");
  await page.getByTestId("rehab-protocol-picker").getByRole("button").first().click();

  let release!: () => void;
  let observed!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { observed = resolve; });
  await page.route("**/app/settings/rehab-protocols*", async (route) => {
    if (route.request().method() === "POST") {
      observed();
      await held;
    }
    await route.continue();
  });
  const response = page.waitForResponse((res) =>
    res.request().method() === "POST" && !!res.request().headers()["next-action"]);
  await page.getByTestId("rehab-protocol-save").click();
  await started;
  try {
    await expect(page.getByTestId("rehab-protocol-name")).toHaveValue("List confirmation test");
    await expect(page.getByTestId("rehab-protocol-notice")).toHaveCount(0);
  } finally {
    release();
  }
  await (await response).finished();
  const cards = page.locator('section[data-testid^="rehab-protocol-"]');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("List confirmation test");
  await page.reload();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("List confirmation test");
});
