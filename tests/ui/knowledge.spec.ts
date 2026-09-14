import { expect, test, type Page } from "@playwright/test";
import { dashboardFixture, mountDashboard } from "./dashboard-fixture";

async function mountKnowledge(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem("worktree-switcher-knowledge-token", "knowledge-fixture"));
  const data = dashboardFixture(); data.projects = [];
  const fixture = await mountDashboard(page, data);
  const project = { id: "knowledge-only", name: "Knowledge without server", status: "active", writable: true, revision: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
  const records: Array<{ id: string; projectId: string; title: string; body?: string; description?: string; priority?: string; status?: string; revision: number; createdBy: string }> = [];
  const replies: Array<{ id: string; threadId: string; body: string; revision: number; createdBy: string }> = [];
  const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
  const saved = new Map<string, unknown>();
  const savedInputs = new Map<string, string>();
  let failSave = false;
  let loseResponse = false;
  await page.route("**/api/identity", route => route.fulfill({ json: { principal: { id: "owner", kind: "owner" }, credential: { kind: "owner_session" } } }));
  await page.route("**/api/knowledge", async route => {
    const request = route.request().postDataJSON(); calls.push(request);
    const { operation, input } = request;
    const pageResult = (items: unknown[]) => ({ items, nextOffset: null });
    if (operation === "projects") return route.fulfill({ json: pageResult([project]) });
    if (operation === "project") return route.fulfill({ json: project });
    if (operation === "tasks" || operation === "threads") return route.fulfill({ json: pageResult(records.filter(record => (operation === "tasks" ? "description" in record : "body" in record) && (!input.query || record.title.includes(input.query)) && (!input.status || record.status === input.status) && (!input.priority || record.priority === input.priority))) });
    if (operation === "task" || operation === "thread") return route.fulfill({ json: records.find(record => record.id === (input.taskId ?? input.threadId)) });
    if (operation === "relations") return route.fulfill({ json: pageResult([]) });
    if (operation === "replies") return route.fulfill({ json: pageResult(replies.filter(reply => reply.threadId === input.threadId)) });
    if (failSave) return route.fulfill({ status: 503, json: { code: "unavailable", error: "Unavailable" } });
    if (saved.has(input.idempotencyKey)) {
      if (savedInputs.get(input.idempotencyKey) !== JSON.stringify(input)) return route.fulfill({ status: 409, json: { code: "idempotency_conflict", error: "Different committed input" } });
      return route.fulfill({ json: { value: saved.get(input.idempotencyKey), replayed: true } });
    }
    savedInputs.set(input.idempotencyKey, JSON.stringify(input));
    if (operation === "create_reply") {
      const reply = { id: `r${replies.length}`, threadId: input.threadId, body: input.body, revision: 1, createdBy: "owner" }; replies.push(reply); saved.set(input.idempotencyKey, reply);
      return route.fulfill({ json: { value: reply, replayed: false } });
    }
    if (operation === "update_task") {
      const record = records.find(record => record.id === input.taskId)!;
      if (record.revision !== input.expectedRevision) return route.fulfill({ status: 409, json: { code: "revision_conflict", currentRevision: record.revision, error: "Conflict" } });
      Object.assign(record, { title: input.title, description: input.description, priority: input.priority, status: input.status, revision: record.revision + 1 }); saved.set(input.idempotencyKey, record);
      return route.fulfill({ json: { value: record, replayed: false } });
    }
    const record = { id: `k${records.length}`, projectId: project.id, title: input.title, ...(operation === "create_thread" ? { body: input.body } : { description: input.description, status: "open", priority: input.priority ?? "later" }), revision: 1, createdBy: "owner" };
    records.push(record);
    const value = operation === "task_from_thread" ? { task: record, relation: { targetId: input.threadId } } : record;
    saved.set(input.idempotencyKey, value);
    if (loseResponse) { loseResponse = false; return route.abort("failed"); }
    return route.fulfill({ json: { value, replayed: false } });
  });
  await page.getByRole("button", { name: "Knowledge", exact: true }).click();
  await expect(page.getByLabel("Knowledge project", { exact: true })).toHaveValue(project.id);
  return { ...fixture, records, calls, setFailure: (value: boolean) => { failSave = value; }, loseNextResponse: () => { loseResponse = true; } };
}

