import { expect, test } from "@playwright/test";
import { endpointIdentity, endpointUnavailable, startControllerFixture } from "../support/controller-fixture";

test("the real dashboard enforces, reuses, and lowers server capacity", async ({ page }) => {
  const fixture = await startControllerFixture(3);
  try {
    const [a, b, c] = fixture.projects;
    await page.goto(fixture.accessUrl);
    const card = (id: string) => page.locator(`[data-project-id="${id}"]`);

    await page.getByRole("button", { name: "Open server capacity" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("switch", { name: "Enable limit" }).click();
    await dialog.getByLabel("Maximum servers").fill("2");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    await card(a!.id).getByRole("button", { name: "Start", exact: true }).click();
    await card(b!.id).getByRole("button", { name: "Start", exact: true }).click();
    const before = await Promise.all([endpointIdentity(a!), endpointIdentity(b!)]);
    await expect(page.getByRole("button", { name: "Open server capacity" })).toContainText("2/2");
    await expect(page.getByText("project-b: start completed.", { exact: true })).toBeVisible();

    const rejected = page.waitForResponse((response) => response.url().includes(`/api/projects/${c!.id}/operation`));
    await card(c!.id).getByRole("button", { name: "Start", exact: true }).click();
    expect((await rejected).status()).toBe(409);
    await expect(page.getByRole("alert").filter({ hasText: /limit of 2/i })).toBeVisible();
    await endpointUnavailable(c!);
    expect(await Promise.all([endpointIdentity(a!), endpointIdentity(b!)])).toEqual(before);

    await card(a!.id).getByRole("button", { name: "Stop", exact: true }).click();
    await endpointUnavailable(a!);
    await expect(page.getByRole("button", { name: "Open server capacity" })).toContainText("1/2");
    await card(c!.id).getByRole("button", { name: "Start", exact: true }).click();
    await endpointIdentity(c!);

    await page.getByRole("button", { name: "Open server capacity" }).click();
    await dialog.getByLabel("Maximum servers").fill("1");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open server capacity" })).toContainText("2/1");
    await expect(card(b!.id).getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await expect(card(c!.id).getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    expect(await endpointIdentity(b!)).toEqual(before[1]);
  } finally {
    await page.close();
    await fixture.close();
  }
});
