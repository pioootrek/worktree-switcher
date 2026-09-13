import { expect, test } from "@playwright/test";
import { endpointIdentity, endpointUnavailable, startControllerFixture } from "../support/controller-fixture";
import { selectDashboardProject } from "../support/dashboard-actions";

test("the real dashboard enforces, reuses, and lowers server capacity", async ({ page }) => {
  const fixture = await startControllerFixture(3);
  const mainRow = () => page.locator("tbody tr").filter({ has: page.getByText("main", { exact: true }) });
  const startProject = async (name: string) => {
    await selectDashboardProject(page, name);
    await mainRow().getByRole("button", { name: "Start", exact: true }).click();
  };
  try {
    const [a, b, c] = fixture.projects;
    await page.goto(fixture.accessUrl);

    await page.getByRole("button", { name: "Open server capacity" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("switch", { name: "Enable limit" }).click();
    await dialog.getByLabel("Maximum servers").fill("2");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    await startProject("project-a");
    await startProject("project-b");
    const before = await Promise.all([endpointIdentity(a!), endpointIdentity(b!)]);
    await expect(page.getByRole("button", { name: "Open server capacity" })).toContainText("2/2");
    await expect(page.getByText("project-b: start completed.", { exact: true })).toBeVisible();

    const rejected = page.waitForResponse((response) => response.url().includes(`/api/projects/${c!.id}/operation`));
    await startProject("project-c");
    expect((await rejected).status()).toBe(409);
    await expect(page.getByRole("alert").filter({ hasText: /limit of 2/i })).toBeVisible();
    await endpointUnavailable(c!);
    expect(await Promise.all([endpointIdentity(a!), endpointIdentity(b!)])).toEqual(before);

    await selectDashboardProject(page, "project-a");
    await mainRow().getByRole("button", { name: "Actions for main", exact: true }).click();
    await page.getByRole("menuitem", { name: "Stop", exact: true }).click();
    await endpointUnavailable(a!);
    await expect(page.getByRole("button", { name: "Open server capacity" })).toContainText("1/2");
    await startProject("project-c");
    await endpointIdentity(c!);

    await page.getByRole("button", { name: "Open server capacity" }).click();
    await dialog.getByLabel("Maximum servers").fill("1");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open server capacity" })).toContainText("2/1");
    await selectDashboardProject(page, "project-b");
    await expect(mainRow().getByRole("button", { name: "Open", exact: true })).toBeVisible();
    await selectDashboardProject(page, "project-c");
    await expect(mainRow().getByRole("button", { name: "Open", exact: true })).toBeVisible();
    expect(await endpointIdentity(b!)).toEqual(before[1]);
  } finally {
    await page.close();
    await fixture.close();
  }
});
