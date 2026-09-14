import { afterEach, describe, expect, it } from "vitest";
import { startControllerFixture, type ControllerFixture } from "../support/controller-fixture";
import type { KnowledgeMutationResult, KnowledgePage, KnowledgeTask, KnowledgeThread } from "../../src/shared/contracts/knowledge";

describe("built knowledge controller and CLI", () => {
  let fixture: ControllerFixture | undefined;
  afterEach(async () => { await fixture?.close(); fixture = undefined; });

  it("keeps knowledge and idempotency across restart with no runtime projects", async () => {
    fixture = await startControllerFixture(0);
    const owner = await fixture.request<{ token: string; principalId: string }>("/api/identity/bootstrap", { method: "POST", body: "{}" });
    const admin = <T>(input: unknown) => fixture!.request<T>("/api/identity/admin", { method: "POST", headers: { Authorization: `Bearer ${owner.token}` }, body: JSON.stringify(input) });
    const { project } = await admin<{ project: { id: string } }>({ action: "create-knowledge-project", name: "Detached knowledge" });
    await admin({ action: "grant-knowledge", principalId: owner.principalId, projectId: project.id, permissions: ["knowledge:read", "knowledge:write"] });
    const { principal } = await admin<{ principal: { id: string } }>({ action: "create-agent" });
    await admin({ action: "grant-knowledge", principalId: principal.id, projectId: project.id, permissions: ["knowledge:read", "knowledge:write"] });
    const agent = await admin<{ token: string }>({ action: "issue-agent-token", principalId: principal.id, label: "integration" });
    const mcp = await fixture.mcp(agent.token);
    let thread: KnowledgeThread;
    try {
      thread = (await mcp.call<KnowledgeMutationResult<KnowledgeThread>>("knowledge_create_thread", { projectId: project.id, title: "Finding", body: "Evidence", idempotencyKey: "finding" })).value;
      expect((await mcp.call<KnowledgePage<KnowledgeThread>>("knowledge_threads", { projectId: project.id })).items).toHaveLength(1);
    } finally { await mcp.close(); }
    const args = ["knowledge", "task_from_thread", "--json", JSON.stringify({ projectId: project.id, threadId: thread.id, title: "Fix", description: "Acceptance", idempotencyKey: "cli-task" })];
    const environment = { WORKTREE_SWITCHER_KNOWLEDGE_TOKEN: agent.token };
    const first = JSON.parse(await fixture.cli(args, environment)) as KnowledgeMutationResult<{ task: KnowledgeTask }>;
    await fixture.restart();
    const retry = JSON.parse(await fixture.cli(args, environment)) as KnowledgeMutationResult<{ task: KnowledgeTask }>;
    expect(retry.value).toEqual(first.value); expect(retry.replayed).toBe(true);
    const tasks = JSON.parse(await fixture.cli(["knowledge", "tasks", "--json", JSON.stringify({ projectId: project.id })], environment)) as KnowledgePage<KnowledgeTask>;
    expect(tasks.items).toHaveLength(1);
    const dashboard = await fixture.request<{ projects: unknown[] }>("/api/dashboard");
    expect(dashboard.projects).toEqual([]);
  });
});