test("knowledge without runtime: discussion, reply, task, filters and static deep link", async ({ page }) => {
  const f = await mountKnowledge(page);
  await page.getByRole("tab", { name: "Discussions", exact: true }).click();
  await page.getByRole("button", { name: "Quick save", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Finding"); await page.getByLabel("Body", { exact: true }).fill("Evidence");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finding", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByLabel("Body", { exact: true }).fill("Confirmed"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create task from thread", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Fix finding"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fix finding", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/knowledgeTab=backlog.*record=/);
  await page.reload(); await expect(page.getByRole("heading", { name: "Fix finding", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("knowledge-desktop.png"), fullPage: true });
  await page.getByLabel("Search titles").fill("Absent"); await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(page.getByText("No entries match these filters.")).toBeVisible();
  expect(f.calls.some(call => call.operation === "tasks" && call.input.query === "Absent")).toBe(true);
  expect(f.requests).toEqual([]); expect(f.errors).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { fixtureEvents: { active: number } }).fixtureEvents.active)).toBe(1);
});

test("conflict and failed save keep drafts after reload; knowledge events avoid dashboard refresh", async ({ page }) => {
  const f = await mountKnowledge(page);
  await page.getByRole("button", { name: "Quick save", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Task"); await page.getByLabel("Body", { exact: true }).fill("Original");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  await page.getByLabel("Body", { exact: true }).fill("Local draft");
  f.records[0].description = "Other client"; f.records[0].revision = 2;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Someone changed this record.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Body", { exact: true })).toHaveValue("Local draft");
  await page.reload();
  await expect(page.getByLabel("Body", { exact: true })).toHaveValue("Local draft");
  await expect(page.getByText("Someone changed this record.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Keep draft and use current revision" }).click();
  f.setFailure(true);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saving failed.", { exact: false })).toBeVisible();
  const failedKey = f.calls.filter(call => call.operation === "update_task").at(-1)!.input.idempotencyKey;
  await page.reload(); await expect(page.getByText("Saving failed.", { exact: false })).toBeVisible();
  f.setFailure(false); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  expect(f.calls.filter(call => call.operation === "update_task").at(-1)!.input.idempotencyKey).toBe(failedKey);
  let dashboardReads = 0;
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/dashboard")) dashboardReads++; });
  f.records[0].description = "Live update"; f.records[0].revision = 4;
  await page.evaluate(() => (window as unknown as { fixtureEvents: { emit: (type: string, value: unknown) => void } }).fixtureEvents.emit("knowledge-changed", { projectIds: ["knowledge-only"] }));
  await expect(page.getByText("Live update", { exact: true })).toBeVisible(); expect(dashboardReads).toBe(0);
  expect(f.errors).toEqual([]);
});

test("Polish and mobile knowledge navigation has labeled fields and no overflow", async ({ page }) => {
  await mountKnowledge(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Switch language to Polish" }).click();
  await expect(page.getByLabel("Projekt wiedzy", { exact: true })).toBeVisible();
  expect((await page.getByLabel("Projekt wiedzy", { exact: true }).boundingBox())!.width).toBeGreaterThan(280);
  expect((await page.getByLabel("Szukaj w tytułach", { exact: true }).boundingBox())!.width).toBeGreaterThan(280);
  await page.getByRole("button", { name: "Szybki zapis", exact: true }).click();
  await expect(page.getByLabel("Tytuł", { exact: true })).toBeFocused();
  await page.getByLabel("Tytuł", { exact: true }).fill("Zadanie"); await page.keyboard.press("Tab");
  await expect(page.getByLabel("Treść", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("knowledge-mobile-pl.png"), fullPage: true });
});

test("changing credentials clears the previous principal's visible knowledge before loading", async ({ page }) => {
  const f = await mountKnowledge(page);
  f.records.push({ id: "private", projectId: "knowledge-only", title: "Private task", description: "Private content", status: "open", priority: "now", revision: 1, createdBy: "owner" });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("link", { name: "Private task", exact: true }).click();
  await expect(page.getByText("Private content", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out of knowledge" }).click();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route("**/api/identity", route => route.fulfill({ json: { principal: { id: "other-agent", kind: "agent" }, credential: { kind: "agent_token" } } }));
  await page.route("**/api/knowledge", async route => {
    requested = true;
    await gate;
    if (route.request().postDataJSON().operation === "projects") return route.fulfill({ json: { items: [], nextOffset: null } });
    return route.fulfill({ status: 403, json: { code: "knowledge_forbidden", error: "Denied" } });
  });
  try {
    await page.getByLabel("Knowledge credential", { exact: true }).fill("new-credential");
    await page.getByRole("button", { name: "Sign in to knowledge", exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByText("Private content", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Private task", { exact: true })).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByText("Could not read knowledge.", { exact: false })).toBeVisible();
  expect(f.errors).toEqual([]);
});


test("a committed save with a lost response keeps its retry key through edits and reload", async ({ page }) => {
  const f = await mountKnowledge(page);
  await page.getByRole("button", { name: "Quick save", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Original title");
  await page.getByLabel("Body", { exact: true }).fill("Evidence");
  f.loseNextResponse();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saving failed.", { exact: false })).toBeVisible();
  const firstKey = f.calls.filter(call => call.operation === "create_task").at(-1)!.input.idempotencyKey;
  expect(f.records).toHaveLength(1);
  await page.getByLabel("Title", { exact: true }).fill("Edited after lost response");
  await page.reload();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Edited after lost response");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("This draft was already saved with different content.", { exact: false })).toBeVisible();
  expect(f.calls.filter(call => call.operation === "create_task").at(-1)!.input.idempotencyKey).toBe(firstKey);
  expect(f.records).toHaveLength(1);
  await page.getByLabel("Title", { exact: true }).fill("Original title");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Original title", exact: true })).toBeVisible();
  expect(f.records).toHaveLength(1);
});

for (const target of ["identity", "projects"] as const) {
  test(`transient ${target} errors preserve the session and draft and offer retry after reload`, async ({ page }) => {
    const f = await mountKnowledge(page);
    await page.getByRole("button", { name: "Quick save", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Unsaved draft");
    let fail = true;
    await page.route(target === "identity" ? "**/api/identity" : "**/api/knowledge", async route => {
      if (!fail || (target === "projects" && route.request().postDataJSON().operation !== "projects")) return route.fallback();
      return target === "identity" ? route.fulfill({ status: 503, json: { error: "Unavailable" } }) : route.abort("failed");
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Could not read knowledge.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Unsaved draft");
    await expect(page.getByLabel("Knowledge credential", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Could not read knowledge.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Knowledge credential", { exact: true })).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Unsaved draft");
    await expect(page.getByText("Could not read knowledge.", { exact: false })).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });
}

for (const status of [401, 403]) {
  test(`knowledge discovery HTTP ${status} requires signing in again`, async ({ page }) => {
    await mountKnowledge(page);
    await page.route("**/api/identity", route => route.fulfill({ status, json: { error: "Denied" } }));
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByLabel("Knowledge credential", { exact: true })).toBeVisible();
    await expect(page.getByText("The knowledge session expired", { exact: false })).toBeVisible();
  });
}

test("knowledge sign-in changes only the shared stream credential, not runtime bootstrap", async ({ page }) => {
  let dashboardReads = 0;
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/dashboard")) dashboardReads++; });
  await mountKnowledge(page);
  const events = () => page.evaluate(() => {
    const value = (window as unknown as { fixtureEvents: { active: number; opened: number; lastKnowledgeToken: string } }).fixtureEvents;
    return { active: value.active, opened: value.opened, token: value.lastKnowledgeToken };
  });
  await expect.poll(events).toEqual({ active: 1, opened: 1, token: "Bearer knowledge-fixture" });
  expect(dashboardReads).toBe(1);
  await page.getByRole("button", { name: "Sign out of knowledge" }).click();
  await expect.poll(events).toEqual({ active: 1, opened: 2, token: "" });
  expect(dashboardReads).toBe(1);
  await page.getByLabel("Knowledge credential", { exact: true }).fill("second-credential");
  await page.getByRole("button", { name: "Sign in to knowledge", exact: true }).click();
  await expect(page.getByLabel("Knowledge project", { exact: true })).toBeVisible();
  await expect.poll(events).toEqual({ active: 1, opened: 3, token: "Bearer second-credential" });
  expect(dashboardReads).toBe(1);
  // A runtime revision missed during credential replacement still requires reconciliation.
  await page.evaluate(() => { (window as unknown as { fixtureEvents: { version: { revision: number } } }).fixtureEvents.version.revision++; });
  await page.getByRole("button", { name: "Sign out of knowledge" }).click();
  await expect.poll(() => dashboardReads).toBe(2);
  await expect.poll(events).toEqual({ active: 1, opened: 4, token: "" });
});

test("Back and Forward never initialize an editor from the previous record", async ({ page }) => {
  const f = await mountKnowledge(page);
  f.records.push(
    { id: "a", projectId: "knowledge-only", title: "Task A", description: "Body A", status: "open", priority: "now", revision: 1, createdBy: "owner" },
    { id: "b", projectId: "knowledge-only", title: "Task B", description: "Body B", status: "open", priority: "now", revision: 1, createdBy: "owner" },
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("link", { name: "Task A", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Task A", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Task B", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Task B", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Task B");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Task A", exact: true })).toBeVisible();
  let requested = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/knowledge", async route => {
    const { operation, input } = route.request().postDataJSON();
    if (operation === "task" && input.taskId === "b") { requested = true; await gate; }
    return route.fallback();
  });
  try {
    await page.goForward();
    await expect(page).toHaveURL(/record=b.*knowledgeEditor=edit/);
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByLabel("Title", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Task A", exact: true })).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Task B");
  await expect(page.getByLabel("Body", { exact: true })).toHaveValue("Body B");
  await page.getByLabel("Body", { exact: true }).fill("Updated B");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  expect(f.calls.filter(call => call.operation === "update_task").at(-1)!.input.taskId).toBe("b");
  expect(f.records[0].description).toBe("Body A");
  expect(f.records[1].description).toBe("Updated B");
  expect(f.errors).toEqual([]);
});
