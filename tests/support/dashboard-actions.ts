import type { Page } from "@playwright/test";

export async function selectDashboardProject(page: Page, projectName: string) {
  const switcher = page.getByRole("combobox", { name: /Choose project/ });
  await switcher.click();
  await page.getByRole("textbox", { name: "Filter projects…" }).fill(projectName);
  await page.getByRole("option").filter({ hasText: projectName }).click();
  return page.locator(`[data-project-id]`).filter({ hasText: projectName });
}
