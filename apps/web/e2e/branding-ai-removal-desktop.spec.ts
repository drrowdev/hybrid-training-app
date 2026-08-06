import { expect, test } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

test("uses the compact mark and exposes no AI surfaces", async ({
  page,
  context,
  request,
  freshUser,
  seedConfig,
  admin,
  baseURL,
}) => {
  const url = baseURL ?? "http://localhost:3000";

  await page.goto("/");
  await expect(page.getByRole("img", { name: "SxC" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText(/Strength\s*[×x+]\s*Cardio/i)).toHaveCount(0);

  expect((await request.post("/api/ai/chat")).status()).toBe(404);
  expect((await request.get("/mcp/authorize")).status()).toBe(404);
  expect((await request.post("/mcp/token")).status()).toBe(404);
  expect((await request.post("/mcp/tools")).status()).toBe(404);

  await markOnboarded(admin, freshUser.userId);
  await seedStrengthTms(admin, freshUser.userId);
  await signInAs(context, freshUser, seedConfig, url);

  await page.goto("/app/settings/integrations");
  await expect(
    page.getByTestId("settings-hub-integrations-strava"),
  ).toBeVisible();
  await expect(page.getByText(/AI providers/i)).toHaveCount(0);

  await page.goto("/app/settings/ai");
  await expect(page.getByText("404")).toBeVisible();
});
