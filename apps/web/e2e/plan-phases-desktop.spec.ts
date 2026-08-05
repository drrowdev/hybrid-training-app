import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedRecentBlock } from "./fixtures/seed-blocks";

test.describe("@desktop /app/plan program phases", () => {
  test("rebases Activation at Armor and distinguishes week states", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 7);
    const startedOn = start.toISOString().slice(0, 10);
    const blockId = await seedRecentBlock(admin, freshUser.userId, {
      archetype: "custom",
      daysPerWeek: 6,
      status: "active",
      startedOn,
      weeks: 20,
    });
    const { error: blockError } = await admin
      .from("training_blocks")
      .update({
        notes: "Activation",
        program_id: "tactical-barbell",
        program_family: "tactical-barbell",
      })
      .eq("id", blockId);
    expect(blockError).toBeNull();

    const { error: instanceError } = await admin.from("program_instances").insert({
      user_id: freshUser.userId,
      program_id: "tactical-barbell",
      program_family: "tactical-barbell",
      block_id: blockId,
      status: "active",
      // Legacy instances created before the Plan redesign omitted this offset.
      setup_input: {},
      instance: {
        templateId: "activation",
        blocks: 1,
        blockWeeks: 25,
        cluster: [],
        useTrainingMax: false,
        tmPercent: 1,
        useTemplateDefaults: true,
        armorSupplementalA: "back-extension",
        armorSupplementalB: "pullup",
      },
    });
    expect(instanceError).toBeNull();

    const completedIds: string[] = [];
    for (let dayIndex = 0; dayIndex < 6; dayIndex += 1) {
      const { data, error } = await admin
        .from("sessions")
        .insert({
          user_id: freshUser.userId,
          performed_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          title: `Completed Armor ${dayIndex + 1}`,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      completedIds.push(data!.id);
    }

    const plannedRows = Array.from({ length: 3 }, (_, weekIndex) =>
      Array.from({ length: 6 }, (_, dayIndex) => ({
        block_id: blockId,
        user_id: freshUser.userId,
        week_index: weekIndex,
        day_index: dayIndex,
        slot: "single",
        title:
          dayIndex === 2 || dayIndex === 4
            ? "LSS 60"
            : ["Squat + Rack Pull", "Bench + Row", "LSS 60", "Squat + Deadlift", "LSS 60", "Bench + Row"][dayIndex],
        role: dayIndex === 2 || dayIndex === 4 ? "cardio" : "primary",
        prescription: {
          items:
            dayIndex === 2 || dayIndex === 4
              ? [{ kind: "cardio_z2", durationMin: 60 }]
              : [],
          programRef: `b0-w${weekIndex + 6}-${
            [
              "armor-a1",
              "armor-b1",
              "armor-lss-1",
              "armor-a2",
              "armor-lss-2",
              "armor-b2",
            ][dayIndex]
          }`,
        },
        completed_session_id:
          weekIndex === 0 ? completedIds[dayIndex] : null,
      })),
    ).flat();
    const { error: plannedError } = await admin
      .from("planned_sessions")
      .insert(plannedRows);
    expect(plannedError).toBeNull();

    await signInAs(
      context,
      freshUser,
      seedConfig,
      baseURL ?? "http://localhost:3000",
    );
    await page.goto("/app/plan");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Activation");
    await expect(page.getByTestId("plan-redesign")).toContainText(
      /Active program · Tactical Barbell/i,
    );
    await expect(page.getByTestId("plan-redesign")).toContainText(
      /Week 2 of 20 · Armor/i,
    );
    await expect(page.getByTestId("plan-phase-0")).toContainText("Armor");
    await expect(page.getByTestId("plan-phase-1")).toContainText(
      "Operator Blue",
    );

    const completed = page.getByTestId("plan-timeline-week-0");
    const current = page.getByTestId("plan-timeline-week-1");
    const upcoming = page.getByTestId("plan-timeline-week-2");
    await expect(completed).toHaveClass(/completed/);
    await expect(current).toHaveClass(/current/);
    await expect(current).toHaveAttribute("open", "");
    await expect(upcoming).toHaveClass(/upcoming/);

    const colors = await Promise.all(
      [completed, current, upcoming].map(async (week) =>
        week.locator("summary").first().evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      ),
    );
    expect(new Set(colors).size).toBe(3);
  });
});
