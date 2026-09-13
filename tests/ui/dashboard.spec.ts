import { expect, test, type Route } from "@playwright/test";
import { translate } from "../../src/i18n/messages";
import { dashboardFixture, mountDashboard } from "./dashboard-fixture";

test("overview metrics lead to combined filters and persistent size sorting", async ({ page }) => {
  const data = dashboardFixture();
  const snapshot = data.projects[0];
  const initial = snapshot.worktrees[0];
  snapshot.worktrees = ["main", "done", "working"].map((branch) => ({ ...initial, branch, path: `/fixture/${branch}`, isDefaultBranch: branch === "main", merged: branch === "done", mergedInto: "main", lastCommitAt: "2020-01-01T00:00:00Z" }));
  snapshot.lastLaunchedAt = { "/fixture/done": "2020-01-01T00:00:00Z", "/fixture/working": new Date().toISOString() };
  snapshot.storage = snapshot.worktrees.slice(0, 2).map((w, index) => ({ worktreePath: w.path, status: "available", totalBytes: (index + 1) * 1024, nextBytes: 0, nextCacheBytes: 0, nodeModulesBytes: 0, otherBytes: 0, measuredAt: "2026-01-01T00:00:00Z", topDirectories: [], history: [], error: null }));
  const { requests, errors } = await mountDashboard(page, data);
  const overview = page.locator("[data-worktree-overview]");
  await expect(overview.getByText("No server is running", { exact: true })).toBeVisible();
  await expect(overview.getByText("Measured 2 of 3 worktrees", { exact: true })).toBeVisible();
  await overview.getByRole("button", { name: /Disk usage/ }).click();
  await expect(page.locator("tbody tr").first()).toContainText("done");
  await expect(page.locator("tbody tr").last()).toContainText("working");
  await page.getByRole("combobox", { name: "Show", exact: true }).click();
  await page.getByRole("option", { name: "Inactive and merged", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("done");
  await page.screenshot({ path: test.info().outputPath("overview-filtered.png"), animations: "disabled", fullPage: true });
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Sort by", exact: true })).toContainText("Largest first");
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`worktree search and pagination preserve the operation target at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const data = dashboardFixture();
    const initial = data.projects[0].worktrees[0];
    data.projects[0].worktrees = Array.from({ length: 25 }, (_, i) => ({
      ...initial, path: `/fixture/checkout-${i}`, branch: `feature-${i}`, head: `${i.toString(16).padStart(8, "0")}abcdef`, shortHead: i.toString(16).padStart(8, "0"),
    }));
    data.projects[0].project.selectedWorktreePath = data.projects[0].worktrees[0].path;
    const { requests, errors } = await mountDashboard(page, data);
    const rows = page.locator("tbody tr");
    const pagination = page.getByRole("navigation", { name: "Worktree list pages" });
    const previous = pagination.getByRole("button", { name: "Previous", exact: true });
    const next = pagination.getByRole("button", { name: "Next", exact: true });
    await expect(rows).toHaveCount(10);
    await expect(previous).toBeDisabled();
    await next.click();
    await expect(rows.first()).toContainText("feature-10");
    await next.click();
    await expect(rows).toHaveCount(5);
    await expect(next).toBeDisabled();
    await page.getByRole("button", { name: "Select worktree feature-24", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "Search worktrees" });
    await search.fill("FEATURE-1");
    await expect(rows).toHaveCount(10);
    await expect(previous).toBeDisabled();
    await expect(pagination).toContainText("1 / 2");
    await search.fill("checkout-7");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("feature-7");
    await search.fill("00000018");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("feature-24");
    await search.fill("no-such-worktree");
    await expect(page.getByText("No matching worktrees.", { exact: true })).toBeVisible();
    await expect(previous).toBeDisabled();
    await expect(next).toBeDisabled();
    await expect(page.locator("#worktree-web")).toContainText("feature-24");
    await search.fill("");
    await expect(rows).toHaveCount(10);
    await expect(page.locator("#worktree-web")).toContainText("feature-24");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath("worktree-pagination.png"), animations: "disabled", fullPage: true });
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("sidebar follows the project picker and preserves the selected worktree across sections", async ({ page }) => {
  const data = dashboardFixture();
  const initial = data.projects[0].worktrees[0];
  data.projects[0].worktrees.push({ ...initial, path: "/fixture/alternate", branch: "feature/alternate" });
  const second = structuredClone(data.projects[0]);
  second.project.id = "api";
  second.project.name = "Fixture API";
  second.runtime.logs = ["api-only-log-entry"];
  data.projects.push(second);
  const { requests, errors } = await mountDashboard(page, data);
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("button", { name: "Projects", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Select worktree feature/alternate", exact: true }).click();
  await nav.getByRole("button", { name: "Tests", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Tests", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.locator("#worktree-web")).toContainText("feature/alternate");
  await expect(page.getByText(translate("en", "tests.history"), { exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "Resources", exact: true }).click();
  await expect(page.getByText(translate("en", "storage.noWorktrees"), { exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "Worktrees", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select worktree feature/alternate", exact: true })).toHaveAttribute("aria-pressed", "true");
  await nav.getByRole("button", { name: "Logs", exact: true }).click();
  await page.getByRole("combobox", { name: /Choose project/ }).click();
  await page.getByRole("option", { name: /Fixture API/ }).click();
  await expect(nav.getByRole("button", { name: "Logs", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("api-only-log-entry", { exact: true })).toBeVisible();
  await expect(page.locator('[data-project-id="web"]')).toHaveCount(0);
  expect(requests).toEqual([]);
  await expect.poll(() => page.evaluate(() => (window as unknown as { fixtureEvents: { active: number } }).fixtureEvents.active)).toBe(1);
  expect(errors).toEqual([]);
});

test("mobile sidebar supports keyboard dismissal, focus return and section selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await mountDashboard(page);
  const trigger = page.getByRole("button", { name: "Toggle navigation", exact: true });
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: translate("en", "dashboard.navigation") });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Worktrees", exact: true })).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("sidebar-mobile.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await sheet.getByRole("button", { name: "Tests", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("heading", { name: "Tests", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await trigger.click();
  await expect(sheet.getByRole("button", { name: "Tests", exact: true })).toHaveAttribute("aria-current", "page");
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

for (const locale of ["en", "pl"] as const) {
  test(`dashboard modules preserve actions and accessible dialogs (${locale})`, async ({ page }) => {
    const { requests, errors } = await mountDashboard(page);
    const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
    await expect(page.locator('[data-project-id="web"]').getByText("Fixture Web", { exact: true })).toBeVisible();
    if (locale === "pl") await page.getByRole("button", { name: translate("en", "language.label") }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect.poll(() => page.evaluate(() => (window as unknown as { fixtureEvents: { active: number } }).fixtureEvents.active)).toBe(1);
    await expect.poll(() => page.evaluate(() => {
      const events = (window as unknown as { fixtureEvents: { lastUrl: string; lastToken: string } }).fixtureEvents;
      return { url: events.lastUrl, token: events.lastToken };
    })).toEqual({ url: "/api/events", token: "ui-fixture-token" });
    await expect(page).toHaveURL("http://switcher.test/");

    await page.getByRole("button", { name: t("metadata.refresh"), exact: true }).click();
    expect(requests.at(-1)).toEqual({ path: "/api/projects/web/metadata/refresh", method: "POST", body: {} });
    const notice = page.getByRole("status");
    await expect(notice).toContainText(translate(locale, "metadata.refreshed", { name: "Fixture Web" }));
    await expect(notice).toBeInViewport();
    await notice.getByRole("button", { name: t("common.close"), exact: true }).click();
    await expect(notice).toBeEmpty();
    await page.getByRole("button", { name: t("metadata.refresh"), exact: true }).click();
    await expect(notice).toContainText(translate(locale, "metadata.refreshed", { name: "Fixture Web" }));
    await expect(page.getByRole("button", { name: t("project.restart"), exact: true })).toBeVisible();

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

    await page.getByRole("navigation").getByRole("button", { name: t("dashboard.navTests"), exact: true }).click();
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
    await page.getByRole("navigation").getByRole("button", { name: t("dashboard.navWorktrees"), exact: true }).click();
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

    await page.getByRole("button", { name: t("project.remove"), exact: true }).click();
    dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: translate(locale, "project.removeTitle", { name: "Fixture Web" }) })).toBeVisible();
    await dialog.getByRole("button", { name: t("project.confirmRemove"), exact: true }).click();
    await expect(page.locator('[data-project-id="web"]')).toBeHidden();
    expect(requests.at(-1)).toEqual({ path: "/api/projects/web", method: "DELETE", body: {} });
    expect(errors).toEqual([]);
  });
}

test("the global project switcher filters projects and persists the selection", async ({ page }) => {
  const data = dashboardFixture();
  const second = structuredClone(data.projects[0]);
  second.project.id = "api";
  second.project.name = "Fixture API";
  second.project.repositoryPath = "/fixture/api";
  data.projects.push(second);
  await mountDashboard(page, data);

  const switcher = page.getByRole("combobox", { name: translate("en", "projectSwitcher.label") });
  await expect(switcher).toContainText("Fixture Web");
  await expect(page.locator('[data-project-id="web"]')).toBeVisible();
  await expect(page.locator('[data-project-id="api"]')).toBeHidden();

  await switcher.click();
  const search = page.getByRole("textbox", { name: translate("en", "projectSwitcher.search") });
  await search.fill("api");
  await expect(page.getByRole("option", { name: /Fixture Web/ })).toBeHidden();
  await search.press("ArrowDown");
  const apiOption = page.getByRole("option", { name: /Fixture API/ });
  await expect(apiOption).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("project-switcher-filtered.png") });
  await apiOption.press("Enter");
  await expect(switcher).toContainText("Fixture API");
  await expect(page.locator('[data-project-id="api"]')).toBeVisible();
  await expect(page.locator('[data-project-id="web"]')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("worktree-switcher-project-selection"))).toBe(
    JSON.stringify({ version: 1, projectId: "api" }),
  );

  await page.reload();
  await expect(switcher).toContainText("Fixture API");
  await expect(page.locator('[data-project-id="api"]')).toBeVisible();
});

test("a failed refresh after project removal does not leave the stale card disabled", async ({ page }) => {
  const { requests, errors } = await mountDashboard(page, dashboardFixture(), {
    failDashboardRefreshAfterProjectRemoval: true,
  });

  await page.getByRole("button", { name: translate("en", "project.remove"), exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", {
    name: translate("en", "project.confirmRemove"),
    exact: true,
  }).click();

  await expect(page.getByRole("alert").getByText("Fixture dashboard refresh failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: translate("en", "project.remove"), exact: true })).toBeEnabled();
  expect(requests.at(-1)).toEqual({ path: "/api/projects/web", method: "DELETE", body: {} });
  expect(errors).toEqual([]);
});

test("a stale persisted project id falls back to an available project", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("worktree-switcher-project-selection", JSON.stringify({ version: 1, projectId: "removed-project" }));
  });
  await mountDashboard(page);

  await expect(page.locator('[data-project-id="web"]')).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Choose project/ })).toContainText("Fixture Web");
});

test("rapid typed changes keep one live request in flight and one coalesced follow-up", async ({ page }) => {
  await mountDashboard(page);
  await expect(page.locator('[data-project-id="web"]').getByText("Fixture Web", { exact: true })).toBeVisible();
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

test("worktree row selection updates the operation target", async ({ page }) => {
  const data = dashboardFixture();
  const initial = data.projects[0].worktrees[0];
  data.projects[0].worktrees.push({
    ...initial,
    path: "/fixture/web-alternate",
    branch: "feature/alternate",
    head: "1234567890abcdef",
    shortHead: "1234567",
  });
  await mountDashboard(page, data);

  await page.getByRole("button", { name: "Select worktree feature/alternate", exact: true }).click();

  await expect(page.locator("#worktree-web")).toContainText("feature/alternate");
  await expect(page.locator("[data-operation-target]")).toContainText("feature/alternate");
  await expect(page.locator("[data-operation-target]")).toContainText("1234567");
  await expect(page.locator("[data-operation-target]")).toContainText("No server is running");
});

test("a failed runtime reports its location without claiming it is running", async ({ page }) => {
  const data = dashboardFixture();
  const snapshot = data.projects[0];
  snapshot.runtime.phase = "failed";
  snapshot.runtime.worktreePath = snapshot.worktrees[0].path;
  snapshot.runtime.error = "fixture failure";
  await mountDashboard(page, data);

  const card = page.locator('[data-project-id="web"]');
  await expect(card.getByText("Failed", { exact: true })).toHaveCount(1);
  await expect(card.getByText("Running", { exact: true })).toHaveCount(0);
  await expect(card.locator("[data-operation-target]")).toContainText("No server is running");
});

test("an SSE ready event after reconnect reconciles a quiet dashboard", async ({ page }) => {
  await mountDashboard(page);
  await expect(page.locator('[data-project-id="web"]').getByText("Fixture Web", { exact: true })).toBeVisible();
  let bootstraps = 0;
  await page.route("**/api/dashboard", async (route) => {
    bootstraps += 1;
    await route.fulfill({ json: dashboardFixture() });
  });
  await page.evaluate(() => {
    (window as unknown as { fixtureEvents: { disconnect(): void } }).fixtureEvents.disconnect();
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { fixtureEvents: { active: number } }).fixtureEvents.active)).toBe(1);
  await expect.poll(() => bootstraps).toBe(1);
});

test("stale metadata waits for an explicit refresh", async ({ page }) => {
  const { requests } = await mountDashboard(page);
  await expect(page.locator('[data-project-id="web"]').getByText("Fixture Web", { exact: true })).toBeVisible();
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
  await expect(page.getByText(translate("en", "metadata.stale"), { exact: true })).toHaveCount(0);
  await page.locator("[data-worktree-overview] details summary").click();
  await expect(page.getByText(/^Last successful read:/)).toBeVisible();
  expect(requests.filter(({ path }) => path === "/api/projects/web/metadata/refresh")).toEqual([]);
});

for (const kind of ["bootstrap", "live"] as const) {
  test(`a ${kind} refresh preserves an operation error through connection recovery`, async ({ page }) => {
    const { errors } = await mountDashboard(page);
    await expect(page.locator('[data-project-id="web"]').getByText("Fixture Web", { exact: true })).toBeVisible();
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

for (const status of ["stale", "unavailable"] as const) {
  test(`metadata ${status} with a read error remains a warning`, async ({ page }) => {
    const data = dashboardFixture();
    data.projects[0].metadata = {
      status, error: "Git read failed", retryAt: null,
      lastAttemptAt: "2026-01-01T12:00:00.000Z",
      lastSuccessfulAt: status === "unavailable" ? null : "2026-01-01T11:59:00.000Z",
    };
    await mountDashboard(page, data);
    await expect(page.getByRole("alert").filter({ hasText: translate("en", `metadata.${status}`) })).toBeVisible();
  });
}

for (const width of [390, 768, 1440]) {
  test(`long worktree names fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const data = dashboardFixture();
    data.projects[0].worktrees[0].branch = "feat-dual-region-production-stacks-with-a-very-long-branch-name";
    data.projects[0].worktrees[0].dirty = true;
    data.projects[0].project.repositoryPath = "/home/example/development/a-very-long-repository-directory-name";
    const { errors } = await mountDashboard(page, data);
    await expect(page.locator('[data-project-id="web"]').getByText("Fixture Web", { exact: true })).toBeVisible();
    await expect(page.locator("dt").filter({ hasText: /^Preset$/ }).locator("+ dd")).toHaveText(translate("en", "preset.node"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const control of [page.getByRole("button", { name: "Start", exact: true }), page.locator("#worktree-web"), page.getByRole("button", { name: translate("en", "metadata.refresh"), exact: true })]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await page.locator("#worktree-web").click();
    await expect(page.getByRole("option")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("option")).toBeHidden();
    const path = page.locator('[data-slot="card-description"]');
    const pathBox = await path.boundingBox();
    expect(pathBox!.x + pathBox!.width).toBeLessThanOrEqual(width - 16);
    await page.getByRole("button", { name: translate("en", "language.label") }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/dashboard-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

for (const { width, count } of [{ width: 390, count: 12 }, { width: 1440, count: 12 }, { width: 390, count: 50 }, { width: 1440, count: 50 }]) {
  test(`worktree menu shows multiple rows and selects the last of ${count} worktrees at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const data = dashboardFixture();
    const initial = data.projects[0].worktrees[0];
    data.projects[0].worktrees = Array.from({ length: count }, (_, index) => ({
      ...initial, path: `${initial.path}-${index}`, branch: `feature-${index}-with-a-long-worktree-name`,
    }));
    data.projects[0].project.selectedWorktreePath = data.projects[0].worktrees[0].path;
    await mountDashboard(page, data);
    const trigger = page.locator("#worktree-web");
    await trigger.click();
    const options = page.getByRole("option");
    await expect(options).toHaveCount(count);
    const viewport = page.locator("[data-radix-select-viewport]");
    const firstBox = await options.first().boundingBox();
    const viewportBox = await viewport.boundingBox();
    expect(viewportBox!.height).toBeGreaterThanOrEqual(firstBox!.height * 3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(options.first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(options.last()).toBeFocused();
    await expect(options.last()).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(trigger).toContainText(`feature-${count - 1}-with-a-long-worktree-name`);
    await expect(trigger).toBeFocused();
  });
}
