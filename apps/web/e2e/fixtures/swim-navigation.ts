import { expect, type Page } from "@playwright/test";

export async function openSwimProgramActions(page: Page) {
  const menu = page.getByTestId("swim-program-actions");
  await expect(menu).toHaveCount(1);
  if (await menu.getAttribute("open") === null) await menu.locator("summary").click();
  await expect(menu).toHaveAttribute("open", "");
}

export async function openSwimProgramHistory(page: Page) {
  const choices = page.getByRole("navigation", { name: "Program history", exact: true });
  const disclosure = choices.locator("..");
  if (await disclosure.getAttribute("open") === null) await disclosure.locator("summary").click();
  await expect(choices).toBeVisible();
}
