import { expect, test } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

function currentMondayYmd(): string {
  const now = new Date();
  const mondayOffset = (now.getUTCDay() + 6) % 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - mondayOffset);
  return monday.toISOString().slice(0, 10);
}

test("customized TB builder exposes standalone templates and Activation", async ({
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
  await page.locator('input[type="date"]').first().fill(currentMondayYmd());
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
  await expect(page.getByText("Customize template")).toBeVisible();
});

test("creates and restores a phase-aware customized Activation plan", async ({
  page,
  context,
  freshUser,
  seedConfig,
  admin,
  baseURL,
}) => {
  test.slow();
  const url = baseURL ?? "http://localhost:3000";
  await markOnboarded(admin, freshUser.userId);
  await seedStrengthTms(admin, freshUser.userId);
  await signInAs(context, freshUser, seedConfig, url);

  await page.goto("/app/program?program=tactical-barbell");
  await page.getByTestId("loadout-opt-activation").click();
  await page.getByText("Customize template").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const base = page.getByTestId("activation-phase-base");
  await expect(base).toBeVisible();
  await page.getByLabel("Base circuit 1 weekday").selectOption("6");
  await page
    .getByTestId(
      "activation-movement-activation.base.base-1-goblet-squat",
    )
    .getByRole("button", { name: "Remove" })
    .click();
  await page
    .getByTestId("activation-session-activation.base.base-lss-3")
    .getByRole("checkbox")
    .uncheck();
  const armor = page.getByTestId("activation-phase-armor");
  await armor.locator(":scope > summary").click();
  const armorSquat = page.getByTestId(
    "activation-movement-activation.armor.armor-a1-squat",
  );
  await armorSquat.getByText("Change", { exact: true }).click();
  await armorSquat
    .getByLabel("Search the exercise library")
    .fill("Belt Squat");
  await armorSquat.getByRole("button", { name: /Belt Squat/ }).click();
  await armor.getByRole("button", { name: "Tue +", exact: true }).click();
  await page
    .getByTestId("activation-phase-operator")
    .locator(":scope > summary")
    .click();
  for (const session of ["operator-d1", "operator-d2"]) {
    const row = page.getByTestId(
      `activation-movement-activation.operator.${session}-squat`,
    );
    await row.getByText("Change", { exact: true }).click();
    await row.getByLabel("Search the exercise library").fill("Deadlift");
    await row
      .getByRole("button", { name: /Conventional Deadlift/ })
      .click();
  }
  await page.getByRole("button", { name: "Add rehab movement" }).click();
  await page
    .getByLabel("Instructions for rehab movement 1")
    .fill("Slow and pain-free, as prescribed by physio.");
  await expect(
    page.getByText("3 strength · 2 conditioning · 0 rehab · 2 rest"),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const deploy = page.getByRole("button", { name: "Deploy program" });
  await expect(deploy).toBeEnabled();
  await deploy.click();
  await page.waitForURL("**/app", { timeout: 30_000 });

  const { data: programInstance, error: instanceError } = await admin
    .from("program_instances")
    .select("block_id, display_name, customization_version, setup_input")
    .eq("user_id", freshUser.userId)
    .eq("status", "active")
    .maybeSingle();
  expect(instanceError).toBeNull();
  expect(programInstance).toMatchObject({
    display_name: "Tactical Barbell - Customized",
    customization_version: 2,
  });
  const setupInput = programInstance!.setup_input as {
    customization?: {
      version?: number;
      rehab?: {
        items?: Array<{ instructions?: string }>;
      };
      phases?: {
        base?: {
          rehabDays?: number[];
          sessions?: Record<
            string,
            {
              day?: number;
              enabled?: boolean;
              movementOverrides?: Record<string, unknown>;
            }
          >;
        };
        armor?: {
          rehabDays?: number[];
          sessions?: Record<
            string,
            { movementOverrides?: Record<string, unknown> }
          >;
        };
      };
    };
  };
  expect(setupInput.customization).toMatchObject({
    version: 2,
    rehab: {
      items: [
        {
          instructions: "Slow and pain-free, as prescribed by physio.",
        },
      ],
    },
    phases: {
      base: {
        rehabDays: [],
        sessions: {
          "activation.base.base-1": {
            day: 6,
            movementOverrides: { "goblet-squat": null },
          },
          "activation.base.base-lss-3": { enabled: false },
        },
      },
      armor: {
        rehabDays: [1],
        sessions: {
          "activation.armor.armor-a1": {
            movementOverrides: {
              squat: {
                slug: "belt-squat",
                displayName: "Belt Squat",
              },
            },
          },
        },
      },
    },
  });

  const { data: sessions, error: sessionsError } = await admin
    .from("planned_sessions")
    .select("id, week_index, day_index, slot, role, prescription, completed_session_id")
    .eq("block_id", programInstance!.block_id);
  expect(sessionsError).toBeNull();
  const weekOne = sessions!.filter((session) => session.week_index === 0);
  expect(
    weekOne.find(
      (session) =>
        (session.prescription as { programRef?: string }).programRef?.endsWith(
          "base-1",
        ),
    )?.day_index,
  ).toBe(6);
  expect(
    weekOne.some((session) =>
      (session.prescription as { programRef?: string }).programRef?.endsWith(
        "base-lss-3",
      ),
    ),
  ).toBe(false);
  expect(weekOne.some((session) => session.role === "rehab")).toBe(false);
  const baseOne = weekOne.find((session) =>
    (session.prescription as { programRef?: string }).programRef?.endsWith(
      "base-1",
    ),
  )!;
  expect(
    (
      baseOne.prescription as {
        items?: Array<{ movementName?: string }>;
      }
    ).items?.some((item) => item.movementName === "Goblet Squat"),
  ).toBe(false);
  const armorWeek = sessions!.filter((session) => session.week_index === 5);
  expect(
    armorWeek.filter((session) => session.day_index === 1).map(
      (session) => [session.role, session.slot],
    ),
  ).toEqual(
    expect.arrayContaining([
      ["strength", "single"],
      ["rehab", "pm"],
    ]),
  );
  const armorA1 = armorWeek.find((session) =>
    (session.prescription as { programRef?: string }).programRef?.endsWith(
      "armor-a1",
    ),
  )!;
  const beltSquat = (
    armorA1.prescription as {
      items?: Array<{
        movementName?: string;
        percentTm?: number;
        targetWeightKg?: number;
      }>;
    }
  ).items?.find((item) => item.movementName === "Belt Squat");
  expect(beltSquat).toMatchObject({
    movementName: "Belt Squat",
  });
  expect(beltSquat?.percentTm).toBeUndefined();
  expect(beltSquat?.targetWeightKg).toBeUndefined();
  expect(
    sessions!.some(
      (session) => session.week_index === 4 && session.role === "rehab",
    ),
  ).toBe(false);
  const mappedPeak = sessions!.find(
    (session) =>
      session.week_index === 13 &&
      (session.prescription as { programRef?: string }).programRef?.endsWith(
        "peak-squat",
      ),
  )!;
  const mappedPeakNames = (
    mappedPeak.prescription as {
      items?: Array<{ movementName?: string; kind?: string }>;
    }
  ).items
    ?.filter((item) => item.kind === "main")
    .map((item) => item.movementName);
  expect(mappedPeakNames?.[0]).toBe("Conventional Deadlift");
  expect(mappedPeakNames).not.toContain("Squat");

  const completedPlanned = sessions!.find(
    (session) =>
      session.week_index === 0 &&
      session.day_index === 2 &&
      (session.prescription as { programRef?: string }).programRef?.endsWith(
        "base-2",
      ),
  )!;
  const { data: completedSession, error: completedInsertError } = await admin
    .from("sessions")
    .insert({
      user_id: freshUser.userId,
      performed_at: new Date().toISOString(),
      title: "Completed Base circuit 2",
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  expect(completedInsertError).toBeNull();
  const { error: completedLinkError } = await admin
    .from("planned_sessions")
    .update({ completed_session_id: completedSession!.id })
    .eq("id", completedPlanned.id);
  expect(completedLinkError).toBeNull();

  await page.goto(`/app/program?edit=${programInstance!.block_id}`);
  await expect(
    page.locator('input[value="Tactical Barbell - Customized"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Base circuit 1 weekday")).toHaveValue("6");
  await expect(
    page
      .getByTestId(
        "activation-movement-activation.base.base-1-goblet-squat",
      )
      .getByText("Removed"),
  ).toBeVisible();
  await page
    .getByTestId("activation-phase-armor")
    .locator(":scope > summary")
    .click();
  await expect(
    page
      .getByTestId(
        "activation-movement-activation.armor.armor-a1-squat",
      )
      .getByText("Belt Squat"),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("activation-phase-armor")
      .getByRole("button", { name: "Tue +", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .getByTestId("activation-session-activation.base.base-lss-3")
      .getByRole("checkbox"),
  ).not.toBeChecked();
  await page.getByLabel("Base circuit 1 weekday").selectOption("5");
  await page
    .getByTestId("activation-phase-operator")
    .locator(":scope > summary")
    .click();
  await expect(
    page
      .getByTestId(
        "activation-movement-activation.operator.operator-d1-squat",
      )
      .getByText("Conventional Deadlift"),
  ).toBeVisible();
  await page.getByLabel("Operator D3 weekday").selectOption("6");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL("**/app/plan", { timeout: 30_000 });

  const { data: editedSessions, error: editedError } = await admin
    .from("planned_sessions")
    .select("id, week_index, day_index, prescription, completed_session_id")
    .eq("block_id", programInstance!.block_id);
  expect(editedError).toBeNull();
  expect(
    editedSessions!.find(
      (session) =>
        session.week_index === 0 &&
        (session.prescription as { programRef?: string }).programRef?.endsWith(
          "base-1",
        ),
    )?.day_index,
  ).toBe(5);
  expect(
    editedSessions!.find(
      (session) =>
        session.week_index === 8 &&
        (session.prescription as { programRef?: string }).programRef?.endsWith(
          "operator-d3",
        ),
    )?.day_index,
  ).toBe(6);
  expect(
    editedSessions!.find(
      (session) => session.id === completedPlanned.id,
    )?.completed_session_id,
  ).toBe(completedSession!.id);
});

test("blocks an untouched canonical Activation movement under an active limitation", async ({
  page,
  context,
  freshUser,
  seedConfig,
  admin,
  baseURL,
}) => {
  await markOnboarded(admin, freshUser.userId);
  const { data: pushup } = await admin
    .from("movements")
    .select("id")
    .eq("slug", "push-up")
    .is("user_id", null)
    .maybeSingle();
  expect(pushup).toBeTruthy();
  const { error: limitationError } = await admin.from("limitations").insert({
    user_id: freshUser.userId,
    severity: "moderate",
    kind: "E2E canonical movement gate",
    affected_movement_ids: [pushup!.id],
  });
  expect(limitationError).toBeNull();
  await signInAs(
    context,
    freshUser,
    seedConfig,
    baseURL ?? "http://localhost:3000",
  );

  await page.goto("/app/program?program=tactical-barbell");
  await page.getByTestId("loadout-opt-activation").click();
  await page.getByText("Customize template").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const deploy = page.getByRole("button", { name: "Deploy program" });
  await expect(deploy).toBeEnabled();
  await deploy.click();
  await expect(
    page.getByText(/active limitations block.*push/i),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/app\/program/);

  const { count } = await admin
    .from("program_instances")
    .select("id", { count: "exact", head: true })
    .eq("user_id", freshUser.userId);
  expect(count).toBe(0);
});
