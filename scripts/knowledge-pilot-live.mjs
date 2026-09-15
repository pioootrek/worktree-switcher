import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

if (process.argv.length !== 3) throw new Error("Usage: node scripts/knowledge-pilot-live.mjs <prepared pilot directory>");
const root = resolve(process.argv[2]);
const marker = JSON.parse(readFileSync(join(root, "pilot.json"), "utf8"));
assert.equal(marker.liveWrites, false);
const access = JSON.parse(readFileSync(join(root, "state/service-access.json"), "utf8"));
const endpoint = new URL(access.localDashboardEndpoint);
assert.equal(endpoint.hostname, "127.0.0.1");
assert.equal(new URL(access.mcpEndpoint).hostname, "127.0.0.1");
const implementation = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceDirty = Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim());
const owner = readFileSync(join(root, "owner-token"), "utf8").trim();
const projectId = marker.projectId;
const run = randomUUID();
const checks = [];
const clients = [];
const browser = await chromium.launch({ headless: true });
let page;
async function request(path, body) {
  const response = await fetch(new URL(path, endpoint), { method: "POST", headers: { "Content-Type": "application/json", Origin: endpoint.origin, Authorization: `Bearer ${owner}` }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.ok, true, `${path}: ${result.code ?? response.status}`);
  return result;
}
async function mcp(client, operation, input) {
  const result = await client.callTool({ name: `knowledge_${operation}`, arguments: { projectId, ...input } });
  const part = result.content.find(c => c.type === "text");
  const value = JSON.parse(part.text);
  if (result.isError) throw new Error(value.code ?? "MCP operation failed");
  return value;
}
try {
  for (let i = 0; i < 2; i++) {
    const { principal } = await request("/api/identity/admin", { action: "create-agent" });
    await request("/api/identity/admin", { action: "grant-knowledge", principalId: principal.id, projectId, permissions: ["knowledge:read", "knowledge:write", "knowledge:export", "attachments:read"] });
    const { token } = await request("/api/identity/admin", { action: "issue-agent-token", principalId: principal.id, label: `K7a pilot ${run} agent ${i + 1}` });
    const client = new Client({ name: `k7a-agent-${i + 1}`, version: "1" });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(access.mcpEndpoint), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  }
  const [first, second] = clients;
  const imported = await mcp(first, "tasks", { limit: 100 });
  assert.ok(imported.items.length > 0);
  checks.push("agent 1 reads imported backlog over real MCP");
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  await page.addInitScript(token => { sessionStorage.setItem("worktree-switcher-knowledge-token", token); localStorage.setItem("worktree-switcher-locale", "en"); }, owner);
  const url = new URL(access.accessUrl);
  url.searchParams.set("view", "knowledge");
  url.searchParams.set("knowledgeProject", projectId);
  url.searchParams.set("knowledgeTab", "backlog");
  await page.goto(url.href);
  await page.getByRole("button", { name: "Quick save", exact: true }).click();
  const title = `K7a human task ${run}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Body", { exact: true }).fill("Pilot copy only: verify a human can hand work to two agents.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Edit task", exact: true }).waitFor();
  await page.screenshot({ path: join(root, "human-task.png"), fullPage: true });
  const tasks = await mcp(first, "tasks", { query: title });
  assert.equal(tasks.items.length, 1);
  const task = tasks.items[0];
  checks.push("human creates a task in GUI; agent 1 reads the same record");
  const decisionInput = { title: `K7a decision ${run}`, body: "Hub remains the authoritative write location during the pilot.", category: "decision", tags: ["pilot"], legacyId: null, sources: [{ kind: "task", id: task.id, revision: task.revision }], idempotencyKey: `${run}-decision` };
  const decision = await mcp(first, "create_memory", decisionInput);
  assert.equal((await mcp(first, "create_memory", decisionInput)).replayed, true);
  const question = await mcp(second, "create_memory", { ...decisionInput, title: `K7a question ${run}`, body: "How should archived references be presented?", category: "question", idempotencyKey: `${run}-question` });
  const forbidden = await second.callTool({ name: "knowledge_approve_memory", arguments: { projectId, memoryId: decision.value.id, expectedRevision: 1, idempotencyKey: `${run}-forbidden` } });
  assert.equal(forbidden.isError, true);
  assert.equal(JSON.parse(forbidden.content.find(c => c.type === "text").text).code, "knowledge_forbidden");
  url.searchParams.set("knowledgeTab", "memory");
  url.searchParams.set("record", decision.value.id);
  await page.goto(url.href);
  await page.getByRole("button", { name: "Approve this revision", exact: true }).click();
  await page.getByText("Active · Approved", { exact: true }).waitFor();
  const context = await mcp(second, "task_context", { taskId: task.id });
  assert.ok(context.decisions.some(item => item.id === decision.value.id));
  assert.ok(context.openQuestions.some(item => item.id === question.value.id));
  checks.push("agent 1 proposes; agent 2 asks; only the human approves in GUI; agent 2 receives approved context");
  await page.screenshot({ path: join(root, "approved-decision.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(root, "mobile-memory.png"), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  checks.push("mobile memory view has no horizontal overflow");
  writeFileSync(join(root, "live-report.json"), JSON.stringify({ implementation, sourceDirty, checks, taskId: task.id, decisionId: decision.value.id, run, cutoverApproved: false }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ checks }));
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(root, "live-failure.png"), fullPage: true });
    writeFileSync(join(root, "live-failure.txt"), await page.locator("body").innerText(), { mode: 0o600 });
  }
  throw error;
} finally {
  await browser.close();
  for (const client of clients) await client.close();
}
