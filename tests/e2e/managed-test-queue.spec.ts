import { expect, test } from "@playwright/test";

import { startControllerFixture } from "../support/controller-fixture";
import { selectDashboardProject } from "../support/dashboard-actions";

test("the real dashboard configures, queues, cancels, and retains managed test results", async ({ page }) => {
  const fixture = await startControllerFixture(2);
  try {
    const [a, b] = fixture.projects;
    await page.goto(fixture.accessUrl);

    await page.getByRole("button", { name: "Open test queue settings" }).click();
    const settings = page.getByRole("dialog");
    await settings.getByLabel("Maximum parallel tests").fill("1");
    await settings.getByRole("button", { name: "Save", exact: true }).click();

    const first = await selectDashboardProject(page, "project-a");
    await first.getByRole("tab", { name: "Tests", exact: true }).click();
    await first.getByLabel("Test preset").click();
    await page.getByRole("option", { name: "test:hold · node", exact: true }).click();
    await first.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(first.getByText("Running", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open test queue settings" })).toContainText("1/1");

    const second = await selectDashboardProject(page, "project-b");
    await second.getByRole("tab", { name: "Tests", exact: true }).click();
    await second.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(second.getByText("Queued", { exact: true })).toBeVisible();
    await expect(second.getByText(/Queue position: 1/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open test queue settings" })).toContainText("+1");

    await second.getByRole("button", { name: "Cancel test", exact: true }).click();
    await expect(second.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(second.getByRole("button", { name: "Cancel test", exact: true })).toBeHidden();

    await fixture.releaseTestGate(a!);
    await selectDashboardProject(page, "project-a");
    await first.getByRole("tab", { name: "Tests", exact: true }).click();
    await expect(first.getByText("Passed", { exact: true })).toBeVisible({ timeout: 15_000 });
    await first.getByText("Show output", { exact: true }).click();
    await expect(first.locator("pre")).toContainText("verification project-a:main hold");
    await expect(first.getByText("Source matched at observation points")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open test queue settings" })).toContainText("0/1");

    await first.getByLabel("Test preset").click();
    await page.getByRole("option", { name: "test:fail · node", exact: true }).click();
    await first.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(first.getByText("Failed", { exact: true })).toBeVisible();
    await expect(first.getByText("The test process exited with code 9.", { exact: true })).toBeVisible();
  } finally {
    await page.close();
    await fixture.close();
  }
});
