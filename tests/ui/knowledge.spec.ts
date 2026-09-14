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

async function mountMemory(page: Page) {
  const fixture = await mountKnowledge(page);
  const memories: import("../../src/shared/contracts/knowledge-memory").KnowledgeMemory[] = [];
  const saved = new Map<string, unknown>();
  const entries: unknown[] = [];
  let loseResponse = false;
  await page.route("**/api/knowledge", async route => {
    const { operation, input } = route.request().postDataJSON();
    const record = memories.find(item => item.id === input.memoryId);
    const pageResult = (items: unknown[]) => ({ items, nextOffset: null });
    if (operation === "search") return route.fulfill({ json: pageResult(memories.filter(item => (input.includeInactive || item.status === "active") && (!input.query || `${item.title} ${item.body}`.includes(input.query))).map(item => ({ ...item, kind: "memory", excerpt: item.body.slice(0, 300), threadId: null }))) });
    if (operation === "memory") return route.fulfill({ json: record });
    if (operation === "history") return route.fulfill({ json: pageResult(entries) });
    if (operation === "task_context" || operation === "export_context") {
      const task = fixture.records.find(item => item.id === input.taskId)!;
      const items = memories.filter(item => item.status === "active").map(item => ({ ...item, excerpt: item.body, bodyTruncated: false, sourceStates: item.sources.map(source => ({ source, currentRevision: 1, stale: false, inactive: false })) }));
      const context = { formatVersion: 1, generatedAt: "2026-09-14", projectId: input.projectId, task, scope: task.description, scopeTruncated: false, decisions: items.filter(item => item.category === "decision" && item.approval), proposals: items.filter(item => item.category !== "question" && !item.approval), openQuestions: items.filter(item => item.category === "question"), evidence: [], nextOffset: null, fingerprint: `version-${memories.map(item => item.revision).join("-")}` };
      if (operation === "task_context") return route.fulfill({ json: context });
      return route.fulfill({ json: { ...context, format: input.format, content: JSON.stringify(context) } });
    }
    if (!["create_memory", "update_memory", "approve_memory", "archive_memory", "restore_memory", "supersede_memory"].includes(operation)) return route.fallback();
    if (saved.has(input.idempotencyKey)) return route.fulfill({ json: { value: saved.get(input.idempotencyKey), replayed: true } });
    if (operation !== "create_memory" && record?.revision !== input.expectedRevision) return route.fulfill({ status: 409, json: { code: "revision_conflict", currentRevision: record?.revision, error: "Conflict" } });
    let value = record;
    if (operation === "create_memory") {
      value = { ...input, id: `memory-${memories.length}`, revision: 1, status: "active", approval: null, supersededBy: null, createdBy: "owner", createdAt: "2026-09-14", updatedAt: "2026-09-14" };
      memories.push(value!);
    } else {
      entries.push({ id: entries.length, operation, revision: record!.revision + 1, previousJson: JSON.stringify(record), principalId: "owner" });
      Object.assign(record!, { revision: record!.revision + 1, approval: null });
      if (operation === "update_memory") Object.assign(record!, { title: input.title, body: input.body, category: input.category, tags: input.tags, legacyId: input.legacyId, sources: input.sources });
      if (operation === "approve_memory") record!.approval = { revision: record!.revision, principalId: "owner", approvedAt: "2026-09-14" };
      if (operation === "archive_memory") record!.status = "archived";
      if (operation === "restore_memory") record!.status = "active";
      if (operation === "supersede_memory") { record!.status = "superseded"; record!.supersededBy = { id: input.replacementId, revision: input.replacementRevision }; }
    }
    saved.set(input.idempotencyKey, structuredClone(value));
    if (loseResponse) { loseResponse = false; return route.abort("failed"); }
    return route.fulfill({ json: { value, replayed: false } });
  });
  await page.getByRole("button", { name: "Quick save", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("K4 task");
  await page.getByLabel("Body", { exact: true }).fill("Preserve decisions between sessions");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "K4 task", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Memory", exact: true }).click();
  return { ...fixture, memories, loseResponse: () => { loseResponse = true; } };
}

async function addMemory(page: Page, title: string, category = "decision") {
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Body", { exact: true }).fill("Use one SQLite owner");
  await page.getByLabel("Memory category", { exact: true }).selectOption(category);
  await page.getByLabel("Source record ID", { exact: true }).fill("k0");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
}

test("memory approval, edit invalidation, archive, supersession and context export", async ({ page }) => {
  const f = await mountMemory(page);
  await addMemory(page, "Storage decision");
  await page.getByRole("button", { name: "Approve this revision", exact: true }).click();
  await expect(page.getByText("Approved by owner, revision 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit memory", exact: true }).click();
  await page.getByLabel("Body", { exact: true }).fill("Use SQLite with revision history");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Active · Proposed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Archive memory", exact: true }).click();
  await expect(page.getByText("Archived · Proposed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore memory", exact: true }).click();
  await page.getByRole("button", { name: "Approve this revision", exact: true }).click();
  await expect(page.getByText("Approved by owner, revision 6", { exact: true })).toBeVisible();
  await addMemory(page, "Retention question", "question");
  await page.getByRole("tab", { name: "Backlog", exact: true }).click();
  await page.getByRole("link", { name: "K4 task", exact: true }).click();
  await page.getByRole("button", { name: "Next session context", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Approved decisions", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Retention question/ })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("task-context-k0-0.json");
  f.memories[1].revision++;
  await page.getByRole("button", { name: "Next session context", exact: true }).click();
  await expect(page.getByText("The downloaded export is now out of date. Download a new version.", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath("k4-context-desktop.png"), fullPage: true });
  await page.getByRole("tab", { name: "Memory", exact: true }).click();
  await addMemory(page, "Replacement");
  await page.getByRole("link", { name: "Storage decision", exact: true }).click();
  await page.getByLabel("Replacement memory ID", { exact: true }).fill("memory-2");
  await page.getByRole("button", { name: "Supersede with this record", exact: true }).click();
  await expect(page.getByText("Superseded · Proposed", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Replacement: memory-2 · r1", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Switch language to Polish" }).click();
  await expect(page.getByRole("button", { name: "Zatwierdź tę rewizję", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Szukaj w tytułach, treści i pamięci", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("k4-memory-mobile-pl.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
});

test("memory draft retries a lost response after reload without duplicating the record", async ({ page }) => {
  const f = await mountMemory(page);
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Recovered memory");
  await page.getByLabel("Body", { exact: true }).fill("Evidence");
  await page.getByLabel("Source record ID", { exact: true }).fill("k0");
  f.loseResponse();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saving failed.", { exact: false })).toBeVisible();
  expect(f.memories).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Recovered memory");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recovered memory", exact: true })).toBeVisible();
  expect(f.memories).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test("context pagination returns to the actual preceding page after a byte-limited page", async ({ page }) => {
  const f = await mountMemory(page);
  const offsets: number[] = [];
  await page.route("**/api/knowledge", route => {
    const { operation, input } = route.request().postDataJSON();
    if (operation !== "task_context") return route.fallback();
    offsets.push(input.offset);
    return route.fulfill({ json: { formatVersion: 1, projectId: input.projectId, task: f.records[0], scope: `Context page ${input.offset}`, decisions: [], proposals: [], openQuestions: [], evidence: [], nextOffset: input.offset === 0 ? 7 : input.offset === 7 ? 14 : null, fingerprint: "test", scopeTruncated: false } });
  });
  await page.getByRole("tab", { name: "Backlog", exact: true }).click();
  await page.getByRole("link", { name: "K4 task", exact: true }).click();
  await page.getByRole("button", { name: "Next session context", exact: true }).click();
  const section = page.getByRole("button", { name: "Next session context", exact: true }).locator("..");
  await expect(section.getByText("Context page 0", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(section.getByText("Context page 7", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(section.getByText("Context page 14", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(section.getByText("Context page 7", { exact: true })).toBeVisible();
  expect(offsets).toEqual([0, 7, 14, 7]);
  await section.getByLabel("Entries per context page", { exact: true }).selectOption("1");
  await expect(section.getByText("Context page 0", { exact: true })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("dashboard Refresh retries failed memory reads and clears their error", async ({ page }) => {
  const f = await mountMemory(page);
  let failed = true;
  await page.route("**/api/knowledge", route => {
    const { operation } = route.request().postDataJSON();
    if (operation === "search" && failed) return route.fulfill({ status: 503, json: { code: "unavailable", error: "Retry" } });
    return route.fallback();
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Could not read knowledge.", { exact: false })).toBeVisible();
  failed = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Could not read knowledge.", { exact: false })).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
