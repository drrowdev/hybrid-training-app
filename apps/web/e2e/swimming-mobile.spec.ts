import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";

test.describe("ADR0079 standalone swimming", () => {
  test.skip(
    !swimE2EEnabled(process.env),
    "Blocked: swimming E2E was not explicitly requested.",
  );

  test("blockless setup, local progress, offline finish and native history", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/program");
    await page.getByRole("link", { name: /Pool swimming/ }).click();
    await page.getByLabel("Pool length", { exact: true }).selectOption("25yd");
    await page.getByLabel("Recent comfortable continuous lengths").fill("4");
    await page.getByLabel("Weeks", { exact: true }).fill("4");
    await page.getByRole("button", { name: "Create swim plan" }).click();
    await expect(page).toHaveURL(/\/app\/swim\?plan=/);

    await page.goto("/app/plan");
    await expect(page).toHaveURL(/\/app\/plan$/);
    await page.getByRole("link", { name: /Pool swim/ }).first().click();
    await page.getByRole("button", { name: "Start swim" }).click();
    const firstStep = page.getByRole("checkbox", { name: /^Mark .* done$/ }).first();
    await firstStep.check();
    await page.reload();
    await expect(firstStep).toBeChecked();
    await page.getByRole("link", { name: "Log swim", exact: true }).click();
    await page.getByLabel("Whole lengths", { exact: true }).fill("16");
    await page.getByLabel("Time · min:sec", { exact: true }).fill("15:12.345");
    await context.setOffline(true);
    await page.getByRole("button", { name: "Finish swim", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Waiting to sync" })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole("heading", { name: "Your swim", exact: true })).toBeVisible({ timeout: 25000 });
    await expect(page.getByText(/16 lengths · 15:12.345/)).toBeVisible();

    const { data: workouts, error } = await admin.from("swim_workouts").select("session_id").eq("user_id", freshUser.userId).not("session_id", "is", null);
    expect(error).toBeNull();
    expect(workouts).toHaveLength(1);
    const sessionId = workouts![0]!.session_id as string;
    const { data: logs } = await admin.from("cardio_logs").select("id").eq("session_id", sessionId);
    expect(logs).toHaveLength(1);
    await page.goto(`/app/sessions/${sessionId}`);
    await expect(page).toHaveURL(/\/app\/swim\/[^/]+$/);
    await page.goto("/app/stats");
    await page.getByRole("link", { name: "Swimming", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/swim$/);
  });

  test("custom pool entry survives validation and compact repeats retain progress", async ({
    page, context, freshUser, admin, baseURL, seedConfig,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/swim/setup");
    await page.getByLabel("Pool length", { exact: true }).selectOption("custom");
    await page.getByLabel("Custom pool length", { exact: true }).fill("33.33");
    await page.getByLabel("Recent comfortable continuous lengths").fill("6");
    await page.getByLabel("Weeks", { exact: true }).fill("2");
    await page.getByText("200 / 400 assessment (optional)", { exact: true }).click();
    await page.getByLabel("200 time").fill("4:00");
    await page.getByLabel("400 time").fill("8:30");
    await page.getByLabel("Swum on", { exact: true }).fill(await page.getByLabel("Start date", { exact: true }).inputValue());
    await page.getByRole("checkbox", { name: /Verified times/ }).check();
    await page.getByRole("button", { name: "Create swim plan" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Custom pool length", { exact: true })).toHaveValue("33.33");
    await expect(page.getByLabel("200 time")).toHaveValue("4:00");
    await page.getByLabel("Custom pool length", { exact: true }).fill("33 1/3");
    await page.getByRole("button", { name: "Create swim plan" }).click();
    await expect(page).toHaveURL(/\/app\/swim\?plan=/);

    await page.goto("/app/plan");
    await page.getByRole("link", { name: /Pool swim/ }).first().click();
    await page.getByRole("button", { name: "Start swim" }).click();
    await page.getByRole("button", { name: "Mark next", exact: true }).first().click();
    await expect(page.locator("output").first()).toHaveText(/^1\//);
    await page.reload();
    await expect(page.locator("output").first()).toHaveText(/^1\//);

    await page.getByRole("link", { name: "Log swim", exact: true }).click();
    await page.getByLabel("Whole lengths", { exact: true }).fill("6");
    await page.getByLabel("Time · min:sec", { exact: true }).fill("8:12.345");
    await page.getByText("Notes, changes and splits", { exact: true }).click();
    await page.getByLabel("Changed or skipped work", { exact: true }).fill("Stopped early");
    await page.getByRole("button", { name: "Add split", exact: true }).click();
    await page.getByLabel("Split 1 lengths", { exact: true }).fill("4");
    await page.getByLabel("Split 1 time", { exact: true }).fill("2:15.125");
    await page.getByRole("button", { name: "Finish swim", exact: true }).click();
    const result = page.getByRole("heading", { name: "Your swim", exact: true }).locator("..");
    await expect(result.getByText("200 m", { exact: true })).toBeVisible({ timeout: 25000 });
    await result.getByRole("button", { name: "Edit result", exact: true }).click();
    await page.getByText("Notes, changes and splits", { exact: true }).click();
    await expect(page.getByLabel("Split 1 lengths", { exact: true })).toHaveValue("4");
    await expect(page.getByLabel("Split 1 time", { exact: true })).toHaveValue("2:15.125");
  });
});
