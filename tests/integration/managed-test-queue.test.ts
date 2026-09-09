import { afterEach, describe, expect, it } from "vitest";

import type { TestQueueStatus, TestRun, WorktreeTestPresets } from "../../src/shared/contracts";
import { startControllerFixture, waitFor, type ControllerFixture, type FixtureMcpClient } from "../support/controller-fixture";

async function waitForPhase(
  mcp: FixtureMcpClient,
  runId: string,
  phases: TestRun["phase"][],
): Promise<TestRun> {
  return waitFor(async () => {
    const run = await mcp.call<TestRun>("get_test_run", { runId });
    return phases.includes(run.phase) ? run : null;
  }, 15_000, () => `Test run ${runId} did not reach ${phases.join(" or ")}.`);
}

describe("managed test queue through a real controller", () => {
  let fixture: ControllerFixture | undefined;
  afterEach(async () => { await fixture?.close(); fixture = undefined; });

  it("discovers and runs portable Node and Django presets with qualified source and final output", async () => {
    fixture = await startControllerFixture(2, ["node", "django"]);
    const mcp = await fixture.mcp();
    try {
      const [node, django] = fixture.projects;
      const nodePresets = await mcp.call<WorktreeTestPresets[]>("list_test_presets", { projectId: node!.id });
      const djangoPresets = await mcp.call<WorktreeTestPresets[]>("list_test_presets", { projectId: django!.id });
      expect(nodePresets.find(({ worktreePath }) => worktreePath === node!.main)?.presets.map(({ id }) => id)).toContain("node:test");
      expect(djangoPresets.find(({ worktreePath }) => worktreePath === django!.main)?.presets.map(({ id }) => id)).toContain("django:test");

      const nodeRun = await mcp.call<TestRun>("run_test", {
        projectId: node!.id, worktreePath: node!.main, presetId: "node:test", idempotencyKey: "portable-node",
      });
      const completedNode = await waitForPhase(mcp, nodeRun.id, ["passed"]);
      expect(completedNode).toMatchObject({ adapter: "node", source: { attribution: "observed_match", processOutcome: "passed" } });
      expect(completedNode.logs.join("\n")).toContain("verification project-a:main pass");

      const djangoRun = await mcp.call<TestRun>("run_test", {
        projectId: django!.id, worktreePath: django!.main, presetId: "django:test", idempotencyKey: "portable-django",
      });
      const completedDjango = await waitForPhase(mcp, djangoRun.id, ["passed"]);
      expect(completedDjango).toMatchObject({ adapter: "django", source: { attribution: "observed_match", processOutcome: "passed" } });
      expect(completedDjango.logs.join("\n")).toContain("django verification project-b:main");
    } finally { await mcp.close(); }
  });

  it("serializes one worktree, runs distinct worktrees concurrently, and honors a lowered limit", async () => {
    fixture = await startControllerFixture(2);
    const mcp = await fixture.mcp();
    try {
      const [a, b] = fixture.projects;
      await fixture.request("/api/settings/test-queue", { method: "POST", body: JSON.stringify({ limit: 2 }) });
      const first = await mcp.call<TestRun>("run_test", { projectId: a!.id, worktreePath: a!.main, presetId: "node:test:hold", idempotencyKey: "parallel-main" });
      const alternate = await mcp.call<TestRun>("run_test", { projectId: a!.id, worktreePath: a!.alternate, presetId: "node:test:hold", idempotencyKey: "parallel-alternate" });
      await Promise.all([waitForPhase(mcp, first.id, ["running"]), waitForPhase(mcp, alternate.id, ["running"])]);

      const sameWorktree = await mcp.call<TestRun>("run_test", { projectId: a!.id, worktreePath: a!.main, presetId: "node:test", idempotencyKey: "same-worktree" });
      expect((await waitForPhase(mcp, sameWorktree.id, ["queued"])).queuePosition).not.toBeNull();
      await fixture.request("/api/settings/test-queue", { method: "POST", body: JSON.stringify({ limit: 1 }) });
      const waiting = await mcp.call<TestRun>("run_test", { projectId: b!.id, worktreePath: b!.main, presetId: "node:test", idempotencyKey: "after-lower" });
      expect(await mcp.call<TestQueueStatus>("get_test_queue")).toMatchObject({ limit: 1, running: 2, queued: 2 });

      await fixture.releaseTestGate(a!, a!.main);
      await waitForPhase(mcp, first.id, ["passed"]);
      expect((await mcp.call<TestRun>("get_test_run", { runId: waiting.id })).phase).toBe("queued");
      await fixture.releaseTestGate(a!, a!.alternate);
      await Promise.all([
        waitForPhase(mcp, alternate.id, ["passed"]),
        waitForPhase(mcp, sameWorktree.id, ["passed"]),
        waitForPhase(mcp, waiting.id, ["passed"]),
      ]);

      const events = await fixture.testEvents(a!);
      const firstFinished = events.findIndex(({ event, identity }) => event === "finish" && identity === "project-a:main");
      const sameStarted = events.findIndex(({ event, identity, mode }) => event === "start" && identity === "project-a:main" && mode === "pass");
      expect(firstFinished).toBeGreaterThanOrEqual(0);
      expect(sameStarted).toBeGreaterThan(firstFinished);
    } finally { await mcp.close(); }
  });

  it("replays idempotent submissions and restricts cancellation to the creating MCP session", async () => {
    fixture = await startControllerFixture(1);
    const owner = await fixture.mcp();
    const competitor = await fixture.mcp();
    try {
      const project = fixture.projects[0]!;
      const input = { projectId: project.id, worktreePath: project.main, presetId: "node:test:hold", idempotencyKey: "owned-run" };
      const run = await owner.call<TestRun>("run_test", input);
      expect((await owner.call<TestRun>("run_test", input)).id).toBe(run.id);
      await expect(owner.call("run_test", { ...input, presetId: "node:test" })).rejects.toThrow(/idempotency key/i);
      await waitForPhase(owner, run.id, ["running"]);
      await waitFor(async () => (await fixture!.testEvents(project)).some(({ event }) => event === "start") || null,
        5_000, () => "Owned test process did not record its start.");
      await expect(competitor.call("cancel_test_run", { runId: run.id })).rejects.toThrow(/author/i);
      await owner.call("cancel_test_run", { runId: run.id });
      const cancelled = await waitForPhase(owner, run.id, ["cancelled"]);
      expect(cancelled).toMatchObject({ source: { processOutcome: "cancelled" } });
      expect((await fixture.testEvents(project)).filter(({ event }) => event === "start")).toHaveLength(1);
    } finally {
      await competitor.close();
      await owner.close();
    }
  });
});
