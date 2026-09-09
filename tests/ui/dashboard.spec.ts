import { expect, test, type Route } from "@playwright/test";
import { translate } from "../../src/i18n/messages";
import { dashboardFixture, mountDashboard } from "./dashboard-fixture";

for (const locale of ["en", "pl"] as const) {
  test(`dashboard modules preserve actions and accessible dialogs (${locale})`, async ({ page }) => {
    const { requests, errors } = await mountDashboard(page);
    const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
    await expect(page.getByText("Fixture Web", { exact: true })).toBeVisible();
    if (locale === "pl") await page.getByRole("button", { name: translate("en", "language.label") }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect.poll(() => page.evaluate(() => (window as unknown as { fixtureEvents: { active: number } }).fixtureEvents.active)).toBe(1);
    await expect(page).toHaveURL("http://switcher.test/");

    await page.getByRole("button", { name: t("metadata.refresh"), exact: true }).click();
    expect(requests.at(-1)).toEqual({ path: "/api/projects/web/metadata/refresh", method: "POST", body: {} });

    await page.getByRole("button", { name: t("capacity.openSettings") }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByRole("switch", { name: t("capacity.enabled"), exact: true }).click();
    await dialog.getByLabel(t("capacity.limit"), { exact: true }).fill("3");
    await dialog.getByRole("button", { name: t("common.save"), exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(requests.at(-1)).toEqual({ path: "/api/settings/capacity", method: "POST", body: { enabled: true, limit: 3 } });

    await page.getByRole("button", { name: t("tests.openSettings") }).click();
    await dialog.getByLabel(t("tests.limit"), { exact: true }).fill("2");
    await dialog.getByRole("button", { name: t("common.save"), exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(requests.at(-1)).toEqual({ path: "/api/settings/test-queue", method: "POST", body: { limit: 2 } });

    await page.getByRole("button", { name: t("environment.settings"), exact: true }).click();
    await dialog.getByLabel(t("environment.variables"), { exact: true }).fill("APP_FEATURE=enabled");
    await dialog.getByRole("button", { name: t("common.save"), exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(requests.at(-1)).toEqual({ path: "/api/projects/web/environment-profiles", method: "POST", body: { name: "default", environment: { APP_FEATURE: "enabled" }, restart: false } });

    await page.getByRole("button", { name: t("tls.settings"), exact: true }).click();
    await dialog.getByRole("combobox", { name: t("tls.mode"), exact: true }).click();
    await page.getByRole("option", { name: t("tls.generated"), exact: true }).click();
    await dialog.getByRole("button", { name: t("common.save"), exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(requests.at(-1)).toEqual({ path: "/api/projects/web/tls", method: "POST", body: { mode: "generated", keyPath: null, certPath: null, caPath: null } });

    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    expect(requests.at(-1)).toEqual({ path: "/api/projects/web/operation", method: "POST", body: { operation: "start", worktreePath: "/fixture/web" } });
    await page.getByRole("button", { name: t("tls.settings"), exact: true }).click();
    await expect(dialog.getByRole("button", { name: t("common.save"), exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: t("tls.settings"), exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    await page.getByRole("tab", { name: t("tests.tab"), exact: true }).click();
    await page.getByRole("button", { name: t("tests.run"), exact: true }).click();
    await expect(page.getByRole("button", { name: t("tests.cancel"), exact: true })).toBeVisible();
    expect(requests.at(-1)).toEqual({ path: "/api/projects/web/tests", method: "POST", body: { worktreePath: "/fixture/web", presetId: "node:test" } });
    await page.getByText(t("tests.output"), { exact: true }).click();
    await expect(page.getByText("fixture test output", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: t("tests.cancel"), exact: true }).click();
    await expect(page.getByRole("button", { name: t("tests.cancel"), exact: true })).toBeHidden();
    expect(requests.at(-1)).toEqual({ path: "/api/test-runs/run-1/cancel", method: "POST", body: {} });

    await page.getByRole("button", { name: t("mcp.openStatus") }).click();
    await expect(dialog.getByRole("heading", { name: t("mcp.title") })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.getByRole("tab", { name: t("project.status"), exact: true }).click();
    await page.screenshot({ path: test.info().outputPath("dashboard-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: t("add.trigger"), exact: true })).toBeVisible();
    await page.getByRole("button", { name: t("add.trigger"), exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(t("add.name"), { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => (window as unknown as { fixtureEvents: { active: number } }).fixtureEvents.active)).toBe(1);
    await page.screenshot({ path: test.info().outputPath("dashboard-mobile.png"), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("rapid typed changes keep one live request in flight and one coalesced follow-up", async ({ page }) => {
  await mountDashboard(page);
  await expect(page.getByText("Fixture Web", { exact: true })).toBeVisible();
  const pending: Route[] = [];
  let active = 0;
  let maximumActive = 0;
  await page.route("**/api/dashboard/live?*", (route) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    pending.push(route);
  });
  const change = {
    epoch: "fixture", revision: 1, kinds: ["runtime"], projectIds: ["web"], allProjects: false,
    at: "2026-01-01T12:00:01.000Z",
  };
  await page.evaluate((event) => {
    const fixture = (window as unknown as { fixtureEvents: { emit(type: string, data: unknown): void } }).fixtureEvents;
    fixture.emit("changed", event);
    fixture.emit("changed", { ...event, revision: 2 });
  }, change);
  await expect.poll(() => pending.length).toBe(1);
  const runtime = dashboardFixture().projects[0].runtime;
  await pending[0].fulfill({ json: { projects: [{ projectId: "web", runtime }] } });
  active -= 1;
  await expect.poll(() => pending.length).toBe(2);
  await pending[1].fulfill({ json: { projects: [{ projectId: "web", runtime }] } });
  active -= 1;
  expect(maximumActive).toBe(1);
});

test("an SSE ready event after reconnect reconciles a quiet dashboard", async ({ page }) => {
  await mountDashboard(page);
  await expect(page.getByText("Fixture Web", { exact: true })).toBeVisible();
  let bootstraps = 0;
  await page.route("**/api/dashboard", async (route) => {
    bootstraps += 1;
    await route.fulfill({ json: dashboardFixture() });
  });
  await page.evaluate(() => {
    (window as unknown as { fixtureEvents: { emit(type: string, data: unknown): void } }).fixtureEvents.emit(
      "ready", { epoch: "fixture", revision: 2 },
    );
  });
  await expect.poll(() => bootstraps).toBe(1);
});

test("stale metadata waits for an explicit refresh", async ({ page }) => {
  const { requests } = await mountDashboard(page);
  await expect(page.getByText("Fixture Web", { exact: true })).toBeVisible();
  const stale = dashboardFixture();
  stale.projects[0].metadata = {
    status: "stale",
    lastSuccessfulAt: "2026-01-01T11:59:00.000Z",
    lastAttemptAt: "2026-01-01T11:59:00.000Z",
    retryAt: null,
    error: null,
  };
  let bootstraps = 0;
  await page.route("**/api/dashboard", async (route) => {
    bootstraps += 1;
    await route.fulfill({ json: stale });
  });
  await page.evaluate(() => {
    (window as unknown as { fixtureEvents: { emit(type: string, data: unknown): void } }).fixtureEvents.emit(
      "changed",
      { epoch: "fixture", revision: 3, kinds: ["metadata"], projectIds: ["web"], allProjects: false },
    );
  });
  await expect.poll(() => bootstraps).toBe(1);
  await expect(page.getByText(translate("en", "metadata.stale"), { exact: true })).toBeVisible();
  expect(requests.filter(({ path }) => path === "/api/projects/web/metadata/refresh")).toEqual([]);
});

for (const kind of ["bootstrap", "live"] as const) {
  test(`a ${kind} refresh preserves an operation error through connection recovery`, async ({ page }) => {
    const { errors } = await mountDashboard(page);
    await expect(page.getByText("Fixture Web", { exact: true })).toBeVisible();
    const operationPath = "**/api/projects/web/operation";
    const message = "Server limit of 2 reached.";
    await page.route(operationPath, route => route.fulfill({ status: 409, json: { error: message } }));
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const operationError = page.getByRole("alert").filter({ hasText: message });
    await expect(operationError).toBeVisible();

    let limit = 3;
    let status = 200;
    await page.route(kind === "bootstrap" ? "**/api/dashboard" : "**/api/dashboard/live?*", route => {
      const data = dashboardFixture();
      const capacity = { ...data.capacity, enabled: true, limit, available: limit };
      return route.fulfill({ status, json: status === 200
        ? kind === "bootstrap" ? { ...data, capacity } : { projects: [], capacity }
        : { error: "refresh failed" } });
    });
    let revision = 0;
    const refresh = () => page.evaluate(({ kind, revision }) => {
      (window as unknown as { fixtureEvents: { emit(type: string, data: unknown): void } }).fixtureEvents.emit(
        "changed", { epoch: "fixture", revision, kinds: [kind === "bootstrap" ? "topology" : "controller"], projectIds: [], allProjects: true },
      );
    }, { kind, revision: ++revision });
    const capacity = page.getByRole("button", { name: "Open server capacity" });
    await refresh();
    // The capacity change confirms that React applied the refresh response.
    await expect(capacity).toContainText("0/3");
    await expect(operationError).toBeVisible();

    status = 503;
    await refresh();
    const refreshError = page.getByRole("alert").filter({ hasText: "refresh failed" });
    await expect(refreshError).toBeVisible();
    status = 200; limit = 4;
    await refresh();
    await expect(capacity).toContainText("0/4");
    await expect(refreshError).toBeHidden();
    await expect(operationError).toBeVisible();

    await page.unroute(operationPath);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(operationError).toBeHidden();
    expect(errors).toEqual([]);
  });
}
