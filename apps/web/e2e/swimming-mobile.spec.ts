import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { completeRetainedSwim, retainedSwimActor } from "./fixtures/swim-retained";
import { getSwimResult, listSwimWorkouts } from "../src/lib/swim/storage";
import { workoutPresentation } from "../src/lib/swim/presentation";

test.describe("ADR0079 standalone swimming", () => {
  test.skip(
    !swimE2EEnabled(process.env),
    "Blocked: swimming E2E was not explicitly requested.",
  );

  test("blockless setup, program navigation and retained native history", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/plan/new");
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByRole("button", { name: "Swimming", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Set up swimming", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/swim\/setup$/);
    await page.reload();
    await expect(page).toHaveURL(/\/app\/swim\/setup$/);
    await page.goto("/app/plan/new");
    await page.getByRole("dialog").getByRole("button", { name: "Swimming", exact: true }).click();
    const [{ count: tms }, { count: blocks }] = await Promise.all([
      admin.from("training_maxes").select("id", { count: "exact", head: true }).eq("user_id", freshUser.userId),
      admin.from("training_blocks").select("id", { count: "exact", head: true }).eq("user_id", freshUser.userId),
    ]);
    expect(tms).toBe(0);
    expect(blocks).toBe(0);
    await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("25yd");
    await page.getByLabel("Recent comfortable non-stop lengths").fill("4");
    await page.getByLabel("Weeks", { exact: true }).fill("4");
    await page.getByRole("button", { name: "Preview plan", exact: true }).click();
    await page.getByRole("button", { name: "Create swim plan" }).click();
    await expect(page).toHaveURL(/\/app\/swim\?plan=/);

    const planId = new URL(page.url()).searchParams.get("plan")!;
    const actor = await retainedSwimActor(seedConfig, freshUser);
    const issued = await listSwimWorkouts(actor, planId);
    expect(issued).toHaveLength(8);
    const workout = issued[0];
    await page.goto("/app/programs");
    const row = page.locator(`a[data-kind="swimming"][href="/app/swim?plan=${planId}"]`);
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/app/swim\\?plan=${planId}$`));
    await page.getByRole("heading", { name: "Swims", exact: true }).locator("..")
      .locator(`a[href="/app/swim/${workout.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/app/swim/${workout.id}$`));
    const prescription = page.getByRole("heading", { name: "Workout", exact: true }).locator("..");
    const before = await prescription.innerText();
    await completeRetainedSwim(actor, workout, { lengths: 16, timeMs: 912345 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your swim", exact: true })).toBeVisible();
    expect(await prescription.innerText()).toBe(before);
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

  test("custom pool validation preserves inputs and exact issued repeats across reload", async ({
    page, context, freshUser, admin, baseURL, seedConfig,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/swim/setup");
    await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("custom");
    await page.getByLabel("Custom length", { exact: true }).fill("33.33");
    await page.getByLabel("Recent comfortable non-stop lengths").fill("6");
    await page.getByLabel("Weeks", { exact: true }).fill("2");
    await page.getByText("200 / 400 assessment (optional)", { exact: true }).click();
    await page.getByLabel("200 time").fill("4:00");
    await page.getByLabel("400 time").fill("8:30");
    await page.getByLabel("Swum on", { exact: true }).fill(await page.getByLabel("Start date", { exact: true }).inputValue());
    await page.getByRole("checkbox", { name: /Verified times/ }).check();
    await page.getByRole("button", { name: "Preview plan", exact: true }).click();
    await expect(page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"))).toBeVisible();
    await expect(page.getByLabel("Custom length", { exact: true })).toHaveValue("33.33");
    await expect(page.getByLabel("200 time")).toHaveValue("4:00");
    await page.getByLabel("Custom length", { exact: true }).fill("33 1/3");
    await page.getByRole("button", { name: "Preview plan", exact: true }).click();
    await page.getByRole("button", { name: "Create swim plan" }).click();
    await expect(page).toHaveURL(/\/app\/swim\?plan=/);

    const planId = new URL(page.url()).searchParams.get("plan")!;
    const actor = await retainedSwimActor(seedConfig, freshUser);
    const issued = await listSwimWorkouts(actor, planId);
    expect(issued).toHaveLength(4);
    const workout = issued[0];
    expect(workout.definition.issued.snapshot.course).toEqual({ numerator: 100, denominator: 3, unit: "m" });
    await page.getByRole("heading", { name: "Swims", exact: true }).locator("..")
      .locator(`a[href="/app/swim/${workout.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/app/swim/${workout.id}$`));
    const prescription = page.getByRole("heading", { name: "Workout", exact: true }).locator("..");
    const steps = prescription.getByRole("listitem");
    const view = workoutPresentation(workout.definition.issued);
    await expect(steps).toHaveCount(view.steps.length);
    for (const [index, step] of view.steps.entries()) {
      await expect(steps.nth(index)).toContainText(step.title);
      await expect(steps.nth(index)).toContainText(step.detail);
      await expect(steps.nth(index)).toContainText(step.rest);
    }
    const before = await prescription.innerText();
    await page.reload();
    expect(await prescription.innerText()).toBe(before);
    expect(await listSwimWorkouts(actor, planId)).toEqual(issued);
    const splits = [{ lengths: 4, timeMs: 135125 }];
    const completed = await completeRetainedSwim(actor, workout, {
      lengths: 6, timeMs: 492345, splits, deviationReason: "Stopped early",
    });
    await page.reload();
    const result = page.getByRole("heading", { name: "Your swim", exact: true }).locator("..");
    await expect(result.getByText("200 m", { exact: true })).toBeVisible({ timeout: 25000 });
    await expect(result).toContainText("6 lengths · 8:12.345");
    const retained = await getSwimResult(actor, completed.session_id);
    expect(retained).toMatchObject({
      lengths: 6, timeMs: 492345, splits,
      snapshot: { course: { numerator: 100, denominator: 3, unit: "m" } },
      provenance: { deviationReason: "Stopped early" },
    });
    await page.reload();
    await expect(result.getByText("200 m", { exact: true })).toBeVisible();
    expect(await prescription.innerText()).toBe(before);
    expect(await getSwimResult(actor, completed.session_id)).toEqual(retained);
  });
});
